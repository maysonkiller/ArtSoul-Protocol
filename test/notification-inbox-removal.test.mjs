import assert from 'node:assert/strict';
import test from 'node:test';
import auctionHandler from '../src/api/routes/notifications.js';
import moderationHandler from '../src/api/routes/moderation/notifications.js';
import {setWalletSession} from '../src/api/backend.js';
import {createAuctionNotifications} from '../src/features/moderation/auction-notifications-state.js';
import {createNotificationInbox} from '../src/features/moderation/notification-inbox-state.js';

const A=`0x${'a'.repeat(40)}`,B=`0x${'b'.repeat(40)}`,CORE=`0x${'c'.repeat(40)}`,ORIGIN='https://artsoulprotocol.com';
const env={SESSION_SECRET:'local-removal-fixture',SUPABASE_URL:'https://removal.example.test',SUPABASE_SERVICE_ROLE_KEY:'local-removal-service',
  ARTSOUL_PUBLIC_ORIGIN:ORIGIN,ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA:CORE,ARTSOUL_AUCTION_NOTIFICATIONS_ENABLED:'true',
  ARTSOUL_NOTIFICATION_SUMMARY_ENABLED:'true',API_ALLOWED_ORIGINS:''};
const response=()=>({headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v;},status(v){this.statusCode=v;return this;},json(v){this.body=v;return this;},end(){}});
test('inbox removal APIs bind a bounded mutation to the signed recipient and verify exact acknowledgments',async t=>{
  const previous=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]])),fetcher=globalThis.fetch;Object.assign(process.env,env);
  t.after(()=>{globalThis.fetch=fetcher;for(const[key,value]of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;});
  const session=response();setWalletSession(session,A);
  const headers={cookie:session.headers['Set-Cookie'].split(';')[0],'x-artsoul-wallet':A,'content-type':'application/json',origin:ORIGIN};
  for(const [name,handler,query,rpc] of [['auction',auctionHandler,{},'remove_auction_notifications'],['moderation',moderationHandler,{v:'2'},'remove_personal_moderation_notifications']]){
    await t.test(name,async()=>{
      let calls=[];
      const call=async(body={action:'remove',ids:['9007199254740993']},h=headers,method='PUT')=>{
        const res=response();await handler({method,headers:h,query,body},res);assert.equal(res.headers['Cache-Control'],'private, no-store');return res;
      };
      globalThis.fetch=async(url,options)=>{calls.push({url:new URL(url),body:JSON.parse(options.body)});return Response.json({removed:true,ids:['9007199254740993']});};
      const ok=await call();assert.equal(ok.statusCode,200);assert.deepEqual(ok.body,{wallet:A,removed:['9007199254740993']});
      assert.equal(calls[0].url.pathname,`/rest/v1/rpc/${rpc}`);assert.deepEqual(calls[0].body,{p_wallet:A,p_ids:['9007199254740993'],...(name==='auction'?{p_core:CORE}:{})});
      for(const body of [{action:'remove',ids:[]},{action:'remove',ids:['1','1']},{action:'remove',ids:['0']},
        {action:'remove',ids:['9223372036854775808']},{action:'remove',ids:[1]},{action:'remove',ids:Array.from({length:21},(_,i)=>String(i+1))},
        {action:'remove',ids:['1'],wallet:B},{action:'remove',ids:['1'],read:true}]){
        calls=[];assert.equal((await call(body)).statusCode,400);assert.equal(calls.length,0);
      }
      for(const h of [{...headers,'x-artsoul-wallet':B},{...headers,cookie:''},{...headers,origin:'https://foreign.test'}]){
        calls=[];assert.equal((await call(undefined,h)).statusCode,401);assert.equal(calls.length,0);
      }
      globalThis.fetch=async()=>Response.json({removed:false});assert.equal((await call()).statusCode,409);
      for(const acknowledgment of [{removed:true,ids:[]},{removed:true,ids:['2']},{removed:true,ids:['9007199254740993','9007199254740993']}]){
        globalThis.fetch=async()=>Response.json(acknowledgment);assert.equal((await call()).statusCode,503);
      }
      globalThis.fetch=async()=>Response.json({message:'private database details'},{status:500});
      const failed=await call();assert.equal(failed.statusCode,503);assert.doesNotMatch(JSON.stringify(failed.body),/private database/);
    });
  }
});

