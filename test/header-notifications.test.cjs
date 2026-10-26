const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'src/entries/header-notifications.js'), 'utf8');
const pages = ['index.html', 'gallery.html', 'artwork.html', 'profile.html', 'upload.html', 'admin.html', 'collection-builder.html', 'docs-protocol.html'];
const A = '0x' + 'a'.repeat(40), B = '0x' + 'b'.repeat(40);
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}

function harness({initial, settled = false, missingHost = false, pending = null, hint = ''} = {}) {
  const listeners = new Map(), imports = [], roots = [], warnings = [];
  let clicks = 0;
  const effects = [];
  const host = {dataset: {notificationWallet: hint}, hidden: !hint, current: null, innerHTML: '<button data-notification-preview>Notifications</button>',
    addEventListener(type, fn) {this.onClick = fn;},
    querySelector() {return {click() {clicks++;}};}};
  const window = {
    artsoulWalletStateSettled: settled, artsoulSettledWalletState: initial,
    ArtSoulHeaderPrepaint: {boot: {notificationWallet: hint}},
    // Cached identity is explicitly insufficient to show a private control.
    currentWalletAddress: A, getCurrentWalletAddress: () => A,
    localStorage: {getItem() {throw Error('A header must not trust storage hints.');}},
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    }
  };
  function NotificationInbox() {}
  const runtime = {React: {...React, useEffect: fn => effects.push(fn)}, createRoot(node) {
    assert.equal(node, host);
    const root = {renders: [], disposed: false,
      render(element) {assert.equal(this.disposed, false); this.renders.push(element); host.current = element.type(); host.innerHTML = 'mounted'; effects.splice(0).forEach(fn => fn());},
      unmount() {assert.equal(this.disposed, false); this.disposed = true; host.current = null; host.innerHTML = '';}
    };
    roots.push(root); return root;
  }};
  let load = (name, value) => {imports.push(name); return pending ? pending.promise.then(() => value) : Promise.resolve(value);};
  const transformed = source
    .replace("import('./react-runtime.js')", "loadRuntime()")
    .replace("import('../features/moderation/notification-inbox.jsx')", "loadComponent()");
  assert.doesNotMatch(transformed, /\bimport\(/, 'the harness must intercept both production imports');
  const run = () => vm.runInNewContext(transformed, {
    window, document: {getElementById: id => id === 'header-notifications' && !missingHost ? host : null},
    loadRuntime: () => load('runtime', runtime), loadComponent: () => load('inbox', {NotificationInbox}),
    console: {warn: message => warnings.push(message)}
  }, {filename: 'header-notifications.js'});
  const fire = (type, detail) => {for (const fn of listeners.get(type) || []) fn({type, detail});};
  const connect = (address, chainId = 84532) => {
    window.artsoulWalletStateSettled = true;
    window.artsoulSettledWalletState = {address, chainId, isConnected: Boolean(address)};
    fire('artsoul:wallet-state-changed', window.artsoulSettledWalletState);
  };
  run();
  return {host, window, imports, roots, listeners, warnings, connect, fire, run, get clicks() {return clicks;},
    clickPreview() {host.dataset.notificationRequested = host.dataset.notificationWallet; host.onClick({target: {closest: () => true}});},
    recoverImports() {load = (name, value) => {imports.push(name); return Promise.resolve(value);};}};
}

test('all eight product headers own one hidden non-private bell shell and one deferred entry', () => {
  for (const page of pages) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    assert.equal((html.match(/id="header-notifications"/g) || []).length, 1, page);
    const shell = html.slice(html.indexOf('<div id="header-notifications"'), html.indexOf('<div id="navButtons"'));
    assert.match(shell, /^<div id="header-notifications" hidden>/, page);
    assert.match(shell, /data-notification-preview/, page);
    assert.doesNotMatch(shell, /notification-badge|id="profile-notifications"|Unread|Report /, page);
    const entry = '<script type="module" src="/src/entries/header-notifications.js"></script>';
    assert.equal(html.split(entry).length - 1, 1, page);
    const actions = html.indexOf('<div class="site-header-actions">');
    assert.ok(actions >= 0 && html.indexOf('id="header-notifications"') > actions, page);
  }
});

test('guests, unresolved wallet restoration and malformed addresses never import or display notifications', async () => {
  for (const options of [{}, {settled: true, initial: {isConnected: false, address: A}},
    {initial: {isConnected: true, address: A}}, {settled: true, initial: {isConnected: true, address: 'not-a-wallet'}}]) {
    const h = harness(options); await flush();
    assert.equal(h.host.hidden, true); assert.equal(h.host.current, null);
    assert.equal(h.imports.length, 0); assert.equal(h.roots.length, 0);
  }
  const missing = harness({missingHost: true});
  assert.equal(missing.listeners.size, 0); assert.equal(missing.imports.length, 0);
});

test('an already settled wallet mounts the shared inbox without waiting for another wallet event', async () => {
  const h = harness({settled: true, initial: {isConnected: true, address: A.toUpperCase().replace('0X', '0x')}});
  await flush();
  assert.deepEqual(h.imports, ['runtime', 'inbox']);
  assert.equal(h.host.hidden, false); assert.equal(h.roots.length, 1);
  assert.equal(h.host.current.props.wallet, A); assert.equal(h.host.current.props.header, true);
});

