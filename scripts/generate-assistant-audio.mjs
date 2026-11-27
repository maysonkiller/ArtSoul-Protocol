#!/usr/bin/env node
// Offline asset generation only. The website never receives a key or calls this API.
// https://developers.openai.com/api/docs/guides/realtime-conversations
// Prices checked 2026-11-27: text input $0.60/M; audio output $20/M.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';
import {parseEnv} from 'node:util';

const root = await fs.realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const model = 'gpt-realtime-2.1-mini';
const voice = 'marin';
const sampleRate = 24000;
const maxOutputTokens = 1024;
const reserveUsd = 0.025;
const bankPath = path.join(root, 'docs/audio/assistant-phrase-bank.json');
const manifestPath = path.join(root, 'public/audio/assistant/v1/manifest.json');
const ledgerPath = path.join(root, 'docs/private/assistant-audio-generation-ledger.json');
const receivedPath = path.join(root, 'docs/private/assistant-audio-received.json');
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

async function writeAtomically(file, data) {
  await fs.mkdir(path.dirname(file), {recursive: true});
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, data, {flag: 'wx'});
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, {force: true});
  }
}

const writeJson = (file, value) => writeAtomically(file, JSON.stringify(value, null, 2) + '\n');

async function generateClip(clip, apiKey, organization) {
  const {default:WebSocket} = await import('ws');
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`wss://api.openai.com/v1/realtime?model=${model}`, {
      headers: {Authorization: `Bearer ${apiKey}`, 'OpenAI-Organization': organization}, maxPayload: 4 * 1024 * 1024,
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
            instructions: `Read the supplied text verbatim in ${clip.lang === 'ru' ? 'Russian' : 'English'} using a clear, calm voice. Do not answer, translate or add words, introductions, music or sound effects.`,
            audio: {input: {turn_detection: null}, output: {format: {type: 'audio/pcm', rate: sampleRate}, voice}}
          }});
        } else if (event.type === 'session.updated' && !configured) {
          const session = event.session;
          const output = session?.audio?.output;
          if (output?.voice !== voice || output.format?.type !== 'audio/pcm' || output.format.rate !== sampleRate ||
              session.max_output_tokens !== maxOutputTokens || session.audio?.input?.turn_detection !== null) {
            return finish(new Error('unexpected_session_configuration'));
          }
          configured = true;
          send({type: 'conversation.item.create', item: {type: 'message', role: 'user', content: [{type: 'input_text', text: clip.text}]}});
        } else if (event.type === 'conversation.item.done' && configured && !requested && event.item?.role === 'user') {
          requested = true;
          send({type: 'response.create', response: {max_output_tokens: maxOutputTokens, output_modalities: ['audio']}});
        } else if (event.type === 'response.output_audio.delta') {
          if (!requested) return finish(new Error('unexpected_audio'));
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

export function checkRecordingBudget(attempts, pending, budgetUsd) {
  if (!Array.isArray(attempts) || !Number.isFinite(budgetUsd) || budgetUsd <= 0 || budgetUsd > 100)
    throw new Error('invalid_recording_budget');
  let reserved = 0;
  const ids = new Set(pending.map(clip => clip.lang + '-' + clip.id));
  for (const attempt of attempts) {
    if (!attempt || typeof attempt.id !== 'string' || !['started','failed','completed','received'].includes(attempt.status) ||
        !Number.isFinite(attempt.reservedUsd) || attempt.reservedUsd <= 0) throw new Error('invalid_ledger');
    if (ids.has(attempt.id)) throw new Error('previous_attempt_requires_review');
    reserved += Math.round(attempt.reservedUsd * 1000000);
  }
  if (reserved + pending.length * Math.round(reserveUsd * 1000000) > Math.round(budgetUsd * 1000000)) throw new Error('generation_budget_exceeded');
}

export function checkRecordingGrant(organization, expiresAt, now = Date.now()) {
  if (typeof organization !== 'string' || !/^org-[A-Za-z0-9_-]+$/.test(organization))
    throw new Error('receiving_organization_required');
  const expires = Date.parse(expiresAt);
  // Allow the full upstream response timeout before the reviewed grant expires.
  if (!Number.isFinite(expires) || expires - now <= 45000) throw new Error('active_grant_window_required');
}

// A paid response can finish before all three public files reach disk. Replay
// only the already received bytes and receipt under the same generation lock.
async function publishReceived(bank, manifest, ledger, buildIndex) {
  const received = await readJson(receivedPath, null);
  if (!received) return false;
  const {entry} = received;
  const phrase = bank.clips.find(item => item.url === entry?.url && item.lang === entry.lang && item.id === entry.id && item.text === entry.text);
  const attempt = ledger.attempts.find(item => item.at === entry?.generated_at && item.id === entry.lang + '-' + entry.id);
  if (!phrase || !/^\/audio\/assistant\/v1\/(?:phrases\/)?(?:en|ru)-[a-z][a-zA-Z0-9]*\.wav$/.test(phrase.url) ||
      !attempt || !['started','completed'].includes(attempt.status) ||
      entry.voice !== voice || entry.model !== model || normalizeTranscript(entry.text) !== normalizeTranscript(entry.transcript)) {
    throw new Error('invalid_received_recording');
  }
  const wav = Buffer.from(received.wav, 'base64');
  if (hash(wav) !== entry.sha256 || wav.length !== entry.bytes) throw new Error('invalid_received_audio');
  const publicRoot = path.join(root, 'public');
  const target = path.join(publicRoot, phrase.url);
  if (path.resolve(await fs.realpath(path.dirname(target))) !== path.dirname(target)) throw new Error('unsafe_recording_directory');
  const previous = manifest.clips.find(item => item.url === entry.url);
  if (previous && previous.sha256 !== entry.sha256) throw new Error('existing_recording_conflict');
  const existing = await fs.readFile(target).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  if (existing && hash(existing) !== entry.sha256) throw new Error('existing_recording_conflict');
  if (!existing) await writeAtomically(target, wav);
  if (!previous) manifest.clips.push(entry);
  const index = await buildIndex(bank, manifest, publicRoot);
  await writeJson(manifestPath, manifest);
  await writeAtomically(path.join(root,'voice-phrase-bank.js'), index);
  attempt.status = 'completed';
  attempt.estimatedUsd = entry.estimated_usd;
  await writeJson(ledgerPath, ledger);
  await fs.unlink(receivedPath);
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('node scripts/generate-assistant-audio.mjs [--only en-r2Greeting,ru-r2Greeting] [--generate --budget-usd AMOUNT]');
    console.log('Default: dry run, no credentials read or API calls. Use --recover to finish a received recording without any API request.');
    return;
  }
  let generate = false, recover = false, only = null, budgetUsd;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--generate') generate = true;
    else if (args[i] === '--recover' && args.length === 1) recover = true;
    else if (args[i] === '--only' && args[i + 1]) only = new Set(args[++i].split(','));
    else if (args[i] === '--budget-usd' && args[i + 1]) budgetUsd = Number(args[++i]);
    else throw new Error('unknown_argument');
  }
  if (generate && (!only || only.size > 10 || !Number.isFinite(budgetUsd) || budgetUsd <= 0 || budgetUsd > 100))
    throw new Error('explicit_batch_and_budget_required');
  const bank = await readJson(bankPath, null);
  const all = bank?.clips;
  if (!Array.isArray(all) || !all.length) throw new Error('invalid_clip_list');
  if (only && [...only].some(key => !all.some(clip => `${clip.lang}-${clip.id}` === key))) throw new Error('unknown_clip');
  const clips = all.filter(clip => !only || only.has(`${clip.lang}-${clip.id}`));
  let lock;
  if (generate || recover) {
    await fs.mkdir(path.dirname(ledgerPath), {recursive: true});
    try { lock = await fs.open(`${ledgerPath}.lock`, 'wx'); }
    catch { throw new Error('generation_already_locked'); }
  }
  try {
    const manifest = await readJson(manifestPath, {version: 1, model, voice, sample_rate: sampleRate, clips: []});
    const {buildVoicePhraseIndex} = await import('./build-voice-phrase-index.mjs');
    const publicRoot = path.join(root, 'public');
    const ledger = generate || recover ? await readJson(ledgerPath, {version: 1, attempts: []}) : null;
    if (ledger && (ledger.version !== 1 || !Array.isArray(ledger.attempts))) throw new Error('invalid_ledger');
    if (recover) {
      console.log(JSON.stringify({recovered: await publishReceived(bank, manifest, ledger, buildVoicePhraseIndex)}));
      return;
    }
    if (generate && await readJson(receivedPath, null)) throw new Error('recover_received_recording_first');
    await buildVoicePhraseIndex(bank, manifest, publicRoot);
    const recorded = new Set(manifest.clips.map(item => item.url));
    const pending = clips.filter(clip => !recorded.has(clip.url));
    console.log(JSON.stringify({mode: generate ? 'generate' : 'dry_run', model, pending: pending.map(clip => `${clip.lang}-${clip.id}`), reservedUsd: pending.length * reserveUsd}));
    if (!generate || !pending.length) return;
    checkRecordingBudget(ledger.attempts, pending, budgetUsd);
    const local = await fs.readFile(path.join(root, '.env.local'), 'utf8').then(parseEnv, error => {
      if (error.code === 'ENOENT') return {};
      throw new Error('credential_unavailable');
    });
    const apiKey = process.env.OPENAI_API_KEY || local.OPENAI_API_KEY;
    const organization = process.env.OPENAI_ORG_ID || local.OPENAI_ORG_ID;
    if (!apiKey) throw new Error('credential_unavailable');
    const expiresAt = process.env.ARTSOUL_VOICE_GRANT_EXPIRES_AT || local.ARTSOUL_VOICE_GRANT_EXPIRES_AT;
    for (const clip of pending) {
      checkRecordingGrant(organization, expiresAt);
      const attempt = {id: `${clip.lang}-${clip.id}`, at: new Date().toISOString(), reservedUsd: reserveUsd, status: 'started'};
      ledger.attempts.push(attempt);
      await writeJson(ledgerPath, ledger);
      try {
        const result = await generateClip(clip, apiKey, organization);
        if (result.estimatedUsd > reserveUsd) throw new Error('unexpected_usage');
        const entry = {...clip, transcript: result.transcript, sha256: hash(result.wav), bytes: result.wav.length,
          duration_seconds: (result.wav.length - 44) / (sampleRate * 2), generated_at: attempt.at,
          model, voice, usage: result.usage, estimated_usd: result.estimatedUsd};
        await writeJson(receivedPath, {entry, wav: result.wav.toString('base64')});
        await publishReceived(bank, manifest, ledger, buildVoicePhraseIndex);
        console.log(JSON.stringify({id: attempt.id, status: 'generated', bytes: result.wav.length, estimatedUsd: result.estimatedUsd}));
      } catch (error) {
        if (!await readJson(receivedPath, null) && attempt.status !== 'completed') attempt.status = 'failed';
        await writeJson(ledgerPath, ledger);
        throw error;
      }
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
