const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs');
const runtime={};new Function('window',fs.readFileSync('voice-conversation-r2.js','utf8'))(runtime);
const create=()=>runtime.ArtSoulVoiceConversation.createDialogue(()=>1000000);
test('bilingual auction/lifecycle intent resolves only read-only WebMCP tools',()=>{
  for(const [phrase,name] of [['Покажи открытые аукционы','find_active_auctions'],['Which auctions are open','find_active_auctions'],['Объясни что будет после аукциона','explain_settlement'],['What happens after the auction','explain_settlement']])assert.equal(create().route(phrase)?.tool,name,phrase);
});
test('multi-turn references require verified tool state and bid is preview-only',()=>{
  const d=create();d.observe('find_active_auctions',{count:2,auctions:[{artwork_id:'31',hours_remaining:8},{artwork_id:'42',hours_remaining:2}]});
  assert.equal(d.route('Which one ends first?').input.artwork_id,'42');
  d.observe('get_auction_state',{artwork_id:'42'});
  for(const [phrase,name] of [['Расскажи подробнее про эту работу','get_artwork'],['Кто сейчас владелец?','get_artwork_provenance'],['Open its page','open_artwork'],['Помоги подготовить ставку, но ничего пока не подтверждай','prepare_bid']]){
    const item=d.route(phrase);assert.equal(item?.tool,name,phrase);assert.equal(item?.input?.artwork_id,'42',phrase);
  }
});
test('dangerous negations, low confidence and mistaken NFT terms fail closed',()=>{
  for(const phrase of ['open nfg','okay storage room','не открывай работу 42',"don't buy artwork 42",'нет, я имел в виду другую работу'])assert.notEqual(create().route(phrase)?.kind,'tool',phrase);
  assert.notEqual(create().route('открой работу 31',{spoken:true,confidence:0.2})?.kind,'tool');
});
test('context resets and invalid navigation IDs are rejected',()=>{
 const d=create();d.observe('find_active_auctions',{count:1,auctions:[{artwork_id:'31',hours_remaining:1}]});
 const state=d.snapshot();assert.equal(state.last,'31');d.clear();assert.equal(d.snapshot().last,null);
 assert.equal(d.restore(state),true);assert.equal(d.restore({...state,last:'1;alert(1)'}),false);
});
test('all site scripts load conversation before voice commands',()=>{
  for(const page of ['index','gallery','artwork','profile','upload','collection-builder','docs-protocol']){
    const html=fs.readFileSync(page+'.html','utf8');
    assert.ok(html.indexOf('/voice-conversation-r2.js?v=3')>=0,page);
    assert.ok(html.indexOf('/voice-conversation-r2.js?v=3')<html.indexOf('/voice-commands.js?v=22'),page);
  }
});

test('ambiguous or invalid explicit artwork IDs never inherit the previous work',()=>{
 const d=create();
 d.observe('find_active_auctions',{count:1,auctions:[{artwork_id:'31',hours_remaining:1}]});
 for(const phrase of [
   'Open artwork 31 and artwork 42',
   'Tell me more about artwork 0',
   'Tell me more about artwork -1',
   'Tell me more about artwork 31.5',
   'Tell me more about artwork 42abc',
   'Подготовь ставку для работы 31 и работы 42',
   'Кто владелец работы 0?',
   'Open work 99999999999999999999999999999999999999999999999999999999999999999999999999999999999999999'
 ]){
   const got=d.route(phrase);
   assert.equal(got?.kind,'reply',phrase);
   assert.equal(got?.tool,undefined,phrase);
 }
 assert.equal(d.route('Tell me more about artwork 42')?.input?.artwork_id,'42');
 assert.equal(d.route('Open its page')?.input?.artwork_id,'31');
});

test('equal earliest deadlines require an explicit artwork number',()=>{
 const d=create();
 d.observe('find_active_auctions',{count:3,auctions:[
   {artwork_id:'31',hours_remaining:1},{artwork_id:'42',hours_remaining:1},
   {artwork_id:'53',hours_remaining:5}
 ]});
 assert.equal(d.route('Which one ends first?')?.kind,'reply');
 assert.equal(d.route('Какой аукцион закончится раньше?')?.kind,'reply');
 d.observe('find_active_auctions',{count:2,auctions:[
   {artwork_id:'31',hours_remaining:2},{artwork_id:'42',hours_remaining:1}
 ]});
 assert.equal(d.route('Which one ends first?')?.input?.artwork_id,'42');
});

test('malformed or failed auction refresh drops stale context',()=>{
 const failures=[
  {error:'temporary error'},
  {count:1,auctions:[{artwork_id:'31',hours_remaining:'1'}]},
  {count:1,auctions:[{artwork_id:'31',hours_remaining:null}]},
  {count:1,auctions:[{artwork_id:'0',hours_remaining:1}]},
  {count:2,auctions:[{artwork_id:'31',hours_remaining:1},{artwork_id:'31',hours_remaining:2}]},
  {count:0,auctions:[{artwork_id:'31',hours_remaining:1}]},
  {count:1,auctions:'not-an-array'}
 ];
 for(const bad of failures){
   const d=create();
   d.observe('find_active_auctions',{count:1,auctions:[{artwork_id:'31',hours_remaining:1}]});
   assert.equal(d.snapshot().last,'31');
   d.observe('find_active_auctions',bad);
   assert.equal(d.snapshot().last,null,JSON.stringify(bad));
   assert.deepEqual(d.snapshot().auctions,[],JSON.stringify(bad));
   assert.equal(d.route('Open its page')?.kind,'reply',JSON.stringify(bad));
 }
});

test('restored navigation snapshot is validated completely without partial acceptance',()=>{
 const d=create();
 d.observe('find_active_auctions',{count:1,auctions:[{artwork_id:'31',hours_remaining:2}]});
 const good=d.snapshot();
 for(const bad of [
   {...good,auctions:[{artwork:'31',hours:'2'}]},
   {...good,auctions:[{artwork:'31',hours:2},{artwork:'31',hours:3}]},
   {...good,auctions:[{artwork:'31',hours:2},{artwork:'0',hours:1}]},
   {...good,auctions:[{artwork:'31',hours:-1}]},
   {...good,auctions:[{artwork:'31',hours:Infinity}]}
 ]){
   assert.equal(d.restore(bad),false,'reject entire snapshot');
   assert.equal(d.snapshot().last,'31','do not corrupt prior valid state');
 }
 assert.equal(d.restore(good),true);
});

test('only a string may enter the contextual speech router',()=>{
 const d=create();
 for(const raw of [null,0,1,{},[],false])assert.equal(d.route(raw),null);
});
