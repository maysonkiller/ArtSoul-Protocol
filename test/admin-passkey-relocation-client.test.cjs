const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(process.env.ADMIN_CANDIDATE_PATH || 'src/entries/admin.jsx', 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('function ProtocolAdminPage()');
const end = source.indexOf('    const verification =', start) >= 0 ? source.indexOf('    const verification =', start) : source.indexOf('    const groups =', start);
const logic = source.slice(start, end) + `return {checkAccess, authenticate, changeQueueStatus, submitDecision, setDecision,
    closeSetup: () => { if (typeof setPasskeyOpen === 'function') setPasskeyOpen(false); },
    snapshot: {accessState, access, data, busy, message, decision,
        setupAllowed: typeof setupAllowed === 'undefined' ? Boolean(setupWallet) : setupAllowed,
        passkeyOpen: typeof passkeyOpen === 'undefined' ? false : passkeyOpen}}; }`;
const WALLET = '0x'+'11'.repeat(20), OTHER = '0x'+'22'.repeat(20);
const access = (fields={}) => ({enabled:true,setupEnabled:true,authenticated:true,eligible:true,access:{role:'admin',stepUpActive:true},...fields});
const empty = () => ({reports:[],events:[],hidden:[],moderationLog:[],notifications:[]});
const secret = () => ({...empty(), reports:[{id:'private-report',details:'private complaint'}]});
const tick = () => new Promise(resolve=>setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done=>{resolve=done;}); return {promise,resolve}; };

function harness(response=access(), settled=true) {
    const state = {wallet:WALLET,auth:WALLET,calls:[],access:response,queue:secret(),ensureAuthenticated:async()=>true};
    const values=[],refs=[],effects=[],callbacks=[],listeners=new Map();
    let si,ri,ei,ci,pending;
    const scope = {
        window:{artsoulWalletStateSettled:settled,getCurrentWalletAddress:()=>state.wallet,
            SupabaseAuth:{getAuthenticatedWallet:()=>state.auth},ensureAuthenticated:()=>state.ensureAuthenticated(),
            addEventListener:(name,fn)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},removeEventListener:(name,fn)=>listeners.get(name)?.delete(fn)},
        currentAdminWallet:()=>scope.window.artsoulWalletStateSettled ? state.wallet : '', emptyAdminData:empty, encodeURIComponent,
        api:async(path,options)=>{state.calls.push({path,options});if(state.api)return state.api(path,options);return path.startsWith('access')?state.access:{data:state.queue};},
        useState:initial=>{const i=si++;if(!(i in values))values[i]=typeof initial==='function'?initial():initial;return [values[i],value=>{values[i]=typeof value==='function'?value(values[i]):value;}];},
        useRef:initial=>refs[ri++] ||= {current:initial},
        useCallback:(fn,deps)=>{const i=ci++,old=callbacks[i];if(!old||deps.some((x,j)=>x!==old.deps[j]))callbacks[i]={fn,deps};return callbacks[i].fn;},
        useEffect:(fn,deps)=>{const i=ei++,old=effects[i];if(!old||deps.some((x,j)=>x!==old.deps[j]))pending.push(()=>{old?.cleanup?.();effects[i]={deps,cleanup:fn()};});}
    };
    const run=vm.runInNewContext(logic+'\nProtocolAdminPage;',scope);
    const h={state,scope,values,render(){si=ri=ei=ci=0;pending=[];h.actions=run();pending.forEach(fn=>fn());return h.actions.snapshot;},
        event:(name,event={})=>[...(listeners.get(name)||[])].forEach(fn=>fn(event)),unmount:()=>effects.forEach(effect=>effect.cleanup?.())};
    h.render();return h;
}

test('setup remains available with queue off and opens only the local verification dialog', async()=>{
    const h=harness(access({enabled:false,access:{role:'admin',stepUpActive:false}}));await tick();
    const view=h.render();assert.equal(view.setupAllowed,true);assert.equal(view.passkeyOpen,true);assert.equal(view.accessState,'setup');
    assert.equal(h.state.calls.length,1);assert.match(h.state.calls[0].path,new RegExp('expectedWallet='+WALLET));
    h.actions.closeSetup();h.render();await h.actions.checkAccess();assert.equal(h.render().passkeyOpen,false,'closing persists through same-session access refresh');
    assert.ok(h.state.calls.every(call=>call.path.startsWith('access')));
});

test('queue requires enabled, authenticated, eligible and active step-up independently', async()=>{
    for(const fields of [{enabled:false},{authenticated:false},{eligible:false},{access:{role:'admin',stepUpActive:false}}]) {
        const h=harness(access(fields));await tick();assert.equal(h.state.calls.some(call=>call.path.startsWith('review-queue')),false,JSON.stringify(fields));
    }
    const h=harness();await tick();assert.equal(h.render().data.reports[0].id,'private-report');
    assert.equal(h.render().passkeyOpen,false,'an already verified admin does not see another verification dialog');
});

test('unsettled wallet setup opens automatically after restoration without a page reload', async()=>{
    const h=harness(access({enabled:false,access:{role:'admin',stepUpActive:false}}), false);
    await tick();assert.equal(h.render().setupAllowed,false);assert.equal(h.state.calls.length,0);
    h.scope.window.artsoulWalletStateSettled=true;h.event('artsoul:wallet-state-changed');
    await tick();const view=h.render();assert.equal(view.setupAllowed,true);assert.equal(view.passkeyOpen,true);
    assert.equal(h.state.calls.length,1);assert.match(h.state.calls[0].path,new RegExp('expectedWallet='+WALLET));
    assert.match(source, /\['setup', 'setup_verified', 'step_up'\]\.includes\(state\)/);
});

test('setup clears on wallet and auth boundaries and ignores stale setup responses', async()=>{
    for(const event of ['artsoul:wallet-state-changed','artsoul:auth-state-changed','pagehide','storage']) {
        const h=harness(access({enabled:false,access:{role:'admin',stepUpActive:false}}));await tick();h.render();
        const pending=deferred();h.state.api=()=>pending.promise;const old=h.actions.checkAccess();
        if(event==='artsoul:wallet-state-changed')h.state.wallet='';
        h.event(event,{key:'artsoul_authenticated_wallet'});
        assert.equal(h.render().setupAllowed,false);assert.equal(h.render().passkeyOpen,false);
        pending.resolve(access({enabled:false}));await old;assert.equal(h.render().setupAllowed,false);assert.equal(h.render().passkeyOpen,false);
    }
});
