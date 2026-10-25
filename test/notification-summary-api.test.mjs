import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../src/api/routes/notifications.js';
import moderation from '../src/api/routes/moderation/notifications.js';
import {setWalletSession} from '../src/api/backend.js';
import {readAuctionNotificationConfig} from '../src/api/auction-notification-config.js';
import {createNotificationInbox} from '../src/features/moderation/notification-inbox-state.js';
const A='0x'+'a'.repeat(40),B='0x'+'b'.repeat(40),CORE='0x'+'c'.repeat(40),ORIGIN='https://artsoulprotocol.com';
const result=()=>({headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;},end(){}});
const summary=(patch={})=>({auctionCount:1,moderationCount:2,reminderCount:0,remindersAvailable:true,serverTime:'2026-10-25T12:00:00Z',nextReminderDeadline:null,chainRevision:'0',preferencesRevision:0,...patch});
test('private notification summary and moderation read API',async t=>{
  const env={SESSION_SECRET:'summary-local-test-only',SUPABASE_URL:'https://summary.example.test',SUPABASE_SERVICE_ROLE_KEY:'local-fixture',
    ARTSOUL_NOTIFICATION_SUMMARY_ENABLED:'true',ARTSOUL_AUCTION_NOTIFICATIONS_ENABLED:'true',ARTSOUL_AUCTION_LIFECYCLE_ENABLED:'true',
    ARTSOUL_AUCTION_REMINDERS_ENABLED:'true',ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA:CORE,ARTSOUL_PUBLIC_ORIGIN:ORIGIN,API_ALLOWED_ORIGINS:''};
  const prior={...process.env},originalFetch=globalThis.fetch;Object.assign(process.env,env);
  t.after(()=>{globalThis.fetch=originalFetch;for(const key of Object.keys(env)){if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];}});
  const session=result();setWalletSession(session,A);const headers={cookie:session.headers['Set-Cookie'].split(';')[0],'x-artsoul-wallet':A,'content-type':'application/json',origin:ORIGIN};
  let requests=[];
  function storage(value){requests=[];globalThis.fetch=async(url,options)=>{requests.push({url:String(url),body:options.body?JSON.parse(options.body):null});return Response.json(typeof value==='function'?value(requests.at(-1)):value);};}
  async function call({route=handler,method='GET',query={summary:'1'},h=headers,body}={}){const r=result();await route({method,headers:h,query,body},r);assert.equal(r.headers['Cache-Control'],'private, no-store');return r;}
  await t.test('summary scope comes from SIWE, not a query-selected recipient; projection strips extra fields',async()=>{
    storage({...summary(),privateComplaint:'never return'});const r=await call();assert.equal(r.statusCode,200);assert.deepEqual(r.body,{wallet:A,...summary()});
    assert.deepEqual(requests[0].body,{p_wallet:A,p_core:CORE,p_auctions:true,p_lifecycle:true,p_reminders:true});assert.match(requests[0].url,/rpc\/read_notification_summary$/);
  });
  await t.test('guest, foreign wallet and unsupported query/method cannot reach storage',async()=>{
    for(const options of [{h:{}},{h:{...headers,'x-artsoul-wallet':B}},{h:{...headers,'x-artsoul-wallet':undefined}},
      {query:{summary:'1',wallet:B}},{query:{summary:'1',before:'2'}},{query:{summary:'1',v:'3'}},{query:{summary:'true'}},{method:'PUT'}]){
      storage(summary());assert.ok((await call(options)).statusCode>=400);assert.equal(requests.length,0);
    }
  });
  await t.test('summary capability is explicit and independent of auction write/read activation',async()=>{
    delete process.env.ARTSOUL_NOTIFICATION_SUMMARY_ENABLED;storage(summary());assert.equal((await call()).statusCode,503);assert.equal(requests.length,0);
    process.env.ARTSOUL_NOTIFICATION_SUMMARY_ENABLED='true';process.env.ARTSOUL_AUCTION_NOTIFICATIONS_ENABLED='false';
    storage(summary({auctionCount:0,chainRevision:null}));assert.equal((await call()).statusCode,200);assert.equal(requests[0].body.p_auctions,false);
    assert.equal(requests[0].body.p_reminders,false);assert.equal(readAuctionNotificationConfig().summaryEnabled,true);process.env.ARTSOUL_AUCTION_NOTIFICATIONS_ENABLED='true';
  });
  await t.test('invalid or stale summary fields never become a count',async()=>{
    for(const patch of [{auctionCount:101},{moderationCount:-1},{reminderCount:1},{serverTime:'bad'},{chainRevision:1},{preferencesRevision:-1},
      {nextReminderDeadline:'1'},{remindersAvailable:false,reminderCount:1,nextReminderDeadline:'1792930600'}]){
      storage(summary(patch));assert.equal((await call()).statusCode,503);
    }
    globalThis.fetch=async()=>{throw Error('private database connection');};const r=await call();assert.equal(r.statusCode,503);assert.doesNotMatch(JSON.stringify(r.body),/connection|database/);
  });
  const modCall=options=>call({route:moderation,query:{v:'2'},...options});
  const report='11111111-1111-1111-1111-111111111111';
  await t.test('versioned personal moderation page exposes only read state, not read timestamp or report content',async()=>{
    storage(({url})=>url.includes('/artwork_reports?')?[{id:report,chain_id:'84532',artwork_id:'34'}]:
      [{id:'9007199254741050',report_id:report,notification_type:'REPORT_RESOLVED',created_at:'2026-10-25T11:00:00Z',read_at:null}]);
    const r=await modCall();assert.equal(r.statusCode,200);assert.equal(r.body.items[0].read,false);assert.match(requests[0].url,/read_at/);
    assert.doesNotMatch(JSON.stringify(r.body),/report_id|read_at/);
  });
  await t.test('recipient can reversibly mark an exact BIGINT personal notice',async()=>{
    for(const read of [true,false]){storage({updated:true,ids:['9007199254741050'],read});const r=await modCall({method:'PUT',body:{action:'read',ids:['9007199254741050'],read}});
      assert.equal(r.statusCode,200);assert.deepEqual(requests[0].body,{p_wallet:A,p_ids:['9007199254741050'],p_read:read});assert.equal(r.body.read,read);}
  });
  await t.test('read mutation rejects mixed scope, bad origin, wrong version, bounds and injected recipient before storage',async()=>{
    const body={action:'read',ids:['1'],read:true};
    for(const options of [{h:{...headers,origin:'https://evil.example'}},{h:{...headers,'x-artsoul-wallet':B}},{h:{...headers,'x-artsoul-wallet':undefined}},
      {query:{}},{query:{v:'2',before:'4'}},{body:{...body,wallet:B}},{body:{...body,ids:['1','1']}},{body:{...body,ids:[1]}},{body:{...body,ids:[]}},{body:{...body,read:1}}]){
      storage({updated:true,ids:['1'],read:true});assert.ok((await modCall({method:'PUT',body,...options})).statusCode>=400);assert.equal(requests.length,0);
    }
  });
  await t.test('foreign or disappeared personal notice returns conflict and false acknowledgments fail closed',async()=>{
    const body={action:'read',ids:['1'],read:true};storage({updated:false});assert.equal((await modCall({method:'PUT',body})).statusCode,409);
    for(const reply of [{updated:true,ids:['2'],read:true},{updated:true,ids:['1'],read:false},{updated:true,ids:['1','1'],read:true}]){
      storage(reply);assert.equal((await modCall({method:'PUT',body})).statusCode,503);
    }
  });
});

