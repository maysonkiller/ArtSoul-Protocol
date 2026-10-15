const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/features/admin/staff-factor-dialog.jsx', 'utf8');
const component = source.slice(source.indexOf('export function StaffFactorDialog('))
  .replace('export function', 'function').replace("import('@simplewebauthn/browser')", 'loadBrowser()')
  .replace("import('qrcode')", 'loadQRCode()');
const logic = component.slice(0, component.indexOf('    return <dialog')) +
  'return {passkey,close,prepareApp,verifyCode,setCode,snapshot:{busy,message,status,setup,qrCode:typeof qrCode === "undefined" ? null : qrCode}}; }\nStaffFactorDialog;';
const WALLET = '0x' + '1'.repeat(40);
const SETUP = {factorId:'fixture-factor',secret:'JBSWY3DPEHPK3PXP',uri:'otpauth://totp/ArtSoul:fixture?secret=JBSWY3DPEHPK3PXP&issuer=ArtSoul&algorithm=SHA1&digits=6&period=30'};
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  const state = {wallet:WALLET,calls:[],cancelled:0,native:0,refreshed:0,closed:0};
  const values=[], refs=[], effects=[], timers=new Map(), listeners=new Map();
  let si,ri,ei,pending;
  const scope={
    window:{getCurrentWalletAddress:()=>state.wallet,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)},
    document:{activeElement:{isConnected:true,focus(){}}},
    loadQRCode:()=>state.loadQRCode ? state.loadQRCode() : Promise.resolve({default:require('qrcode')}),
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
      api:async(route,options)=>{state.calls.push(route);if(state.api)return state.api(route,options);
        if(options && JSON.parse(options.body).operation==='totp-setup')return {...SETUP};
        return options?{options:{challenge:'local'}}:{setup:{id:'permission',expiresAt:new Date(Date.now()+900000).toISOString()},passkeyAvailable:true,totpAvailable:true};},
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

test('authenticator QR encodes the setup URI locally with a four-module quiet border',async()=>{
  const h=harness();await tick();h.render();await h.actions.prepareApp();h.render();await tick();
  const {qrCode,setup}=h.render();assert.ok(qrCode);assert.equal(qrCode.setup,setup);
  const {modules}=require('qrcode').create(SETUP.uri,{errorCorrectionLevel:'M'});
  assert.equal(qrCode.size,modules.size+8);
  const drawn=[...qrCode.path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map(([,x,y])=>[Number(x),Number(y)]);
  assert.equal(drawn.length,modules.data.filter(Boolean).length);
  for(const [x,y] of drawn){assert(x>=4&&x<qrCode.size-4&&y>=4&&y<qrCode.size-4);assert.equal(modules.get(y-4,x-4),1);}
  assert(h.state.calls.every(route=>route==='factor-setup'||route.startsWith('factor-setup?')));
});

test('a late QR encoder cannot restore setup data after close, wallet change, expiry or unmount',async()=>{
  for(const boundary of ['close','artsoul:wallet-state-changed','artsoul:auth-state-changed','pagehide','expiry','unmount']){
    const h=harness();await tick();h.render();let finish;
    h.state.loadQRCode=()=>new Promise(resolve=>{finish=resolve;});
    await h.actions.prepareApp();h.render();assert.equal(typeof finish,'function');
    if(boundary==='close')h.actions.close();else if(boundary==='expiry')h.expire();else if(boundary==='unmount')h.unmount();else h.event(boundary);
    finish({default:require('qrcode')});await tick();
    assert.equal(h.render().qrCode,null,boundary);
  }
});

test('QR generation failure keeps manual setup available without exposing encoder errors',async()=>{
  const h=harness();await tick();h.render();h.state.loadQRCode=async()=>{throw new Error(SETUP.secret);};
  await h.actions.prepareApp();h.render();await tick();const view=h.render();
  assert.equal(view.setup.secret,SETUP.secret);assert.equal(view.qrCode?.failed,true);
  assert.doesNotMatch(view.message,new RegExp(SETUP.secret));
});

test('successful authenticator verification removes the setup key and its QR',async()=>{
  const h=harness();await tick();h.render();await h.actions.prepareApp();h.render();await tick();
  assert.ok(h.render().qrCode);h.actions.setCode('123456');h.render();
  h.actions.verifyCode({preventDefault(){}});await tick();const view=h.render();
  assert.equal(view.setup,null);assert.equal(view.qrCode,null);assert.equal(h.state.refreshed,1);
});

test('a failed manual verification does not strand a delayed QR encoder',async()=>{
  const h=harness();await tick();h.render();let finish;
  h.state.loadQRCode=()=>new Promise(resolve=>{finish=resolve;});
  await h.actions.prepareApp();h.render();
  h.state.api=async(route,options)=>{
    if(JSON.parse(options.body).operation==='totp-verify')throw Object.assign(new Error('invalid'),{code:'CODE_NOT_VERIFIED'});
    return {attemptId:'fixture-attempt'};
  };
  h.actions.setCode('123456');h.render();h.actions.verifyCode({preventDefault(){}});await tick();h.render();
  finish({default:require('qrcode')});await tick();
  assert.ok(h.render().qrCode?.path);assert.match(h.render().message,/code did not match/);
});
