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
const defaultBudgetUsd = 1;
const manifestPath = path.join(root, 'public/audio/assistant/v1/manifest.json');
const ledgerPath = path.join(root, 'docs/private/assistant-audio-generation-ledger.json');
const hash = data => createHash('sha256').update(data).digest('hex');

const PUBLIC_ERROR_CODES = new Set([
  'invalid_request_error', 'invalid_api_key', 'authentication_error',
  'permission_denied', 'insufficient_quota', 'billing_hard_limit_reached',
  'rate_limit_exceeded', 'rate_limit_error', 'model_not_found',
  'unsupported_model', 'unsupported_value', 'unknown_parameter',
  'invalid_parameter', 'server_error', 'quota_exceeded',
  'context_length_exceeded'
]);
const PUBLIC_ERROR_PARAMS = new Set([
  'session.output_modalities', 'session.max_output_tokens',
  'session.audio.output.voice', 'session.audio.output.format',
  'session.audio.input.turn_detection', 'session.tools',
  'session.tool_choice', 'response.output_modalities',
  'response.max_output_tokens', 'model'
]);
const PUBLIC_ERROR_STAGES = new Set([
  'connect', 'session_update', 'text_input', 'response_create', 'audio_stream'
]);

// Never print provider messages. They can echo user text, request bodies or secrets.
export function safeApiDiagnostic(event, stage) {
  const info = event?.error || {};
  const providerCode = [info.code, info.type].find(code => PUBLIC_ERROR_CODES.has(code)) || 'unclassified';
  const param = PUBLIC_ERROR_PARAMS.has(info.param) ? info.param : null;
  return {
    stage: PUBLIC_ERROR_STAGES.has(stage) ? stage : 'connect',
    providerCode,
    ...(param ? {providerParam: param} : {})
  };
}


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
  const builtIn = win.ArtSoulVoice?.replyClips;
  const bank = await readJson(path.join(root,'docs/audio/assistant-r2-phrase-bank.json'), null);
  const video = await readJson(path.join(root,'docs/audio/assistant-video-r3-phrase-bank.json'), null);
  for (const [item,required] of [[bank,166],[video,22]]) {
    if (!item || item.version !== 2 || item.model !== model || item.voice !== voice ||
        !Array.isArray(item.clips) || item.clips.length !== required) throw new Error('invalid_phrase_bank');
  }
  const clips = [...builtIn,...bank.clips,...video.clips];
  if (!Array.isArray(builtIn) || builtIn.length !== 18 || clips.length > 220) throw new Error('invalid_clip_list');
  const seen = new Set();
  for (const clip of clips) {
    const key = `${clip.lang}-${clip.id}`;
    const expectedUrl = clip.id.startsWith('r2')
      ? `/audio/assistant/v1/phrases/${key}.wav` : `/audio/assistant/v1/${key}.wav`;
    if (!['en','ru'].includes(clip.lang) || !/^[a-z][a-zA-Z0-9]*$/.test(clip.id)
      || typeof clip.text !== 'string' || !clip.text.trim() || clip.text.length > 800
      || clip.url !== expectedUrl || seen.has(key)) throw new Error('invalid_clip');
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
    let stage = 'connect';
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
    socket.on('unexpected-response', (_request, response) => {
      const error = new Error('connection_failed');
      const status = Number(response?.statusCode);
      if ([400, 401, 403, 404, 408, 429, 500, 502, 503].includes(status)) error.httpStatus = status;
      response?.resume?.();
      finish(error);
    });
    socket.on('close', () => finish(new Error('connection_closed')));
    socket.on('message', raw => {
      if (finished) return;
      try {
        const event = JSON.parse(raw.toString());
        if (event.type === 'error') {
          const error = new Error('api_request_failed');
          Object.assign(error, safeApiDiagnostic(event, stage));
          return finish(error);
        }
        if (event.type === 'session.created') {
          stage = 'session_update';
          send({type: 'session.update', session: {
            type: 'realtime', output_modalities: ['audio'], max_output_tokens: maxOutputTokens,
            tools: [], tool_choice: 'none',
            instructions: `Read the supplied text verbatim in its original language (Russian or English); never translate. You are a voice renderer, not an assistant answering the text. Use a clear, calm voice. Do not add, omit, translate or reword anything. No introduction, sound effects or music.`,
            audio: {input: {turn_detection: null}, output: {format: {type: 'audio/pcm', rate: sampleRate}, voice}}
          }});
        } else if (event.type === 'session.updated' && !configured) {
          configured = true;
          stage = 'text_input';
          send({type: 'conversation.item.create', item: {type: 'message', role: 'user', content: [{type: 'input_text', text: clip.text}]}});
        } else if (event.type === 'conversation.item.done' && configured && !requested && event.item?.role === 'user') {
          requested = true;
          stage = 'response_create';
          send({type: 'response.create', response: {max_output_tokens: maxOutputTokens, output_modalities: ['audio']}});
        } else if (event.type === 'response.output_audio.delta') {
          stage = 'audio_stream';
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

async function syncVerifiedIndex(manifest) {
  const entries = [];
  for (const clip of manifest.clips) {
    if (!clip?.id?.startsWith('r2') ||
        !/^\/audio\/assistant\/v1\/phrases\/(?:ru|en)-r2[A-Za-z0-9]+\.wav$/.test(clip.url || '') ||
        typeof clip.text !== 'string' || typeof clip.sha256 !== 'string') continue;
    try {
      if (hash(await fs.readFile(path.join(root,'public',clip.url))) === clip.sha256)
        entries.push([clip.text,clip.url]);
    } catch(error) {
      if(error.code !== 'ENOENT')throw new Error('audio_index_validation_failed');
    }
  }
  if(new Map(entries).size !== entries.length)throw new Error('ambiguous_phrase');
  const js = "(function(){'use strict';const map=new Map(" + JSON.stringify(entries) +
    ");window.ArtSoulVoiceAudioBank=Object.freeze({lookup:text=>map.get(text)||''});})();\n";
  const final = path.join(root,'voice-audio-bank-r2.js');
  const temp = final+'.'+process.pid+'.tmp';
  await fs.writeFile(temp,js,{flag:'wx'}); await fs.rename(temp,final);
  console.log(JSON.stringify({audio_index:'updated',verified_clips:entries.length}));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('node scripts/generate-assistant-audio.mjs [--generate] [--max-new 10] [--budget-usd 1] [--only ru-r2Greeting,en-r2Greeting] [--sync-bank]');
    console.log('Default: dry run, no credentials read or API calls. Existing verified clips are skipped.');
    return;
  }
  let generate=false,only=null,syncBank=false,maxNew=10,budgetUsd=defaultBudgetUsd;
  for (let i=0;i<args.length;i++) {
    if(args[i]==='--generate')generate=true;
    else if(args[i]==='--sync-bank')syncBank=true;
    else if(args[i]==='--only'&&args[i+1])only=new Set(args[++i].split(','));
    else if(args[i]==='--max-new'&&args[i+1]){
      const n=Number(args[++i]);if(!Number.isSafeInteger(n)||n<1||n>30)throw new Error('invalid_batch_size');
      maxNew=n;
    } else if(args[i]==='--budget-usd'&&args[i+1]){
      const v=Number(args[++i]);if(!Number.isFinite(v)||v<1||v>30)throw new Error('invalid_budget');
      budgetUsd=v;
    } else throw new Error('unknown_argument');
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
    const batch=pending.slice(0,maxNew);
    console.log(JSON.stringify({mode:generate?'generate':'dry_run',model,voice,pendingTotal:pending.length,
      planned:batch.map(clip=>`${clip.lang}-${clip.id}`),reservedUsd:batch.length*reserveUsd,budgetUsd}));
    if(!generate){if(syncBank)await syncVerifiedIndex(manifest);return;}
    if(!batch.length){if(syncBank)await syncVerifiedIndex(manifest);return;}
    const ledger = await readJson(ledgerPath, {version: 1, attempts: []});
    if (ledger.version !== 1 || !Array.isArray(ledger.attempts)) throw new Error('invalid_ledger');
    const reserved = ledger.attempts.reduce((sum, attempt) => sum + Number(attempt.reservedUsd), 0);
    if (!Number.isFinite(reserved) || reserved < 0 || reserved + batch.length * reserveUsd > budgetUsd) throw new Error('generation_budget_exceeded');
    // Codex or a local operator may supply a narrowly scoped environment secret.
    // Never print it, write it to evidence, or put it in tracked source files.
    let apiKey = typeof process.env.OPENAI_API_KEY === 'string'
      ? process.env.OPENAI_API_KEY.trim() : '';
    if (!apiKey) {
      try { apiKey = parseEnv(await fs.readFile(path.join(root, '.env.local'), 'utf8')).OPENAI_API_KEY; }
      catch { /* A missing local env file is fine when the secret is injected. */ }
    }
    if (!apiKey) throw new Error('credential_unavailable');
    for (const clip of batch) {
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
    if(syncBank)await syncVerifiedIndex(manifest);
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
    const diagnostic = {error: code, automaticRetry: false};
    if (PUBLIC_ERROR_STAGES.has(error.stage)) diagnostic.stage = error.stage;
    if (PUBLIC_ERROR_CODES.has(error.providerCode) || error.providerCode === 'unclassified') {
      diagnostic.providerCode = error.providerCode;
    }
    if (PUBLIC_ERROR_PARAMS.has(error.providerParam)) diagnostic.parameter = error.providerParam;
    if ([400, 401, 403, 404, 408, 429, 500, 502, 503].includes(error.httpStatus)) {
      diagnostic.httpStatus = error.httpStatus;
    }
    console.error(JSON.stringify(diagnostic));
    process.exitCode = 1;
  });
}