test('personal moderation client retains read state only after a matching acknowledgement',async()=>{
  let state;const calls=[];const model=createNotificationInbox({wallet:A,getWallet:()=>A,onChange:s=>{state=s;},fetchPage:async(url,options)=>{
    calls.push(url);if(options.method==='PUT'){const body=JSON.parse(options.body);return Response.json({wallet:A,updated:body.ids,read:body.read});}
    if(url.startsWith('/api/moderation/access'))return Response.json({authenticated:true,eligible:false});
    return Response.json({wallet:A,items:[{id:'1',read:false}],nextCursor:null});
  }});
  model.configure({summaryEnabled:true});await model.load();assert.equal(state.items[0].read,false);
  await model.markRead('1',true);assert.equal(state.items[0].read,true);await model.markRead('1',false);assert.equal(state.items[0].read,false);
  assert.equal(calls[0],'/api/moderation/notifications?v=2');assert.equal(state.pendingId,null);model.invalidate();
});
test('late personal moderation read acknowledgement cannot repopulate an invalidated wallet',async()=>{
  let state,finish;const model=createNotificationInbox({wallet:A,getWallet:()=>A,onChange:s=>{state=s;},fetchPage:async(url,options)=>{
    if(options.method==='PUT')return new Promise(resolve=>{finish=()=>resolve(Response.json({wallet:A,updated:['1'],read:true}));});
    if(url.startsWith('/api/moderation/access'))return Response.json({authenticated:true,eligible:false});
    return Response.json({wallet:A,items:[{id:'1',read:false}],nextCursor:null});
  }});
  model.configure({summaryEnabled:true});await model.load();const pending=model.markRead('1',true);model.invalidate('auth');finish();await pending;
  assert.equal(state.status,'auth');assert.deepEqual(state.items,[]);
});
test('personal read action does not abort an in-flight older page and strand its loading state',async()=>{
  let state,finish,writes=0;const model=createNotificationInbox({wallet:A,getWallet:()=>A,onChange:s=>{state=s;},fetchPage:async(url,options)=>{
    if(options.method==='PUT'){writes++;return Response.json({wallet:A,updated:['2'],read:true});}
    if(url.includes('before='))return new Promise(resolve=>{finish=()=>resolve(Response.json({wallet:A,items:[{id:'1',read:false}],nextCursor:null}));});
    if(url.startsWith('/api/moderation/access'))return Response.json({authenticated:true,eligible:false});
    return Response.json({wallet:A,items:[{id:'2',read:false}],nextCursor:'2'});
  }});
  model.configure({summaryEnabled:true});await model.load();const pending=model.load('2');await model.markRead('2',true);assert.equal(writes,0);
  finish();await pending;assert.equal(state.status,'ready');assert.equal(state.items.length,2);model.invalidate();
});