test('repeated connection and chain updates do not reload or remount the same wallet', async () => {
  const h = harness(); h.connect(A); await flush();
  const original = h.host.current;
  h.connect(A, 1); h.connect(A.toUpperCase().replace('0X', '0x'), 84532);
  h.fire('artsoul:wallet-runtime-ready'); h.fire('online'); h.fire('pageshow'); await flush();
  assert.equal(h.roots.length, 1); assert.equal(h.roots[0].renders.length, 1);
  assert.equal(h.host.current, original); assert.equal(h.imports.length, 2);
});

test('account switch and disconnect synchronously remove the previous wallet content', async () => {
  const h = harness(); h.connect(A); await flush();
  h.connect(B);
  assert.equal(h.host.hidden, false); assert.equal(h.host.current, null); assert.equal(h.roots[0].disposed, true);
  await flush();
  assert.equal(h.roots.length, 2); assert.equal(h.host.current.props.wallet, B);
  h.connect(null);
  assert.equal(h.host.hidden, true); assert.equal(h.host.current, null); assert.equal(h.roots[1].disposed, true);
  await flush(); assert.equal(h.roots.length, 2); assert.equal(h.imports.length, 2);
});

test('a late import cannot restore a disconnected or superseded wallet', async () => {
  for (const finalWallet of [null, B, A]) {
    const pending = deferred(), h = harness({pending});
    h.connect(A); h.connect(B); h.connect(finalWallet);
    assert.equal(h.host.hidden, !finalWallet); pending.resolve(); await flush();
    assert.equal(h.roots.length, finalWallet ? 1 : 0);
    assert.equal(h.host.current?.props.wallet || null, finalWallet);
    assert.equal(h.host.hidden, !finalWallet); assert.equal(h.imports.length, 2);
  }
});

test('returning to unresolved state removes a mounted inbox until connection is settled again', async () => {
  const h = harness(); h.connect(A); await flush();
  h.window.artsoulWalletStateSettled = false; h.fire('artsoul:wallet-state-changed');
  assert.equal(h.host.hidden, true); assert.equal(h.host.current, null);
  await flush(); assert.equal(h.roots.length, 1);
  h.connect(B); await flush(); assert.equal(h.host.current.props.wallet, B);
});

test('pagehide disposes private content and BFCache pageshow uses the latest confirmed wallet', async () => {
  const h = harness(); h.connect(A); await flush();
  h.fire('pagehide');
  assert.equal(h.host.hidden, true); assert.equal(h.host.current, null); assert.equal(h.roots[0].disposed, true);
  h.connect(B); h.fire('online'); await flush(); assert.equal(h.roots.length, 1);
  h.fire('pageshow'); await flush();
  assert.equal(h.roots.length, 2); assert.equal(h.host.current.props.wallet, B);
  h.fire('pagehide'); h.connect(null); h.fire('pageshow'); await flush();
  assert.equal(h.host.hidden, true); assert.equal(h.roots.length, 2);
});

test('pagehide also fences pending imports and a later pageshow restores exactly once', async () => {
  const pending = deferred(), h = harness({pending});
  h.connect(A); h.fire('pagehide'); pending.resolve(); await flush();
  assert.equal(h.host.hidden, true); assert.equal(h.roots.length, 0);
  h.fire('pageshow'); h.fire('pageshow'); await flush();
  assert.equal(h.roots.length, 1); assert.equal(h.host.current.props.wallet, A);
});

test('failed imports retain the non-private bell and retry on online without stale-wallet rendering', async () => {
  const pending = deferred(), h = harness({pending});
  h.connect(A); pending.reject(Error('Fixture transport failure')); await flush();
  assert.equal(h.host.hidden, false); assert.equal(h.host.current, null); assert.equal(h.roots.length, 0); assert.equal(h.warnings.length, 1);
  h.recoverImports(); h.fire('online'); await flush();
  assert.equal(h.host.hidden, false); assert.equal(h.roots.length, 1); assert.equal(h.imports.length, 4);
});

test('repeated entry execution never installs a second controller or React root', async () => {
  const h = harness(); h.run(); h.connect(A); h.run(); await flush();
  assert.equal(h.roots.length, 1); assert.equal(h.imports.length, 2);
  for (const callbacks of h.listeners.values()) assert.equal(callbacks.size, 1);
});

test('a prior connected hint paints only the bell and warms code without mounting any private model', async () => {
  const pending = deferred(), h = harness({hint: A, pending});
  assert.equal(h.host.hidden, false); assert.equal(h.host.current, null); assert.equal(h.roots.length, 0);
  assert.deepEqual(h.imports, ['runtime', 'inbox']);
  pending.resolve(); await flush();
  assert.equal(h.roots.length, 0);
  h.connect(A); await flush(); assert.equal(h.host.current.props.wallet, A); assert.equal(h.imports.length, 2);
});

test('a bell click while restoring opens once only after the same wallet is confirmed', async () => {
  const pending = deferred(), h = harness({hint: A, pending});
  h.clickPreview(); h.clickPreview(); assert.equal(h.clicks, 0); assert.equal(h.roots.length, 0);
  h.connect(A); pending.resolve(); await flush();
  assert.equal(h.clicks, 1); assert.equal(h.host.dataset.notificationRequested, undefined);
  h.connect(A); await flush(); assert.equal(h.clicks, 1);
});

test('queued bell clicks never cross a different confirmed wallet or a final guest result', async () => {
  for (const finalWallet of [B, null]) {
    const pending = deferred(), h = harness({hint: A, pending});
    h.clickPreview(); h.connect(finalWallet); pending.resolve(); await flush();
    assert.equal(h.clicks, 0); assert.equal(h.host.current?.props.wallet || null, finalWallet);
    assert.equal(h.host.hidden, !finalWallet);
  }
});
