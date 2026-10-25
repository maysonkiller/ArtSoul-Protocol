import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotificationSummary} from '../src/features/moderation/notification-summary-state.js';
const A='0x'+'a'.repeat(40),B='0x'+'b'.repeat(40);
const data=(patch={})=>({wallet:A,auctionCount:2,moderationCount:1,reminderCount:0,remindersAvailable:true,
  serverTime:'2026-10-25T12:00:00Z',nextReminderDeadline:null,chainRevision:'0',preferencesRevision:0,...patch});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
function fixture(fetchPage=async()=>Response.json(data())) {
  let wallet=A,now=0,timer;const calls=[],states=[];
  const model=createNotificationSummary({wallet:A,getWallet:()=>wallet,onChange:state=>states.push(state),clock:()=>now,
    fetchPage:(...args)=>{calls.push(args);return fetchPage(...args);},schedule:(fn,delay)=>{timer={fn,delay};return 1;},cancelSchedule:()=>{timer=null;}});
  return{model,calls,states,setWallet:value=>{wallet=value;},advance:value=>{now+=value;},get timer(){return timer;}};
}
test('collapsed summary uses one private count request without fetching notification content',async()=>{
  const h=fixture();h.model.configure({summaryEnabled:true});await h.model.refresh();
  assert.deepEqual(h.model.getState(),{status:'ready',count:3,complete:true});
  assert.equal(h.calls[0][0],'/api/notifications?summary=1');
  assert.equal(h.calls[0][1].headers['X-ArtSoul-Wallet'],A);assert.equal(h.calls[0][1].cache,'no-store');
  assert.equal(h.calls.length,1);h.model.dispose();
});
test('disabled summary makes no request, independent of auction feature',async()=>{
  const h=fixture();h.model.configure({enabled:true});await h.model.refresh(true);assert.equal(h.calls.length,0);
  h.model.configure({enabled:false,summaryEnabled:true});await h.model.refresh();assert.equal(h.model.getState().count,3);h.model.dispose();
});
test('focus bursts and pending reads are bounded; forced mutation refresh retires the earlier result',async()=>{
  const a=deferred(),b=deferred();let n=0;const h=fixture(()=>++n===1?a.promise:b.promise);h.model.configure({summaryEnabled:true});
  const first=h.model.refresh();await h.model.refresh();assert.equal(h.calls.length,1);
  const second=h.model.refresh(true);b.resolve(Response.json(data({auctionCount:0,moderationCount:0})));await second;
  a.resolve(Response.json(data({auctionCount:99})));await first;assert.equal(h.model.getState().count,0);
  await h.model.refresh();assert.equal(h.calls.length,2);h.model.dispose();
});
for(const change of ['wallet','invalidate','dispose'])test(`${change} rejects late private summary`,async()=>{
  const pending=deferred(),h=fixture(()=>pending.promise);h.model.configure({summaryEnabled:true});const run=h.model.refresh();
  if(change==='wallet')h.setWallet(B);else h.model[change]();
  pending.resolve(Response.json(data()));await run;assert.equal(h.model.getState().count,null);h.model.dispose();
});
test('401 stops passive retries until explicit sign-in refresh and never prompts a wallet',async()=>{
  let ok=false;const h=fixture(()=>Promise.resolve(ok?Response.json(data()):Response.json({},{status:401})));h.model.configure({summaryEnabled:true});
  await h.model.refresh();h.advance(60000);await h.model.refresh();assert.equal(h.calls.length,1);assert.equal(h.model.getState().status,'auth');
  ok=true;await h.model.refresh(true);assert.equal(h.model.getState().count,3);h.model.dispose();
});
test('partial reminder availability retains only a truthful unread signal',async()=>{
  const h=fixture(async()=>Response.json(data({remindersAvailable:false})));h.model.configure({summaryEnabled:true});await h.model.refresh();
  assert.deepEqual(h.model.getState(),{status:'ready',count:3,complete:false});h.model.dispose();
});
test('counts saturate at 100 for a 99+ display, without counting review queue records',async()=>{
  const h=fixture(async()=>Response.json(data({auctionCount:99,moderationCount:100,staffReview:{count:1000}})));h.model.configure({summaryEnabled:true});
  await h.model.refresh();assert.equal(h.model.getState().count,100);h.model.dispose();
});
test('server deadline and elapsed request time expire the badge without device-wall-clock assumptions',async()=>{
  const pending=deferred(),h=fixture(()=>pending.promise);h.model.configure({summaryEnabled:true});const run=h.model.refresh();h.advance(2000);
  pending.resolve(Response.json(data({reminderCount:1,nextReminderDeadline:String(Date.parse('2026-10-25T12:00:10Z')/1000)})));await run;
  assert.equal(h.timer.delay,8000);h.timer.fn();assert.equal(h.model.getState().count,null);h.model.dispose();
});
for(const patch of [{wallet:B},{auctionCount:-1},{moderationCount:101},{reminderCount:1},{serverTime:'bad'},
  {nextReminderDeadline:'1792929599'},{remindersAvailable:false,reminderCount:1,nextReminderDeadline:'1792930600'},{preferencesRevision:-1},{chainRevision:2}]) {
  test(`invalid summary is suppressed: ${JSON.stringify(patch)}`,async()=>{const h=fixture(async()=>Response.json(data(patch)));h.model.configure({summaryEnabled:true});await h.model.refresh();assert.equal(h.model.getState().count,null);h.model.dispose();});
}
test('refresh failure clears old count instead of claiming zero unread',async()=>{
  let fail=false;const h=fixture(async()=>{if(fail)throw Error('offline');return Response.json(data());});h.model.configure({summaryEnabled:true});await h.model.refresh();fail=true;
  await h.model.refresh(true);assert.deepEqual(h.model.getState(),{status:'unavailable',count:null,complete:false});h.model.dispose();
});
