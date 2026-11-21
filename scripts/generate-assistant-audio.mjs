#!/usr/bin/env node
// Offline asset generation only. The website never receives a key or calls this API.
// https://developers.openai.com/api/docs/guides/realtime-conversations
// Prices checked 2026-11-16: text input $0.60/M; audio output $20/M.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {parseEnv} from 'node:util';
import WebSocket from 'ws';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const model = 'gpt-realtime-2.1-mini';
const voice = 'marin';
const sampleRate = 24000;
const maxOutputTokens = 1024;
const reserveUsd = 0.025;
const budgetUsd = 1;
const manifestPath = path.join(root, 'public/audio/assistant/v1/manifest.json');
const ledgerPath = path.join(root, 'docs/private/assistant-audio-generation-ledger.json');
const hash = data => createHash('sha256').update(data).digest('hex');

export const normalizeTranscript = text => String(text).normalize('NFKC').toLowerCase()
  .replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function wavFile(pcm) {
  if (!pcm.length || pcm.length % 2 || pcm.length > 60 * sampleRate * 2) throw new Error('invalid_audio');
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(pcm.length + 36, 4);
  header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw new Error('invalid_local_record'); }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), {recursive: true});
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
  await fs.rename(temporary, file);
}

async function loadClips() {
  // Match the parser tests: no document or tool registry means no UI is mounted.
  const win = {};
  new Function('window', 'document', 'navigator', await fs.readFile(path.join(root, 'voice-commands.js'), 'utf8'))(win, undefined, {});
  const clips = win.ArtSoulVoice?.replyClips;
  if (!Array.isArray(clips) || !clips.length || clips.length > 30) throw new Error('invalid_clip_list');
  const seen = new Set();
  for (const clip of clips) {
    const key = `${clip.lang}-${clip.id}`;
    if (!['en','ru'].includes(clip.lang) || !/^[a-z][a-zA-Z0-9]*$/.test(clip.id)
      || typeof clip.text !== 'string' || !clip.text.trim() || clip.text.length > 800
      || clip.url !== `/audio/assistant/v1/${key}.wav` || seen.has(key)) throw new Error('invalid_clip');
    seen.add(key);
  }
  return clips;
}

