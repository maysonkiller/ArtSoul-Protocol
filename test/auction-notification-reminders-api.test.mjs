import assert from 'node:assert/strict';
import test from 'node:test';
import handler from '../src/api/routes/notifications.js';
import {setWalletSession} from '../src/api/backend.js';
import {readAuctionNotificationConfig} from '../src/api/auction-notification-config.js';

const A='0x'+'a'.repeat(40), CORE='0x'+'c'.repeat(40), ORIGIN='https://artsoulprotocol.com';
const NOW='2026-10-25T12:00:00.000Z', DEADLINE=String(Date.parse(NOW)/1000+1800);
const prefs={auction_created:true,outbid:true,lifecycle:true,reminders:true};
const reminder=(extra={})=>({id:'4',type:'auction_ending',created_at:NOW,artwork_id:'34',auction_id:'66',
  transaction_hash:'0x'+'d'.repeat(64),read:false,artworkAvailable:true,deadline:DEADLINE,offset_minutes:60,...extra});
const page=(extra={})=>({items:[],preferences:{...prefs},preferencesRevision:0,chainRevision:'0',
  reminderMinutes:[60],serverTime:NOW,remindersAvailable:true,remindersCapped:false,reminders:[reminder()],...extra});
const response=()=>({headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v;},status(s){this.statusCode=s;return this;},json(b){this.body=b;return this;},end(){}});

test('reminder API validates private v3 data and bounded personal settings',async t=>{
  const env={SESSION_SECRET:'reminder-local-test-only',SUPABASE_URL:'https://reminders.example.test',
    NEXT_PUBLIC_SUPABASE_URL:'https://reminders.example.test',SUPABASE_SERVICE_ROLE_KEY:'reminder-local-service',
    ARTSOUL_AUCTION_NOTIFICATIONS_ENABLED:'true',ARTSOUL_AUCTION_LIFECYCLE_ENABLED:'true',
    ARTSOUL_AUCTION_REMINDERS_ENABLED:'true',ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA:CORE,ARTSOUL_PUBLIC_ORIGIN:ORIGIN,API_ALLOWED_ORIGINS:''};
  const prior=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]])), original=globalThis.fetch;
  Object.assign(process.env,env);
  t.after(()=>{globalThis.fetch=original;for(const[k,v]of Object.entries(prior)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
  const session=response();setWalletSession(session,A);
  const headers={cookie:session.headers['Set-Cookie'].split(';')[0],'x-artsoul-wallet':A,origin:ORIGIN,'content-type':'application/json'};
  let reply,calls;
  function storage(value){reply=value;calls=[];globalThis.fetch=async(url,options)=>{
    calls.push({url:new URL(url),body:JSON.parse(options.body)});return Response.json(reply);
  };}
  async function call({body,h=headers,query={v:'3'}}={}){
    const res=response();await handler({method:body?'PUT':'GET',headers:h,query,body},res);
    assert.equal(res.headers['Cache-Control'],'private, no-store');return res;
  }
  await t.test('capability is opt-in and depends on lifecycle configuration',async()=>{
    for(const flag of ['ARTSOUL_AUCTION_REMINDERS_ENABLED','ARTSOUL_AUCTION_LIFECYCLE_ENABLED']){
      process.env[flag]='false';storage(page());assert.equal(readAuctionNotificationConfig().remindersEnabled,undefined);
      assert.equal((await call()).statusCode,503);assert.equal(calls.length,0);process.env[flag]='true';
    }
    assert.equal(readAuctionNotificationConfig().remindersEnabled,true);
  });
  await t.test('current reminders are separate from historical pagination and storage internals',async()=>{
    storage(page({reminders:[reminder({private_extra:'do not disclose'})]}));const res=await call();
    assert.equal(res.statusCode,200);assert.equal(calls[0].url.pathname,'/rest/v1/rpc/read_auction_notifications_v3');
    assert.deepEqual(calls[0].body,{p_wallet:A,p_core:CORE,p_before:null});
    assert.equal(res.body.nextCursor,null);assert.equal(res.body.items.length,0);
    assert.equal(res.body.reminders[0].chain_id,'84532');assert.equal(res.body.reminders[0].private_extra,undefined);
    assert.match(res.body.reminders[0].message,/current deadline/);
  });
  await t.test('stale, duplicate, malformed and disabled reminders fail closed',async()=>{
    const bad=[{reminderMinutes:[]},{reminderMinutes:[60,30]},{reminderMinutes:[60,60]},{reminderMinutes:[1441]},
      {serverTime:'invalid'},{remindersAvailable:false},{preferences:{...prefs,reminders:false}},
      {reminders:[reminder(),reminder()]},{reminders:[reminder(),reminder({id:'5'})]},
      ...[{deadline:String(Date.parse(NOW)/1000)},{deadline:'0'},{offset_minutes:30},{created_at:'2026-10-25T12:01:00Z'},
        {offset_minutes:'60'},{type:'auction_won'},{id:'90071992547409999999'},{auction_id:'0'}].map(extra=>({reminders:[reminder(extra)]}))];
    for(const data of bad){storage(page(data));assert.equal((await call()).statusCode,503,JSON.stringify(data));}
    storage(page({remindersAvailable:false,reminders:[]}));assert.equal((await call()).statusCode,200);
  });
  await t.test('three unique minute offsets are normalized and compare-and-swapped',async()=>{
    const body={action:'preferences',expected_revision:4,preferences:{...prefs},reminderMinutes:[1440,1,60]};
    storage({saved:true,preferences:prefs,preferencesRevision:5,reminderMinutes:[1,60,1440]});
    assert.equal((await call({body})).statusCode,200);
    assert.equal(calls[0].url.pathname,'/rest/v1/rpc/save_auction_notification_preferences_v3');
    assert.deepEqual(calls[0].body,{p_wallet:A,p_core:CORE,p_revision:4,p_created:true,p_outbid:true,p_lifecycle:true,p_reminders:true,p_minutes:[1,60,1440]});
    for(const minutes of [[],[0],[1441],[1.5],['60'],[60,60],[1,2,3,4],null]){
      storage({});assert.equal((await call({body:{...body,reminderMinutes:minutes}})).statusCode,400);assert.equal(calls.length,0);
    }
    storage({saved:false});assert.equal((await call({body})).body.error,'NOTIFICATION_PREFERENCES_CONFLICT');
    storage({saved:true,preferences:prefs,preferencesRevision:5,reminderMinutes:[60]});assert.equal((await call({body})).statusCode,503);
  });
  await t.test('marking history and reminders uses one validated atomic RPC',async()=>{
    const body={action:'read',ids:['2','4'],read:true};storage({updated:true,ids:['4','2'],read:true});
    const res=await call({body});assert.equal(res.statusCode,200);
    assert.equal(calls[0].url.pathname,'/rest/v1/rpc/mark_auction_notifications_v3');
    storage({updated:false});assert.equal((await call({body})).body.error,'NOTIFICATION_UNAVAILABLE');
  });
  await t.test('guest, wrong wallet, foreign origin and query overrides cannot reach storage',async()=>{
    for(const options of [{h:{}},{h:{...headers,'x-artsoul-wallet':'0x'+'b'.repeat(40)}},
      {h:{...headers,origin:'https://foreign.test'},body:{action:'read',ids:['4'],read:true}},
      {query:{v:'3',wallet:A}},{query:{v:['3']}}]){
      storage({});assert.ok([400,401].includes((await call(options)).statusCode));assert.equal(calls.length,0);
    }
  });
});
