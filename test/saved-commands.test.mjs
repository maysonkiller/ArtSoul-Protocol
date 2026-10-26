import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSavedStore, savedKey } from '../src/features/saved/saved-state.js';

const A = '0x' + 'a'.repeat(40), B = '0x' + 'b'.repeat(40), CORE = '0x' + 'c'.repeat(40);
const config = { saved: { enabled: true, chainId: 84532, coreAddress: CORE } };
const item = { chain_id: 84532, core_address: CORE, artwork_id: '34' };
const row = { ...item, artwork: { title: 'Artwork' }, created_at: '2026-10-24T00:00:00Z' };
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });

// Execute the production module in an isolated browser harness. Only ESM
// declarations are removed; the store, command, locking and DOM code are real.
const source = readFileSync(new URL('../src/features/saved/saved-ui.js', import.meta.url), 'utf8')
  .replace(/^import .*?;\r?\n/, '').replace(/^export /gm, '');
const load = new Function('createSavedStore', 'savedKey', 'window', 'document', 'MutationObserver',
  'queueMicrotask', 'setTimeout', 'clearTimeout', source + '\nreturn { savedStore, savedConfig, subscribeSaved, setSavedArtwork };');

function element(tag = 'button') {
  return {
    tagName: tag.toUpperCase(), dataset: {}, children: [], disabled: false,
    setAttribute(name, value) { this[name] = String(value); },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    remove() { this.removed = true; }
  };
}

function harness({ wallet = A, publicConfig = config, authenticate = async () => true } = {}) {
  const calls = [], buttons = [], handlers = new Map(), body = element('body');
  let signIns = 0;
  const window = {
    getCurrentWalletAddress: () => wallet,
    ArtSoulPublicConfig: { load: () => publicConfig },
    ensureAuthenticated: async () => { signIns++; return authenticate(); },
    addEventListener(name, handler) {
      if (!handlers.has(name)) handlers.set(name, []);
      handlers.get(name).push(handler);
    }
  };
  const document = {
    body, documentElement: {},
    querySelectorAll: selector => selector === '[data-saved-artwork]' ? buttons : [],
    createElement: element, createTextNode: text => ({ textContent: text }),
    getElementById: id => body.children.find(child => child.id === id && !child.removed)
  };
  const request = (url, options) => {
    const pending = deferred();
    calls.push({ url, options, ...pending });
    return pending.promise;
  };
  const api = load(options => createSavedStore({ ...options, request }), savedKey, window, document,
    class { observe() {} }, queueMicrotask, () => 1, () => {});
  return {
    ...api, window, calls, buttons, get signIns() { return signIns; },
    button(id = '34') {
      const button = element();
      button.dataset = { savedArtwork: id, savedChain: '84532' };
      buttons.push(button);
      return button;
    },
    emit(type, extra = {}) { for (const handler of handlers.get(type) || []) handler({ type, ...extra }); },
    wallet(value, event = true) { wallet = value; if (event) this.emit('artsoul:wallet-state-changed'); },
    reply(index, data, status = 200) { calls[index].resolve(response(data, status)); }
  };
}

test('explicit repeated commands keep their desired state and notify shared controls and Saved subscribers', async () => {
  const h = harness();
  await h.savedConfig;
  assert.equal(h.window.ArtSoulSaved.setArtwork, h.setSavedArtwork);
  const card = h.button(), detail = h.button(), states = [];
  const unsubscribe = h.subscribeSaved(state => states.push(state));
  for (const desired of [true, true, false, false]) {
    const previous = h.savedStore.getState().saved.get(savedKey(item));
    const pending = h.window.ArtSoulSaved.setArtwork('34', desired);
    await tick();
    const call = h.calls.at(-1);
    assert.equal(call.url, '/api/saved');
    assert.equal(call.options.method, 'PUT');
    assert.equal(call.options.credentials, 'same-origin');
    assert.equal(call.options.cache, 'no-store');
    assert.equal(call.options.headers['X-ArtSoul-Wallet'], A);
    assert.deepEqual(JSON.parse(call.options.body), { ...item, saved: desired });
    assert.equal(h.savedStore.getState().saved.get(savedKey(item)), previous, 'no optimistic acknowledgement');
    for (const control of [card, detail]) assert.equal(control.disabled, true);
    call.resolve(response({ wallet: A, saved: desired }));
    assert.deepEqual(await pending, { updated: true, artwork_id: '34', saved: desired, url: '/profile#saved' });
    for (const control of [card, detail]) {
      assert.equal(control.disabled, false);
      assert.equal(control['aria-pressed'], String(desired));
      assert.equal(control['aria-label'], desired ? 'Remove from Saved' : 'Save artwork');
    }
    assert.equal(states.at(-1).saved.get(savedKey(item)), desired);
  }
  assert.equal(h.calls.length, 4, 'commands do not perform a lookup to choose a toggle');
  assert.equal(h.savedStore.getState().listVersion, 4);
  assert.equal(h.signIns, 0);
  unsubscribe();
});

