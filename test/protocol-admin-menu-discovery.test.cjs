// Lazy Protocol Admin menu discovery (A8c audit fix P2-6).
//
// Executes the real avatar-dropdown.js inside a minimal DOM harness and
// proves the discovery contract: a connected header render performs no
// /api/moderation/access request; the first dropdown opening performs exactly
// one; repeated openings reuse it; a wallet change invalidates the cached
// result; and the admin link is rendered only after a successful server
// response. Authorization itself stays server-side and is covered by
// protocol-admin-review.test.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'avatar-dropdown.js'), 'utf8');
const WALLET_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const WALLET_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function matches(element, selector) {
  if (selector.startsWith('#')) return element.id === selector.slice(1);
  if (selector.startsWith('.')) {
    return String(element.className || '').split(/\s+/).includes(selector.slice(1));
  }
  if (selector.startsWith('[') && selector.endsWith(']')) {
    return Object.prototype.hasOwnProperty.call(element.attributes, selector.slice(1, -1));
  }
  return false;
}

function collect(element, selector, results) {
  for (const child of element.children) {
    if (matches(child, selector)) results.push(child);
    collect(child, selector, results);
  }
}

class FakeClassList {
  constructor() { this.names = new Set(); }
  add(...names) { for (const name of names) this.names.add(name); }
  remove(...names) { for (const name of names) this.names.delete(name); }
  contains(name) { return this.names.has(name); }
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    this.classList = new FakeClassList();
    this.textContent = '';
    this.hidden = false;
    this.id = '';
    this.className = '';
    this.parentNode = null;
    this._innerHTML = '';
    this._slotStub = null;
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.children = [];
    this._slotStub = null;
  }

  get innerHTML() { return this._innerHTML; }

  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  prepend(child) { child.parentNode = this; this.children.unshift(child); return child; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }
  addEventListener() {}
  removeEventListener() {}
  contains() { return false; }

  querySelector(selector) {
    const results = [];
    collect(this, selector, results);
    if (results.length > 0) return results[0];
    // Menu content is committed as an innerHTML string. Surface the reserved
    // Protocol Admin slot from that string as a stable stub element so the
    // targeted slot update path can be observed by the tests.
    if (selector === '[data-protocol-admin-slot]') {
      for (const child of this.children) {
        const nested = child.querySelector(selector);
        if (nested) return nested;
      }
      if (this._innerHTML.includes('data-protocol-admin-slot')) {
        if (!this._slotStub) {
          this._slotStub = new FakeElement('div');
          this._slotStub.attributes['data-protocol-admin-slot'] = '';
          const start = this._innerHTML.indexOf('data-protocol-admin-slot');
          const inner = this._innerHTML.slice(this._innerHTML.indexOf('>', start) + 1);
          this._slotStub._innerHTML = inner.slice(0, inner.indexOf('</div>'));
        }
        return this._slotStub;
      }
    }
    return null;
  }

  querySelectorAll(selector) {
    const results = [];
    collect(this, selector, results);
    return results;
  }
}

function createHarness() {
  const accessCalls = [];
  let accessResponse = () => ({
    ok: true,
    json: async () => ({
      success: true,
      enabled: true,
      authenticated: true,
      eligible: true,
      access: { role: 'moderator', stepUpActive: false, passkeyRequired: true }
    })
  });

  const documentElement = new FakeElement('html');
  const body = new FakeElement('body');
  const navButtons = new FakeElement('div');
  navButtons.id = 'navButtons';
  body.appendChild(navButtons);

  const storage = new Map();
  const localStorage = {
    getItem: key => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key)
  };

  const document = {
    readyState: 'loading',
    documentElement,
    body,
    head: new FakeElement('head'),
    addEventListener() {},
    removeEventListener() {},
    createElement: tag => new FakeElement(tag),
    getElementById(id) {
      return matches(body, `#${id}`) ? body : body.querySelector(`#${id}`);
    },
    querySelector: selector => body.querySelector(selector),
    querySelectorAll: selector => body.querySelectorAll(selector)
  };

  const context = {
    console: { log() {}, warn() {}, error() {} },
    URLSearchParams,
    setTimeout: () => 0,
    clearTimeout() {},
    localStorage,
    navigator: { userAgent: 'node-test' },
    MutationObserver: class { observe() {} disconnect() {} },
    document,
    fetch: (url, options) => {
      if (String(url).includes('/api/moderation/access')) {
        accessCalls.push({ url: String(url), options });
        return Promise.resolve(accessResponse());
      }
      return Promise.resolve({ ok: false, json: async () => ({}), text: async () => '' });
    }
  };
  context.window = context;
  context.window.location = { pathname: '/index.html', search: '', hash: '' };
  context.window.addEventListener = () => {};
  context.window.artsoulWalletStateSettled = true;

  vm.runInNewContext(SOURCE, context, { filename: 'avatar-dropdown.js' });

  return {
    context,
    accessCalls,
    setAccessResponse(factory) { accessResponse = factory; },
    dropdown: context.window.AvatarDropdown,
    async flush() { await new Promise(resolve => setImmediate(resolve)); }
  };
}

