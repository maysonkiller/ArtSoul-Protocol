// Shared DOM harness for the real avatar-dropdown.js shared header component.
//
// Extracted from protocol-admin-menu-discovery.test.cjs so every shared-header
// suite drives the same component source inside one minimal DOM instead of
// duplicating a second fake DOM. The harness executes the unmodified
// avatar-dropdown.js in a vm context: assertions observe real component
// behaviour, not source text.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE_PATH = path.join(__dirname, '..', '..', 'avatar-dropdown.js');
const SOURCE = fs.readFileSync(SOURCE_PATH, 'utf8');

const BASE_SEPOLIA_RPC_URL = 'https://sepolia.base.org';

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

const VOID_TAGS = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'path', 'circle', 'stop']);
const TOKEN = /<\/?([a-zA-Z][\w:-]*)((?:\s+[\w:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>/g;
const ATTRIBUTE = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g;

// Minimal HTML materializer: the component commits button and menu markup as
// innerHTML strings, so the harness must turn that markup into real elements
// for querySelector to behave like a browser. Only the subset the component
// emits is supported (tags, attributes, text) — no entities or scripts.
function parseFragment(html, parent, harness) {
  const stack = [parent];
  let cursor = 0;
  TOKEN.lastIndex = 0;
  let match;
  while ((match = TOKEN.exec(html)) !== null) {
    const [raw, tagName, attributeText, selfClosing] = match;
    const text = html.slice(cursor, match.index).trim();
    if (text) stack[stack.length - 1].textContent = text;
    cursor = match.index + raw.length;

    if (raw.startsWith('</')) {
      if (stack.length > 1) stack.pop();
      continue;
    }

    const element = new FakeElement(tagName.toLowerCase(), harness);
    ATTRIBUTE.lastIndex = 0;
    let attribute;
    while ((attribute = ATTRIBUTE.exec(attributeText)) !== null) {
      const name = attribute[1];
      const value = attribute[2] ?? attribute[3] ?? '';
      if (name === 'class') element.className = value;
      else if (name === 'id') element.id = value;
      else if (name === 'hidden') element.hidden = true;
      else if (name.startsWith('data-')) {
        const key = name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
        element.dataset[key] = value;
      }
      element.attributes[name] = value;
    }
    stack[stack.length - 1].appendChild(element);
    if (!selfClosing && !VOID_TAGS.has(element.tagName)) stack.push(element);
  }
  const tail = html.slice(cursor).trim();
  if (tail) stack[stack.length - 1].textContent = tail;
}

class FakeClassList {
  constructor() { this.names = new Set(); }
  add(...names) { for (const name of names) this.names.add(name); }
  remove(...names) { for (const name of names) this.names.delete(name); }
  contains(name) { return this.names.has(name); }
}

class FakeElement {
  constructor(tagName = 'div', ownerHarness = null) {
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
    this._listeners = new Map();
    this._harness = ownerHarness;
    // <img> semantics: `complete` mirrors a decoded image and flips only when
    // the harness resolves the requested source.
    this.complete = false;
    this.onerror = null;
    this._src = '';
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.children = [];
    this._slotStub = null;
    parseFragment(this._innerHTML, this, this._harness);
  }

  get innerHTML() { return this._innerHTML; }

  // The component assigns `image.src`; the harness decides whether that source
  // resolves or fails, exactly like a browser image request.
  set src(value) {
    const next = String(value);
    this._src = next;
    this.attributes.src = next;
    if (this.tagName !== 'img' || !this._harness) return;
    this.complete = false;
    this._harness.queueImageLoad(this, next);
  }

  get src() { return this._src; }

  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  prepend(child) { child.parentNode = this; this.children.unshift(child); return child; }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'src') this.src = value;
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }

  addEventListener(type, handler, options = {}) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push({ handler, once: options.once === true });
  }

  removeEventListener(type, handler) {
    const list = this._listeners.get(type) || [];
    this._listeners.set(type, list.filter(entry => entry.handler !== handler));
  }

  dispatchEvent(event) {
    const list = this._listeners.get(event.type) || [];
    this._listeners.set(event.type, list.filter(entry => !entry.once));
    for (const entry of list) entry.handler(event);
    return true;
  }

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
          this._slotStub = new FakeElement('div', this._harness);
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

/**
 * Build a harness around the real component.
 *
 * options.userAgent       - navigator.userAgent (mobile paths key off this)
 * options.pathname        - window.location.pathname
 * options.settled         - initial window.artsoulWalletStateSettled
 * options.profiles        - map of lowercased wallet -> profile row
 * options.failingImages   - Set of image sources that must fail to load
 */
function createAvatarHarness(options = {}) {
  const harness = {};

  const accessCalls = [];
  const profileCalls = [];
  const balanceCalls = [];
  const imageLoads = [];
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

  const profiles = new Map(
    Object.entries(options.profiles || {}).map(([wallet, profile]) => [wallet.toLowerCase(), profile])
  );
  const failingImages = new Set(options.failingImages || []);
  // Pending image resolutions, drained by flush(). Mirrors a browser deferring
  // load/error until after the synchronous render completed.
  const pendingImages = [];
  // Profile reads can be held open to model a slow mobile response.
  let profileGate = null;
  let profileBehaviour = null;

  harness.queueImageLoad = (image, source) => {
    pendingImages.push({ image, source });
  };

  const documentElement = new FakeElement('html', harness);
  const body = new FakeElement('body', harness);
  const navButtons = new FakeElement('div', harness);
  navButtons.id = 'navButtons';
  body.appendChild(navButtons);

  const storage = new Map(Object.entries(options.storage || {}));
  const localStorage = {
    getItem: key => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key)
  };

  const documentListeners = new Map();
  const mutationObservers = [];

  const document = {
    readyState: options.readyState || 'complete',
    documentElement,
    body,
    head: new FakeElement('head', harness),
    addEventListener(type, handler) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(handler);
    },
    removeEventListener() {},
    createElement: tag => new FakeElement(tag, harness),
    getElementById(id) {
      return matches(body, `#${id}`) ? body : body.querySelector(`#${id}`);
    },
    querySelector: selector => body.querySelector(selector),
    querySelectorAll: selector => body.querySelectorAll(selector)
  };

  const windowListeners = new Map();

  const context = {
    console: { log() {}, warn() {}, error() {} },
    URLSearchParams,
    setTimeout: (fn) => { if (typeof fn === 'function') pendingTimeouts.push(fn); return 0; },
    clearTimeout() {},
    localStorage,
    navigator: { userAgent: options.userAgent || 'node-test' },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; mutationObservers.push(this); }
      observe() {}
      disconnect() {}
    },
    document,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    CustomEvent: class {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    fetch: (url, requestOptions) => {
      const target = String(url);
      if (target.includes('/api/moderation/access')) {
        accessCalls.push({ url: target, options: requestOptions });
        return Promise.resolve(accessResponse());
      }
      if (target === BASE_SEPOLIA_RPC_URL) {
        balanceCalls.push({ url: target, options: requestOptions });
        return Promise.resolve({
          ok: true,
          json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x16345785d8a0000' })
        });
      }
      return Promise.resolve({ ok: false, json: async () => ({}), text: async () => '' });
    }
  };

  const pendingTimeouts = [];

  context.window = context;
  context.window.location = {
    pathname: options.pathname || '/index.html',
    search: options.search || '',
    hash: options.hash || ''
  };
  context.window.addEventListener = (type, handler) => {
    if (!windowListeners.has(type)) windowListeners.set(type, []);
    windowListeners.get(type).push(handler);
  };
  context.window.removeEventListener = (type, handler) => {
    const list = windowListeners.get(type) || [];
    windowListeners.set(type, list.filter(entry => entry !== handler));
  };
  context.window.dispatchEvent = (event) => {
    for (const handler of windowListeners.get(event.type) || []) handler(event);
    return true;
  };
  context.window.artsoulWalletStateSettled = options.settled !== false;

  // Faithful mirror of window.ArtSoulProfileDisplay from supabase-client.js.
  // profile-display-contract coverage in the suite pins these semantics to the
  // real source so the harness cannot silently drift from production.
  const GENERATED_PROFILE_USERNAME = /^User[0-9a-fA-F]{4,6}$/;
  const shortWalletAddress = (address) => {
    const walletAddress = (address || '').toString().trim();
    if (!walletAddress) return '';
    if (walletAddress.length <= 12) return walletAddress;
    return `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
  };
  context.window.ArtSoulProfileDisplay = {
    displayName(profile = {}, address = '') {
      const username = (profile?.username || '').toString().trim();
      if (username && !GENERATED_PROFILE_USERNAME.test(username)) return username;
      return shortWalletAddress(profile?.wallet_address || address);
    },
    avatarUrl: (profile = {}, fallbackUrl = '') => profile?.avatar_url || fallbackUrl || '',
    shortWalletAddress
  };

  context.window.ArtSoulDB = {
    getProfile(walletAddress) {
      const wallet = String(walletAddress || '').toLowerCase();
      profileCalls.push(wallet);
      if (typeof profileBehaviour === 'function') {
        const outcome = profileBehaviour(wallet, profileCalls.length);
        if (outcome !== undefined) return Promise.resolve(outcome);
      }
      if (profileGate) {
        return profileGate.then(() => profiles.get(wallet) || null);
      }
      return Promise.resolve(profiles.get(wallet) || null);
    }
  };

  vm.runInNewContext(SOURCE, context, { filename: 'avatar-dropdown.js' });

  Object.assign(harness, {
    context,
    document,
    navButtons,
    documentElement,
    accessCalls,
    profileCalls,
    balanceCalls,
    imageLoads,
    mutationObservers,
    dropdown: context.window.AvatarDropdown,
    storage,

    setAccessResponse(factory) { accessResponse = factory; },

    /** Install a per-call profile read behaviour (return undefined to fall through). */
    setProfileBehaviour(fn) { profileBehaviour = fn; },

    setProfile(wallet, profile) { profiles.set(String(wallet).toLowerCase(), profile); },

    /** Hold every profile read open until release() is called. */
    holdProfileReads() {
      let release;
      profileGate = new Promise(resolve => { release = resolve; });
      return () => {
        profileGate = null;
        release();
      };
    },

    failImage(source) { failingImages.add(source); },
    allowImage(source) { failingImages.delete(source); },

    /** The stable account button element, or null before first render. */
    button() { return navButtons.querySelector('.avatar-button'); },

    /** The <img> inside the stable account button. */
    avatarImage() {
      return navButtons.querySelector('[data-avatar-image]');
    },

    /** Currently displayed avatar source. */
    avatarSrc() { return harness.avatarImage()?.getAttribute('src') || ''; },

    /** Currently displayed account name. */
    avatarName() {
      return navButtons.querySelector('[data-avatar-name]')?.textContent || '';
    },

    /** Currently displayed short address ('' when hidden). */
    avatarAddress() {
      const node = navButtons.querySelector('[data-avatar-address]');
      if (!node || node.hidden) return '';
      return node.textContent || '';
    },

    menu() { return document.getElementById('avatarDropdownMenu'); },
    menuHtml() { return harness.menu()?.innerHTML || ''; },

    uiState() { return documentElement.dataset.walletUiState; },

    /** Dispatch the shared wallet-state event exactly as appkit-init.js does. */
    dispatchWalletState(detail) {
      context.window.dispatchEvent(new context.CustomEvent('artsoul:wallet-state-changed', { detail }));
    },

    /** Run every registered MutationObserver callback (nav DOM restoration). */
    triggerMutationObservers() {
      for (const observer of mutationObservers) observer.callback([], observer);
    },

    /** Resolve pending image requests and drain microtasks. */
    async flush() {
      for (let round = 0; round < 8; round += 1) {
        while (pendingImages.length > 0) {
          const { image, source } = pendingImages.shift();
          imageLoads.push(source);
          if (failingImages.has(source)) {
            const onerror = image.onerror;
            if (typeof onerror === 'function') onerror.call(image, { type: 'error' });
          } else {
            image.complete = true;
            image.dispatchEvent({ type: 'load' });
          }
        }
        while (pendingTimeouts.length > 0) pendingTimeouts.shift()();
        await new Promise(resolve => setImmediate(resolve));
      }
    }
  });

  return harness;
}

module.exports = {
  createAvatarHarness,
  FakeElement,
  matches,
  SOURCE,
  SOURCE_PATH,
  BASE_SEPOLIA_RPC_URL
};
