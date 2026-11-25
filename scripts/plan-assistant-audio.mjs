#!/usr/bin/env node
// ArtSoul R2: offline voice-bank inventory and safe future batches.
// No API, no .env access, no network, no writes. Node built-ins only.
import fs from 'node:fs';
import path from 'node:path';
import {loadClips, verifyRecordingInventory} from './generate-assistant-audio.mjs';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const phrases = await loadClips();
const clips = phrases.filter(phrase => phrase.id.startsWith('r2'));
const manifest = JSON.parse(fs.readFileSync(path.join(root,'public/audio/assistant/v1/manifest.json'),'utf8'));
const args = process.argv.slice(2);
const strict = args.includes('--strict');
const sizes = args.filter(arg => arg !== '--strict');
if (sizes.length > 1) throw new Error('Usage: plan-assistant-audio.mjs [batch size] [--strict]');
const size = Number(sizes[0] || 10);
if (!Number.isSafeInteger(size) || size < 1 || size > 30) throw new Error('Batch size must be 1..30');
const records = await verifyRecordingInventory(manifest, phrases);
const recorded = [], pending = [];
for (const clip of clips) {
  (records.has(clip.url) ? recorded : pending).push(clip.lang + '-' + clip.id);
}
const batches=[];
for(let i=0;i<pending.length;i+=size){
 const ids=pending.slice(i,i+size);
 batches.push({
   index:batches.length+1,
   count:ids.length,
   ids,
   reservedUsd:Number((ids.length*0.025).toFixed(3)),
   dryRunCommand:'node scripts/generate-assistant-audio.mjs --only '+ids.join(',')+' --max-new '+size
 });
}
console.log(JSON.stringify({
 mode:'OFFLINE_ONLY_NO_API_CALLS',voice:manifest.voice,model:manifest.model,
 phraseBank:clips.length,verifiedRecorded:recorded.length,pending:pending.length,
 reservedForPendingUsd:Number((pending.length*0.025).toFixed(3)),
 note:'Reservation is not a bill or an API limit. All commands above are dry-run only. Refill is not automatic.',
 batches
},null,2));

if (strict && pending.length) process.exitCode = 1;
