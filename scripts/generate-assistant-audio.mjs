#!/usr/bin/env node
// Offline asset generation only. The website never receives a key or calls this API.
// https://developers.openai.com/api/docs/guides/realtime-conversations
// Prices checked 2026-11-16: text input $0.60/M; audio output $20/M.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';
import {parseEnv} from 'node:util';


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

async function writeAtomic(file, data, {exclusive = false} = {}) {
  await fs.mkdir(path.dirname(file), {recursive: true});
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    await fs.writeFile(temporary, data, {flag:'wx'});
    if (exclusive) await fs.link(temporary, file);
    else await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, {force:true});
  }
}

function writeJson(file, value) {
  return writeAtomic(file, JSON.stringify(value, null, 2) + '\n');
}

export async function loadClips() {
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

async function generateClip(clip, apiKey) {
  const {default:WebSocket} = await import('ws');
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

// Clip paths come from the reviewed bank. Reject redirected components, including directory junctions.
async function recordingStat(publicRoot, url) {
  const segments = url.slice(1).split('/');
  let current = publicRoot;
  for (let i = 0; i <= segments.length; i++) {
    if (i) current = path.join(current, segments[i - 1]);
    const stat = await fs.lstat(current).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!stat) return null;
    if (stat.isSymbolicLink() || !(i === segments.length ? stat.isFile() : stat.isDirectory())) {
      throw new Error('unsafe_audio_path');
    }
    if (i === segments.length) return stat;
  }
}

export async function verifyRecordingInventory(manifest, phrases, publicRoot = path.join(root, 'public')) {
  if (manifest?.version !== 1 || manifest.voice !== voice || manifest.model !== model ||
      manifest.sample_rate !== sampleRate || !Array.isArray(manifest.clips)) throw new Error('invalid_manifest');
  const records = new Map(manifest.clips.map(clip => [clip?.url, clip]));
  const approved = new Set(phrases.map(clip => clip.url));
  if (records.size !== manifest.clips.length || [...records.keys()].some(url => !approved.has(url))) {
    throw new Error('unapproved_manifest_record');
  }
  for (const phrase of phrases) {
    const {lang, id, url, text} = phrase;
    if (!['en','ru'].includes(lang) || !/^[a-z][a-zA-Z0-9]*$/.test(id) ||
        url !== '/audio/assistant/v1/' + (id.startsWith('r2') ? 'phrases/' : '') + lang + '-' + id + '.wav') {
      throw new Error('unsafe_audio_path');
    }
    const stat = await recordingStat(publicRoot, url);
    const record = records.get(url);
    if (!record && !stat) continue;
    if (!record) throw new Error('orphan_recording_requires_review');
    if (!stat || record.lang !== lang || record.id !== id || record.text !== text ||
        record.model !== model || record.voice !== voice || typeof record.transcript !== 'string' ||
        normalizeTranscript(record.transcript) !== normalizeTranscript(text) ||
        stat.size !== record.bytes || stat.size <= 44 || stat.size > 44 + 60 * sampleRate * 2) {
      throw new Error('invalid_recording');
    }
    const wav = await fs.readFile(path.join(publicRoot, url));
    if (hash(wav) !== record.sha256 || wav.length !== stat.size || (wav.length - 44) % 2 !== 0 ||
        wav.toString('ascii', 0, 4) !== 'RIFF' || wav.readUInt32LE(4) !== wav.length - 8 ||
        wav.toString('ascii', 8, 16) !== 'WAVEfmt ' || wav.readUInt32LE(16) !== 16 ||
        wav.readUInt16LE(20) !== 1 || wav.readUInt16LE(22) !== 1 || wav.readUInt32LE(24) !== sampleRate ||
        wav.readUInt32LE(28) !== sampleRate * 2 || wav.readUInt16LE(32) !== 2 ||
        wav.readUInt16LE(34) !== 16 || wav.toString('ascii', 36, 40) !== 'data' ||
        wav.readUInt32LE(40) !== wav.length - 44 || !Number.isFinite(record.duration_seconds) ||
        Math.abs(record.duration_seconds - (wav.length - 44) / (sampleRate * 2)) > 0.0051) {
      throw new Error('invalid_recording');
    }
  }
  return records;
}

export function checkGenerationLedger(ledger, batch, budgetUsd) {
  if (ledger?.version !== 1 || !Array.isArray(ledger.attempts)) throw new Error('invalid_ledger');
  const pending = new Set(batch.map(clip => clip.lang + '-' + clip.id));
  let reserved = 0;
  for (const attempt of ledger.attempts) {
    if (!attempt || typeof attempt.id !== 'string' || !['started','received','failed','completed'].includes(attempt.status) ||
        !Number.isFinite(attempt.reservedUsd) || attempt.reservedUsd <= 0) throw new Error('invalid_ledger');
    if (pending.has(attempt.id)) throw new Error('previous_attempt_requires_review');
    reserved += attempt.reservedUsd;
  }
  if (reserved + batch.length * reserveUsd > budgetUsd) throw new Error('generation_budget_exceeded');
}

export async function reconcileReceived(manifest, ledger, phrases, publicRoot) {
  checkGenerationLedger(ledger, [], Infinity);
  const clips = [...manifest.clips];
  const attempts = ledger.attempts.map(attempt => {
    if (attempt.status !== 'received') return attempt;
    const entry = attempt.recording;
    if (!entry || attempt.id !== entry.lang + '-' + entry.id) throw new Error('invalid_ledger_recording');
    const existing = clips.find(clip => clip.url === entry.url);
    if (existing && existing.sha256 !== entry.sha256) throw new Error('conflicting_recording');
    if (!existing) clips.push(entry);
    return {...attempt,status:'completed'};
  });
  const repaired = {...manifest, clips};
  const records = await verifyRecordingInventory(repaired, phrases, publicRoot);
  return {manifest:repaired, ledger:{...ledger, attempts}, records};
}

async function syncVerifiedIndex(records) {
  const entries = [...records.values()].filter(clip => clip.lang === 'en' && clip.id.startsWith('r2'))
    .map(clip => [clip.text,clip.url]);
  if (new Map(entries).size !== entries.length) throw new Error('ambiguous_phrase');
  const js = "(function(){'use strict';const map=new Map(" + JSON.stringify(entries) +
    ");window.ArtSoulVoiceAudioBank=Object.freeze({lookup:text=>map.get(text)||''});})();\n";
  await writeAtomic(path.join(root, 'voice-audio-bank-r2.js'), js);
  console.log(JSON.stringify({audio_index:'updated', verified_clips:entries.length}));
}

export function checkGenerationScope(args, only) {
  if (!only || !args.includes('--max-new') || !args.includes('--budget-usd')) {
    throw new Error('explicit_generation_limits_required');
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('node scripts/generate-assistant-audio.mjs [--generate] [--max-new 10] [--budget-usd 1] [--only ru-r2Greeting,en-r2Greeting] [--sync-bank] | --recover');
    console.log('Default: dry run. Paid generation requires --only, --max-new and --budget-usd. Existing verified clips are skipped.');
    return;
  }
  let generate=false,only=null,syncBank=false,recover=false,maxNew=10,budgetUsd=defaultBudgetUsd;
  for (let i=0;i<args.length;i++) {
    if(args[i]==='--generate')generate=true;
    else if(args[i]==='--recover' && args.length===1)recover=true;
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
  if (generate) checkGenerationScope(args, only);
  const all = await loadClips();
  if (only && [...only].some(key => !all.some(clip => `${clip.lang}-${clip.id}` === key))) throw new Error('unknown_clip');
  const clips = all.filter(clip => !only || only.has(`${clip.lang}-${clip.id}`));
  let lock;
  if (generate || syncBank || recover) {
    await fs.mkdir(path.dirname(ledgerPath), {recursive: true});
    try { lock = await fs.open(`${ledgerPath}.lock`, 'wx'); }
    catch { throw new Error('generation_already_locked'); }
  }
  try {
    const manifest = await readJson(manifestPath, {version: 1, model, voice, sample_rate: sampleRate, clips: []});
    if (recover) {
      const ledger = await readJson(ledgerPath, null);
      const restored = await reconcileReceived(manifest, ledger, all);
      await writeJson(manifestPath, restored.manifest);
      await syncVerifiedIndex(restored.records);
      await writeJson(ledgerPath, restored.ledger);
      return;
    }
    const records = await verifyRecordingInventory(manifest, all);
    const pending = clips.filter(clip => !records.has(clip.url));
    const batch=pending.slice(0,maxNew);
    console.log(JSON.stringify({mode:generate?'generate':'dry_run',model,voice,pendingTotal:pending.length,
      planned:batch.map(clip=>`${clip.lang}-${clip.id}`),reservedUsd:batch.length*reserveUsd,budgetUsd}));
    if(!generate){if(syncBank)await syncVerifiedIndex(records);return;}
    if(!batch.length){if(syncBank)await syncVerifiedIndex(records);return;}
    const ledger = await readJson(ledgerPath, {version: 1, attempts: []});
    checkGenerationLedger(ledger, batch, budgetUsd);
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
        const entry = {...clip, transcript: result.transcript, sha256: hash(result.wav), bytes: result.wav.length,
          duration_seconds: (result.wav.length - 44) / (sampleRate * 2), generated_at: attempt.at,
          model, voice, usage: result.usage, estimated_usd: result.estimatedUsd};
        attempt.status = 'received';
        attempt.recording = entry;
        await writeJson(ledgerPath, ledger);
        await writeAtomic(target, result.wav, {exclusive:true});
        manifest.clips = [...manifest.clips.filter(item => item.url !== clip.url), entry];
        await writeJson(manifestPath, manifest);
        attempt.status = 'completed'; attempt.estimatedUsd = result.estimatedUsd;
        console.log(JSON.stringify({id: attempt.id, status: 'generated', bytes: result.wav.length, estimatedUsd: result.estimatedUsd}));
      } catch (error) {
        if (attempt.status === 'started') attempt.status = 'failed';
        await writeJson(ledgerPath, ledger);
        throw error;
      }
      await writeJson(ledgerPath, ledger);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    await syncVerifiedIndex(await verifyRecordingInventory(manifest, all));
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
