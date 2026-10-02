const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync('src/features/profile/email-connection.jsx', 'utf8');
const start = source.indexOf('async function manage(');
const end = source.indexOf('\n  return (', start);
const WALLET = `0x${'1'.repeat(40)}`, OTHER = `0x${'2'.repeat(40)}`;
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness({effects = false} = {}) {
  const listeners = new Map();
  const state = {active: WALLET, authenticated: WALLET, busyChanges: [], notices: [], writes: [], refreshes: 0, reads: 0};
  const scope = {wallet: WALLET, email: 'artist@example.test', busy: false,
    activeWallet: () => state.active, operationRef: {current: 0}, authenticatingRef: {current: null}, requestRef: {current: 0}, busyRef: {current: false}, tokenRef: {current: 'a'.repeat(64)},
    URLSearchParams,
    window: {ensureAuthenticated: async () => true, location: {pathname: '/profile', search: '', hash: '#verify_email=' + 'a'.repeat(64)}, history: {replaceState() {state.tokenCleared = true;}},
      SupabaseAuth: {getAuthenticatedWallet: () => state.authenticated},
      addEventListener: (name, handler) => listeners.set(name, handler), removeEventListener: (name, handler) => {if (listeners.get(name) === handler) listeners.delete(name);}},
    api: async body => {if (body) state.writes.push(body); else state.reads++; return {wallet: WALLET, verified: false, available: true};},
    refresh: async () => {state.refreshes++; scope.requestRef.current++;},
    useEffect: fn => {state.retire = fn();},
    setBusy: value => state.busyChanges.push(value), setNotice: value => {state.notices.push(value); state.notice = value;},
    setConnection: value => {state.connection = value;}, setEditing: value => {state.editing = value;}, setEmail: value => {state.email = value;}, setHasToken() {}};
  vm.runInNewContext(source.slice(effects ? source.indexOf('async function refresh(') : start, end) + '\nthis.manage = manage;', scope);
  return {state, scope, manage: scope.manage, authChanged: wallet => {state.authenticated = wallet; listeners.get('artsoul:auth-state-changed')?.();}};
}

test('an email operation waiting for wallet sign-in cannot write after its component is retired', async () => {
  const h = harness(); let release;
  h.scope.window.ensureAuthenticated = () => new Promise(resolve => {release = resolve;});
  const old = h.manage('request'); await tick();
  h.state.active = OTHER;
  h.scope.operationRef.current++; h.scope.requestRef.current++;
  h.state.active = WALLET;
  release(true); await old;
  assert.deepEqual(h.state.writes, []);
  assert.deepEqual(h.state.busyChanges, [true]);
});

test('an old email completion cannot clear a newer operation busy state or repaint private data', async () => {
  const h = harness(); let release;
  h.scope.api = () => new Promise(resolve => {release = resolve;});
  const old = h.manage('confirm'); await tick();
  h.scope.operationRef.current++; h.scope.requestRef.current++;
  release({wallet: WALLET, verified: true}); await old;
  assert.deepEqual(h.state.busyChanges, [true]);
  assert.equal(h.state.refreshes, 0);
  assert.ok(!h.state.notices.includes('Email verified.'));
});

test('email completion remains busy-safe when its own status refresh advances the read generation', async () => {
  const h = harness(); await h.manage('request');
  assert.equal(h.state.refreshes, 1);
  assert.deepEqual(h.state.busyChanges, [true, false]);
});

test('two same-turn email submits issue only one authenticated request', async () => {
  const h = harness();
  await Promise.all([h.manage('request'), h.manage('request')]);
  assert.equal(h.state.writes.length, 1);
  assert.deepEqual(h.state.busyChanges, [true, false]);
});

test('the link fragment is cleared only after successful confirmation', async () => {
  const h = harness();
  h.scope.api = async () => {throw new Error('Wrong wallet');};
  await h.manage('confirm');
  assert.equal(h.state.tokenCleared, undefined);
  assert.equal(h.scope.tokenRef.current, 'a'.repeat(64));
  h.scope.api = async () => ({wallet: WALLET, verified: true});
  await h.manage('confirm');
  assert.equal(h.state.tokenCleared, true);
  assert.equal(h.scope.tokenRef.current, '');
});

test('completion for an older email link cannot erase a newly opened link in the same tab', async () => {
  const h = harness(); let release;
  h.scope.api = () => new Promise(resolve => {release = resolve;});
  const confirmation = h.manage('confirm'); await tick();
  h.scope.tokenRef.current = 'b'.repeat(64);
  release({wallet: WALLET, verified: true}); await confirmation;
  assert.equal(h.scope.tokenRef.current, 'b'.repeat(64));
  assert.equal(h.state.tokenCleared, undefined);
  assert.equal(h.state.refreshes, 0);
  assert.deepEqual(h.state.busyChanges, [true, false]);
});

