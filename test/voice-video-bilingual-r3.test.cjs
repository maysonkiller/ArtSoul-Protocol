/* Screen recording 2026-11-21 19:00:23: commands visibly transcribed by
 * the browser, paired with natural RU/EN equivalents. No real wallet, API or
 * SpeechRecognition service; all tests run against the actual site parsers. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const sandbox={};
new Function('window',fs.readFileSync('voice-conversation-r2.js','utf8'))(sandbox);
new Function('window','document','navigator',fs.readFileSync('voice-commands.js','utf8'))(sandbox,undefined,{});
const voice=sandbox.ArtSoulVoice;
const make=()=>sandbox.ArtSoulVoiceConversation.createDialogue(()=>1000000);
function intent(phrase,lang='en'){
 const context=make().route(phrase,{lang});
 return context||voice.parseCommand(phrase,lang);
}
const cases=[
 ['hello','привет','reply'],
 ['open artworks','открой работы','open_page',{page:'gallery'}],
 ['open Explorer','открой каталог работ','open_page',{page:'gallery'}],
 ['open discovery','открой галерею','open_page',{page:'gallery'}],
 ['open profile','открой профиль','open_page',{page:'profile'}],
 ['open test','открой тест','search_catalog',{query:'test',category:'artworks'}],
 ['open Discovery test black','открой работу тест черный','search_catalog'],
 ['open T-34','открой Т-34','search_catalog'],
 ['connect to wallet','подключи кошелек','ui:walletMenu'],
 ['notifications','уведомление','ui:notifications'],
 ['show my network','покажи какая сеть подключена','ui:networkStatus'],
 ['mode','режим','reply'],
 ['switch to classic mode','выбери режим classic','ui:theme'],
 ['switch to future mode','выбери режим future','ui:theme'],
 ['why are you speaking English','почему ты говоришь на английском','reply'],
 ['did you do it','это сделал','reply'],
 ['help','помощь','help'],
 ['open nfc','открой ен эф ти','replyOrPrompt'],
 ['my activity','моя активность','get_my_activity'],
 ['what auctions are open','покажи открытые аукционы','find_active_auctions'],
 ['what happens after the auction','объясни что будет после аукциона','explain_settlement'],
 ['open artwork 31','открой работу 31','open_artwork',{artwork_id:'31'}],
 ['find artwork moon','найди работы луна','search_catalog'],
 ['tell me about artwork 31','расскажи про работу 31','get_artwork']
];
test('each visible recording intent has matched RU/EN behavior without guesswork',()=>{
 for(const [en,ru,expected,input] of cases){
  const pair=[];
  for(const [lang,phrase] of [['en',en],['ru',ru]]){
   const got=intent(phrase,lang);
   assert.ok(got,'missing '+lang+' '+phrase);
   if(expected==='replyOrPrompt') {
     assert.ok(got.kind==='reply'||got.nftPrompt===true||got.message,'clarification only '+phrase);
   } else if(expected==='reply'||expected==='help'){
     assert.ok(expected==='reply'?got.kind==='reply':got.help===true,lang+' '+phrase+' '+JSON.stringify(got));
   } else if(expected.startsWith('ui:')){
     assert.equal(got.kind,'ui',phrase);
     assert.equal(got.action,expected.slice(3),phrase);
   } else {
     assert.equal(got.kind==='tool'?got.tool:got.tool,expected,lang+' '+phrase+' '+JSON.stringify(got));
     if(input)assert.deepEqual(got.input,input,lang+' '+phrase);
   }
   pair.push(got);
  }
  // The two languages must select the same safe tool or UI feature.
  if(!['reply','help','replyOrPrompt'].includes(expected))
   assert.equal(pair[0].kind==='ui'?pair[0].action:pair[0].tool,
     pair[1].kind==='ui'?pair[1].action:pair[1].tool,en+' ↔ '+ru);
 }
});
test('speech recognition uncertainty does not invoke UI, search or navigation',()=>{
 const cases=['open artworks','connect to wallet','notifications','show my network',
   'switch to classic mode','open test','открой Т-34','подключи кошелек','уведомление',
   'покажи какая сеть подключена','выбери режим future'];
 for(const phrase of cases){
   const lang=/[а-яё]/iu.test(phrase)?'ru':'en';
   const got=make().route(phrase,{lang,spoken:true,confidence:0.15});
   assert.equal(got?.kind,'reply',phrase);
 }
});
test('compound and dangerous voice instructions cannot produce automatic tools or UI',()=>{
 const commands=[
   ['en','open gallery and buy artwork 31'],
   ['ru','открой галерею и купи работу 31'],
   ['en','connect to wallet and sign a transaction'],
   ['ru','подключи кошелек и подпиши транзакцию'],
   ['en','open notifications and withdraw funds'],
   ['ru','покажи уведомления и выведи деньги'],
   ['en','open https://example.org/secret'],
   ['en','open admin'],
   ['ru','открой админку и удали данные'],
   ['ru','не открывай работу 31'],
   ['en',"don't open artwork 31"]
 ];
 for(const [lang,phrase] of commands){
   const got=intent(phrase,lang);
   assert.ok(!got?.tool && got?.kind!=='tool' && got?.kind!=='ui',lang+' '+phrase+' '+JSON.stringify(got));
 }
});
test('UI actions call only reviewed header controls, never connect or sign automatically',()=>{
 let menu=0,notifications=0,connection=0,signatures=0,theme='';
 const buttons={
   '.avatar-button[aria-label="ArtSoul account menu"]':{disabled:false,getAttribute:()=> 'false',click:()=>menu++},
   '[data-notification-preview]':{disabled:false,click:()=>notifications++}
 };
 const doc={visibilityState:'visible',querySelector:key=>buttons[key]||null};
 const win={
   ThemeManager:{setTheme:x=>{theme=x}},
   safeConnectWallet:()=>connection++,
   ethereum:{request:()=>signatures++},
   artsoulWalletStateSettled:true,
   artsoulSettledWalletState:{isConnected:true,address:'0x'+'1'.repeat(40),chainId:84532}
 };
 const f=voice.safeVoiceUiAction;
 const calls=[
   {kind:'ui',action:'walletMenu'},
   {kind:'ui',action:'notifications'},
   {kind:'ui',action:'theme',theme:'future'},
   {kind:'ui',action:'networkStatus'}
 ];
 for(const command of calls){
   for(const lang of ['ru','en']){
     const out=f(command,{doc,win,lang});
     assert.ok(out.show.length>10 && out.show===out.say);
   }
 }
 assert.equal(menu,2);
 assert.equal(notifications,2);
 assert.equal(theme,'future');
 assert.equal(connection,0,'never auto-open wallet connect modal');
 assert.equal(signatures,0,'never request or sign transactions');
 assert.match(f({kind:'ui',action:'networkStatus'},{doc,win,lang:'ru'}).show,/Base Sepolia/);
 assert.match(f({kind:'ui',action:'networkStatus'},{doc,win,lang:'en'}).show,/Base Sepolia/);
 assert.match(f({kind:'ui',action:'unknown'}, {doc,win,lang:'ru'}).show,/недоступна/);
 assert.equal(signatures,0);
});
test('voice text is never replaced with an arbitrary browser TTS or private dynamic audio',()=>{
 assert.equal(voice.getReplyAudio('This artwork costs 17 ETH.'),'');
 assert.equal(voice.getReplyAudio('Balance 0x'+'f'.repeat(40)),'');
 assert.match(voice.getReplyAudio('Hello! What would you like to explore in ArtSoul?'),
    /^\/audio\/assistant\/v1\/phrases\/en-r2Greeting\.wav$/);
});
