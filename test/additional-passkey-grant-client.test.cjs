const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync('src/entries/artwork.jsx', 'utf8').replace(/\r\n/g, '\n');
const component = source.slice(source.indexOf('function AdditionalPasskeyGrant('), source.indexOf('\nfunction useDecodedImage('));
const logic = component.slice(0, component.indexOf('    return (\n')) + '    return {issueGrant, copyGrant, clearGrant};\n}';
const WALLET = '0x' + '1'.repeat(40), OTHER = '0x' + '2'.repeat(40), TOKEN = 'T'.repeat(43);
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};};

function harness() {
  const state = {wallet: WALLET, now: Date.now(), writes: [], clipboard: [], verificationRequired: 0};
  const values = [], refs = [], effects = [], listeners = new Map(), timers = new Map();
  let stateIndex, refIndex, effectIndex, timerId = 0, pendingEffects;
  const scope = {
    window: {
      getCurrentWalletAddress: () => state.wallet,
      ensureAuthenticated: async () => true,
      addEventListener: (type, fn) => listeners.set(type, fn),
      removeEventListener: (type, fn) => {if (listeners.get(type) === fn) listeners.delete(type);}
    },
    navigator: {clipboard: {writeText: async value => {state.clipboard.push(value);}}},
    Date: class Clock extends Date {static now() {return state.now;}},
    setTimeout: (fn, delay) => {const id = ++timerId; timers.set(id, {fn, delay}); return id;},
    clearTimeout: id => timers.delete(id),
    useState: initial => {
      const index = stateIndex++;
      if (!(index in values)) values[index] = initial;
      return [values[index], value => {values[index] = value;}];
    },
    useRef: initial => {const index = refIndex++; return refs[index] ||= {current: initial};},
    useEffect: (fn, deps) => {
      const index = effectIndex++, old = effects[index];
      if (!old || deps.some((value, i) => value !== old.deps[i])) pendingEffects.push(() => {
        old?.cleanup?.(); effects[index] = {deps, cleanup: fn()};
      });
    }
  };
  state.api = async path => {
    state.writes.push(path);
    return {success: true, token: TOKEN, expires_at: new Date(state.now + 15 * 60 * 1000).toISOString()};
  };
  const renderComponent = vm.runInNewContext(logic + '\nAdditionalPasskeyGrant;', scope);
  const h = {state, scope, values, timers,
    render() {
      stateIndex = refIndex = effectIndex = 0; pendingEffects = [];
      h.actions = renderComponent({walletAddress: WALLET, api: path => state.api(path), onStepUpRequired: () => {state.verificationRequired++;}});
      pendingEffects.forEach(run => run()); return h.actions;
    },
    event: (name, event = {}) => listeners.get(name)?.(event),
    unmount: () => effects.forEach(effect => effect.cleanup?.())
  };
  h.render(); return h;
}

test('additional enrollment makes no request before an explicit click and suppresses same-turn duplicates', async () => {
  const h = harness(); assert.deepEqual(h.state.writes, []);
  const auth = deferred(); h.scope.window.ensureAuthenticated = () => auth.promise;
  const first = h.actions.issueGrant(); await h.actions.issueGrant();
  assert.equal(h.values[1], true); auth.resolve(true); await first;
  assert.deepEqual(h.state.writes, ['passkey-grant']);
  assert.equal(h.values[0].token, TOKEN); assert.equal(h.values[1], false);
  await h.actions.issueGrant(); assert.equal(h.state.writes.length, 1);
});

test('cancelling while authentication is pending prevents grant creation', async () => {
  const h = harness(), auth = deferred(); h.scope.window.ensureAuthenticated = () => auth.promise;
  const pending = h.actions.issueGrant(); h.actions.clearGrant(); auth.resolve(true); await pending;
  assert.deepEqual(h.state.writes, []); assert.equal(h.values[0], null); assert.equal(h.values[1], false);
});

