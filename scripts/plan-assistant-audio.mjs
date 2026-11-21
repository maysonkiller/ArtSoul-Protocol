#!/usr/bin/env node
// ArtSoul R2: offline voice-bank inventory and safe future batches.
// No API, no .env access, no network, no writes. Node built-ins only.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const bank=JSON.parse(fs.readFileSync(path.join(root,'docs/audio/assistant-r2-phrase-bank.json'),'utf8'));
const video=JSON.parse(fs.readFileSync(path.join(root,'docs/audio/assistant-video-r3-phrase-bank.json'),'utf8'));
const clips=[...bank.clips,...video.clips];
const manifest=JSON.parse(fs.readFileSync(path.join(root,'public/audio/assistant/v1/manifest.json'),'utf8'));
const size=Number(process.argv[2]||10);
if(!Number.isSafeInteger(size)||size<1||size>30)throw new Error('Batch size must be 1..30');
if(bank.version!==2||bank.voice!=='marin'||bank.model!=='gpt-realtime-2.1-mini'||
   !Array.isArray(bank.clips)||bank.clips.length!==166||
   video.version!==2||video.voice!==bank.voice||video.model!==bank.model||
   !Array.isArray(video.clips)||video.clips.length!==22)throw new Error('Unknown phrase bank');
if(manifest.version!==1||!Array.isArray(manifest.clips))throw new Error('Unknown audio manifest');
const byUrl=new Map(manifest.clips.map(c=>[c.url,c]));
const recorded=[],pending=[];
for(const clip of clips){
 if(!['en','ru'].includes(clip.lang)||!/^r2[A-Z][A-Za-z0-9]*$/.test(clip.id)||
    clip.url!==('/audio/assistant/v1/phrases/'+clip.lang+'-'+clip.id+'.wav'))
   throw new Error('Invalid bank entry');
 const file=path.resolve(root,'public','.'+clip.url);
 const claim=byUrl.get(clip.url);
 const exists=fs.existsSync(file);
 if(claim||exists){
   if(!claim||!exists)throw new Error('Audio/manifest mismatch: '+clip.lang+'-'+clip.id);
   if(claim.id!==clip.id||claim.lang!==clip.lang||claim.text!==clip.text)
     throw new Error('Transcript mismatch: '+clip.lang+'-'+clip.id);
   const st=fs.lstatSync(file);
   if(!st.isFile()||st.isSymbolicLink())throw new Error('Unsafe audio path');
   const data=fs.readFileSync(file);
   if(createHash('sha256').update(data).digest('hex')!==claim.sha256)
     throw new Error('SHA256 mismatch: '+clip.lang+'-'+clip.id);
   recorded.push(clip.lang+'-'+clip.id);
 }else pending.push(clip.lang+'-'+clip.id);
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
 mode:'OFFLINE_ONLY_NO_API_CALLS',voice:bank.voice,model:bank.model,
 phraseBank:clips.length,verifiedRecorded:recorded.length,pending:pending.length,
 reservedForPendingUsd:Number((pending.length*0.025).toFixed(3)),
 note:'Reservation is not a bill or an API limit. All commands above are dry-run only. Refill is not automatic.',
 batches
},null,2));