const item=id=>({id,type:'auction_created',chain_id:'84532',core_address:CORE,artwork_id:'1',auction_id:'1',
  transaction_hash:`0x${'d'.repeat(64)}`,created_at:'2026-10-26T10:00:00Z',message:'Auction created.',read:false,artworkAvailable:true});
const page=(items=[item('3'),item('2')])=>({wallet:A,items,nextCursor:'2',preferences:{auction_created:true,outbid:true},preferencesRevision:0,chainRevision:'0'});
const deferred=()=>{let resolve;return {promise:new Promise(done=>resolve=done),resolve:value=>resolve(value)};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
for(const kind of ['auction','moderation']){
  function fixture(fetchPage){
    let wallet=A,state;
    const model=(kind==='auction'?createAuctionNotifications:createNotificationInbox)({wallet:A,getWallet:()=>wallet,onChange:value=>state=value,
      fetchPage:(url,options)=>url.startsWith('/api/moderation/access?')?Response.json({authenticated:true,eligible:false}):fetchPage(url,options)});
    model.configure(kind==='auction'?{enabled:true,chainId:84532,coreAddress:CORE}:{summaryEnabled:true});
    return {model,get state(){return state;},switchWallet(){wallet=B;model.invalidate('auth');}};
  }
  test(`${kind} removal waits for exact acknowledgment, preserves older cursor and rejects invalid selection`,async()=>{
    const delayed=deferred();let writes=0;
    const m=fixture(async(_url,options)=>options.method==='PUT'?(writes++,delayed.promise):Response.json(page()));
    await m.model.load();
    for(const ids of [[],['3','3'],['999'],[3],Array.from({length:21},()=> '3')])await m.model.remove(ids);
    assert.equal(writes,0);
    const pending=m.model.remove(['3']);await tick();assert.deepEqual(m.state.items.map(i=>i.id),['3','2']);assert.deepEqual(m.state.pendingIds,['3']);
    await m.model.load('2');assert.equal(m.state.pendingIds.length,1);
    delayed.resolve(Response.json({wallet:A,removed:['3']}));await pending;
    assert.deepEqual(m.state.items.map(i=>i.id),['2']);assert.equal(m.state.nextCursor,'2');assert.deepEqual(m.state.pendingIds,[]);
  });
  for(const boundary of ['wallet','signout','foreign-response','bad-ack'])test(`${kind} removal protects ${boundary} boundary`,async()=>{
    const delayed=deferred();const m=fixture(async(_url,options)=>options.method==='PUT'?{ok:true,status:200,json:()=>delayed.promise}:Response.json(page()));
    await m.model.load();const pending=m.model.remove(['3']);await tick();
    if(boundary==='wallet')m.switchWallet();if(boundary==='signout')m.model.invalidate('auth');
    delayed.resolve({wallet:boundary==='foreign-response'?B:A,removed:boundary==='bad-ack'?['2']:['3']});await pending;
    if(boundary==='bad-ack'){assert.equal(m.state.items.length,2);assert.ok(m.state.error);}else{assert.equal(m.state.status,'auth');assert.deepEqual(m.state.items,[]);}
  });
  test(`${kind} failed removal preserves all selected rows`,async()=>{
    const m=fixture(async(_url,options)=>options.method==='PUT'?Response.json({error:'NOTIFICATIONS_UNAVAILABLE',message:'Try again.'},{status:503}):Response.json(page()));
    await m.model.load();await m.model.remove(['3','2']);assert.equal(m.state.items.length,2);assert.ok(m.state.error);assert.deepEqual(m.state.pendingIds,[]);
  });
}