test('auth and wallet boundaries discard an outstanding response even after the original wallet returns', async () => {
  for (const event of ['artsoul:auth-state-changed', 'artsoul:wallet-state-changed', 'storage', 'pagehide']) {
    const h = harness(), result = deferred(); h.state.api = () => result.promise;
    const pending = h.actions.issueGrant(); await tick();
    if (event === 'artsoul:wallet-state-changed') h.state.wallet = OTHER;
    h.event(event, {key: 'artsoul_authenticated_wallet'}); h.state.wallet = WALLET;
    result.resolve({success: true, token: TOKEN, expires_at: new Date(h.state.now + 10000).toISOString()}); await pending;
    assert.equal(h.values[0], null, event); assert.equal(h.values[1], false, event);
  }
});

test('private enrollment code clears immediately on sign-out and unrelated storage events leave it intact', async () => {
  const h = harness(); await h.actions.issueGrant();
  h.event('storage', {key: 'artsoul_theme'}); assert.equal(h.values[0].token, TOKEN);
  h.event('artsoul:auth-state-changed'); assert.equal(h.values[0], null);
  assert.equal(h.state.verificationRequired, 1);
});

test('an unmounted component ignores a late successful grant response', async () => {
  const h = harness(), result = deferred(); h.state.api = () => result.promise;
  const pending = h.actions.issueGrant(); await tick(); h.unmount();
  result.resolve({success: true, token: TOKEN, expires_at: new Date(h.state.now + 10000).toISOString()}); await pending;
  assert.equal(h.values[0], null);
});

test('expired or malformed server grants are never displayed', async () => {
  for (const fields of [{expires_at: 'invalid'}, {expires_at: new Date(0).toISOString()}, {token: 'bad token'}, {success: false}]) {
    const h = harness();
    h.state.api = async () => ({success: true, token: TOKEN, expires_at: new Date(h.state.now + 10000).toISOString(), ...fields});
    await h.actions.issueGrant(); assert.equal(h.values[0], null); assert.match(h.values[2], /Could not create/);
    assert.ok(!h.values[2].includes(TOKEN));
  }
});

test('expiry clears the in-memory code and requires a new step-up without another grant request', async () => {
  const h = harness(); await h.actions.issueGrant(); h.render();
  const timer = [...h.timers.values()][0]; assert.equal(timer.delay, 15 * 60 * 1000);
  h.state.now += timer.delay; timer.fn();
  assert.equal(h.values[0], null); assert.equal(h.state.verificationRequired, 1);
  assert.deepEqual(h.state.writes, ['passkey-grant']);
  await h.actions.copyGrant(); assert.deepEqual(h.state.clipboard, []);
});

test('copy is explicit, bounded by expiry and wallet, and failures never echo the token', async () => {
  const h = harness(); await h.actions.issueGrant();
  assert.deepEqual(h.state.clipboard, []); await h.actions.copyGrant();
  assert.deepEqual(h.state.clipboard, [TOKEN]); assert.ok(!h.values[2].includes(TOKEN));
  h.scope.navigator.clipboard.writeText = async () => {throw new Error(TOKEN);};
  await h.actions.copyGrant(); assert.match(h.values[2], /copy it manually/); assert.ok(!h.values[2].includes(TOKEN));
  h.state.wallet = OTHER; await h.actions.copyGrant(); assert.equal(h.values[0], null);
  assert.equal(h.state.clipboard.length, 1);
});

test('an expired server step-up requests verification without displaying a grant or raw error', async () => {
  const h = harness(); h.state.api = async () => {throw Object.assign(new Error(TOKEN), {code: 'STEP_UP_REQUIRED'});};
  await h.actions.issueGrant(); assert.equal(h.state.verificationRequired, 1); assert.equal(h.values[0], null);
  assert.ok(!h.values[2].includes(TOKEN));
});

test('staff-only grant UI uses ordinary buttons, ephemeral display and no token persistence', () => {
  assert.match(source, /passkeyAccess\?\.required && isSameAddress\(passkeyAccess\.wallet, connectedWalletAddress\)/);
  assert.match(source, /passkeyAccess\.active && <AdditionalPasskeyGrant/);
  assert.match(component, /onClick=\{issueGrant\}/); assert.match(component, /onClick=\{copyGrant\}/);
  assert.match(component, /onClick=\{clearGrant\}/); assert.match(component, /autoComplete="off"/);
  assert.doesNotMatch(component, /localStorage\.|sessionStorage\.|console\.|history\.|location\.|sendBeacon|clipboard\.read/);
});
