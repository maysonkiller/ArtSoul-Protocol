/* Offline integrity checks for all shipped and newly recorded ArtSoul voice assets.
 * Node built-ins only. No network, microphone, key, credits, or wallet access. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const root=path.resolve(__dirname,'..');
const pub=path.join(root,'public');
const bank=JSON.parse(fs.readFileSync(path.join(root,'docs/audio/assistant-r2-phrase-bank.json'),'utf8'));
const video=JSON.parse(fs.readFileSync(path.join(root,'docs/audio/assistant-video-r3-phrase-bank.json'),'utf8'));
const allPhrases=[...bank.clips,...video.clips];
const manifest=JSON.parse(fs.readFileSync(path.join(pub,'audio/assistant/v1/manifest.json'),'utf8'));
const normalize=text=>String(text).normalize('NFKC').toLowerCase().replace(/ё/g,'е')
  .replace(/[^\p{L}\p{N}]+/gu,' ').trim();
function checkedPath(url){
  assert.match(url,/^\/audio\/assistant\/v1\/(?:phrases\/)?(?:ru|en)-[a-zA-Z][a-zA-Z0-9]*\.wav$/);
  const full=path.resolve(pub,'.'+url);
  assert.ok(full.startsWith(pub+path.sep),'audio path must be below public/');
  return full;
}
function validateWav(entry){
  const file=checkedPath(entry.url);
  const st=fs.lstatSync(file);
  assert.ok(st.isFile()&&!st.isSymbolicLink(),'real local WAV required');
  const audio=fs.readFileSync(file);
  assert.equal(crypto.createHash('sha256').update(audio).digest('hex'),entry.sha256,entry.url);
  assert.equal(entry.bytes,audio.length,entry.url);
  assert.ok(audio.length>44 && audio.length<=44+60*24000*2,entry.url);
  assert.equal(audio.subarray(0,4).toString('ascii'),'RIFF');
  assert.equal(audio.readUInt32LE(4),audio.length-8);
  assert.equal(audio.subarray(8,12).toString('ascii'),'WAVE');
  assert.equal(audio.subarray(12,16).toString('ascii'),'fmt ');
  assert.equal(audio.readUInt32LE(16),16,'PCM fmt chunk');
  assert.equal(audio.readUInt16LE(20),1,'PCM encoding');
  assert.equal(audio.readUInt16LE(22),1,'mono');
  assert.equal(audio.readUInt32LE(24),24000,'24kHz');
  assert.equal(audio.readUInt32LE(28),48000,'byte rate');
  assert.equal(audio.readUInt16LE(32),2,'block align');
  assert.equal(audio.readUInt16LE(34),16,'sample bits');
  assert.equal(audio.subarray(36,40).toString('ascii'),'data');
  assert.equal(audio.readUInt32LE(40),audio.length-44,'data length');
  assert.ok(Math.abs(entry.duration_seconds-(audio.length-44)/48000)<0.011,'duration');
  assert.equal(normalize(entry.transcript),normalize(entry.text),'transcript must match');
}
test('bank has 83 unique, identical-language RU/EN pairs without dynamic fields',()=>{
  assert.equal(bank.version,2);
  assert.equal(bank.model,'gpt-realtime-2.1-mini');
  assert.equal(bank.voice,'marin');
  assert.equal(bank.clips.length,166);
  const pairs=new Map();
  for(const clip of bank.clips){
    assert.ok(['ru','en'].includes(clip.lang));
    assert.match(clip.id,/^r2[A-Z][A-Za-z0-9]*$/);
    assert.equal(clip.url,'/audio/assistant/v1/phrases/'+clip.lang+'-'+clip.id+'.wav');
    assert.ok(clip.text.trim()&&clip.text.length<=800);
    assert.doesNotMatch(clip.text,/\{\{|\$\{|<%|\b0x[0-9a-f]{40}\b/i,'no dynamic wallet or template values');
    const languages=pairs.get(clip.id)||new Map();
    assert.equal(languages.has(clip.lang),false,clip.id+' duplicate language');
    languages.set(clip.lang,clip);pairs.set(clip.id,languages);
  }
  assert.equal(pairs.size,83);
  for(const [id,languages] of pairs){
    assert.deepEqual([...languages.keys()].sort(),['en','ru'],id);
    assert.notEqual(languages.get('en').text,languages.get('ru').text,id);
  }
});
test('video observations add eleven verified EN/RU source pairs with no audio claims',()=>{
  assert.equal(video.model,bank.model);
  assert.equal(video.voice,bank.voice);
  assert.equal(video.clips.length,22);
  const paired=new Map();
  for(const clip of video.clips){
    assert.ok(['ru','en'].includes(clip.lang));
    assert.match(clip.id,/^r2Video[A-Z][A-Za-z0-9]*$/);
    assert.equal(clip.url,'/audio/assistant/v1/phrases/'+clip.lang+'-'+clip.id+'.wav');
    assert.ok(clip.text.trim()&&clip.text.length<=800);
    const langs=paired.get(clip.id)||new Set();
    assert.equal(langs.has(clip.lang),false);
    langs.add(clip.lang);paired.set(clip.id,langs);
  }
  assert.equal(paired.size,11);
  for(const langs of paired.values())assert.deepEqual([...langs].sort(),['en','ru']);
  assert.equal(new Set(allPhrases.map(c=>c.url)).size,allPhrases.length);
});
test('all manifest WAVs exist, have matching SHA256 and valid PCM headers',()=>{
  assert.equal(manifest.version,1);
  assert.equal(manifest.voice,'marin');
  assert.equal(manifest.model,'gpt-realtime-2.1-mini');
  assert.equal(manifest.sample_rate,24000);
  assert.ok(Array.isArray(manifest.clips)&&manifest.clips.length>=18);
  const paths=new Set();
  for(const entry of manifest.clips){
    assert.ok(['en','ru'].includes(entry.lang));
    assert.equal(paths.has(entry.url),false,entry.url+' is duplicated');
    paths.add(entry.url);
    validateWav(entry);
  }
});
test('any r2 WAV in manifest has an identical approved script entry',()=>{
  const phrases=new Map(allPhrases.map(c=>[c.url,c]));
  const recorded=manifest.clips.filter(c=>c.id.startsWith('r2'));
  for(const clip of recorded){
    const expected=phrases.get(clip.url);
    assert.ok(expected,clip.url+' has no reviewed phrase');
    assert.deepEqual({id:clip.id,lang:clip.lang,text:clip.text},
      {id:expected.id,lang:expected.lang,text:expected.text});
  }
});
test('every generated r2 file is indexed by the manifest; dynamic text is silent',()=>{
  const entries=new Map(manifest.clips.map(c=>[c.url,c]));
  const folder=path.join(pub,'audio/assistant/v1/phrases');
  for(const file of fs.readdirSync(folder)){
    if(!/^(?:ru|en)-r2[A-Za-z0-9]+\.wav$/.test(file))continue;
    const url='/audio/assistant/v1/phrases/'+file;
    assert.ok(entries.has(url),url+' is not in the manifest');
    validateWav(entries.get(url));
  }
  const w={};
  new Function('window',fs.readFileSync(path.join(root,'voice-audio-bank-r2.js'),'utf8'))(w);
  assert.equal(w.ArtSoulVoiceAudioBank.lookup('A user balance, signed receipt, or dynamic reply'), '');
  for(const clip of allPhrases){
    const lookup=w.ArtSoulVoiceAudioBank.lookup(clip.text);
    if(entries.has(clip.url))assert.equal(lookup,clip.url,'recorded phrase must be indexed');
    else assert.equal(lookup,'','unrecorded phrase must not be voiced');
  }
});
