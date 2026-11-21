// R4: reproduces owner's real "NFT does not open" complaint.
// No browser API, wallet, microphone or network; source-only tests.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const context={};
new Function('window',fs.readFileSync('voice-conversation-r2.js','utf8'))(context);
const api=context.ArtSoulVoiceConversation;
const create=()=>api.createDialogue(()=>1000000);
const positives=[
 ['ru','открой NFT','nfts'],
 ['ru','открой нфт','nfts'],
 ['ru','открой эн-эф-ти','nfts'],
 ['ru','открой ен эф ти','nfts'],
 ['ru','покажи мне NFT','nfts'],
 ['ru','покажи все NFT','nfts'],
 ['ru','открой каталог NFT','nfts'],
 ['ru','открой галерею NFT','nfts'],
 ['ru','открой мои NFT','collected'],
 ['ru','открой NFT в кошельке','walletNfts'],
 ['ru','открой NFT на маркетплейсе','marketplace'],
 ['en','open NFT','nfts'],
 ['en','open nfts','nfts'],
 ['en','open NFT gallery','nfts'],
 ['en','show me NFTs','nfts'],
 ['en','show my nfts','collected'],
 ['en','open nft in my wallet','walletNfts'],
 ['en','open NFT marketplace','marketplace']
];
test('18 bilingual NFT commands map to real, explicit, public page IDs',()=>{
 for(const [lang,phrase,page] of positives){
  const result=create().route(phrase,{lang,spoken:true,confidence:1});
  assert.deepEqual(result,{kind:'tool',tool:'open_page',input:{page}},phrase);
 }
});
test('NFC misrecognition, trailing writes and compound requests never open NFT tabs',()=>{
 for(const phrase of [
  'open NFC','open nfg','nft open nft','open NFT and buy artwork 31',
  'открой нфт и купи работу 31','не открывай NFT',
  'открой NFT номер 38 и купи','open admin','open https://example.org'
 ]){
  const lang=/[а-яё]/iu.test(phrase)?'ru':'en';
  const result=create().route(phrase,{lang,spoken:true,confidence:1});
  assert.ok(!result || result.kind!=='tool'||result.tool!=='open_page',phrase);
 }
});
test('low-confidence NFT navigation never opens a gallery or wallet destination',()=>{
 for(const [lang,phrase] of [
  ['ru','покажи NFT'],['ru','открой нфт'],['en','show NFTs'],
  ['en','open NFT gallery'],['ru','открой NFT в кошельке']
 ]){
  const result=create().route(phrase,{lang,spoken:true,confidence:0.18});
  assert.equal(result?.kind,'reply',phrase);
 }
});
test('existing open_page backend is restricted to canonical NFT destinations',()=>{
 const source=fs.readFileSync('webmcp-tools.js','utf8');
 assert.match(source,/nfts:\s*\{\s*url:\s*'\/gallery#nft'/);
 assert.match(source,/collected:\s*\{\s*url:\s*'\/profile#collected'/);
 assert.match(source,/walletNfts:\s*\{\s*url:\s*'\/profile#wallet-nfts'/);
 assert.match(source,/marketplace:\s*\{\s*url:\s*'\/gallery#marketplace'/);
 assert.match(source,/name:\s*'open_page'/);
});
