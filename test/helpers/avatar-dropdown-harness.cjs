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
const PREPAINT_SOURCE_PATH = path.join(__dirname, '..', '..', 'header-prepaint.js');
const PREPAINT_SOURCE = fs.readFileSync(PREPAINT_SOURCE_PATH, 'utf8');

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
  toggle(name, force) {
    const shouldAdd = force === undefined ? !this.names.has(name) : Boolean(force);
    if (shouldAdd) this.names.add(name);
    else this.names.delete(name);
    return shouldAdd;
  }
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
    this.onload = null;
    this.onerror = null;
    this._src = '';
    // A decoded image has intrinsic dimensions; the preview capture reads them.
    this.naturalWidth = 0;
    this.naturalHeight = 0;
    this.crossOrigin = null;
    // HTMLImageElement.decode(). It is a SEPARATE lifecycle stage from 'load':
    // the resource can have arrived while the bitmap is still decoding, which is
    // exactly the window a commit-on-load would paint into. A harness whose
    // images support decode() must therefore let a test hold the two apart.
    // Omitted entirely when the harness models a browser without decode().
    if (tagName === 'img' && ownerHarness && ownerHarness.supportsDecode !== false) {
      this.decode = () => ownerHarness.queueImageDecode(this, this._src);
    }
  }

  get rel() { return this.attributes.rel || ''; }
  set rel(value) { this.attributes.rel = String(value); }
  get as() { return this.attributes.as || ''; }
  set as(value) { this.attributes.as = String(value); }
  get href() { return this.attributes.href || ''; }
  set href(value) { this.attributes.href = String(value); }

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
 * options.failingDecodes  - Set of image sources that LOAD but fail to decode
 * options.supportsDecode  - false models a browser without Image.decode()
 * options.staticShellHtml - static #navButtons markup a product page ships, so
 *                           the harness can model what the browser paints
 *                           before avatar-dropdown.js touches anything
 */
