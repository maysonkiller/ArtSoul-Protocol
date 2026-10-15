const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/features/admin/staff-factor-dialog.jsx', 'utf8');
const component = source.slice(source.indexOf('export function StaffFactorDialog('))
  .replace('export function', 'function').replace("import('@simplewebauthn/browser')", 'loadBrowser()');
const logic = component.slice(0, component.indexOf('    return <dialog')) +
  'return {passkey,close,snapshot:{busy,message,status}}; }\nStaffFactorDialog;';
const WALLET = '0x' + '1'.repeat(40);
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  const state = {wallet:WALLET,calls:[],cancelled:0,native:0,refreshed:0,closed:0};
  const values=[], refs=[], effects=[], timers=new Map(), listeners=new Map();
  let si,ri,ei,pending;
  const scope={
    window:{getCurrentWalletAddress:()=>state.wallet,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)},
    document:{activeElement:{isConnected:true,focus(){}}},
    setTimeout:fn=>{const key={};timers.set(key,fn);return key;},clearTimeout:key=>timers.delete(key),
    useState:initial=>{const i=si++;if(!(i in values))values[i]=initial;return [values[i],value=>{values[i]=value;}];},
    useRef:initial=>refs[ri++]||=( {current:initial} ),
    useEffect:(fn,deps)=>{const i=ei++,old=effects[i];if(!old||deps.some((value,j)=>value!==old.deps[j]))pending.push(()=>{old?.cleanup?.();effects[i]={deps,cleanup:fn()};});},
    loadBrowser:async()=>({
      WebAuthnAbortService:{cancelCeremony:()=>{state.cancelled++;}},
      startRegistration:()=>{state.native++;return state.nativeResult();},
      startAuthentication:()=>{state.native++;return state.nativeResult();}
    })
  };
  const run=vm.runInNewContext(logic,scope);
  const h={state,render(){
    si=ri=ei=0;pending=[];
    h.actions=run({walletAddress:WALLET,sessionActive:false,
      api:async(route,options)=>{state.calls.push(route);return options?{options:{challenge:'local'}}:{setup:{id:'permission',expiresAt:new Date(Date.now()+900000).toISOString()},passkeyAvailable:true,totpAvailable:true};},
      onClose:()=>state.closed++,onAccessChanged:async()=>state.refreshed++});
    refs[0].current={showModal(){},close(){}};refs[1].current={focus(){}};
    pending.forEach(fn=>fn());return h.actions.snapshot;
  },event:(name,value={})=>listeners.get(name)?.(value),unmount:()=>effects.forEach(e=>e.cleanup?.()),expire:()=>[...timers.values()].forEach(fn=>fn())};
  h.render();return h;
}

test('factor dialog cancels its native request at every identity and lifetime boundary',async()=>{
  for(const enroll of [false,true])for(const boundary of ['close','artsoul:wallet-state-changed','artsoul:auth-state-changed','storage','pagehide','unmount','expiry']){
    const h=harness();await tick();h.render();
    let finish;h.state.nativeResult=()=>new Promise(resolve=>{finish=resolve;});
    const work=h.actions.passkey(enroll);await tick();
    assert.equal(h.state.native,1,boundary);
    if(boundary==='close')h.actions.close();else if(boundary==='unmount')h.unmount();else if(boundary==='expiry')h.expire();else h.event(boundary,{key:'artsoul_authenticated_wallet'});
    assert.equal(h.state.cancelled,1,boundary);
    finish({id:'stale'});await work;
    assert.equal(h.state.calls.some(route=>route.endsWith('-verify')),false,boundary);
    assert.equal(h.state.refreshed,0,boundary);
  }
});

test('closing after completed native verification does not cancel an unrelated later ceremony',async()=>{
  const h=harness();await tick();h.render();h.state.nativeResult=async()=>({id:'completed'});
  await h.actions.passkey(false);h.actions.close();h.unmount();
  assert.equal(h.state.cancelled,0);
  assert.equal(h.state.refreshed,1);
  assert(h.state.calls.includes('passkey-auth-verify'));
});

test('a native refusal is described without assuming cancellation or displaying private error text',async()=>{
  const h=harness();await tick();h.render();
  h.state.nativeResult=async()=>{throw Object.assign(new Error('private provider detail'),{name:'NotAllowedError'});};
  await h.actions.passkey(true);const message=h.render().message;
  assert.match(message,/did not complete/);assert.match(message,/timed out/);
  assert.doesNotMatch(message,/private provider detail|Verification was cancelled/);
  assert.equal(h.state.calls.some(route=>route.endsWith('-verify')),false);
});