function generateClip(clip, apiKey) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`wss://api.openai.com/v1/realtime?model=${model}`, {
      headers: {Authorization: `Bearer ${apiKey}`}, maxPayload: 4 * 1024 * 1024,
      handshakeTimeout: 15000
    });
    const chunks = [];
    let bytes = 0, transcript = '', finished = false, configured = false, requested = false;
    const timer = setTimeout(() => finish(new Error('generation_timeout')), 45000);
    const finish = (error, result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.terminate();
      if (error) reject(error); else resolve(result);
    };
    const send = event => socket.send(JSON.stringify(event));
    socket.on('error', () => finish(new Error('connection_failed')));
    socket.on('close', () => finish(new Error('connection_closed')));
    socket.on('message', raw => {
      if (finished) return;
      try {
        const event = JSON.parse(raw.toString());
        if (event.type === 'error') return finish(new Error('api_request_failed'));
        if (event.type === 'session.created') {
          send({type: 'session.update', session: {
            type: 'realtime', output_modalities: ['audio'], max_output_tokens: maxOutputTokens,
            tools: [], tool_choice: 'none',
            instructions: `Read the supplied text verbatim in its original language (Russian or English); never translate. You are a voice renderer, not an assistant answering the text. Use a clear, calm voice. Do not add, omit, translate or reword anything. No introduction, sound effects or music.`,
            audio: {input: {turn_detection: null}, output: {format: {type: 'audio/pcm', rate: sampleRate}, voice}}
          }});
        } else if (event.type === 'session.updated' && !configured) {
          configured = true;
          send({type: 'conversation.item.create', item: {type: 'message', role: 'user', content: [{type: 'input_text', text: clip.text}]}});
        } else if (event.type === 'conversation.item.done' && configured && !requested && event.item?.role === 'user') {
          requested = true;
          send({type: 'response.create', response: {max_output_tokens: maxOutputTokens, output_modalities: ['audio']}});
        } else if (event.type === 'response.output_audio.delta') {
          const chunk = Buffer.from(event.delta, 'base64');
          bytes += chunk.length;
          if (bytes > 60 * sampleRate * 2) return finish(new Error('audio_limit_exceeded'));
          chunks.push(chunk);
        } else if (event.type === 'response.output_audio_transcript.delta') {
          transcript += event.delta;
          if (transcript.length > 2000) return finish(new Error('transcript_limit_exceeded'));
        } else if (event.type === 'response.output_audio_transcript.done') {
          transcript = event.transcript;
        } else if (event.type === 'response.done') {
          if (event.response?.status !== 'completed') return finish(new Error('response_incomplete'));
          const usage = event.response.usage;
          if (![usage?.input_tokens, usage?.output_tokens].every(value => Number.isSafeInteger(value) && value >= 0)) return finish(new Error('missing_usage'));
          const safeUsage = {input_tokens: usage.input_tokens, output_tokens: usage.output_tokens};
          const estimatedUsd = (safeUsage.input_tokens * 0.6 + safeUsage.output_tokens * 20) / 1000000;
          if (normalizeTranscript(transcript) !== normalizeTranscript(clip.text)) return finish(new Error('transcript_mismatch'));
          finish(null, {wav: wavFile(Buffer.concat(chunks)), transcript, usage: safeUsage, estimatedUsd});
        }
      } catch { finish(new Error('invalid_response')); }
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('node scripts/generate-assistant-audio.mjs [--generate] [--only en-helpSpeech,en-settled]');
    console.log('Default: dry run, no credentials read or API calls. Existing verified clips are skipped.');
    return;
  }
  let generate = false, only = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--generate') generate = true;
    else if (args[i] === '--only' && args[i + 1]) only = new Set(args[++i].split(','));
    else throw new Error('unknown_argument');
  }
  const all = await loadClips();
  if (only && [...only].some(key => !all.some(clip => `${clip.lang}-${clip.id}` === key))) throw new Error('unknown_clip');
  const clips = all.filter(clip => !only || only.has(`${clip.lang}-${clip.id}`));
  let lock;
  if (generate) {
    await fs.mkdir(path.dirname(ledgerPath), {recursive: true});
    try { lock = await fs.open(`${ledgerPath}.lock`, 'wx'); }
    catch { throw new Error('generation_already_locked'); }
  }
  try {
    const manifest = await readJson(manifestPath, {version: 1, model, voice, sample_rate: sampleRate, clips: []});
    if (manifest.version !== 1 || !Array.isArray(manifest.clips)) throw new Error('invalid_manifest');
    const pending = [];
    for (const clip of clips) {
      const existing = manifest.clips.find(item => item.url === clip.url && item.text === clip.text);
      let verified = false;
      if (existing) {
        try { verified = hash(await fs.readFile(path.join(root, 'public', clip.url))) === existing.sha256; }
        catch (error) { if (error.code !== 'ENOENT') throw new Error('asset_read_failed'); }
      }
      if (!verified) pending.push(clip);
    }
    console.log(JSON.stringify({mode: generate ? 'generate' : 'dry_run', model, pending: pending.map(clip => `${clip.lang}-${clip.id}`), reservedUsd: pending.length * reserveUsd}));
    if (!generate || !pending.length) return;
    const ledger = await readJson(ledgerPath, {version: 1, attempts: []});
    if (ledger.version !== 1 || !Array.isArray(ledger.attempts)) throw new Error('invalid_ledger');
    const reserved = ledger.attempts.reduce((sum, attempt) => sum + Number(attempt.reservedUsd), 0);
    if (!Number.isFinite(reserved) || reserved < 0 || reserved + pending.length * reserveUsd > budgetUsd) throw new Error('generation_budget_exceeded');
    let apiKey;
    try { apiKey = parseEnv(await fs.readFile(path.join(root, '.env.local'), 'utf8')).OPENAI_API_KEY; }
    catch { throw new Error('credential_unavailable'); }
    if (!apiKey) throw new Error('credential_unavailable');
    for (const clip of pending) {
      const attempt = {id: `${clip.lang}-${clip.id}`, at: new Date().toISOString(), reservedUsd: reserveUsd, status: 'started'};
      ledger.attempts.push(attempt);
      await writeJson(ledgerPath, ledger);
      try {
        const result = await generateClip(clip, apiKey);
        if (result.estimatedUsd > reserveUsd) throw new Error('unexpected_usage');
        const target = path.join(root, 'public', clip.url);
        await fs.mkdir(path.dirname(target), {recursive: true});
        await fs.writeFile(target, result.wav);
        const entry = {...clip, transcript: result.transcript, sha256: hash(result.wav), bytes: result.wav.length,
          duration_seconds: (result.wav.length - 44) / (sampleRate * 2), generated_at: attempt.at,
          model, voice, usage: result.usage, estimated_usd: result.estimatedUsd};
        manifest.clips = [...manifest.clips.filter(item => item.url !== clip.url), entry];
        await writeJson(manifestPath, manifest);
        attempt.status = 'completed'; attempt.estimatedUsd = result.estimatedUsd;
        console.log(JSON.stringify({id: attempt.id, status: 'generated', bytes: result.wav.length, estimatedUsd: result.estimatedUsd}));
      } catch (error) {
        attempt.status = 'failed';
        await writeJson(ledgerPath, ledger);
        throw error;
      }
      await writeJson(ledgerPath, ledger);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } finally {
    if (lock) {
      await lock.close();
      await fs.unlink(`${ledgerPath}.lock`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    // Never print provider messages, request headers, environment values or stacks.
    const code = /^[a-z_]+$/.test(error.message) ? error.message : 'generation_failed';
    console.error(JSON.stringify({error: code, automaticRetry: false}));
    process.exitCode = 1;
  });
}