function createAvatarHarness(options = {}) {
  const harness = {};
  // Read by FakeElement while building the static shell, so it must be known
  // before the first image element exists.
  harness.supportsDecode = options.supportsDecode !== false;

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
  const failingDecodes = new Set(options.failingDecodes || []);
  // Sources whose host sends no CORS headers: an anonymous request fails.
  const corsBlockedImages = new Set(options.corsBlockedImages || []);
  // Pending image resolutions, drained by flush(). Mirrors a browser deferring
  // load/error until after the synchronous render completed.
  const pendingImages = [];
  // Pending decode() settlements. Held separately from load so a test can
  // observe the window where the resource has arrived but the bitmap is not
  // ready to paint — the exact window a commit-on-load would paint into.
  const pendingDecodes = [];
  const decodeCalls = [];
  let decodesDeferred = false;
  // Profile reads can be held open to model a slow mobile response.
  let profileGate = null;
  let profileBehaviour = null;
  // Balance/network reads can be held open or made to fail independently.
  let balanceGate = null;
  let balanceFails = options.balanceFails === true;

  harness.queueImageLoad = (image, source) => {
    pendingImages.push({ image, source });
  };

  harness.queueImageDecode = (image, source) => new Promise((resolve, reject) => {
    // A source that never loaded, or one flagged as undecodable, rejects with
    // an EncodingError exactly as the platform does.
    const fails = failingImages.has(source) || failingDecodes.has(source);
    pendingDecodes.push({
      source,
      settle: () => (fails ? reject(new Error(`decode failed for ${source}`)) : resolve())
    });
  });

  // Observer invoked at every point the component could have committed a
  // visible change, so a test can record the full visible-state history instead
  // of only the settled state.
  let commitObserver = null;
  const notifyCommit = () => { if (commitObserver) commitObserver(); };

  const documentElement = new FakeElement('html', harness);
  const body = new FakeElement('body', harness);
  const navButtons = new FakeElement('div', harness);
  navButtons.id = 'navButtons';
  body.appendChild(navButtons);
  // The static shell every product page ships inside #navButtons. Materialising
  // it reproduces the real first paint: the browser has already painted the
  // canonical avatar before a single line of component code runs.
  if (options.staticShellHtml) {
    navButtons.innerHTML = options.staticShellHtml;
    navButtons.dataset.avatarRenderKey = 'initializing';
    // The static markup is part of the document: it is already decoded when the
    // first paint happens, exactly like a browser serving it from cache.
    const shellImage = navButtons.querySelector('[data-avatar-image]');
    if (shellImage) shellImage.complete = true;
  }

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
    createElement: tag => {
      const element = new FakeElement(tag, harness);
      // Minimal <canvas> so the paint-ready avatar preview capture can be
      // driven deterministically: options.canvasExport decides whether the
      // export succeeds, throws a SecurityError (tainted canvas, the real
      // no-CORS behaviour) or is unavailable altogether.
      if (tag === 'canvas') {
        element.getContext = () => (options.canvasExport === 'no-context' ? null : { drawImage() {} });
        element.toDataURL = (type) => {
          if (options.canvasExport === 'tainted') {
            const error = new Error('Tainted canvases may not be exported.');
            error.name = 'SecurityError';
            throw error;
          }
          if (options.canvasExport === 'oversized') {
            return `data:image/png;base64,${'A'.repeat(40 * 1024)}`;
          }
          if (options.canvasExport === 'svg') return 'data:image/svg+xml;base64,PHN2Zy8+';
          if (type === 'image/webp' && options.canvasExport === 'no-webp') {
            return 'data:image/png;base64,QUJD';
          }
          return type === 'image/webp'
            ? 'data:image/webp;base64,V0VCUFBSRVZJRVc='
            : 'data:image/png;base64,UE5HUFJFVklFVw==';
        };
      }
      return element;
    },
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
    // Deterministic timers: the delay is recorded but never waited on, so a
    // bounded backoff stays testable without wall-clock time. Ids start at 1 so
    // a live timer is never falsy. clearTimeout genuinely removes the entry.
    setTimeout: (fn, delay = 0) => {
        if (typeof fn !== 'function') return 0;
        const id = ++timeoutSequence;
        pendingTimeouts.push({ id, fn, delay });
        return id;
    },
    clearTimeout: (id) => {
        const index = pendingTimeouts.findIndex(entry => entry.id === id);
        if (index >= 0) pendingTimeouts.splice(index, 1);
    },
    localStorage,
    // The shared header decodes the next avatar in a detached image before it
    // swaps the visible one, so the harness must provide the same constructor
    // the browser does.
    Image: class {
      constructor() { return new FakeElement('img', harness); }
    },
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
        const response = {
          ok: true,
          json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x16345785d8a0000' })
        };
        // A slow, hanging or failing balance RPC must never hold the visible
        // identity. balanceGate models exactly that.
        if (balanceGate) return balanceGate.then(() => (balanceFails ? Promise.reject(new Error('balance RPC failed')) : response));
        if (balanceFails) return Promise.reject(new Error('balance RPC failed'));
        return Promise.resolve(response);
      }
      return Promise.resolve({ ok: false, json: async () => ({}), text: async () => '' });
    }
  };

  const pendingTimeouts = [];
  const scheduledDelays = [];
  let timeoutSequence = 0;

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

  const artSoulDb = {
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

  // Product pages snapshot first-frame state in a tiny synchronous head bridge,
  // then hydrate the parsed shell before the deferred account component runs.
  // The option is explicit so component-only tests can still isolate the larger
  // component while first-paint tests use the real ordering.
  if (options.prepaint === true) {
    vm.runInNewContext(PREPAINT_SOURCE, context, { filename: 'header-prepaint.js' });
    context.window.ArtSoulHeaderPrepaint.hydrate(navButtons);
  }

  // supabase-client.js is deferred, so ArtSoulDB can be missing when a wallet
  // is confirmed. Passing dbReady:false reproduces that race; earlier suites
  // keep the ready-from-the-start default.
  if (options.dbReady !== false) context.window.ArtSoulDB = artSoulDb;

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

    /**
     * Assign window.ArtSoulDB and announce readiness exactly as
     * supabase-client.js does. Returns the number of dispatches so a test can
     * fire duplicates and assert the read count stays bounded.
     */
    makeDbReady({ dispatch = true } = {}) {
      context.window.ArtSoulDB = artSoulDb;
      if (dispatch) harness.dispatchDbReady();
      return context.window.ArtSoulDB;
    },

    /** Delays of every timer that actually fired, in firing order. */
    firedDelays() { return [...scheduledDelays]; },

    /** Timers scheduled but not yet fired (a cancelled timer is gone). */
    pendingTimerCount() { return pendingTimeouts.length; },

    /**
     * Flip a still-parsing document to 'complete' and fire DOMContentLoaded,
     * exactly as the browser does after the last of the shared header's boot
     * scripts. Only meaningful with `readyState: 'loading'`, which models the
     * real ordering: the component is a synchronous head script, so it runs
     * long before the document has finished parsing.
     */
    fireDomContentLoaded() {
      document.readyState = 'complete';
      for (const handler of documentListeners.get('DOMContentLoaded') || []) handler({ type: 'DOMContentLoaded' });
      notifyCommit();
    },

    /** Dispatch 'artsoul:db-ready' without touching window.ArtSoulDB. */
    dispatchDbReady() {
      context.window.dispatchEvent(new context.CustomEvent('artsoul:db-ready'));
    },

    /** Install a per-call profile read behaviour (return undefined to fall through). */
    setProfileBehaviour(fn) { profileBehaviour = fn; },

    setProfile(wallet, profile) { profiles.set(String(wallet).toLowerCase(), profile); },

    /**
     * Hold every balance/network read open until release() is called, so a test
     * can prove the visible identity commits without waiting for the RPC.
     */
    holdBalanceReads() {
      let release;
      balanceGate = new Promise(resolve => { release = resolve; });
      return () => {
        balanceGate = null;
        release();
      };
    },

    /** Make every balance/network read reject. */
    failBalanceReads() { balanceFails = true; },

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

    failDecode(source) { failingDecodes.add(source); },
    allowDecode(source) { failingDecodes.delete(source); },

    /** Sources whose decode() was actually awaited, in call order. */
    decodeCalls,

    /**
     * Stop flush() from settling decode(), so a test can drive a load to
     * completion and assert that the visible image has NOT changed yet.
     */
    deferDecodes() { decodesDeferred = true; },

    /** Resume decode settlement; the next flush() drains what is pending. */
    releaseDecodes() { decodesDeferred = false; },

    /** decode() promises that have been requested but not settled. */
    pendingDecodeCount() { return pendingDecodes.length; },

    /** The stable account button element, or null before first render. */
    button() { return navButtons.querySelector('.avatar-button'); },

    /** The <img> inside the stable account button. */
    avatarImage() {
      return navButtons.querySelector('[data-avatar-image]');
    },

    /** Currently displayed avatar source. */
    avatarSrc() { return harness.avatarImage()?.getAttribute('src') || ''; },

    /**
     * What the displayed pixels REPRESENT, which is not always what is in src:
     * a restored paint-ready preview paints in place of its own source URL.
     */
    avatarSource() { return harness.avatarImage()?.dataset.avatarSource || ''; },

    /** True when the button displays a locally cached preview data URI. */
    avatarIsPreview() { return /^data:image\//.test(harness.avatarSrc()); },

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

    /**
     * Install an observer invoked at every point the component could have
     * committed a visible change (each image resolution, each timer, each
     * microtask round). Tests use it to record the full visible-state history
     * so a forbidden INTERMEDIATE state cannot hide behind a correct final one.
     */
    observeCommits(fn) {
      commitObserver = typeof fn === 'function' ? fn : null;
      notifyCommit();
    },

    /** Resolve pending image requests and drain microtasks. */
    async flush() {
      notifyCommit();
      for (let round = 0; round < 8; round += 1) {
        while (pendingImages.length > 0) {
          const { image, source } = pendingImages.shift();
          imageLoads.push(source);
          if (failingImages.has(source)) {
            const onerror = image.onerror;
            if (typeof onerror === 'function') onerror.call(image, { type: 'error' });
          } else if (corsBlockedImages.has(source) && image.crossOrigin === 'anonymous') {
            // A host without CORS headers rejects the anonymous request. The
            // component must retry once without it so the avatar still renders.
            const onerror = image.onerror;
            if (typeof onerror === 'function') onerror.call(image, { type: 'error' });
          } else {
            image.complete = true;
            image.naturalWidth = 200;
            image.naturalHeight = 200;
            if (typeof image.onload === 'function') image.onload.call(image, { type: 'load' });
            image.dispatchEvent({ type: 'load' });
          }
          notifyCommit();
        }
        while (!decodesDeferred && pendingDecodes.length > 0) {
          const entry = pendingDecodes.shift();
          decodeCalls.push(entry.source);
          entry.settle();
          notifyCommit();
        }
        while (pendingTimeouts.length > 0) {
          const entry = pendingTimeouts.shift();
          scheduledDelays.push(entry.delay);
          entry.fn();
          notifyCommit();
        }
        await new Promise(resolve => setImmediate(resolve));
        notifyCommit();
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