test('same-wallet sign-out immediately clears private email and rejects an older status read', async () => {
  const h = harness({effects: true}); await tick();
  h.state.connection = {available: true, verified: true, email: 'private@example.test'};
  h.state.email = 'draft@example.test'; h.state.editing = true; h.state.notice = 'Email verified.';
  let release;
  h.scope.api = () => new Promise(resolve => {release = resolve;});
  const pending = h.scope.refresh();
  const readsBefore = h.state.reads;
  h.authChanged('');
  assert.equal(h.state.connection.email, undefined);
  assert.equal(h.state.connection.needsSignIn, true);
  assert.equal(h.state.email, ''); assert.equal(h.state.editing, false); assert.equal(h.state.notice, '');
  assert.equal(h.state.reads, readsBefore, 'sign-out does not start another private request');
  release({available: true, verified: true, email: 'private@example.test'}); await pending;
  assert.equal(h.state.connection.email, undefined);
  assert.equal(h.state.connection.needsSignIn, true);
  h.state.retire();
  assert.equal(h.scope.operationRef.current, 2);
});

test('sign-out fences an in-flight email confirmation without consuming the link or painting success', async () => {
  const h = harness({effects: true}); await tick(); let release;
  h.scope.api = () => new Promise(resolve => {release = resolve;});
  const pending = h.manage('confirm'); await tick();
  h.authChanged('');
  assert.equal(h.scope.busyRef.current, false);
  assert.equal(h.state.busyChanges.at(-1), false);
  release({wallet: WALLET, verified: true}); await pending;
  assert.equal(h.state.connection.needsSignIn, true);
  assert.equal(h.state.tokenCleared, undefined);
  assert.equal(h.scope.tokenRef.current, 'a'.repeat(64));
  assert.ok(!h.state.notices.includes('Email verified.'));
});

test('first email action survives the actual missing-session checks and successful sign-in events', async () => {
  for (const action of ['open', 'request', 'confirm']) {
    const h = harness({effects: true}); await tick();
    h.state.authenticated = '';
    h.scope.window.ensureAuthenticated = async () => {
      // ensureAuthenticated checks the backend, then authenticateWithWallet checks again.
      h.authChanged(''); await tick(); h.authChanged(''); await tick(); h.authChanged(WALLET);
      return true;
    };
    await h.manage(action);
    assert.equal(h.scope.busyRef.current, false);
    assert.deepEqual(h.state.busyChanges, [true, false]);
    assert.equal(h.state.writes.length, action === 'open' ? 0 : 1);
    if (action === 'open') assert.equal(h.state.editing, true);
    if (action === 'request') assert.equal(h.state.writes[0].email, 'artist@example.test');
    if (action === 'confirm') assert.equal(h.state.tokenCleared, true);
  }
});

test('another authenticated wallet cancels an email action still waiting for sign-in', async () => {
  const h = harness({effects: true}); await tick(); let release;
  h.scope.window.ensureAuthenticated = () => new Promise(resolve => {release = resolve;});
  const pending = h.manage('request'); await tick();
  h.authChanged(OTHER);
  release(true); await pending;
  assert.deepEqual(h.state.writes, []);
  assert.equal(h.state.connection.needsSignIn, true);
  assert.equal(h.scope.busyRef.current, false);
});

test('retired auth listeners cannot clear a newer email component', async () => {
  const h = harness({effects: true}); await tick();
  h.state.retire();
  h.state.connection = {verified: true, email: 'new-session@example.test'};
  h.authChanged('');
  assert.equal(h.state.connection.email, 'new-session@example.test');
});

test('profile email gate remains disabled without a true public flag and ignores retired config reads', async () => {
  const profileSource = fs.readFileSync('src/entries/profile.jsx', 'utf8');
  const marker = profileSource.indexOf('Promise.resolve(window.ArtSoulPublicConfig?.load?.())');
  const effectStart = profileSource.lastIndexOf('useEffect(() => {', marker);
  const effectEnd = profileSource.indexOf('}, []);', marker) + '}, []);'.length;
  const effect = profileSource.slice(effectStart, effectEnd);
  for (const config of [undefined, {}, {emailVerificationEnabled: false}, {emailVerificationEnabled: 'true'}, {emailVerificationEnabled: true}]) {
    const changes = [];
    vm.runInNewContext(effect, {Promise, window: {ArtSoulPublicConfig: {load: async () => config}},
      useEffect: fn => fn(), setEmailVerificationEnabled: value => changes.push(value)});
    await tick();
    assert.deepEqual(changes, [config?.emailVerificationEnabled === true]);
  }
  let release, retire;
  const changes = [];
  vm.runInNewContext(effect, {Promise, window: {ArtSoulPublicConfig: {load: () => new Promise(resolve => {release = resolve;})}},
    useEffect: fn => {retire = fn();}, setEmailVerificationEnabled: value => changes.push(value)});
  retire(); release({emailVerificationEnabled: true}); await tick();
  assert.deepEqual(changes, []);
  vm.runInNewContext(effect, {Promise, window: {ArtSoulPublicConfig: {load: async () => {throw new Error('config unavailable');}}},
    useEffect: fn => fn(), setEmailVerificationEnabled: value => changes.push(value)});
  await tick(); assert.deepEqual(changes, [false]);
});
