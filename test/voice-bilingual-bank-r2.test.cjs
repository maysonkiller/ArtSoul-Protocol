const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const bank=JSON.parse(fs.readFileSync('docs/audio/assistant-r2-phrase-bank.json','utf8'));
const voice=fs.readFileSync('voice-commands.js','utf8');
test('the bilingual audio library is bounded, unique and public-generic',()=>{
 assert.equal(bank.voice,'marin');assert.equal(bank.model,'gpt-realtime-2.1-mini');
 assert.equal(bank.clips.length,166);const keys=new Set();
 for(const item of bank.clips){
   assert.match(item.id,/^r2[A-Za-z0-9]+$/);assert.ok(['ru','en'].includes(item.lang));
   assert.equal(item.url,'/audio/assistant/v1/phrases/'+item.lang+'-'+item.id+'.wav');
   assert.ok(item.text.length>=5&&item.text.length<=800);assert.ok(!keys.has(item.url));keys.add(item.url);
 }
 assert.equal(bank.clips.filter(x=>x.lang==='en').length,83);
 assert.equal(bank.clips.filter(x=>x.lang==='ru').length,83);
});
test('male voice fallback is not reachable and audio index is empty before generation',()=>{
 const w={};new Function('window','document','navigator',voice)(w,undefined,{});
 new Function('window',fs.readFileSync('voice-audio-bank-r2.js','utf8'))(w);
 assert.equal(w.ArtSoulVoiceAudioBank.lookup('Unrecorded dynamic result'),'');
 assert.equal(w.ArtSoulVoice.getReplyAudio('Unrecorded dynamic result'),'');
 assert.ok(!voice.includes('new SpeechSynthesisUtterance('));
 assert.match(voice,/ArtSoulVoiceAudioBank/);
});
test('no public page loads the old voice script cache key and all load the bank first',()=>{
 for(const page of ['index','gallery','artwork','profile','upload','collection-builder','docs-protocol']){
  const html=fs.readFileSync(page+'.html','utf8');
  assert.ok(html.indexOf('/voice-audio-bank-r2.js?v=1')>=0,page);
  assert.ok(html.indexOf('/voice-audio-bank-r2.js?v=1')<html.indexOf('/voice-commands.js?v=21'),page);
 }
 assert.match(fs.readFileSync('vite.config.js','utf8'),/'voice-audio-bank-r2.js'/);
});
test('asset generator remains dry-run by default and bank index requires verified hashes',()=>{
 const generator=fs.readFileSync('scripts/generate-assistant-audio.mjs','utf8');
 assert.match(generator,/if\(!generate\)/);
 assert.match(generator,/invalid_budget/);
 assert.match(generator,/audio_index_validation_failed/);
 assert.match(generator,/hash\(await fs.readFile/);
 assert.doesNotMatch(voice,/\bfetch\(/);
});
test('fixed tool summaries narrate only verified generic facts, not private data',()=>{
 const win={};new Function('window','document','navigator',voice)(win,undefined,{});
 const summary=win.ArtSoulVoice.safeToolCue;
 const fixtures=[
  ['find_active_auctions',{count:1,auctions:[{artwork_id:'31',title:'Mock Work',hours_remaining:1}]},'r2AuctionResults'],
  ['find_active_auctions',{count:0,auctions:[]},'r2NoAuctions'],
  ['get_artwork',{artwork_id:'31',title:'Mock Work',current_bid_eth:'0.05'},'r2ArtworkResults'],
  ['get_artwork_provenance',{artwork_id:'31',owner:'0x123'},'r2ProvenanceResults'],
  ['get_my_activity',{needs_attention_count:1},'r2ActivityResults'],
  ['explain_settlement',{lifecycle:['Step one']},'r2LifecycleResults'],
  ['prepare_bid',{prepared:true,artwork_id:'31'},'r2BidPreparedResult'],
  ['prepare_bid',{prepared:false,artwork_id:'31'},'r2ActionNotCompleted'],
  ['get_artwork',{error:'Private data'},'r2ToolError']
 ];
 for(const [tool,data,name] of fixtures)for(const lang of ['en','ru']){
  const cue=summary(tool,data,lang);
  assert.equal(cue,bank.clips.find(x=>x.id===name&&x.lang===lang)?.text,name+lang);
  assert.ok(!cue.includes('Mock Work')&&!cue.includes('0x123')&&!cue.includes('0.05'));
 }
});

test('Realtime error diagnostics reveal only allowlisted categories and phases', async () => {
  const {safeApiDiagnostic} = await import('../scripts/generate-assistant-audio.mjs');
  assert.deepEqual(safeApiDiagnostic({
    type: 'error', error: {
      type: 'invalid_request_error', code: 'unknown_parameter',
      param: 'session.audio.output.voice', message: 'sk-proj-private-key'
    }
  }, 'session_update'), {
    stage: 'session_update',
    providerCode: 'unknown_parameter',
    providerParam: 'session.audio.output.voice'
  });
  assert.deepEqual(safeApiDiagnostic({
    error: {code: 'insufficient_quota', message: 'secret data'}
  }, 'response_create'), {
    stage: 'response_create',
    providerCode: 'insufficient_quota'
  });
  const untrusted = safeApiDiagnostic({
    error: {code: 'sk-proj-dont-log', type: 'not-allowed', param: 'secret data', message: 'secret data'}
  }, 'secret-stage');
  assert.deepEqual(untrusted, {stage: 'connect', providerCode: 'unclassified'});
  assert.doesNotMatch(JSON.stringify(untrusted), /secret|sk-proj/);
});