test('command removal updates the existing Saved list and its subscription', async () => {
  const h = harness();
  await h.savedConfig;
  const loading = h.savedStore.load();
  h.reply(0, { wallet: A, items: [row], nextCursor: null });
  await loading;
  const states = [];
  h.subscribeSaved(state => states.push(state));
  const pending = h.setSavedArtwork('34', false);
  await tick();
  assert.equal(h.savedStore.getState().items.length, 1);
  h.reply(1, { wallet: A, saved: false });
  assert.equal((await pending).updated, true);
  assert.deepEqual(states.at(-1).items, []);
  assert.equal(states.at(-1).listVersion, 1);
});

test('same-item repeated, opposite and toggle commands report contention without adding writes', async () => {
  const h = harness();
  await h.savedConfig;
  const button = h.button();
  const first = h.setSavedArtwork('34', true);
  await tick();
  for (const desired of [true, false]) {
    const result = await h.setSavedArtwork('34', desired);
    assert.equal(result.updated, false);
    assert.match(result.reason, /being updated/);
  }
  await h.window.ArtSoulSaved.toggle(button);
  assert.equal(h.calls.length, 1);
  assert.equal(h.signIns, 0, 'a colliding toggle does not start authentication');
  h.reply(0, { wallet: A, saved: true });
  assert.equal((await first).updated, true);
  const retry = h.setSavedArtwork('34', false);
  await tick();
  h.reply(1, { wallet: A, saved: false });
  assert.equal((await retry).saved, false);
});

test('a toggle owns the shared lock while authentication, lookup and its write are pending', async () => {
  const signIn = deferred(), h = harness({ authenticate: () => signIn.promise });
  await h.savedConfig;
  const button = h.button(), toggle = h.window.ArtSoulSaved.toggle(button);
  assert.match((await h.setSavedArtwork('34', true)).reason, /being updated/);
  assert.equal(h.calls.length, 0);
  signIn.resolve(true);
  await tick();
  assert.match(h.calls[0].url, /artwork_ids=34/);
  assert.match((await h.setSavedArtwork('34', false)).reason, /being updated/);
  h.reply(0, { wallet: A, chainId: 84532, coreAddress: CORE, artworkIds: [] });
  await tick();
  assert.deepEqual(JSON.parse(h.calls[1].options.body), { ...item, saved: true });
  assert.match((await h.setSavedArtwork('34', false)).reason, /being updated/);
  h.reply(1, { wallet: A, saved: true });
  await toggle;
  assert.equal(button.disabled, false);
  assert.equal(h.savedStore.getState().saved.get(savedKey(item)), true);
});

test('a write from the Saved list blocks a command through the same store pending state', async () => {
  const h = harness();
  await h.savedConfig;
  const removal = h.savedStore.set(item, false);
  const command = await h.setSavedArtwork('34', true);
  assert.equal(command.updated, false);
  assert.match(command.reason, /being updated/);
  assert.equal(h.calls.length, 1);
  h.reply(0, { wallet: A, saved: false });
  assert.equal(await removal, true);
});

test('commands reject missing, ambiguous, noncanonical and non-string identities and non-boolean actions', async () => {
  const h = harness();
  for (const id of [undefined, null, 34, 34n, ['34'], {}, '', '0', '01', '-1', ' 34', '34 ', '#34', '34,35',
    '34 and 35', '/artwork/34', '1e3', '3.4', '9'.repeat(79), String(2n ** 256n)]) {
    const result = await h.setSavedArtwork(id, true);
    assert.equal(result.updated, false, String(id));
    assert.match(result.reason, /one artwork number/);
  }
  for (const value of [undefined, null, 0, 1, 'true', 'false', {}]) {
    assert.equal((await h.setSavedArtwork('34', value)).updated, false);
  }
  assert.equal(h.calls.length, 0);
  assert.equal(h.signIns, 0);
});

test('the maximum uint256 artwork identity stays an exact string', async () => {
  const h = harness(), id = String(2n ** 256n - 1n);
  const pending = h.setSavedArtwork(id, true);
  await tick();
  assert.equal(JSON.parse(h.calls[0].options.body).artwork_id, id);
  h.reply(0, { wallet: A, saved: true });
  assert.equal((await pending).artwork_id, id);
});

test('disabled, absent, malformed and failed public configuration prevent writes', async t => {
  for (const [name, value] of [
    ['disabled', { saved: { ...config.saved, enabled: false } }], ['absent', {}],
    ['invalid chain', { saved: { ...config.saved, chainId: 0 } }],
    ['invalid core', { saved: { ...config.saved, coreAddress: '0x' + '0'.repeat(40) } }],
    ['missing deployment', { saved: { enabled: true } }]
  ]) await t.test(name, async () => {
    const h = harness({ publicConfig: value });
    const result = await h.setSavedArtwork('34', true);
    assert.equal(result.updated, false);
    assert.match(result.reason, /unavailable/);
    assert.equal(h.calls.length, 0);
  });
  await t.test('failed load', async () => {
    const pendingConfig = deferred(), h = harness({ publicConfig: pendingConfig.promise });
    const pending = h.setSavedArtwork('34', true);
    pendingConfig.reject(new Error('Unavailable'));
    assert.match((await pending).reason, /unavailable/);
    assert.equal(h.calls.length, 0);
  });
});

