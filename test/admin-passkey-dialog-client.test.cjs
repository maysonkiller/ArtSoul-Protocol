const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/features/admin/staff-passkeys.jsx', 'utf8').replace(/\r\n/g, '\n');
const component = source.slice(source.indexOf('export function StaffPasskeyDialog(')).replace('export function', 'function');
const logic = component.slice(0, component.indexOf('    return (\n')) + 'return {perform, close, setEnrollmentCode, snapshot: {enrollmentCode, credentials, busy, message}}; }';
const WALLET = '0x' + '11'.repeat(20), OTHER = '0x' + '22'.repeat(20), CODE = 'c'.repeat(43);
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; };

function harness(sessionActive = false) {
  const state = {wallet: WALLET, calls: [], native: [], closed: 0, refreshed: 0, stepUp: 0, opened: 0, focus: 0};
  const values = [], refs = [], effects = [], listeners = new Map();
  let si, ri, ei, pending;
  const scope = {
    window: {getCurrentWalletAddress: () => state.wallet,
      addEventListener: (name, fn) => listeners.set(name, fn),
      removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); }},
    document: {activeElement: {isConnected: true, focus: () => {state.focus++;}}},
    loadWebAuthnBrowser: async () => ({
      startRegistration: async options => {state.native.push({type: 'register', options}); return state.nativeResult ? state.nativeResult() : {id: 'registration'};},
      startAuthentication: async options => {state.native.push({type: 'verify', options}); return state.nativeResult ? state.nativeResult() : {id: 'authentication'};}
    }),
    useState: initial => {const i = si++; if (!(i in values)) values[i] = initial; return [values[i], value => {values[i] = value;}];},
    useRef: initial => refs[ri++] ||= {current: initial},
    useEffect: (fn, deps) => {const i = ei++, old = effects[i]; if (!old || deps.some((x, j) => x !== old.deps[j])) pending.push(() => {old?.cleanup?.(); effects[i] = {deps, cleanup: fn()};});}
  };
  const run = vm.runInNewContext(logic + '\nStaffPasskeyDialog;', scope);
  const h = {state, scope, render() {
    si = ri = ei = 0; pending = [];
    h.actions = run({walletAddress: WALLET, sessionActive,
      api: async (path, options) => {state.calls.push({path, options}); return state.api ? state.api(path, options) : {options: {challenge: 'fixture'}};},
      onClose: () => {state.closed++;}, onAccessChanged: async () => {state.refreshed++;}, onStepUpRequired: () => {state.stepUp++;}});
    refs[0].current = {showModal: () => {state.opened++;}, close() {}};
    refs[1].current = {focus() {}};
    pending.forEach(fn => fn()); return h.actions.snapshot;
  }, event: (name, event = {}) => listeners.get(name)?.(event), unmount: () => effects.forEach(effect => effect.cleanup?.())};
  h.render(); return h;
}

test('opening verification only opens a local dialog until an explicit action', async () => {
  const h = harness(); await tick(); assert.equal(h.state.opened, 1);
  assert.deepEqual(h.state.calls, []); assert.deepEqual(h.state.native, []);
  await h.actions.perform('enroll'); assert.match(h.render().message, /Paste the enrollment code/);
  assert.deepEqual(h.state.calls, []); assert.deepEqual(h.state.native, []);
});

test('explicit enrollment passes its code only to enrollment endpoints and clears it after success', async () => {
  const h = harness(); h.actions.setEnrollmentCode(' ' + CODE + ' '); h.render();
  await h.actions.perform('enroll'); const view = h.render();
  assert.deepEqual(h.state.calls.map(x => x.path), ['passkey-register-options', 'passkey-register-verify']);
  assert.equal(JSON.parse(h.state.calls[0].options.body).token, CODE);
  assert.equal(JSON.parse(h.state.calls[1].options.body).token, CODE);
  assert.equal(h.state.native[0].type, 'register'); assert.equal(h.state.refreshed, 1);
  assert.equal(view.enrollmentCode, ''); assert.match(view.message, /Passkey saved/);
});

test('closing before options resolve prevents a late native prompt and duplicate clicks', async () => {
  const h = harness(), result = deferred(); h.state.api = () => result.promise;
  const pending = h.actions.perform('verify'); await tick(); await h.actions.perform('verify');
  assert.equal(h.state.calls.length, 1); h.actions.close(); result.resolve({options: {challenge: 'late'}}); await pending;
  assert.deepEqual(h.state.native, []); assert.equal(h.state.closed, 1); assert.equal(h.render().busy, false);
});

test('closing or auth loss while the native prompt is pending prevents verify submission', async () => {
  for (const event of ['close', 'artsoul:auth-state-changed', 'artsoul:wallet-state-changed', 'pagehide', 'storage', 'unmount']) {
    const h = harness(), result = deferred(); h.state.nativeResult = () => result.promise;
    const pending = h.actions.perform('verify'); await tick(); assert.equal(h.state.native.length, 1);
    if (event === 'close') h.actions.close(); else if (event === 'unmount') h.unmount();
    else h.event(event, {key: 'artsoul_authenticated_wallet'});
    result.resolve({id: 'late-authentication'}); await pending;
    assert.deepEqual(h.state.calls.map(x => x.path), ['passkey-auth-options'], event);
    assert.equal(h.state.refreshed, 0, event);
  }
});

test('saved passkeys and typed code clear immediately and late reads cannot restore them', async () => {
  const h = harness(); h.state.api = async () => ({credentials: [{credential_id: 'private-id'}]});
  await h.actions.perform('show'); h.actions.setEnrollmentCode(CODE); assert.equal(h.render().credentials.length, 1);
  h.event('storage', {key: 'artsoul_theme'}); assert.equal(h.render().enrollmentCode, CODE);
  const late = deferred(); h.state.api = () => late.promise; const pending = h.actions.perform('show');
  h.event('artsoul:auth-state-changed'); const view = h.render(); assert.equal(view.credentials, null); assert.equal(view.enrollmentCode, '');
  late.resolve({credentials: [{credential_id: 'late-private-id'}]}); await pending; assert.equal(h.render().credentials, null);
});

test('wallet mismatch cannot invoke native or saved-passkey operations', async () => {
  const h = harness(true); h.state.wallet = OTHER;
  for (const action of ['verify', 'show', 'revoke']) await h.actions.perform(action, 'id');
  assert.deepEqual(h.state.calls, []); assert.deepEqual(h.state.native, []);
});

test('invalid enrollment grant uses the real route error and never renders error payloads', async () => {
  const h = harness(); h.actions.setEnrollmentCode(CODE); h.render();
  h.state.api = async () => {throw Object.assign(new Error(CODE), {code: 'ENROLLMENT_GRANT_REQUIRED'});};
  await h.actions.perform('enroll'); const view = h.render();
  assert.equal(view.message, 'This enrollment code is invalid or expired. Use a new code.');
  assert.ok(!view.message.includes(CODE)); assert.deepEqual(h.state.native, []);
});

test('revoking a passkey requires the already verified session and refreshes accepted access', async () => {
  const blocked = harness(); await blocked.actions.perform('revoke', 'id');
  assert.equal(blocked.state.stepUp, 1); assert.deepEqual(blocked.state.calls, []);
  const h = harness(true); await h.actions.perform('revoke', 'id');
  assert.equal(h.state.calls[0].path, 'passkeys');
  assert.deepEqual(JSON.parse(h.state.calls[0].options.body), {action: 'revoke', credential_id: 'id'});
  assert.equal(h.state.refreshed, 1);
});
