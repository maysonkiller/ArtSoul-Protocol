const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'src/entries/header-notifications.js'), 'utf8');
const pages = ['index.html', 'gallery.html', 'artwork.html', 'profile.html', 'upload.html', 'admin.html', 'collection-builder.html', 'docs-protocol.html'];
const homepage = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const shell = homepage.slice(homepage.indexOf('<div id="header-notifications"'), homepage.indexOf('<div id="navButtons"'));
const previewHandler = shell.match(/<button\b[^>]*data-notification-preview[^>]*onclick="([^"]*)"/)[1];
const A = '0x' + 'a'.repeat(40), B = '0x' + 'b'.repeat(40);
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}

function harness({initial, settled = false, missingHost = false, pending = null, hint = ''} = {}) {
  const listeners = new Map(), hostListeners = new Map(), imports = [], roots = [], warnings = [], forbiddenCalls = [];
  let clicks = 0, focusCalls = 0, connectCalls = 0, shellWrites = 0, markup = shell, nodes;
  const effects = [];
  const host = {dataset: {notificationWallet: hint}, hidden: false, current: null,
    get innerHTML() {return markup;},
    set innerHTML(value) {markup = value; nodes = value === shell ? makeShell() : null; if (nodes) shellWrites++;},
    addEventListener(type, fn, capture) {
      if (!hostListeners.has(type)) hostListeners.set(type, []);
      hostListeners.get(type).push({fn, capture});
    },
    contains(node) {return Boolean(node && (Object.values(nodes || {}).includes(node) || (host.current && node === privateToggle)));},
    querySelector(selector) {
      if (selector === '.notification-toggle') return nodes?.preview || (host.current ? privateToggle : null);
      return ({'#notification-preview-panel': nodes?.panel, '[data-notification-message]': nodes?.message,
        '[data-notification-connect]': nodes?.action})[selector] || null;
    }
  };
  const document = {activeElement: null, getElementById(id) {
    if (id === 'header-notifications') return missingHost ? null : host;
    if (id === 'notification-preview-panel') return nodes?.panel || null;
    return null;
  }};
  const dispatchHost = (type, event) => Promise.all((hostListeners.get(type) || []).map(({fn}) => fn({type, ...event})));
  function makeShell() {
    const preview = {closest: selector => selector === '#header-notifications' ? host : selector === '[data-notification-preview]' ? preview : null};
    const action = {hidden: false, disabled: false, textContent: 'Connect wallet',
      closest: selector => selector === '[data-notification-connect]' ? action : null};
    const message = {textContent: ''};
    const panel = {open: false, matches: selector => selector === ':popover-open' && panel.open,
      showPopover() {if (!this.open) {void dispatchHost('beforetoggle', {target: this, oldState: 'closed', newState: 'open'}); this.open = true;}},
      hidePopover() {if (this.open) {void dispatchHost('beforetoggle', {target: this, oldState: 'open', newState: 'closed'}); this.open = false;}}
    };
    return {preview, action, message, panel};
  }
  const privateToggle = {click() {clicks++;}, focus() {document.activeElement = this; focusCalls++;}};
  nodes = makeShell();
  const forbid = name => () => {forbiddenCalls.push(name); throw Error('Unexpected ' + name);};
  const window = {
    artsoulWalletStateSettled: settled, artsoulSettledWalletState: initial,
    ArtSoulHeaderPrepaint: {boot: {notificationWallet: hint}},
    // Cached identity is explicitly insufficient to show a private control.
    currentWalletAddress: A, getCurrentWalletAddress: () => A,
    localStorage: {getItem() {throw Error('A header must not trust storage hints.');}},
    fetch: forbid('fetch'), ensureAuthenticated: forbid('authentication'),
    safeConnectWallet: async () => {connectCalls++;},
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
    window, document, fetch: forbid('fetch'),
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
  return {host, window, document, imports, roots, listeners, hostListeners, warnings, forbiddenCalls, connect, fire, run,
    get clicks() {return clicks;}, get focusCalls() {return focusCalls;}, get connectCalls() {return connectCalls;},
    get shellWrites() {return shellWrites;}, get panel() {return nodes?.panel;},
    get action() {return nodes?.action;}, get message() {return nodes?.message;},
    clickPreview() {
      const {preview, panel} = nodes;
      document.activeElement = preview;
      vm.runInNewContext('(function () {' + previewHandler + '}).call(preview)', {preview, document});
      void dispatchHost('click', {target: preview});
      if (panel.open) panel.hidePopover(); else panel.showPopover();
    },
    clickConnect() {document.activeElement = nodes.action; return dispatchHost('click', {target: nodes.action});},
    closePreview() {nodes?.panel.hidePopover();},
    setConnect(fn) {window.safeConnectWallet = () => {connectCalls++; return fn();};},
    recoverImports() {load = (name, value) => {imports.push(name); return Promise.resolve(value);};}};
}

test('all eight product headers own a visible native non-private popover shell and one deferred entry', () => {
  for (const page of pages) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    assert.equal((html.match(/id="header-notifications"/g) || []).length, 1, page);
    const shell = html.slice(html.indexOf('<div id="header-notifications"'), html.indexOf('<div id="navButtons"'));
    assert.match(shell, /^<div id="header-notifications">/, page);
    assert.match(shell, /<button[^>]*type="button"[^>]*data-notification-preview[^>]*data-allow-rapid[^>]*aria-label="Notifications"[^>]*aria-controls="notification-preview-panel"[^>]*popovertarget="notification-preview-panel"/, page);
    assert.match(shell, /id="notification-preview-panel"[^>]*popover="auto"[^>]*role="region"[^>]*aria-labelledby="notification-preview-title"/, page);
    assert.match(shell, /<h2 id="notification-preview-title">Notifications<\/h2>/, page);
    assert.match(shell, /<button[^>]*popovertarget="notification-preview-panel"[^>]*popovertargetaction="hide"[^>]*aria-label="Close notifications"/, page);
    assert.match(shell, /data-notification-message>Connect your wallet/, page);
    assert.match(shell, /<button[^>]*type="button"[^>]*data-notification-connect[^>]*>Connect wallet<\/button>/, page);
    assert.doesNotMatch(shell, /aria-expanded|aria-busy|safeConnectWallet|ensureAuthenticated|fetch\(/, page);
    assert.doesNotMatch(shell, /notification-badge|id="profile-notifications"|Unread|Report /, page);
    const entry = '<script type="module" src="/src/entries/header-notifications.js"></script>';
    assert.equal(html.split(entry).length - 1, 1, page);
    const actions = html.indexOf('<div class="site-header-actions">');
    assert.ok(actions >= 0 && html.indexOf('id="header-notifications"') > actions, page);
  }
});

test('guests, unresolved restoration and malformed addresses keep the generic bell without private imports or wallet calls', async () => {
  for (const options of [{}, {settled: true, initial: {isConnected: false, address: A}},
    {initial: {isConnected: true, address: A}}, {settled: true, initial: {isConnected: true, address: 'not-a-wallet'}}]) {
    const h = harness(options); await flush();
    assert.equal(h.host.hidden, false); assert.equal(h.host.current, null);
    assert.equal(h.action.hidden, false); assert.equal(h.action.disabled, false);
    h.clickPreview(); assert.equal(h.panel.open, true);
    assert.equal(h.host.dataset.notificationRequested, undefined);
    assert.match(h.message.textContent, /^Connect your wallet/);
    h.closePreview(); assert.equal(h.panel.open, false);
    assert.equal(h.imports.length, 0); assert.equal(h.roots.length, 0);
    assert.equal(h.connectCalls, 0); assert.deepEqual(h.forbiddenCalls, []);
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
  assert.equal(h.host.hidden, false); assert.equal(h.host.current, null); assert.equal(h.roots[1].disposed, true);
  assert.match(h.message.textContent, /^Connect your wallet/);
  await flush(); assert.equal(h.roots.length, 2); assert.equal(h.imports.length, 2);
});

test('a late import cannot restore a disconnected or superseded wallet', async () => {
  for (const finalWallet of [null, B, A]) {
    const pending = deferred(), h = harness({pending});
    h.connect(A); h.connect(B); h.connect(finalWallet);
    assert.equal(h.host.hidden, false); pending.resolve(); await flush();
    assert.equal(h.roots.length, finalWallet ? 1 : 0);
    assert.equal(h.host.current?.props.wallet || null, finalWallet);
    assert.equal(h.host.hidden, false); assert.equal(h.imports.length, 2);
  }
});

test('returning to unresolved state removes a mounted inbox until connection is settled again', async () => {
  const h = harness(); h.connect(A); await flush();
  h.window.artsoulWalletStateSettled = false; h.fire('artsoul:wallet-state-changed');
  assert.equal(h.host.hidden, false); assert.equal(h.host.current, null);
  await flush(); assert.equal(h.roots.length, 1);
  h.connect(B); await flush(); assert.equal(h.host.current.props.wallet, B);
});

test('pagehide preserves only the generic bell and BFCache pageshow uses the latest confirmed wallet', async () => {
  const h = harness(); h.connect(A); await flush();
  h.host.innerHTML = '<span class="notification-badge">3</span><div id="profile-notifications">Private update</div>';
  h.fire('pagehide');
  assert.equal(h.host.hidden, false); assert.equal(h.host.current, null); assert.equal(h.roots[0].disposed, true);
  assert.equal(h.host.innerHTML, shell);
  assert.equal(h.host.dataset.notificationWallet, '');
  h.connect(B); h.fire('online'); await flush(); assert.equal(h.roots.length, 1);
  assert.equal(h.host.hidden, false); assert.equal(h.host.current, null);
  h.fire('pageshow'); await flush();
  assert.equal(h.roots.length, 2); assert.equal(h.host.current.props.wallet, B);
  h.fire('pagehide'); h.connect(null);
  assert.equal(h.host.hidden, false); assert.equal(h.host.current, null);
  h.fire('pageshow'); await flush();
  assert.equal(h.host.hidden, false); assert.equal(h.roots.length, 2);
});

test('pagehide also fences pending imports and a later pageshow restores exactly once', async () => {
  const pending = deferred(), h = harness({pending});
  h.connect(A); h.clickPreview(); h.fire('pagehide'); pending.resolve(); await flush();
  assert.equal(h.host.hidden, false); assert.equal(h.roots.length, 0);
  assert.equal(h.host.innerHTML, shell);
  assert.equal(h.host.dataset.notificationWallet, '');
  assert.equal(h.host.dataset.notificationRequested, undefined);
  h.fire('pageshow'); h.fire('pageshow'); await flush();
  assert.equal(h.roots.length, 1); assert.equal(h.host.current.props.wallet, A);
  assert.equal(h.clicks, 0);
});

test('pagehide retains a generic guest bell and strips a restoring preview wallet binding', async () => {
  const guest = harness(); guest.fire('pagehide'); await flush();
  assert.equal(guest.host.hidden, false); assert.equal(guest.roots.length, 0);
  assert.equal(guest.imports.length, 0);
  guest.fire('pageshow'); await flush();
  assert.equal(guest.host.hidden, false); assert.equal(guest.imports.length, 0);

  const pending = deferred(), restoring = harness({hint: A, pending});
  restoring.clickPreview(); restoring.fire('pagehide');
  assert.equal(restoring.host.hidden, false);
  assert.equal(restoring.host.dataset.notificationWallet, '');
  assert.equal(restoring.host.dataset.notificationRequested, undefined);
  pending.resolve(); await flush();
  assert.equal(restoring.roots.length, 0);
  restoring.connect(null); restoring.fire('pageshow'); await flush();
  assert.equal(restoring.host.hidden, false); assert.equal(restoring.roots.length, 0);
  assert.equal(restoring.clicks, 0);
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
  for (const callbacks of h.hostListeners.values()) assert.equal(callbacks.length, 1);
});

test('a prior connected hint paints only the bell and warms code without mounting any private model', async () => {
  const pending = deferred(), h = harness({hint: A, pending});
  assert.equal(h.host.hidden, false); assert.equal(h.host.current, null); assert.equal(h.roots.length, 0);
  assert.deepEqual(h.imports, ['runtime', 'inbox']);
  pending.resolve(); await flush();
  assert.equal(h.roots.length, 0);
  h.connect(A); await flush(); assert.equal(h.host.current.props.wallet, A); assert.equal(h.imports.length, 2);
});

test('an open restoring preview hands off once and restores focus only after the same wallet is confirmed', async () => {
  const pending = deferred(), h = harness({hint: A, pending});
  h.clickPreview(); assert.equal(h.clicks, 0); assert.equal(h.roots.length, 0);
  assert.equal(h.panel.open, true); assert.equal(h.host.dataset.notificationRequested, A);
  h.connect(A); pending.resolve(); await flush();
  assert.equal(h.clicks, 1); assert.equal(h.host.dataset.notificationRequested, undefined);
  assert.equal(h.focusCalls, 1);
  h.connect(A); await flush(); assert.equal(h.clicks, 1);
});

test('queued bell clicks never cross a different confirmed wallet or a final guest result', async () => {
  for (const finalWallet of [B, null]) {
    const pending = deferred(), h = harness({hint: A, pending});
    h.clickPreview(); h.connect(finalWallet); pending.resolve(); await flush();
    assert.equal(h.clicks, 0); assert.equal(h.host.current?.props.wallet || null, finalWallet);
    assert.equal(h.host.hidden, false);
  }
});

test('unrelated sync events preserve the open guest shell and its focused Connect action', async () => {
  const h = harness(); h.clickPreview();
  const panel = h.panel, action = h.action;
  h.document.activeElement = action;
  h.fire('online'); h.fire('artsoul:wallet-runtime-ready'); h.fire('artsoul:wallet-state-changed');
  await flush();
  assert.equal(h.panel, panel); assert.equal(h.action, action); assert.equal(panel.open, true);
  assert.equal(h.document.activeElement, action); assert.equal(h.shellWrites, 0);
  assert.equal(h.connectCalls, 0); assert.equal(h.imports.length, 0);
});

test('closing or toggling a restoring preview cancels its pending inbox handoff', async () => {
  for (const dismiss of [h => h.closePreview(), h => h.clickPreview()]) {
    const pending = deferred(), h = harness({hint: A, pending});
    h.clickPreview(); assert.equal(h.host.dataset.notificationRequested, A);
    dismiss(h);
    assert.equal(h.panel.open, false); assert.equal(h.host.dataset.notificationRequested, undefined);
    assert.equal(h.hostListeners.get('beforetoggle')[0].capture, true, 'native beforetoggle does not bubble');
    h.connect(A); pending.resolve(); await flush();
    assert.equal(h.host.current.props.wallet, A); assert.equal(h.clicks, 0);
  }
});

test('reopening a dismissed restoring preview creates one fresh same-wallet handoff', async () => {
  const pending = deferred(), h = harness({hint: A, pending});
  h.clickPreview(); h.closePreview(); h.clickPreview();
  h.connect(A); pending.resolve(); await flush();
  assert.equal(h.clicks, 1); assert.equal(h.host.dataset.notificationRequested, undefined);
  h.connect(A); h.fire('online'); await flush(); assert.equal(h.clicks, 1);
});

test('an asynchronous inbox mount does not take focus from another page control', async () => {
  const pending = deferred(), h = harness({hint: A, pending});
  h.clickPreview();
  const outside = {}; h.document.activeElement = outside;
  h.connect(A); pending.resolve(); await flush();
  assert.equal(h.document.activeElement, outside); assert.equal(h.focusCalls, 0);
  assert.equal(h.host.current.props.wallet, A);
});

test('a failed inbox import exposes an explicit retry without connecting or authenticating again', async () => {
  const pending = deferred(), h = harness({pending});
  h.connect(A); pending.reject(Error('Fixture transport failure')); await flush();
  assert.equal(h.action.hidden, false); assert.equal(h.action.textContent, 'Try again');
  assert.match(h.message.textContent, /could not load/);
  h.recoverImports(); await h.clickConnect(); await flush();
  assert.equal(h.host.current.props.wallet, A); assert.equal(h.imports.length, 4);
  assert.equal(h.connectCalls, 0); assert.deepEqual(h.forbiddenCalls, []);
});

test('disconnect and pagehide clear failed-wallet messaging from the generic guest shell', async () => {
  for (const reset of [h => h.connect(null), h => h.fire('pagehide')]) {
    const pending = deferred(), h = harness({pending});
    h.connect(A); pending.reject(Error('Fixture transport failure')); await flush();
    assert.equal(h.action.textContent, 'Try again');
    reset(h);
    assert.match(h.message.textContent, /^Connect your wallet/);
    assert.equal(h.action.textContent, 'Connect wallet'); assert.equal(h.action.hidden, false);
    assert.equal(h.host.current, null); assert.equal(h.host.dataset.notificationWallet, '');
  }
});

test('the explicit guest Connect action waits for the existing wallet runtime without private imports', async () => {
  const h = harness(); delete h.window.safeConnectWallet;
  h.clickPreview(); await h.clickConnect();
  assert.match(h.message.textContent, /still loading/); assert.equal(h.action.disabled, false);
  assert.equal(h.imports.length, 0); assert.equal(h.connectCalls, 0);
  assert.equal(h.panel.open, true);
  h.setConnect(async () => {}); await h.clickConnect();
  assert.equal(h.connectCalls, 1); assert.equal(h.panel.open, false);
  assert.equal(h.roots.length, 0); assert.equal(h.imports.length, 0); assert.deepEqual(h.forbiddenCalls, []);
});

test('pending Connect is single-flight even if an unrelated button guard removes disabled', async () => {
  const pending = deferred(), h = harness(); h.setConnect(() => pending.promise);
  h.clickPreview(); const first = h.clickConnect();
  assert.equal(h.connectCalls, 1); assert.equal(h.action.disabled, true); assert.equal(h.panel.open, false);
  h.action.disabled = false; await h.clickConnect();
  assert.equal(h.connectCalls, 1); assert.equal(h.imports.length, 0);
  pending.resolve(); await first;
  assert.equal(h.action.disabled, false); assert.equal(h.roots.length, 0);
  assert.deepEqual(h.forbiddenCalls, []);
});

test('a rejected wallet request leaves a retryable generic shell without importing private code', async () => {
  const pending = deferred(), h = harness(); h.setConnect(() => pending.promise);
  h.clickPreview(); const attempt = h.clickConnect(); pending.reject(Error('User cancelled')); await attempt;
  assert.equal(h.action.disabled, false); assert.equal(h.panel.open, false);
  assert.match(h.message.textContent, /not completed/);
  assert.equal(h.imports.length, 0); assert.equal(h.roots.length, 0);
  h.setConnect(async () => {}); h.clickPreview(); await h.clickConnect();
  assert.equal(h.connectCalls, 2); assert.equal(h.action.disabled, false);
});

test('a fulfilled Connect return value never substitutes for confirmed wallet state', async () => {
  const h = harness(); h.setConnect(async () => ({address: A, isConnected: true}));
  h.clickPreview(); await h.clickConnect(); await flush();
  assert.equal(h.connectCalls, 1); assert.equal(h.imports.length, 0); assert.equal(h.roots.length, 0);
  assert.equal(h.host.dataset.notificationWallet, ''); assert.equal(h.host.current, null);
  assert.deepEqual(h.forbiddenCalls, []);
});

test('a guest Connect request never queues a private inbox open and late rejection cannot alter the confirmed account', async () => {
  const pending = deferred(), h = harness(); h.setConnect(() => pending.promise);
  h.clickPreview(); const attempt = h.clickConnect();
  assert.equal(h.host.dataset.notificationRequested, undefined);
  h.connect(A); await flush(); h.connect(B); await flush();
  const current = h.host.current, priorFocusCalls = h.focusCalls;
  pending.reject(Error('Late provider cancellation')); await attempt;
  assert.equal(h.host.current, current); assert.equal(h.host.current.props.wallet, B);
  assert.equal(h.clicks, 0); assert.equal(h.focusCalls, priorFocusCalls);
  assert.equal(h.connectCalls, 1); assert.deepEqual(h.forbiddenCalls, []);
});

test('late Connect completion cannot undo disconnect or pagehide and pageshow uses only settled state', async () => {
  for (const reject of [false, true]) {
    const pending = deferred(), h = harness(); h.setConnect(() => pending.promise);
    h.clickPreview(); const attempt = h.clickConnect();
    h.connect(A); await flush(); h.fire('pagehide'); h.connect(null);
    const guestAction = h.action;
    if (reject) pending.reject(Error('Late cancellation')); else pending.resolve({address: A});
    await attempt; await flush();
    assert.equal(h.host.current, null); assert.equal(h.action, guestAction); assert.equal(h.action.disabled, false);
    assert.equal(h.host.dataset.notificationWallet, ''); assert.equal(h.panel.open, false);
    assert.equal(h.clicks, 0); assert.equal(h.roots.length, 1);
    h.fire('pageshow'); await flush();
    assert.equal(h.roots.length, 1); assert.equal(h.host.current, null); assert.equal(h.host.hidden, false);
  }
});
