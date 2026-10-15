const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { verifyMessage } = require('ethers');

const source = fs.readFileSync('src/features/admin/staff-authority.jsx', 'utf8').replace(/\r\n/g, '\n');
const logic = source.slice(source.indexOf('const STORAGE_KEY ='), source.indexOf('    return <section'))
  .replace('export function StaffAuthority', 'function StaffAuthority') +
  'return {loadRoster,create,snapshot:{roster,rosterBusy,rosterError,request,signatures,busy,message}}; }\nStaffAuthority;';
const WALLET = '0x' + '11'.repeat(20), OTHER = '0x' + '22'.repeat(20);
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const roster = () => ({policy:{authorities:[WALLET,OTHER]},staff:[{wallet:WALLET,role:'team',active:true}],nextCursor:null});
const proposal = () => ({message:'Synthetic role approval',proposal:{requestId:'11111111-1111-4111-8111-111111111111',
  expiresAt:new Date(Date.now()+300000).toISOString(),authorities:[WALLET,OTHER]}});

function harness({readOnly=false, api}={}) {
  const state = {wallet:WALLET,auth:WALLET,settled:true,calls:[],api,accessChanges:0};
  const values=[],refs=[],effects=[],listeners=new Map(),storage=new Map();
  let si,ri,ei,pending;
  const scope = {
    window:{get artsoulWalletStateSettled(){return state.settled;},getCurrentWalletAddress:()=>state.wallet,
      SupabaseAuth:{getAuthenticatedWallet:()=>state.auth},
      addEventListener:(name,fn)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},
      removeEventListener:(name,fn)=>listeners.get(name)?.delete(fn)},
    sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    setTimeout:()=>1,clearTimeout:()=>{},verifyMessage,TextEncoder,
    useState:initial=>{const i=si++;if(!(i in values))values[i]=initial;return [values[i],value=>{values[i]=typeof value==='function'?value(values[i]):value;}];},
    useRef:initial=>refs[ri++] ||= {current:initial},
    useEffect:(fn,deps)=>{const i=ei++,old=effects[i];if(!old||deps.some((value,j)=>value!==old.deps[j]))pending.push(()=>{old?.cleanup?.();effects[i]={deps,cleanup:fn()};});}
  };
  const run = vm.runInNewContext(logic,scope);
  const h = {state,render(){
    si=ri=ei=0;pending=[];
    h.actions=run({walletAddress:WALLET,readOnly,
      api:async(path,options)=>{state.calls.push({path,options});if(state.api)return state.api(path,options);
        return options?{request:proposal()}:roster();},onAccessChanged:async()=>state.accessChanges++});
    pending.forEach(fn=>fn());return h.actions.snapshot;
  },event:(name,event={})=>[...(listeners.get(name)||[])].forEach(fn=>fn(event)),
    unmount:()=>effects.forEach(effect=>effect.cleanup?.()),listenerCount:()=>[...listeners.values()].reduce((total,set)=>total+set.size,0)};
  h.render();return h;
}

async function prepareRequest(h) {
  await tick();h.render();h.actions.create({preventDefault(){}});await tick();
  assert.ok(h.render().request);
}

test('same-wallet state events preserve the team directory and pending authority approval',async()=>{
  for(const readOnly of [false,true]) {
    const h=harness({readOnly});await tick();h.render();if(!readOnly)await prepareRequest(h);
    const before=h.render(),calls=h.state.calls.length;
    for(const chainId of [84532,8453]) {
      h.event('artsoul:wallet-state-changed',{detail:{address:WALLET,chainId,isConnected:true}});
      const after=h.render();
      assert.equal(after.roster,before.roster,'chain state is not a staff identity change');
      assert.equal(after.request,before.request,'an unchanged signer keeps the reviewed proposal');
      assert.equal(h.state.calls.length,calls,'a duplicate wallet notification does not reload the roster');
    }
    h.unmount();
  }
});

test('a same-wallet notification does not discard a team response already in flight',async()=>{
  const pending=deferred(),h=harness({api:()=>pending.promise});
  h.event('artsoul:wallet-state-changed',{detail:{address:WALLET,chainId:84532,isConnected:true}});
  pending.resolve(roster());await tick();
  const after=h.render();assert.equal(after.roster?.staff[0].wallet,WALLET);assert.equal(after.rosterBusy,false);
  h.unmount();
});

test('wallet, authentication and lifecycle changes immediately clear the visible team and approval',async()=>{
  for(const boundary of ['wallet','authentication','unsettled','auth-event','pagehide']) {
    const h=harness();await prepareRequest(h);assert.ok(h.render().roster);
    if(boundary==='wallet')h.state.wallet=OTHER;
    if(boundary==='authentication')h.state.auth='';
    if(boundary==='unsettled')h.state.settled=false;
    const event=boundary==='auth-event'?'artsoul:auth-state-changed':boundary==='pagehide'?'pagehide':'artsoul:wallet-state-changed';
    h.event(event);
    const after=h.render();assert.equal(after.roster,null,boundary);assert.equal(after.request,null,boundary);
    assert.equal(after.signatures.length,0,boundary);assert.equal(after.busy,false,boundary);
    h.unmount();
  }
});

test('late roster and proposal responses cannot return after an identity or lifetime boundary',async()=>{
  for(const boundary of ['wallet','authentication','unsettled','auth-event','pagehide','unmount']) {
    const h=harness();await tick();h.render();const pendingRoster=deferred(),pendingProposal=deferred();
    h.state.api=(path,options)=>options?pendingProposal.promise:pendingRoster.promise;
    const loading=h.actions.loadRoster();h.actions.create({preventDefault(){}});
    if(boundary==='wallet')h.state.wallet=OTHER;
    if(boundary==='authentication')h.state.auth='';
    if(boundary==='unsettled')h.state.settled=false;
    if(boundary==='unmount')h.unmount();
    else h.event(boundary==='auth-event'?'artsoul:auth-state-changed':boundary==='pagehide'?'pagehide':'artsoul:wallet-state-changed');
    // Returning to the original address cannot make an earlier request current again.
    h.state.wallet=WALLET;h.state.auth=WALLET;h.state.settled=true;
    pendingRoster.resolve(roster());pendingProposal.resolve({request:proposal()});await loading;await tick();
    const after=h.render();assert.equal(after.roster,null,boundary);assert.equal(after.request,null,boundary);
    h.unmount();assert.equal(h.listenerCount(),0,boundary);
  }
});
