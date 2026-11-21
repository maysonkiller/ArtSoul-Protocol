const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const bank=JSON.parse(fs.readFileSync('docs/audio/assistant-r2-phrase-bank.json','utf8'));
const voice=fs.readFileSync('voice-commands.js','utf8');
test('the bilingual audio library is bounded, unique and public-generic',()=>{
 assert.equal(bank.voice,'marin');assert.equal(bank.model,'gpt-realtime-2.1-mini');
 assert.equal(bank.clips.length,138);const keys=new Set();
 for(const item of bank.clips){
   assert.match(item.id,/^r2[A-Za-z0-9]+$/);assert.ok(['ru','en'].includes(item.lang));
   assert.equal(item.url,'/audio/assistant/v1/phrases/'+item.lang+'-'+item.id+'.wav');
   assert.ok(item.text.length>=5&&item.text.length<=800);assert.ok(!keys.has(item.url));keys.add(item.url);
 }
 assert.equal(bank.clips.filter(x=>x.lang==='en').length,69);
 assert.equal(bank.clips.filter(x=>x.lang==='ru').length,69);
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
  assert.ok(html.indexOf('/voice-audio-bank-r2.js?v=1')<html.indexOf('/voice-commands.js?v=20'),page);
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