test('guests receive a sign-in instruction without authentication or network activity', async () => {
  const h = harness({ wallet: '' });
  const result = await h.setSavedArtwork('34', true);
  assert.equal(result.updated, false);
  assert.match(result.reason, /Connect and sign in/);
  assert.equal(h.calls.length, 0);
  assert.equal(h.signIns, 0);
});

test('401 and another server wallet clear private state and require ordinary sign-in', async t => {
  for (const [name, data, status] of [['expired session', {}, 401], ['wrong wallet', { wallet: B, saved: true }, 200]]) {
    await t.test(name, async () => {
      const h = harness();
      await h.savedConfig;
      const loading = h.savedStore.load();
      h.reply(0, { wallet: A, items: [row] });
      await loading;
      const pending = h.setSavedArtwork('34', true);
      await tick();
      h.reply(1, data, status);
      const result = await pending;
      assert.equal(result.updated, false);
      assert.match(result.reason, /Sign in/);
      assert.equal(h.savedStore.getState().status, 'auth');
      assert.equal(h.savedStore.getState().saved.size, 0);
      assert.deepEqual(h.savedStore.getState().items, []);
      assert.equal(h.signIns, 0);
    });
  }
});

test('a failed write never claims success and an explicit retry keeps the same desired value', async () => {
  const h = harness();
  const first = h.setSavedArtwork('34', true);
  await tick();
  h.reply(0, {}, 503);
  assert.equal((await first).updated, false);
  assert.equal(h.savedStore.getState().saved.size, 0);
  const retry = h.setSavedArtwork('34', true);
  await tick();
  assert.equal(h.calls[1].options.body, h.calls[0].options.body);
  h.reply(1, { wallet: A, saved: true });
  assert.equal((await retry).updated, true);
});

const contextChanges = [
  ['account switch', h => h.wallet(B)],
  ['account switch without an event', h => h.wallet(B, false)],
  ['switch away and back', h => { h.wallet(B); h.wallet(A); }],
  ['same-wallet sign-in change', h => h.emit('artsoul:auth-state-changed')],
  ['cross-tab authentication change', h => h.emit('storage', { key: 'artsoul_authenticated_wallet' })]
];

test('account and auth changes during configuration prevent the old command from writing', async t => {
  for (const [name, change] of contextChanges) await t.test(name, async () => {
    const pendingConfig = deferred(), h = harness({ publicConfig: pendingConfig.promise });
    const pending = h.setSavedArtwork('34', true);
    change(h);
    pendingConfig.resolve(config);
    const result = await pending;
    assert.equal(result.updated, false);
    assert.match(result.reason, /changed/);
    assert.equal(h.calls.length, 0);
    assert.equal(h.savedStore.getState().saved.size, 0);
    assert.equal(h.signIns, 0);
  });
});

test('account and auth changes during requests reject late acknowledgements even when transport ignores abort', async t => {
  for (const [name, change] of contextChanges) await t.test(name, async () => {
    const h = harness(), pending = h.setSavedArtwork('34', true);
    await tick();
    change(h);
    h.reply(0, { wallet: A, saved: true });
    const result = await pending;
    assert.equal(result.updated, false);
    assert.match(result.reason, /changed/);
    assert.equal(h.savedStore.getState().saved.size, 0);
    assert.equal(h.signIns, 0);
  });
});

test('same-wallet auth changes while response JSON is pending cannot restore old state', async () => {
  const h = harness(), body = deferred(), pending = h.setSavedArtwork('34', true);
  await tick();
  h.calls[0].resolve({ ok: true, status: 200, json: () => body.promise });
  await tick();
  h.emit('artsoul:auth-state-changed');
  assert.equal(h.calls[0].options.signal.aborted, true);
  body.resolve({ wallet: A, saved: true });
  assert.equal((await pending).updated, false);
  assert.equal(h.savedStore.getState().saved.size, 0);
  const retry = h.setSavedArtwork('34', false);
  await tick();
  h.reply(1, { wallet: A, saved: false });
  assert.equal((await retry).updated, true);
});

test('an old account completion cannot release the new account command lock', async () => {
  const h = harness(), first = h.setSavedArtwork('34', true);
  await tick();
  h.wallet(B);
  const second = h.setSavedArtwork('34', false);
  await tick();
  assert.equal(h.calls[1].options.headers['X-ArtSoul-Wallet'], B);
  h.reply(0, { wallet: A, saved: true });
  assert.equal((await first).updated, false);
  assert.match((await h.setSavedArtwork('34', true)).reason, /being updated/);
  assert.equal(h.calls.length, 2);
  h.reply(1, { wallet: B, saved: false });
  assert.equal((await second).updated, true);
  assert.equal(h.savedStore.getState().owner, B);
  assert.equal(h.savedStore.getState().saved.get(savedKey(item)), false);
});
