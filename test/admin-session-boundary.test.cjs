const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/entries/admin.jsx', 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('function ProtocolAdminPage()');
const end = source.indexOf('    const SignInDialog =', start);
const logic = source.slice(start, end) + `return {checkAccess, authenticate, changeQueueStatus, submitDecision, setDecision,
    closeSetup: () => { if (typeof setPasskeyOpen === 'function') setPasskeyOpen(false); },
    snapshot: {accessState, access, data, busy, message, decision,
        setupAllowed: Boolean(setupWallet),
        passkeyOpen: typeof passkeyOpen === 'undefined' ? false : passkeyOpen}}; }`;
const WALLET = '0x'+'11'.repeat(20), OTHER = '0x'+'22'.repeat(20);
const access = (fields={}) => ({enabled:true,setupEnabled:true,authenticated:true,eligible:true,access:{role:'admin',stepUpActive:true},...fields});
const empty = () => ({reports:[],events:[],hidden:[],moderationLog:[],notifications:[]});
const secret = () => ({...empty(), reports:[{id:'private-report',details:'private complaint'}]});
const tick = () => new Promise(resolve=>setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail)=>{resolve=done;reject=fail;}); return {promise,resolve,reject}; };

function harness(response=access()) {
    const state = {wallet:WALLET,auth:WALLET,calls:[],access:response,queue:secret(),ensureAuthenticated:async()=>true};
    const values=[],refs=[],effects=[],callbacks=[],listeners=new Map();
    let si,ri,ei,ci,pending;
    const scope = {
        window:{artsoulWalletStateSettled:true,getCurrentWalletAddress:()=>state.wallet,
            SupabaseAuth:{getAuthenticatedWallet:()=>state.auth},ensureAuthenticated:()=>state.ensureAuthenticated(),
            addEventListener:(name,fn)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},
            removeEventListener:(name,fn)=>listeners.get(name)?.delete(fn)},
        encodeURIComponent,
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

test('same-wallet logout clears protected queue, decision and open setup immediately', async()=>{
    const h=harness();await tick();h.render();h.actions.setDecision({report:{id:'secret'},action:'hide'});h.render();
    h.state.auth='';h.event('artsoul:auth-state-changed');
    const view=h.render();assert.equal(view.access,null);assert.equal(view.decision,null);assert.equal(view.setupAllowed,false);assert.equal(view.passkeyOpen,false);
    assert.equal(view.data.reports.length,0);assert.equal(view.accessState,'unauthenticated');
});

test('a late access response cannot reauthorize after logout or wallet A-B-A', async()=>{
    for(const boundary of ['logout','wallet']) {
        const h=harness();await tick();const pending=deferred();h.state.api=path=>path.startsWith('access')?pending.promise:Promise.resolve({data:secret()});
        const old=h.actions.checkAccess();
        if(boundary==='wallet') {h.state.wallet=OTHER;h.state.auth='';h.event('artsoul:wallet-state-changed');h.state.wallet=WALLET;}
        else {h.state.auth='';h.event('artsoul:auth-state-changed');}
        pending.resolve(access());await old;await tick();const view=h.render();assert.notEqual(view.accessState,'ready');assert.equal(view.data.reports.length,0);
    }
});

test('a pending queue read cannot restore complaint data after logout or unmount', async()=>{
    for(const boundary of ['logout','unmount']) {
        const h=harness();await tick();h.render();const pending=deferred();h.state.api=()=>pending.promise;
        const old=h.actions.changeQueueStatus('actioned');
        if(boundary==='logout'){h.state.auth='';h.event('artsoul:auth-state-changed');}else h.unmount();
        const before=h.values[3];pending.resolve({data:{...empty(),reports:[{id:'late-private-report'}]}});await old;
        assert.notEqual(h.values[3].reports[0]?.id,'late-private-report');if(boundary==='unmount')assert.equal(h.values[3],before);
    }
});

test('late decision completion does not reload the queue or display a success under another session', async()=>{
    const h=harness();await tick();h.render();h.actions.setDecision({report:{id:'report',updated_at:'version'},action:'hide'});h.render();
    const pending=deferred();h.state.api=()=>pending.promise;const old=h.actions.submitDecision('review reason');
    const count=h.state.calls.length;h.state.auth='';h.event('artsoul:auth-state-changed');
    pending.resolve({report:{}});await old;assert.equal(h.state.calls.length,count);const view=h.render();assert.equal(view.message,'');assert.equal(view.decision,null);
});

test('late authentication completion is fenced while successful sign-in events start a fresh access check', async()=>{
    const h=harness(access({authenticated:false}));await tick();h.render();const pending=deferred();h.state.ensureAuthenticated=()=>pending.promise;
    const old=h.actions.authenticate(),count=h.state.calls.length;h.state.auth='';h.event('artsoul:auth-state-changed');pending.resolve(true);await old;
    assert.equal(h.state.calls.length,count);assert.equal(h.render().accessState,'unauthenticated');
    h.state.auth=WALLET;h.state.access=access({enabled:false});h.event('artsoul:auth-state-changed');await tick();assert.equal(h.render().accessState,'setup_verified');
});

test('storage logout and pagehide clear protected state without reacting to unrelated preferences', async()=>{
    const h=harness();await tick();h.render();h.event('storage',{key:'artsoul_theme',newValue:'future'});assert.equal(h.render().accessState,'ready');
    h.event('storage',{key:'artsoul_authenticated_wallet',newValue:null});assert.equal(h.render().data.reports.length,0);
    await h.actions.checkAccess();h.render();h.event('pagehide');assert.equal(h.render().data.reports.length,0);assert.equal(h.render().setupAllowed,false);
});

test('queue expiry after accepted access preserves passkey verification while clearing private data', async()=>{
    const h=harness();await tick();h.render();h.state.api=async path=>{
        if(path.startsWith('access'))return access();
        throw Object.assign(new Error('Verify your passkey.'),{code:'STEP_UP_REQUIRED',status:403});
    };
    await h.actions.checkAccess();const view=h.render();assert.equal(view.accessState,'step_up');assert.equal(view.setupAllowed,true);
    assert.equal(view.data.reports.length,0);assert.equal(view.access.stepUpActive,false);assert.equal(view.busy,false);
});

test('a removed staff role or disabled queue clears previous reports on known access denials', async()=>{
    for(const code of ['ADMIN_REQUIRED','PROTOCOL_ADMIN_DISABLED']) {
        const h=harness();await tick();h.render();h.state.api=async()=>{throw Object.assign(new Error('Access changed.'),{code,status:403});};
        await h.actions.changeQueueStatus('actioned');const view=h.render();assert.equal(view.data.reports.length,0);assert.equal(view.access,null);assert.equal(view.setupAllowed,false);assert.equal(view.accessState,'error');
    }
});

test('revocation during a decision clears the pending decision and requires a new passkey session', async()=>{
    const h=harness();await tick();h.render();h.actions.setDecision({report:{id:'report',updated_at:'version'},action:'hide'});h.render();
    h.state.api=async()=>{throw Object.assign(new Error('Credential revoked.'),{code:'CREDENTIAL_REVOKED',status:403});};
    await h.actions.submitDecision('review reason');const view=h.render();assert.equal(view.data.reports.length,0);assert.equal(view.decision,null);assert.equal(view.accessState,'step_up');assert.equal(view.setupAllowed,true);
});

test('wallet switch drops the open admin view and blocks callbacks retained by the prior render', async()=>{
    const h=harness();await tick();h.render();h.actions.setDecision({report:{id:'private-report'},action:'hide'});h.render();
    const old=h.actions,count=h.state.calls.length;h.state.wallet=OTHER;h.event('artsoul:wallet-state-changed');
    const view=h.render();assert.equal(view.access,null);assert.equal(view.data.reports.length,0);assert.equal(view.decision,null);
    await old.changeQueueStatus('actioned');await old.submitDecision('old-session click');
    assert.equal(h.state.calls.length,count,'the switched wallet must not reuse old callbacks');
});

test('a real sign-in event performs a fresh access check even when the old authenticate call finishes later', async()=>{
    const h=harness(access({authenticated:false}));await tick();h.state.auth='';h.event('artsoul:auth-state-changed');h.render();
    h.state.access=access();h.state.ensureAuthenticated=async()=>{
        h.state.auth=WALLET;h.event('artsoul:auth-state-changed');return true;
    };
    await h.actions.authenticate();await tick();assert.equal(h.render().accessState,'ready');
    assert.equal(h.state.calls.filter(call=>call.path.startsWith('access')).length,2);
    assert.equal(h.state.calls.filter(call=>call.path.startsWith('review-queue')).length,1);
});

test('a newer queue filter wins over an older result or error in the same session', async()=>{
    for(const failOlder of [false,true]) {
        const h=harness();await tick();h.render();const older=deferred(),newer=deferred();
        h.state.api=path=>path.includes('actioned')?older.promise:newer.promise;
        const old=h.actions.changeQueueStatus('actioned'),latest=h.actions.changeQueueStatus('dismissed');
        newer.resolve({data:{...empty(),reports:[{id:'latest-filter'}]}});await latest;
        if(failOlder)older.reject(Object.assign(new Error('old request denied'),{code:'STEP_UP_REQUIRED'}));
        else older.resolve({data:{...empty(),reports:[{id:'old-filter'}]}});
        await old;const view=h.render();assert.equal(view.accessState,'ready');assert.equal(view.data.reports[0].id,'latest-filter');assert.equal(view.busy,false);
    }
});

test('guest access does not request queue data or remain on an indefinite loading gate', async()=>{
    const h=harness();await tick();h.state.wallet='';h.state.auth='';h.event('artsoul:wallet-state-changed');
    const count=h.state.calls.length;await h.actions.checkAccess();const view=h.render();
    assert.equal(view.accessState,'unauthenticated');assert.equal(view.busy,false);assert.equal(h.state.calls.length,count);
});

test('a new access denial discards the previously loaded complaint view', async()=>{
    for(const response of [access({enabled:false}),access({eligible:false}),access({authenticated:false})]) {
        const h=harness();await tick();h.render();h.state.access=response;
        await h.actions.checkAccess();const view=h.render();assert.notEqual(view.accessState,'ready');assert.equal(view.data.reports.length,0);
    }
});

test('a repeated settled-wallet event preserves the current admin view', async()=>{
    const h=harness();await tick();h.render();const count=h.state.calls.length;
    h.event('artsoul:wallet-state-changed');const view=h.render();
    assert.equal(view.accessState,'ready');assert.equal(view.data.reports[0].id,'private-report');assert.equal(h.state.calls.length,count);
});
