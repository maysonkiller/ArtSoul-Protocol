import assert from 'node:assert/strict';
import test from 'node:test';
import {createAuctionNotifications} from '../src/features/moderation/auction-notifications-state.js';
const A='0x'+'a'.repeat(40), B='0x'+'b'.repeat(40), CORE='0x'+'c'.repeat(40);
const NOW='2026-10-25T12:00:00.000Z';
const config={enabled:true,lifecycleEnabled:true,remindersEnabled:true,chainId:84532,coreAddress:CORE};
const prefs={auction_created:true,outbid:true,lifecycle:true,reminders:true};
const history=(id='3')=>({id,type:'auction_created',chain_id:'84532',core_address:CORE,artwork_id:'34',auction_id:'66',
  transaction_hash:'0x'+'d'.repeat(64),created_at:NOW,read:false,artworkAvailable:true,message:'Recorded auction creation.',
  token_id:null,amount_wei:null,settlement_deadline:null});
const reminder=(extra={})=>({...history('4'),type:'auction_ending',deadline:String(Date.parse(NOW)/1000+1800),offset_minutes:60,...extra});
const page=(extra={})=>({wallet:A,items:[history()],preferences:{...prefs},preferencesRevision:0,chainRevision:'0',nextCursor:null,
  reminderMinutes:[60],serverTime:NOW,remindersAvailable:true,remindersCapped:false,reminders:[reminder()],...extra});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t,fetchPage){
  let wallet=A,state,now=0,nextTimer=0;const timers=new Map();
  const model=createAuctionNotifications({wallet:A,getWallet:()=>wallet,onChange:s=>{state=s;},fetchPage,
    clock:()=>now,schedule:(fn,delay)=>{const id=++nextTimer;timers.set(id,{fn,delay});return id;},cancelSchedule:id=>timers.delete(id)});
  model.configure(config);t.after(()=>model.dispose());
  return{model,get state(){return state;},timers,advance:ms=>{now+=ms;},expire:()=>{const timer=[...timers.values()][0];assert.ok(timer);timer.fn();},
    switchWallet:()=>{wallet=B;model.invalidate('auth');}};
}

test('reminder read/unread persists independently of recorded history',async t=>{
  let read=false;const urls=[];
  const m=fixture(t,async(url,options)=>{urls.push(url);if(options.method==='PUT'){
    const write=JSON.parse(options.body);read=write.read;return Response.json({wallet:A,updated:write.ids,read});
  }return Response.json(page({reminders:[reminder({read})]}));});
  await m.model.load();await m.model.markRead(['4'],true);await m.model.load();
  assert.equal(m.state.reminders[0].read,true);assert.equal(m.state.items[0].read,false);
  await m.model.markRead(['4'],false);assert.equal(m.state.reminders[0].read,false);
  assert.ok(urls.every(url=>url==='/api/notifications?v=3'));
});

test('custom reminder minutes survive reload and disabling retains the personal schedule',async t=>{
  let minutes=[60],preferences={...prefs},revision=0;const writes=[];
  const m=fixture(t,async(_url,options)=>{if(options.method==='PUT'){
    const b=JSON.parse(options.body);writes.push(b);minutes=b.reminderMinutes;preferences=b.preferences;revision++;
    return Response.json({wallet:A,preferences,preferencesRevision:revision,reminderMinutes:minutes});
  }return Response.json(page({reminderMinutes:minutes,preferences,preferencesRevision:revision,reminders:preferences.reminders?[reminder()]:[]}));});
  await m.model.load();await m.model.setReminderMinutes([1440,60,1]);
  assert.deepEqual(writes[0].reminderMinutes,[1,60,1440]);assert.deepEqual(m.state.reminderMinutes,[1,60,1440]);
  await m.model.setPreference('reminders',false);assert.deepEqual(writes[1].reminderMinutes,[1,60,1440]);
  assert.deepEqual(m.state.reminders,[]);assert.equal(m.state.preferences.reminders,false);
  for(const bad of [[60,60],[1441],[],[1,2,3,4]])await m.model.setReminderMinutes(bad);
  assert.equal(writes.length,2);
});

test('client freshness expiry hides only current reminders and never depends on the device clock',async t=>{
  const m=fixture(t,async()=>Response.json(page()));await m.model.load();
  assert.equal([...m.timers.values()][0].delay,60000);m.expire();
  assert.deepEqual(m.state.reminders,[]);assert.equal(m.state.remindersStatus,'unavailable');assert.equal(m.state.items.length,1);
  await m.model.refreshReminders();assert.equal(m.state.reminders.length,1);
});

test('deadline expiry and slow response time shorten the freshness window conservatively',async t=>{
  const m=fixture(t,async()=>{m.advance(2500);return Response.json(page({reminders:[reminder({deadline:String(Date.parse(NOW)/1000+10)})]}));});
  await m.model.load();assert.equal([...m.timers.values()][0].delay,7500);
  m.expire();assert.deepEqual(m.state.reminders,[]);
});