test('connected header render performs no Protocol Admin access request', async () => {
  const harness = createHarness();
  harness.context.window.currentWalletAddress = WALLET_A;
  await harness.dropdown.renderWalletInfo(WALLET_A);
  await harness.flush();
  assert.equal(harness.accessCalls.length, 0);
  // The reserved slot keeps header geometry stable while staying empty.
  const menu = harness.context.document.getElementById('avatarDropdownMenu');
  assert.match(menu.innerHTML, /data-protocol-admin-slot/);
  assert.doesNotMatch(menu.innerHTML, /admin\.html/);
});

test('first dropdown opening performs exactly one access request; reopening reuses it', async () => {
  const harness = createHarness();
  harness.context.window.currentWalletAddress = WALLET_A;
  await harness.dropdown.renderWalletInfo(WALLET_A);
  await harness.flush();

  assert.equal(harness.dropdown.toggle(), true);
  await harness.flush();
  assert.equal(harness.accessCalls.length, 1);

  assert.equal(harness.dropdown.toggle(), false);
  assert.equal(harness.dropdown.toggle(), true);
  assert.equal(harness.dropdown.toggle(), false);
  assert.equal(harness.dropdown.toggle(), true);
  await harness.flush();
  assert.equal(harness.accessCalls.length, 1);
});

test('the admin link appears only after a successful eligible server response', async () => {
  const harness = createHarness();
  harness.context.window.currentWalletAddress = WALLET_A;
  await harness.dropdown.renderWalletInfo(WALLET_A);

  harness.setAccessResponse(() => ({
    ok: true,
    json: async () => ({ success: true, enabled: true, authenticated: true, eligible: false, access: null })
  }));
  harness.dropdown.toggle();
  await harness.flush();
  assert.equal(harness.dropdown.protocolAdminEligible, false);
  assert.doesNotMatch(harness.dropdown.renderProtocolAdminSlot('/index.html'), /admin\.html/);

  // A later wallet (fresh discovery) that the server confirms is eligible.
  harness.dropdown.toggle();
  harness.context.window.currentWalletAddress = WALLET_B;
  harness.dropdown.syncProtocolAdminWallet(WALLET_B);
  harness.setAccessResponse(() => ({
    ok: true,
    json: async () => ({
      success: true,
      enabled: true,
      authenticated: true,
      eligible: true,
      access: { role: 'moderator', stepUpActive: false, passkeyRequired: true }
    })
  }));
  harness.dropdown.toggle();
  await harness.flush();
  assert.equal(harness.dropdown.protocolAdminEligible, true);
  assert.match(harness.dropdown.renderProtocolAdminSlot('/index.html'), /href="admin\.html"/);
  // The slot never renders the link on the admin page itself.
  assert.doesNotMatch(harness.dropdown.renderProtocolAdminSlot('/admin.html'), /href="admin\.html"/);
});

test('a wallet change invalidates the cached discovery result', async () => {
  const harness = createHarness();
  harness.context.window.currentWalletAddress = WALLET_A;
  await harness.dropdown.renderWalletInfo(WALLET_A);
  harness.dropdown.toggle();
  await harness.flush();
  assert.equal(harness.accessCalls.length, 1);
  assert.equal(harness.dropdown.protocolAdminWallet, WALLET_A);
  assert.equal(harness.dropdown.protocolAdminEligible, true);
  harness.dropdown.toggle();

  // The next connected render for a different wallet clears the cached
  // result without issuing a request of its own.
  harness.context.window.currentWalletAddress = WALLET_B;
  await harness.dropdown.renderWalletInfo(WALLET_B);
  await harness.flush();
  assert.equal(harness.accessCalls.length, 1);
  assert.equal(harness.dropdown.protocolAdminWallet, null);
  assert.equal(harness.dropdown.protocolAdminEligible, false);

  // Opening the menu for the new wallet performs one fresh request.
  harness.dropdown.toggle();
  await harness.flush();
  assert.equal(harness.accessCalls.length, 2);
  assert.equal(harness.dropdown.protocolAdminWallet, WALLET_B);

  // A disconnect clears the cached result entirely.
  harness.context.window.currentWalletAddress = null;
  harness.dropdown.renderConnectButton();
  assert.equal(harness.dropdown.protocolAdminWallet, null);
  assert.equal(harness.dropdown.protocolAdminEligible, false);
});

test('guest and disconnected menu openings never request Protocol Admin access', async () => {
  const harness = createHarness();
  harness.dropdown.renderConnectButton();
  harness.dropdown.toggle();
  harness.dropdown.toggle();
  harness.dropdown.toggle();
  await harness.flush();
  assert.equal(harness.accessCalls.length, 0);
});

test('render paths call only the non-fetching wallet sync', () => {
  // Static lock: fetch-based discovery lives only in the lazy open-path
  // method, and every render path uses the bookkeeping sync instead.
  const renderCalls = SOURCE.match(/this\.syncProtocolAdminWallet\(walletAddress\);/g) || [];
  assert.equal(renderCalls.length, 2);
  assert.doesNotMatch(SOURCE, /refreshProtocolAdminAccess/);
  const openCall = SOURCE.match(/if \(this\.isOpen\) void this\.requestProtocolAdminAccessOnce\(\);/g) || [];
  assert.equal(openCall.length, 1);
});