test('a response delayed beyond its deadline cannot show a payable reminder',async t=>{
  const m=fixture(t,async()=>{m.advance(61000);return Response.json(page());});await m.model.load();
  assert.deepEqual(m.state.reminders,[]);assert.equal(m.state.status,'ready');assert.equal(m.state.items.length,1);
});

for(const changed of [{},{chainRevision:'1'},{preferencesRevision:1}])test(`hidden page discards a delayed reminder response despite changed revisions ${JSON.stringify(changed)}`,async t=>{
  const delayed=deferred();let calls=0;
  const m=fixture(t,async()=>++calls===1?Response.json(page()):{ok:true,status:200,json:()=>delayed.promise});
  await m.model.load();const pending=m.model.refreshReminders();await tick();m.model.pauseReminders();
  delayed.resolve(page(changed));await pending;
  assert.deepEqual(m.state.reminders,[]);assert.equal(m.state.items.length,1);assert.equal(calls,2);
});

test('hidden page cannot regain reminders through a historical pagination revision reload',async t=>{
  const delayed=deferred();let calls=0;
  const m=fixture(t,async()=>{
    calls++;if(calls===1)return Response.json(page({nextCursor:'3'}));
    if(calls===2)return{ok:true,status:200,json:()=>delayed.promise};
    return Response.json(page({chainRevision:'1'}));
  });
  await m.model.load();const pending=m.model.load('3');await tick();m.model.pauseReminders();
  delayed.resolve(page({items:[history('2')],chainRevision:'1'}));await pending;
  assert.deepEqual(m.state.reminders,[]);assert.equal(m.state.chainRevision,'1');assert.equal(calls,3);
});

test('refresh preserves loaded historical pages but clears both lists on a detected chain rewind',async t=>{
  let calls=0;const waiting=deferred();
  const m=fixture(t,async()=>{
    calls++;if(calls===1)return Response.json(page({nextCursor:'3'}));
    if(calls===2)return Response.json(page({items:[history('2')]}));
    if(calls===3)return Response.json(page());
    if(calls===4)return Response.json(page({chainRevision:'1',reminders:[]}));
    return{ok:true,status:200,json:()=>waiting.promise};
  });
  await m.model.load();await m.model.load('3');await m.model.refreshReminders();
  assert.deepEqual(m.state.items.map(x=>x.id),['3','2']);
  const pending=m.model.refreshReminders();await tick();assert.deepEqual(m.state.items,[]);assert.deepEqual(m.state.reminders,[]);
  waiting.resolve(page({items:[],reminders:[],chainRevision:'1'}));await pending;assert.equal(m.state.chainRevision,'1');
});

test('repeated focus signals do not abort the refresh already in progress',async t=>{
  let calls=0;const waiting=deferred();
  const m=fixture(t,async()=>++calls===1?Response.json(page()):{ok:true,status:200,json:()=>waiting.promise});
  await m.model.load();const pending=m.model.refreshReminders();await tick();await m.model.refreshReminders();
  assert.equal(calls,2);waiting.resolve(page());await pending;assert.equal(m.state.reminders.length,1);
});

for(const boundary of ['wallet','close','capability'])test(`${boundary} retires private reminders and delayed responses`,async t=>{
  const waiting=deferred();let calls=0;
  const m=fixture(t,async()=>++calls===1?Response.json(page()):{ok:true,status:200,json:()=>waiting.promise});
  await m.model.load();const pending=m.model.refreshReminders();await tick();
  if(boundary==='wallet')m.switchWallet();else if(boundary==='close')m.model.invalidate();else m.model.configure({...config,remindersEnabled:false});
  const cleared=m.state;waiting.resolve(page());await pending;
  assert.equal(m.state,cleared);assert.deepEqual(m.state.reminders,[]);assert.deepEqual(m.state.items,[]);
});

test('unavailable indexer and malformed rows do not poison recorded history',async t=>{
  const m=fixture(t,async()=>Response.json(page({remindersAvailable:false,reminders:[]})));await m.model.load();
  assert.equal(m.state.status,'ready');assert.equal(m.state.remindersStatus,'unavailable');assert.equal(m.state.items.length,1);
  for(const changes of [{reminders:[reminder(),reminder()]},{reminderMinutes:[60,60]},{serverTime:'bad'},
    {reminders:[reminder({deadline:String(Date.parse(NOW)/1000)})]},{preferences:{...prefs,reminders:false}}]){
    const bad=fixture(t,async()=>Response.json(page(changes)));await bad.model.load();assert.equal(bad.state.status,'error');assert.deepEqual(bad.state.reminders,[]);
  }
});

test('expired reminder mutation refreshes current data after an all-or-none rejection',async t=>{
  let calls=0;const m=fixture(t,async(_url,options)=>{
    if(options.method==='PUT')return Response.json({error:'NOTIFICATION_UNAVAILABLE',message:'Expired.'},{status:409});
    return Response.json(page({reminders:++calls===1?[reminder()]:[]}));
  });
  await m.model.load();await m.model.markRead(['4'],true);
  assert.deepEqual(m.state.reminders,[]);assert.equal(m.state.items[0].read,false);assert.deepEqual(m.state.pendingIds,[]);
});
