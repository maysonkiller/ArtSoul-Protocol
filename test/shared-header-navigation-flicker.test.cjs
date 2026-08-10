// A-05 regression: shared account-button flicker across full-document navigation.
//
// Production symptom after PR #167 (A-45): the settled identity was correct, but
// the account button still visibly flickered when moving between ArtSoul Home,
// Gallery, Profile, Publish Artwork and artwork detail — separate HTML
// documents, not SPA routes. Reported on desktop and mobile, connected and
// disconnected.
//
// Proven cause, in two parts, both first-paint/hydration only:
//
//   1. `updateStableButton` assigned the next avatar straight onto the live
//      <img> and hid it (`avatar-image-loading`) until `load` fired. Every
//      document starts from the static markup's canonical avatar, so on every
//      navigation the connected user's avatar was replaced by an EMPTY 30px slot
//      for at least one frame. Confirmed in Chromium: with the header already
//      showing name and address, the <img> stayed `visibility: hidden` for the
//      whole fetch window.
//   2. `html.wallet-state-resolving ... .avatar-button > *` hid EVERY child of
//      the account button while a saved session was being restored. On mobile
//      `.avatar-info` is `display: none`, so nothing at all was left — an empty
//      pill.
//
// These tests drive the real avatar-dropdown.js through the shared DOM harness
// and record the full VISIBLE-STATE HISTORY. A final-state-only assertion cannot
// see a forbidden intermediate frame, which is the entire defect here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createAvatarHarness } = require('./helpers/avatar-dropdown-harness.cjs');

const ROOT = path.join(__dirname, '..');
const WALLET_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const WALLET_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const AVATAR_A = 'https://cdn.artsoul.test/avatar-a.png';
const AVATAR_B = 'https://cdn.artsoul.test/avatar-b.png';
const NEUTRAL_AVATAR = '/default-avatar.png';
// Must stay in sync with RESOLVING_IDENTITY_LABEL in avatar-dropdown.js and the
// [data-avatar-resolving] placeholder in every static header shell.
const RESOLVING_LABEL = 'Connecting…';
const STYLIZED_A = /^data:image\/svg\+xml/;
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 CriOS/126.0';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0';

const SHARED_HEADER_PAGES = [
  'index.html',
  'gallery.html',
  'artwork.html',
  'profile.html',
  'upload.html',
  'admin.html',
  'docs-protocol.html'
];

const readPage = page => fs.readFileSync(path.join(ROOT, page), 'utf8');

/** The static account-button markup a product page paints before any script. */
function staticShellOf(page) {
  const shell = readPage(page).match(/<div class="avatar-dropdown-container">[\s\S]*?<\/button>\s*<\/div>/);
  assert.ok(shell, `${page} must ship the static shared-header shell`);
  return shell[0];
}

const STATIC_SHELL = staticShellOf('index.html');

// ---------------------------------------------------------------------------
// Visible-state recording
// ---------------------------------------------------------------------------

/**
 * What a viewer can see of the account button right now.
 *
 * `resolvingPlaceholder` models the one CSS rule that applies while the
 * `wallet-state-resolving` class is present: the name and address nodes are
 * swapped for the `[data-avatar-resolving]` label. `visibleIdentityText` is
 * therefore whichever of the two the viewer actually reads — it can never be
 * empty, which is the invariant the "avatar plus black empty area" defect broke.
 */
function snapshot(harness) {
  const button = harness.button();
  const image = harness.avatarImage();
  const resolvingNode = harness.navButtons.querySelector('[data-avatar-resolving]');
  const resolvingPlaceholder = harness.documentElement.classList.contains('wallet-state-resolving');
  const name = harness.avatarName();
  const address = harness.avatarAddress();
  return {
    hasButton: !!button,
    childCount: button ? button.children.length : 0,
    imgSrc: image ? (image.getAttribute('src') || '') : null,
    imgHiddenByClass: image ? image.classList.contains('avatar-image-loading') : false,
    resolvingPlaceholder,
    resolvingLabel: resolvingNode ? (resolvingNode.textContent || '') : null,
    visibleIdentityText: resolvingPlaceholder
      ? (resolvingNode ? (resolvingNode.textContent || '') : '')
      : name,
    identityTextHidden: resolvingPlaceholder,
    name,
    address,
    uiState: harness.uiState() || null
  };
}

/** Record every distinct visible state the component commits, in order. */
function track(harness) {
  const history = [];
  const record = () => {
    const state = snapshot(harness);
    const key = JSON.stringify(state);
    if (history.length > 0 && history[history.length - 1].key === key) return;
    history.push({ key, ...state });
  };
  harness.observeCommits(record);
  return { history, record };
}

/** Invariants that must hold in EVERY recorded frame, for every scenario. */
function assertNeverFlickers(history, label) {
  assert.ok(history.length > 0, `${label}: nothing was recorded`);
  for (const [index, state] of history.entries()) {
    const where = `${label} frame ${index} ${state.key}`;
    // 1 — the button always exists and always reserves its geometry.
    assert.equal(state.hasButton, true, `${where}: the account button disappeared`);
    assert.ok(state.childCount >= 3, `${where}: the account button was emptied`);
    // 1 / 9 — the avatar slot is never blank.
    assert.ok(state.imgSrc, `${where}: the avatar slot had no image`);
    assert.equal(state.imgHiddenByClass, false, `${where}: the avatar image was hidden`);
    // 8 — the retired stylized "A" must not be reachable, not even for a frame.
    assert.doesNotMatch(state.imgSrc, STYLIZED_A, `${where}: the retired "A" fallback rendered`);
    // The reported defect: an avatar on screen with an empty identity area. The
    // identity region always reads something — a name, or the resolving label.
    assert.ok(
      state.visibleIdentityText && state.visibleIdentityText.trim().length > 0,
      `${where}: the avatar was visible with an empty identity area`
    );
    // 5 / 6 — a visible identity is never the guest one while connected.
    if (state.uiState === 'connected' && !state.identityTextHidden) {
      assert.notEqual(state.name, 'ArtSoul Guest', `${where}: guest identity painted while connected`);
    }
  }
}

/** The ordered list of distinct values a field took across the history. */
function transitions(history, field) {
  const seen = [];
  for (const state of history) {
    if (seen.length === 0 || seen[seen.length - 1] !== state[field]) seen.push(state[field]);
  }
  return seen;
}

/** 7 — the field never returns to a value it already left. */
function assertMonotonic(history, field, label) {
  const seen = transitions(history, field);
  assert.equal(
    new Set(seen).size,
    seen.length,
    `${label}: ${field} was not monotonic, saw ${JSON.stringify(seen)}`
  );
}

/**
 * A harness that boots the way a real document does: the component is a
 * synchronous head script, so it runs while the document is still parsing and
 * the static shell is already in the DOM. Nothing has rendered yet when the
 * caller starts recording, so the very first frame is the true first paint.
 */
function bootHarness(options = {}) {
  const harness = createAvatarHarness({
    userAgent: options.userAgent || DESKTOP_UA,
    pathname: options.pathname || '/gallery.html',
    staticShellHtml: STATIC_SHELL,
    readyState: 'loading',
    ...options
  });
  harness.context.window.currentChainId = 84532;
  harness.context.window.isArtSoulBaseSepoliaConfirmed = () => true;
  return harness;
}

function connect(harness, address) {
  harness.context.window.artsoulWalletStateSettled = true;
  harness.context.window.currentWalletAddress = address;
  harness.context.window.artsoulSettledWalletState = { address, chainId: 84532, isConnected: true };
  // A desktop injected provider. isWalletConnectionConfirmed() consults it on
  // every path that does not carry an explicit `confirmed` flag — notably the
  // observer's rebuild of a genuinely removed header — so a desktop scenario
  // without it would model a browser that has no wallet at all.
  harness.context.window.ethereum = { selectedAddress: address, request: async () => [address] };
  harness.dispatchWalletState({ address, chainId: 84532, isConnected: true });
}

function disconnect(harness) {
  harness.context.window.artsoulWalletStateSettled = true;
  harness.context.window.currentWalletAddress = null;
  harness.context.window.artsoulSettledWalletState = { address: null, chainId: null, isConnected: false };
  harness.context.window.ethereum = { selectedAddress: '', request: async () => [] };
  // appkit-init.js owns the wallet hint and drops it on a settled disconnect;
  // the assertion below pins that contract so this model cannot drift.
  harness.storage.delete('artsoul_wallet');
  harness.dispatchWalletState({ address: null, chainId: null, isConnected: false });
}

test('appkit-init drops the wallet hint on a settled disconnect', () => {
  const appkit = fs.readFileSync(path.join(ROOT, 'appkit-init.js'), 'utf8');
  assert.match(
    appkit,
    /if \(normalizedAddress\) \{\s*localStorage\.setItem\('artsoul_wallet', normalizedAddress\);[\s\S]*?\} else \{\s*localStorage\.removeItem\('artsoul_wallet'\);/
  );
});

function cachedIdentityStorage(wallet, name, avatarUrl) {
  return {
    artsoul_wallet: wallet,
    artsoul_header_ui_state: 'connected',
    artsoul_header_identity: JSON.stringify({ wallet, name, avatarUrl })
  };
}

// ---------------------------------------------------------------------------
// 1 — disconnected first paint through settled disconnected
// ---------------------------------------------------------------------------

for (const userAgent of [DESKTOP_UA, IPHONE_UA]) {
  const device = userAgent === IPHONE_UA ? 'mobile' : 'desktop';

  test(`[${device}] a definitively disconnected boot shows the guest image continuously`, async () => {
    const harness = bootHarness({
      userAgent,
      settled: false,
      storage: { artsoul_header_ui_state: 'disconnected' }
    });
    const { history, record } = track(harness);

    // First paint: the static document, before the component touches anything.
    record();
    harness.dropdown.renderInitializingState();
    record();
    disconnect(harness);
    await harness.flush();

    assertNeverFlickers(history, `${device} guest boot`);
    for (const state of history) {
      assert.equal(state.imgSrc, NEUTRAL_AVATAR, 'the canonical guest image must never change');
      assert.equal(state.name, 'ArtSoul Guest');
      assert.equal(state.identityTextHidden, false, 'a definitive guest boot must never withhold its identity');
      assert.notEqual(state.uiState, 'connected', 'a guest boot must never claim a connection');
    }
    assert.equal(harness.avatarSrc(), NEUTRAL_AVATAR);
    assert.match(harness.menuHtml(), /Connect Wallet/);
  });

  test(`[${device}] a cached connected identity settles without ever blanking the button`, async () => {
    const harness = bootHarness({
      userAgent,
      settled: false,
      storage: cachedIdentityStorage(WALLET_A, 'Founder', AVATAR_A),
      profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
    });
    const { history, record } = track(harness);

    record();
    harness.dropdown.renderInitializingState();
    record();
    await harness.flush();
    connect(harness, WALLET_A);
    await harness.flush();

    assertNeverFlickers(history, `${device} cached connected boot`);
    // The avatar advances canonical -> the user's own avatar and never back.
    assertMonotonic(history, 'imgSrc', `${device} cached connected boot`);
    assert.deepEqual(transitions(history, 'imgSrc'), [NEUTRAL_AVATAR, AVATAR_A]);
    // No guest -> connected -> guest and no connected -> blank -> connected.
    assertMonotonic(history, 'uiState', `${device} cached connected boot`);
    // The cached avatar is not decoded yet on a fresh document, so the button
    // shows the COMPLETE resolving state and only then the connected identity.
    // It must never read "Founder" beside the neutral avatar.
    assert.deepEqual(transitions(history, 'name'), ['ArtSoul Guest', RESOLVING_LABEL, 'Founder']);
    // The guest name is only ever on screen while nothing claims a connection.
    for (const state of history) {
      if (state.name === 'ArtSoul Guest') assert.notEqual(state.uiState, 'connected');
      if (state.name === 'Founder') assert.equal(state.imgSrc, AVATAR_A, 'the connected name never sits beside the neutral avatar');
    }
    assert.equal(harness.avatarSrc(), AVATAR_A);
    assert.equal(harness.uiState(), 'connected');
  });
}

// ---------------------------------------------------------------------------
// 2 — cached connected identity, then no live session at all
// ---------------------------------------------------------------------------

test('a cached connected identity with no live session resolves to guest exactly once', async () => {
  const harness = bootHarness({
    settled: false,
    storage: cachedIdentityStorage(WALLET_A, 'Founder', AVATAR_A)
  });
  const { history, record } = track(harness);

  record();
  harness.dropdown.renderInitializingState();
  record();
  await harness.flush();
  // AppKit settles with no session: the cached shell must not survive it.
  disconnect(harness);
  await harness.flush();

  assertNeverFlickers(history, 'cached identity without a session');
  // One authoritative change, never back and forth.
  assertMonotonic(history, 'uiState', 'cached identity without a session');
  // 'resolving' is the coherent state held while the cached avatar decodes;
  // 'restoring' is the restored cached presentation, which authorizes nothing
  // and is never persisted. Only the settled provider produces 'connected'.
  assert.deepEqual(transitions(history, 'uiState'), [null, 'resolving', 'restoring', 'disconnected']);
  assert.equal(harness.avatarName(), 'ArtSoul Guest');
  assert.equal(harness.avatarSrc(), NEUTRAL_AVATAR);
  assert.equal(harness.avatarAddress(), '');
  assert.match(harness.menuHtml(), /Connect Wallet/);
  // 4 — the cached identity is visual continuity only. It authorises nothing,
  // and the settled state is what the NEXT document boots from: the following
  // navigation must hydrate as a guest even though the blob is still there.
  assert.equal(harness.storage.get('artsoul_header_ui_state'), 'disconnected');
  const nextDocument = bootHarness({
    settled: false,
    storage: Object.fromEntries(harness.storage)
  });
  const nextTrack = track(nextDocument);
  nextDocument.dropdown.renderInitializingState();
  nextTrack.record();
  await nextDocument.flush();

  assertNeverFlickers(nextTrack.history, 'next document after a settled disconnect');
  assert.deepEqual(transitions(nextTrack.history, 'name'), ['ArtSoul Guest']);
  assert.deepEqual(transitions(nextTrack.history, 'imgSrc'), [NEUTRAL_AVATAR]);
  assert.equal(nextDocument.documentElement.classList.contains('wallet-state-resolving'), false);
  assert.equal(nextDocument.document.head.children.length, 0, 'no stale avatar preload');
});

test('an explicit desktop AppKit disconnect rejects a stale connected identity before first paint', async () => {
  const harness = bootHarness({
    userAgent: DESKTOP_UA,
    settled: false,
    storage: {
      ...cachedIdentityStorage(WALLET_A, 'Founder', AVATAR_A),
      '@appkit/connection_status': 'disconnected'
    }
  });
  const { history, record } = track(harness);

  record();
  harness.dropdown.renderInitializingState();
  record();
  await harness.flush();

  assertNeverFlickers(history, 'explicit desktop disconnect with stale identity');
  assert.deepEqual(transitions(history, 'uiState'), [null, 'disconnected']);
  assert.deepEqual(transitions(history, 'name'), ['ArtSoul Guest']);
  assert.deepEqual(transitions(history, 'imgSrc'), [NEUTRAL_AVATAR]);
  assert.equal(harness.document.head.children.length, 0, 'a stale identity must not be preloaded');
  assert.match(harness.menuHtml(), /Connect Wallet/);
});

test('a cached identity for another wallet never renders as the connected one', async () => {
  const harness = bootHarness({
    settled: false,
    storage: cachedIdentityStorage(WALLET_A, 'Alpha', AVATAR_A),
    profiles: { [WALLET_B]: { wallet_address: WALLET_B, username: 'Bravo', avatar_url: AVATAR_B } }
  });
  const { history, record } = track(harness);

  record();
  harness.dropdown.renderInitializingState();
  record();
  connect(harness, WALLET_B);
  await harness.flush();

  assertNeverFlickers(history, 'foreign cached identity');
  for (const state of history) {
    if (state.uiState === 'connected' && state.address === `${WALLET_B.slice(0, 6)}...${WALLET_B.slice(-4)}`) {
      assert.notEqual(state.imgSrc, AVATAR_A, 'wallet A avatar must never be shown for wallet B');
    }
  }
  assert.equal(harness.avatarSrc(), AVATAR_B);
  assert.equal(harness.avatarName(), 'Bravo');
});

// ---------------------------------------------------------------------------
// 3 — connected profiles, with and without an avatar
// ---------------------------------------------------------------------------

test('a connected profile with an avatar commits it in one visible step', async () => {
  const harness = bootHarness({
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
  });
  const { history, record } = track(harness);

  record();
  connect(harness, WALLET_A);
  await harness.flush();

  assertNeverFlickers(history, 'connected with avatar');
  assertMonotonic(history, 'imgSrc', 'connected with avatar');
  assert.deepEqual(transitions(history, 'imgSrc'), [NEUTRAL_AVATAR, AVATAR_A]);
  assert.equal(harness.avatarName(), 'Founder');
});

test('a connected profile without an avatar never leaves the canonical image', async () => {
  const harness = bootHarness({
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: null } }
  });
  const { history, record } = track(harness);

  record();
  connect(harness, WALLET_A);
  await harness.flush();

  assertNeverFlickers(history, 'connected without avatar');
  assert.deepEqual(transitions(history, 'imgSrc'), [NEUTRAL_AVATAR]);
  assert.equal(harness.avatarName(), 'Founder');
  assert.match(harness.menuHtml(), /Disconnect/);
});

// ---------------------------------------------------------------------------
// 4 — avatar image failure
// ---------------------------------------------------------------------------

test('an avatar that fails to load keeps the connected shell and never blanks', async () => {
  const harness = bootHarness({
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } },
    failingImages: [AVATAR_A]
  });
  const { history, record } = track(harness);

  record();
  connect(harness, WALLET_A);
  await harness.flush();

  assertNeverFlickers(history, 'failed avatar');
  // The broken URL was never assigned to the visible <img>: it was loaded in a
  // detached image, failed there, and the canonical image simply stayed.
  assert.deepEqual(transitions(history, 'imgSrc'), [NEUTRAL_AVATAR]);
  assert.equal(harness.avatarName(), 'Founder');
  assert.equal(harness.uiState(), 'connected', 'a decode failure must not change connection semantics');
  assert.match(harness.menuHtml(), /Disconnect/);
  assert.match(harness.button().dataset.avatarContentKey, /\|image-error$/);
});

// ---------------------------------------------------------------------------
// 5 — delayed ArtSoulDB readiness
// ---------------------------------------------------------------------------

test('a delayed ArtSoulDB readiness resolves the identity without an intermediate guest frame', async () => {
  const harness = bootHarness({
    dbReady: false,
    settled: false,
    storage: cachedIdentityStorage(WALLET_A, 'Founder', AVATAR_A),
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder Renamed', avatar_url: AVATAR_B } }
  });
  const { history, record } = track(harness);

  record();
  harness.dropdown.renderInitializingState();
  record();
  connect(harness, WALLET_A);
  await harness.flush();
  harness.makeDbReady();
  await harness.flush();

  assertNeverFlickers(history, 'delayed ArtSoulDB');
  assertMonotonic(history, 'imgSrc', 'delayed ArtSoulDB');
  assert.deepEqual(transitions(history, 'imgSrc'), [NEUTRAL_AVATAR, AVATAR_A, AVATAR_B]);
  assertMonotonic(history, 'uiState', 'delayed ArtSoulDB');
  assert.equal(harness.avatarName(), 'Founder Renamed');
});

// ---------------------------------------------------------------------------
// 6 — no wallet hint at all
// ---------------------------------------------------------------------------

test('a boot with no wallet hint commits nothing at all before the wallet settles', async () => {
  const harness = bootHarness({ settled: false, storage: {} });
  const { history, record } = track(harness);

  record();
  harness.dropdown.renderInitializingState();
  record();
  await harness.flush();

  assertNeverFlickers(history, 'no wallet hint');
  // Only the initial paint plus the harmless state stamp: no identity churn.
  assert.deepEqual(transitions(history, 'imgSrc'), [NEUTRAL_AVATAR]);
  assert.deepEqual(transitions(history, 'name'), ['ArtSoul Guest']);
  assert.equal(harness.documentElement.classList.contains('wallet-state-resolving'), false);
});

// ---------------------------------------------------------------------------
// 7 — repeated identical wallet-state events
// ---------------------------------------------------------------------------

test('repeated identical wallet-state events commit no further visible change', async () => {
  const harness = bootHarness({
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
  });
  const { history, record } = track(harness);

  record();
  connect(harness, WALLET_A);
  await harness.flush();
  const settledFrames = history.length;
  const imageRequests = harness.imageLoads.length;

  for (let i = 0; i < 5; i += 1) {
    harness.dispatchWalletState({ address: WALLET_A, chainId: 84532, isConnected: true });
  }
  harness.triggerMutationObservers();
  await harness.flush();

  assert.equal(history.length, settledFrames, 'a settled header must not repaint');
  assert.equal(harness.imageLoads.length, imageRequests, 'a settled header must not re-request its avatar');
  assertNeverFlickers(history, 'repeated wallet-state events');
});

// ---------------------------------------------------------------------------
// 8 — cross-document consistency of the boot shell itself
// ---------------------------------------------------------------------------

test('every shared-header page ships one identical static boot shell', () => {
  for (const page of SHARED_HEADER_PAGES) {
    assert.equal(staticShellOf(page), STATIC_SHELL, `${page} must ship the same static account button`);
  }
});

test('every shared-header page boots the header in the same order with the same asset pins', () => {
  for (const page of SHARED_HEADER_PAGES) {
    const html = readPage(page);
    // Root-absolute so a page served at a subpath (/artwork/<id>) resolves the
    // same assets as one served at the root.
    assert.match(html, /<link rel="stylesheet" href="\/unified-styles\.css\?v=43">/, `${page} stylesheet pin`);
    assert.match(html, /<script src="\/avatar-dropdown\.js\?v=45" defer><\/script>/, `${page} component pin`);

    const stylesheet = html.indexOf('unified-styles.css?v=43');
    const component = html.indexOf('avatar-dropdown.js?v=45');
    const appkit = html.indexOf('appkit-init.js?v=');
    const shell = html.indexOf('<div id="navButtons"');

    // The stylesheet stays render-blocking so the shell is styled on first
    // paint, and the boot scripts keep their relative order: deferred classic
    // scripts execute in document order, so position still decides sequence.
    assert.ok(stylesheet < component, `${page}: the stylesheet must load before the component`);
    assert.ok(component < appkit, `${page}: the component must run before appkit-init`);
    assert.ok(appkit < shell, `${page}: the boot scripts must precede the header shell`);

    // Hydration used to be an inline call placed after the shell. That is what
    // forced the script to stay render-blocking, because an inline call cannot
    // see a deferred script. The module now hydrates itself, and defer already
    // guarantees it runs after the document — including the shell — is parsed.
    assert.doesNotMatch(html, /window\.AvatarDropdown\?\.renderInitializingState\(\)/,
      `${page} must not hydrate the header from an inline script`);
  }
});

// ---------------------------------------------------------------------------
// 9 — the CSS and head-boot contracts the behaviour above depends on
// ---------------------------------------------------------------------------

test('hydration swaps the identity label and never hides the identity region', () => {
  const css = fs.readFileSync(path.join(ROOT, 'unified-styles.css'), 'utf8');
  // Both retired variants: blanking every child (an empty pill, and on mobile
  // nothing at all) and withholding only the text (avatar plus empty black area).
  assert.doesNotMatch(css, /wallet-state-resolving[^{]*\.avatar-button > \*/);
  assert.doesNotMatch(css, /wallet-state-resolving[^{]*\.avatar-info > \*/);
  assert.doesNotMatch(css, /wallet-state-resolving[\s\S]{0,200}?visibility: hidden/);
  // The resolving state swaps a real label of identical size in and out.
  assert.match(css, /\.site-header #navButtons \[data-avatar-resolving\] \{\s*display: none;/);
  assert.match(css, /html\.wallet-state-resolving \.site-header #navButtons \[data-avatar-resolving\] \{\s*display: block;/);
  assert.match(css, /html\.wallet-state-resolving \.site-header #navButtons \[data-avatar-name\],\s*html\.wallet-state-resolving \.site-header #navButtons \[data-avatar-address\] \{\s*display: none;/);
  assert.match(css, /\.site-header #navButtons \[data-avatar-resolving\] \{[\s\S]*?font-size: 0\.82rem !important;[\s\S]*?font-weight: 600 !important;/);
  // Nothing may hide the account-button image any more.
  assert.doesNotMatch(css, /avatar-image-loading/);
  // The reserved geometry that makes a stable shell possible must stay.
  assert.match(css, /\.site-header #navButtons \.avatar-button \{[\s\S]*?width: 180px !important;/);
  assert.match(css, /\.site-header #navButtons \.avatar-button > img \{[\s\S]*?width: 30px !important;/);
});

test('the resolving label sits after the name so theme first-child rules still target the name', () => {
  // .future/.classic style `.avatar-info > div:first-child` as the display name.
  // Inserting the placeholder before it would move the gradient onto a hidden
  // node and strip the name's Future treatment.
  const css = fs.readFileSync(path.join(ROOT, 'unified-styles.css'), 'utf8');
  assert.match(css, /\.avatar-info > div:first-child/);
  for (const page of SHARED_HEADER_PAGES) {
    const info = readPage(page).match(/<div class="avatar-info">([\s\S]*?)<\/div>\s*<svg/);
    assert.ok(info, `${page} must ship the identity region`);
    assert.ok(
      info[1].indexOf('data-avatar-name') < info[1].indexOf('data-avatar-resolving'),
      `${page}: the resolving label must follow the name node`
    );
  }
});

test('the head boot script preloads a cached avatar instead of fetching it after the header', () => {
  const harness = bootHarness({
    settled: false,
    storage: cachedIdentityStorage(WALLET_A, 'Founder', AVATAR_A)
  });
  const preloads = harness.document.head.children.filter(node => node.attributes.rel === 'preload');
  assert.equal(preloads.length, 1, 'exactly one avatar preload hint');
  assert.equal(preloads[0].attributes.as, 'image');
  assert.equal(preloads[0].attributes.href, AVATAR_A);
});

test('a guest boot issues no preload hint and no resolving state', () => {
  const harness = bootHarness({ settled: false, storage: { artsoul_header_ui_state: 'disconnected' } });
  assert.equal(harness.document.head.children.length, 0, 'a guest boot must not preload anything');
  assert.equal(harness.documentElement.classList.contains('wallet-state-resolving'), false);
});

/** The preload hints a boot with this storage would emit. */
function preloadHints(storage) {
  const harness = bootHarness({ settled: false, storage });
  return harness.document.head.children.filter(node => node.attributes.rel === 'preload');
}

test('the preload hint is emitted only for the cached wallet the hint itself names', () => {
  // Accepted: a validated wallet hint, a connected cached UI state, and an
  // identity stored for exactly that wallet with an HTTPS avatar.
  const accepted = preloadHints(cachedIdentityStorage(WALLET_A, 'Founder', AVATAR_A));
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].attributes.href, AVATAR_A);

  // A root-relative avatar on this origin is equally acceptable.
  const rootRelative = preloadHints(cachedIdentityStorage(WALLET_A, 'Founder', '/avatars/founder.png'));
  assert.equal(rootRelative.length, 1);
  assert.equal(rootRelative[0].attributes.href, '/avatars/founder.png');
});

test('the preload hint is refused whenever it is not bound to the validated wallet', () => {
  const refused = {
    'identity stored for another wallet': {
      artsoul_wallet: WALLET_A,
      artsoul_header_ui_state: 'connected',
      artsoul_header_identity: JSON.stringify({ wallet: WALLET_B, name: 'Bravo', avatarUrl: AVATAR_B })
    },
    'no wallet hint, only a connected cached state': {
      artsoul_header_ui_state: 'connected',
      artsoul_header_identity: JSON.stringify({ wallet: WALLET_A, name: 'Founder', avatarUrl: AVATAR_A })
    },
    'wallet hint present but the cached state is not connected': {
      artsoul_wallet: WALLET_A,
      artsoul_header_ui_state: 'disconnected',
      artsoul_header_identity: JSON.stringify({ wallet: WALLET_A, name: 'Founder', avatarUrl: AVATAR_A })
    },
    'malformed wallet hint': {
      artsoul_wallet: '0xnot-an-address',
      artsoul_header_ui_state: 'connected',
      artsoul_header_identity: JSON.stringify({ wallet: WALLET_A, name: 'Founder', avatarUrl: AVATAR_A })
    },
    'malformed identity JSON': {
      artsoul_wallet: WALLET_A,
      artsoul_header_ui_state: 'connected',
      artsoul_header_identity: '{"wallet":'
    },
    'identity with no wallet': {
      artsoul_wallet: WALLET_A,
      artsoul_header_ui_state: 'connected',
      artsoul_header_identity: JSON.stringify({ name: 'Founder', avatarUrl: AVATAR_A })
    },
    'identity with a malformed wallet': {
      artsoul_wallet: WALLET_A,
      artsoul_header_ui_state: 'connected',
      artsoul_header_identity: JSON.stringify({ wallet: '0xzz', name: 'Founder', avatarUrl: AVATAR_A })
    }
  };

  for (const [label, storage] of Object.entries(refused)) {
    assert.equal(preloadHints(storage).length, 0, `${label} must not become a document-level fetch`);
  }
});

test('the preload hint refuses every URL that is not HTTPS or root-relative on this origin', () => {
  const refusedUrls = [
    '//cdn.artsoul.test/avatar-a.png',          // protocol-relative: a foreign origin
    'http://cdn.artsoul.test/avatar-a.png',     // cleartext external
    'data:image/png;base64,AAAA',
    'javascript:alert(1)',
    'blob:https://cdn.artsoul.test/abcd',
    'https:/cdn.artsoul.test/avatar.png',       // malformed HTTPS
    'avatar-a.png',                             // relative, not root-relative
    ''
  ];
  for (const url of refusedUrls) {
    assert.equal(
      preloadHints(cachedIdentityStorage(WALLET_A, 'Founder', url)).length,
      0,
      `${url || '<empty>'} must not become a document-level fetch`
    );
  }
});

test('a refused preload hint still leaves the cached identity purely visual', () => {
  // Refusing the hint must not change what the header renders or what it grants:
  // the cached identity is restored for continuity and authorizes nothing.
  const harness = bootHarness({
    settled: false,
    storage: cachedIdentityStorage(WALLET_A, 'Founder', 'http://cdn.artsoul.test/avatar-a.png')
  });
  harness.dropdown.renderInitializingState();
  assert.equal(harness.document.head.children.length, 0);
  // The cached avatar still has to be decoded, so the button holds the complete
  // resolving state rather than committing half of the connected identity.
  assert.equal(harness.avatarName(), RESOLVING_LABEL);
  assert.equal(harness.avatarAddress(), `${WALLET_A.slice(0, 6)}...${WALLET_A.slice(-4)}`);
  assert.equal(harness.avatarSrc(), NEUTRAL_AVATAR);
  assert.equal(harness.context.window.currentWalletAddress, undefined);
  assert.equal(harness.context.window.artsoulWalletStateSettled, false);
  assert.equal(harness.dropdown.resolvedIdentityWallet, null);
});

// ---------------------------------------------------------------------------
// 10 — load is not decode
//
// 'load' fires when the resource has arrived; the bitmap can still be decoding.
// Committing on 'load' can therefore still hand the compositor an image it
// cannot paint yet, which is the very frame this PR exists to remove. The
// visible <img> must change only after decode() settles.
// ---------------------------------------------------------------------------

test('a completed load with a pending decode leaves the visible image untouched', async () => {
  const harness = bootHarness({
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
  });
  const { history, record } = track(harness);
  harness.deferDecodes();

  record();
  connect(harness, WALLET_A);
  await harness.flush();

  // The resource has arrived and decode() was requested, but has not settled.
  assert.ok(harness.imageLoads.includes(AVATAR_A), 'the detached image must have loaded');
  assert.equal(harness.pendingDecodeCount(), 1, 'decode must still be pending');
  assert.equal(harness.decodeCalls.length, 0, 'no decode has settled yet');
  // NOTHING of the connected identity is on screen yet: not the image, and not
  // the name or the address. The button holds the complete resolving state.
  assert.equal(harness.avatarSrc(), NEUTRAL_AVATAR, 'load alone must not commit');
  assert.equal(harness.avatarName(), RESOLVING_LABEL, 'the connected name must not precede its avatar');
  assert.equal(harness.avatarAddress(), `${WALLET_A.slice(0, 6)}...${WALLET_A.slice(-4)}`);
  assert.equal(harness.uiState(), 'resolving');
  assertNeverFlickers(history, 'load pending decode');
  // The forbidden frame from the founder's smoke: neutral avatar + connected name.
  for (const state of history) {
    if (state.imgSrc === NEUTRAL_AVATAR) {
      assert.notEqual(state.name, 'Founder', 'neutral avatar must never sit beside the connected profile name');
    }
  }

  // 2 — one coherent transition once decode resolves.
  harness.releaseDecodes();
  await harness.flush();

  assert.deepEqual(harness.decodeCalls, [AVATAR_A]);
  assert.equal(harness.avatarSrc(), AVATAR_A);
  assert.equal(harness.avatarName(), 'Founder');
  assert.equal(harness.uiState(), 'connected');
  assertNeverFlickers(history, 'decode resolved');
  assertMonotonic(history, 'imgSrc', 'decode resolved');
  assert.deepEqual(transitions(history, 'imgSrc'), [NEUTRAL_AVATAR, AVATAR_A]);
  assert.deepEqual(transitions(history, 'name'), ['ArtSoul Guest', RESOLVING_LABEL, 'Founder']);
});

test('a decode rejection keeps the canonical fallback and changes no connection semantics', async () => {
  const harness = bootHarness({
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } },
    // The resource loads; only the bitmap is undecodable.
    failingDecodes: [AVATAR_A]
  });
  const { history, record } = track(harness);

  record();
  connect(harness, WALLET_A);
  await harness.flush();

  assert.ok(harness.imageLoads.includes(AVATAR_A), 'the load itself succeeded');
  assert.deepEqual(harness.decodeCalls, [AVATAR_A], 'the decode was attempted');
  assert.equal(harness.avatarSrc(), NEUTRAL_AVATAR, 'an undecodable avatar must not reach the visible image');
  assert.deepEqual(transitions(history, 'imgSrc'), [NEUTRAL_AVATAR], 'and must never blank it');
  assertNeverFlickers(history, 'decode rejection');
  // Connection semantics are untouched.
  assert.equal(harness.uiState(), 'connected');
  assert.equal(harness.avatarName(), 'Founder');
  assert.equal(harness.avatarAddress(), `${WALLET_A.slice(0, 6)}...${WALLET_A.slice(-4)}`);
  assert.match(harness.menuHtml(), /Disconnect/);
  assert.doesNotMatch(harness.menuHtml(), /Connect Wallet/);
  // The failure is recorded so a later render re-requests the avatar once.
  assert.match(harness.button().dataset.avatarContentKey, /\|image-error$/);
});

test('a decode that settles after a wallet switch cannot modify the current wallet', async () => {
  const harness = bootHarness({
    profiles: {
      [WALLET_A]: { wallet_address: WALLET_A, username: 'Alpha', avatar_url: AVATAR_A },
      [WALLET_B]: { wallet_address: WALLET_B, username: 'Bravo', avatar_url: AVATAR_B }
    }
  });
  const { history, record } = track(harness);
  harness.deferDecodes();

  record();
  connect(harness, WALLET_A);
  await harness.flush();
  // Wallet A's resource has arrived; its decode is still in flight.
  assert.equal(harness.pendingDecodeCount(), 1);
  assert.equal(harness.avatarSrc(), NEUTRAL_AVATAR);

  connect(harness, WALLET_B);
  await harness.flush();

  // Both decodes settle, A's first — its commit must be rejected outright.
  harness.releaseDecodes();
  await harness.flush();

  assert.ok(harness.decodeCalls.includes(AVATAR_A), 'wallet A did settle its decode');
  assert.equal(harness.avatarSrc(), AVATAR_B, 'a stale decode must not repaint the current wallet');
  assert.equal(harness.avatarName(), 'Bravo');
  assert.equal(harness.avatarAddress(), `${WALLET_B.slice(0, 6)}...${WALLET_B.slice(-4)}`);
  assertNeverFlickers(history, 'stale decode after a wallet switch');
  for (const state of history) {
    if (state.address === `${WALLET_B.slice(0, 6)}...${WALLET_B.slice(-4)}`) {
      assert.notEqual(state.imgSrc, AVATAR_A, 'wallet B must never wear wallet A avatar');
    }
  }
});

test('a late unresolved render cannot overwrite a profile resolved for the same wallet', async () => {
  const harness = bootHarness({
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
  });
  const { history, record } = track(harness);
  let releaseFirstNetworkRead;
  let networkRead = 0;
  const networkInfo = {
    name: 'Base Sepolia',
    icon: '',
    color: '#888888',
    currency: 'ETH',
    balance: '1.0000',
    chainId: 84532,
    baseSepoliaConfirmed: true
  };

  harness.dropdown.pendingRenderKey = 'connected:84532';
  harness.dropdown.identityWallet = WALLET_A;
  harness.dropdown.getCurrentNetworkInfo = async () => {
    networkRead += 1;
    if (networkRead === 1) {
      await new Promise(resolve => { releaseFirstNetworkRead = resolve; });
    }
    return networkInfo;
  };

  record();
  const unresolved = harness.dropdown.renderWalletInfo(WALLET_A, {
    renderKey: 'connected:84532',
    resolved: false
  });
  await new Promise(resolve => setImmediate(resolve));

  harness.dropdown.profile = {
    wallet_address: WALLET_A,
    username: 'Founder',
    avatar_url: AVATAR_A
  };
  harness.dropdown.resolvedIdentityWallet = WALLET_A;
  await harness.dropdown.render({ renderKey: 'connected:84532', walletAddress: WALLET_A });
  await harness.flush();
  assert.equal(harness.avatarName(), 'Founder');

  releaseFirstNetworkRead();
  await unresolved;
  await harness.flush();

  assert.equal(harness.avatarName(), 'Founder', 'the stale unresolved identity must be discarded');
  assert.equal(harness.avatarSrc(), AVATAR_A, 'the stale unresolved render must not restore the neutral avatar');
  assertNeverFlickers(history, 'late unresolved render for the resolved wallet');
  assertMonotonic(history, 'name', 'late unresolved render for the resolved wallet');
  assertMonotonic(history, 'imgSrc', 'late unresolved render for the resolved wallet');
});

test('a browser without Image.decode() falls back to the load event and still never blanks', async () => {
  const harness = bootHarness({
    supportsDecode: false,
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
  });
  const { history, record } = track(harness);

  record();
  connect(harness, WALLET_A);
  await harness.flush();

  assert.equal(harness.decodeCalls.length, 0, 'decode() does not exist in this browser');
  assert.equal(harness.avatarSrc(), AVATAR_A, 'the load event remains the safe fallback');
  assert.equal(harness.avatarName(), 'Founder');
  assertNeverFlickers(history, 'no decode support');
  assertMonotonic(history, 'imgSrc', 'no decode support');
  assert.deepEqual(transitions(history, 'imgSrc'), [NEUTRAL_AVATAR, AVATAR_A]);

  // A failing image still falls back correctly without decode().
  const failing = bootHarness({
    supportsDecode: false,
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } },
    failingImages: [AVATAR_A]
  });
  connect(failing, WALLET_A);
  await failing.flush();
  assert.equal(failing.avatarSrc(), NEUTRAL_AVATAR);
  assert.equal(failing.uiState(), 'connected');
  assert.match(failing.button().dataset.avatarContentKey, /\|image-error$/);
});

test('the component awaits decode before touching the visible image', () => {
  // Source contract behind the behavioural cases above: the commit is reached
  // only through decode(), and a rejection routes to the canonical fallback.
  const component = fs.readFileSync(path.join(ROOT, 'avatar-dropdown.js'), 'utf8');
  assert.match(component, /preloader\.decode\(\)\.then\(/);
  assert.match(component, /if \(typeof preloader\.decode !== 'function'\) \{\s*commitAndCapture\(\);/);
  // The commit itself is one guarded transaction, never a per-field write.
  assert.match(component, /commitIdentitySnapshot\(\{ button \}, snapshot, token, failed\)/);
  assert.match(component, /this\.holdIdentityWhilePending\(structure, snapshot\);\s*this\.decodeThenCommitIdentity\(structure, snapshot, token\);/);
});

// ---------------------------------------------------------------------------
// 11 — the production-only defects the source-reading tests could not see
// ---------------------------------------------------------------------------

test('the built output resolves the neutral avatar to exactly one URL', () => {
  // The regression that shipped: Vite rewrote the static header avatar to a
  // hashed /assets/default-avatar-<hash>.png while avatar-dropdown.js kept the
  // literal '/default-avatar.png'. The component then saw a "different" src on
  // every boot, rewrote the already-rendered image, and produced a second
  // request plus a blank bitmap frame. Only built output shows this.
  const distDir = path.join(ROOT, 'dist');
  if (!fs.existsSync(distDir)) {
    // `npm run build` runs before `npm run test:unit` in CI, and the same
    // invariant is enforced hard by scripts/verify-build.mjs on every build.
    assert.match(
      fs.readFileSync(path.join(ROOT, 'scripts', 'verify-build.mjs'), 'utf8'),
      /does not match[\s\S]*?NEUTRAL_AVATAR_URL/,
      'verify-build.mjs must enforce the single neutral avatar URL'
    );
    return;
  }

  const component = fs.readFileSync(path.join(distDir, 'avatar-dropdown.js'), 'utf8');
  const componentUrl = component.match(/const NEUTRAL_AVATAR_URL = '([^']+)';/)?.[1];
  assert.ok(componentUrl, 'dist/avatar-dropdown.js must declare NEUTRAL_AVATAR_URL');
  assert.equal(fs.existsSync(path.join(distDir, componentUrl.replace(/^\//, ''))), true);

  for (const page of SHARED_HEADER_PAGES) {
    const built = fs.readFileSync(path.join(distDir, page), 'utf8');
    const shellUrl = built.match(/<img data-avatar-image src="([^"]+)"/)?.[1];
    assert.equal(shellUrl, componentUrl, `${page}: built shell and component must agree on one neutral avatar`);
    assert.match(built, /data-avatar-resolving/, `${page}: built shell must ship the resolving label`);
  }

  const hashedDuplicates = fs.readdirSync(path.join(distDir, 'assets'))
    .filter(file => /^default-avatar-[^.]+\.(png|jpe?g|webp|svg)$/i.test(file));
  assert.deepEqual(hashedDuplicates, [], 'no hashed duplicate of the neutral avatar may be emitted');
});

test('a stored wallet without a cached profile renders a coherent resolving state', async () => {
  const harness = bootHarness({
    settled: false,
    storage: { artsoul_wallet: WALLET_A, artsoul_header_ui_state: 'connected' }
  });
  const { history, record } = track(harness);

  record();
  harness.dropdown.renderInitializingState();
  record();
  await harness.flush();

  assertNeverFlickers(history, 'resolving without a cached profile');
  // The canonical image plus a real label and the shortened stored address.
  assert.equal(harness.avatarSrc(), NEUTRAL_AVATAR);
  assert.equal(harness.avatarName(), RESOLVING_LABEL);
  assert.equal(harness.avatarAddress(), `${WALLET_A.slice(0, 6)}...${WALLET_A.slice(-4)}`);
  assert.equal(harness.uiState(), 'resolving');
  // Not a fabricated profile, and it authorizes nothing.
  assert.match(harness.menuHtml(), /Connect Wallet/);
  assert.doesNotMatch(harness.menuHtml(), /Disconnect/);
  assert.doesNotMatch(harness.menuHtml(), /data-network-balance/);
  // The transient state must never become the NEXT document's boot hint.
  assert.equal(harness.storage.get('artsoul_header_ui_state'), 'connected');
  for (const state of history) {
    assert.ok(state.visibleIdentityText.trim().length > 0);
  }
});

test('a held or failing balance RPC cannot delay the visible identity', async () => {
  for (const mode of ['held', 'failing']) {
    const harness = bootHarness({
      profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
    });
    const { history, record } = track(harness);
    const release = mode === 'held' ? harness.holdBalanceReads() : null;
    if (mode === 'failing') harness.failBalanceReads();

    record();
    connect(harness, WALLET_A);
    await harness.flush();

    // Identity is fully committed even though the network read has not answered.
    assert.equal(harness.avatarSrc(), AVATAR_A, `${mode}: avatar must not wait on the RPC`);
    assert.equal(harness.avatarName(), 'Founder', `${mode}: name must not wait on the RPC`);
    assert.equal(harness.avatarAddress(), `${WALLET_A.slice(0, 6)}...${WALLET_A.slice(-4)}`);
    assert.equal(harness.uiState(), 'connected', `${mode}: connected state must not wait on the RPC`);
    assert.match(harness.menuHtml(), /Disconnect/);
    assertNeverFlickers(history, `balance RPC ${mode}`);

    if (release) {
      release();
      await harness.flush();
      // The network row folds in afterwards without touching the identity.
      assert.match(harness.menuHtml(), /Base Sepolia/);
      assert.equal(harness.avatarSrc(), AVATAR_A);
      assert.equal(harness.avatarName(), 'Founder');
      assertNeverFlickers(history, 'balance RPC released');
    }
  }
});

test('a late network result is rejected once the wallet generation changed', async () => {
  const harness = bootHarness({
    profiles: {
      [WALLET_A]: { wallet_address: WALLET_A, username: 'Alpha', avatar_url: AVATAR_A },
      [WALLET_B]: { wallet_address: WALLET_B, username: 'Bravo', avatar_url: AVATAR_B }
    }
  });
  const { history, record } = track(harness);
  const release = harness.holdBalanceReads();

  record();
  connect(harness, WALLET_A);
  await harness.flush();
  connect(harness, WALLET_B);
  await harness.flush();

  release();
  await harness.flush();

  assert.equal(harness.avatarSrc(), AVATAR_B);
  assert.equal(harness.avatarName(), 'Bravo');
  assert.equal(harness.avatarAddress(), `${WALLET_B.slice(0, 6)}...${WALLET_B.slice(-4)}`);
  assertNeverFlickers(history, 'late network result after a wallet switch');
  for (const state of history) {
    if (state.address === `${WALLET_B.slice(0, 6)}...${WALLET_B.slice(-4)}`) {
      assert.notEqual(state.imgSrc, AVATAR_A, 'wallet A must never appear for wallet B');
      assert.notEqual(state.name, 'Alpha');
    }
  }
});

test('a transient bootstrap disconnect cannot repaint a committed cached identity', async () => {
  const harness = bootHarness({
    settled: false,
    userAgent: DESKTOP_UA,
    storage: {
      ...cachedIdentityStorage(WALLET_A, 'Founder', AVATAR_A),
      '@appkit/connection_status': 'connected'
    },
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
  });
  const { history, record } = track(harness);

  record();
  harness.dropdown.renderInitializingState();
  await harness.flush();
  assert.equal(harness.uiState(), 'restoring');
  assert.equal(harness.avatarName(), 'Founder');

  // The SDK writes a transient 'disconnected' partway through restoring the
  // session. Nothing in the header may re-read it and tear the identity down.
  harness.storage.set('@appkit/connection_status', 'disconnected');
  for (let i = 0; i < 6; i += 1) {
    harness.triggerMutationObservers();
    harness.dropdown.renderInitializingState();
    await harness.flush();
  }

  assert.equal(harness.uiState(), 'restoring', 'a transient SDK value must not repaint guest');
  assert.equal(harness.avatarName(), 'Founder');
  assert.equal(harness.avatarSrc(), AVATAR_A);
  assertMonotonic(history, 'uiState', 'transient bootstrap disconnect');

  // The restoration then confirms the session — still no guest frame.
  connect(harness, WALLET_A);
  await harness.flush();
  assert.equal(harness.uiState(), 'connected');
  assertNeverFlickers(history, 'transient bootstrap disconnect');
  assert.equal(history.some(state => state.uiState === 'disconnected'), false);
});

test('a boot that starts explicitly disconnected resolves to guest promptly', () => {
  const harness = bootHarness({
    settled: false,
    userAgent: DESKTOP_UA,
    storage: {
      ...cachedIdentityStorage(WALLET_A, 'Founder', AVATAR_A),
      '@appkit/connection_status': 'disconnected'
    }
  });
  harness.dropdown.renderInitializingState();

  assert.equal(harness.uiState(), 'disconnected');
  assert.equal(harness.avatarName(), 'ArtSoul Guest');
  assert.equal(harness.avatarSrc(), NEUTRAL_AVATAR);
  assert.match(harness.menuHtml(), /Connect Wallet/);
  assert.equal(harness.document.head.children.length, 0, 'no preload for an explicitly disconnected boot');
});

test('unrelated document mutations never reset a committed header identity', async () => {
  const harness = bootHarness({
    settled: false,
    storage: {
      ...cachedIdentityStorage(WALLET_A, 'Founder', AVATAR_A),
      '@appkit/connection_status': 'connected'
    },
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
  });
  const { history, record } = track(harness);

  record();
  harness.dropdown.renderInitializingState();
  await harness.flush();
  const framesAfterHydration = history.length;
  const profileReads = harness.profileCalls.length;
  const imageRequests = harness.imageLoads.length;

  // Gallery renders, filter changes, artwork loading: all reach the observer.
  for (let i = 0; i < 25; i += 1) {
    harness.triggerMutationObservers();
    await harness.flush();
  }

  assert.equal(history.length, framesAfterHydration, 'unrelated mutations must commit nothing');
  assert.equal(harness.profileCalls.length, profileReads, 'unrelated mutations must not re-read the profile');
  assert.equal(harness.imageLoads.length, imageRequests, 'unrelated mutations must not re-request the avatar');
  assert.equal(harness.uiState(), 'restoring');
  assert.equal(harness.avatarName(), 'Founder');
  assert.equal(harness.documentElement.classList.contains('wallet-state-resolving'), false);
});

test('a genuinely removed header is still rebuilt by the observer', async () => {
  const harness = bootHarness({
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
  });
  connect(harness, WALLET_A);
  await harness.flush();
  assert.equal(harness.avatarSrc(), AVATAR_A);

  harness.navButtons.innerHTML = '';
  harness.triggerMutationObservers();
  await harness.flush();

  assert.equal(harness.avatarSource(), AVATAR_A);
  assert.equal(harness.avatarName(), 'Founder');
  assert.equal(harness.uiState(), 'connected');
});

test('rapid navigation across every shared-header page stays coherent', async () => {
  // Each page is a fresh document that boots from the storage the previous one
  // settled into, which is exactly what a fast click-through produces.
  let storage = {
    ...cachedIdentityStorage(WALLET_A, 'Founder', AVATAR_A),
    '@appkit/connection_status': 'connected'
  };

  for (const page of SHARED_HEADER_PAGES) {
    const harness = bootHarness({
      settled: false,
      pathname: `/${page}`,
      staticShellHtml: staticShellOf(page),
      storage,
      profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
    });
    const { history, record } = track(harness);

    record();
    harness.dropdown.renderInitializingState();
    record();
    await harness.flush();
    connect(harness, WALLET_A);
    await harness.flush();

    assertNeverFlickers(history, `rapid navigation ${page}`);
    assertMonotonic(history, 'uiState', `rapid navigation ${page}`);
    assert.equal(harness.avatarSource(), AVATAR_A, `${page}: settled avatar`);
    assert.equal(harness.avatarName(), 'Founder', `${page}: settled name`);
    assert.equal(harness.uiState(), 'connected', `${page}: settled state`);
    // The neutral avatar is requested at most once per document, and never as a
    // second URL for the same picture.
    const neutralRequests = harness.imageLoads.filter(src => src === NEUTRAL_AVATAR).length;
    assert.ok(neutralRequests <= 1, `${page}: duplicate neutral avatar requests (${neutralRequests})`);
    assert.equal(harness.imageLoads.some(src => /default-avatar-[^.]+\.png/.test(src)), false,
      `${page}: a hashed neutral avatar URL must never be requested`);

    storage = Object.fromEntries(harness.storage);
  }
});

// ---------------------------------------------------------------------------
// 12 — the identity transaction: intermediate frames, not settled output
//
// The founder's Vercel smoke showed the canonical disconnected avatar standing
// next to a connected profile name and address for 1-2 seconds after every
// navigation. The settled DOM was correct, so settled-output tests passed. The
// cases below inspect the DOM WHILE the profile avatar is still pending.
// ---------------------------------------------------------------------------

/** The forbidden frame: neutral avatar carrying a real connected identity. */
function assertNoHalfIdentity(history, connectedName, label) {
  for (const [index, state] of history.entries()) {
    if (state.imgSrc !== NEUTRAL_AVATAR) continue;
    assert.notEqual(
      state.name,
      connectedName,
      `${label} frame ${index}: neutral avatar beside the connected profile name`
    );
    assert.notEqual(state.uiState, 'connected',
      `${label} frame ${index}: connected UI state committed before its avatar could paint`);
  }
}

test('a pending profile avatar commits no part of the connected identity', async () => {
  const harness = bootHarness({
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
  });
  const { history, record } = track(harness);
  harness.deferDecodes();

  record();
  connect(harness, WALLET_A);
  await harness.flush();

  // The load finished; the decode has not. Inspect the DOM right here.
  assert.equal(harness.pendingDecodeCount(), 1);
  assert.equal(harness.avatarSrc(), NEUTRAL_AVATAR);
  assert.equal(harness.avatarName(), RESOLVING_LABEL);
  assert.equal(harness.avatarAddress(), `${WALLET_A.slice(0, 6)}...${WALLET_A.slice(-4)}`);
  assert.equal(harness.uiState(), 'resolving');
  assertNoHalfIdentity(history, 'Founder', 'pending avatar');
  assertNeverFlickers(history, 'pending avatar');

  // One coherent transition when the image becomes paint-ready.
  harness.releaseDecodes();
  await harness.flush();

  assert.equal(harness.avatarSrc(), AVATAR_A);
  assert.equal(harness.avatarName(), 'Founder');
  assert.equal(harness.uiState(), 'connected');
  assertNoHalfIdentity(history, 'Founder', 'pending avatar settled');
  assertMonotonic(history, 'imgSrc', 'pending avatar settled');
});

test('a rejected profile avatar commits one coherent final fallback', async () => {
  const harness = bootHarness({
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } },
    failingDecodes: [AVATAR_A]
  });
  const { history, record } = track(harness);

  record();
  connect(harness, WALLET_A);
  await harness.flush();

  // Canonical avatar AND the connected name/address, committed together. The
  // identity never stays pending.
  assert.equal(harness.avatarSrc(), NEUTRAL_AVATAR);
  assert.equal(harness.avatarName(), 'Founder');
  assert.equal(harness.avatarAddress(), `${WALLET_A.slice(0, 6)}...${WALLET_A.slice(-4)}`);
  assert.equal(harness.uiState(), 'connected');
  assert.match(harness.button().dataset.avatarContentKey, /\|image-error$/);
  assert.doesNotMatch(harness.button().dataset.avatarContentKey, /\|pending$/);
  assertNeverFlickers(history, 'rejected avatar');
  // The name and the canonical avatar arrived in the SAME frame.
  const halfFrames = history.filter(s => s.imgSrc === NEUTRAL_AVATAR && s.name === 'Founder' && s.uiState !== 'connected');
  assert.deepEqual(halfFrames, [], 'the fallback must be committed together with the connected state');
});

test('wallet A avatar settling after wallet B never reaches the visible button', async () => {
  const harness = bootHarness({
    profiles: {
      [WALLET_A]: { wallet_address: WALLET_A, username: 'Alpha', avatar_url: AVATAR_A },
      [WALLET_B]: { wallet_address: WALLET_B, username: 'Bravo', avatar_url: AVATAR_B }
    }
  });
  const { history, record } = track(harness);
  harness.deferDecodes();

  record();
  connect(harness, WALLET_A);
  await harness.flush();
  // Wallet A's avatar is loaded but not decoded. Supersede it with wallet B.
  connect(harness, WALLET_B);
  await harness.flush();
  // Now let both decodes settle, A first.
  harness.releaseDecodes();
  await harness.flush();

  assert.equal(harness.avatarSrc(), AVATAR_B);
  assert.equal(harness.avatarName(), 'Bravo');
  assert.equal(harness.avatarAddress(), `${WALLET_B.slice(0, 6)}...${WALLET_B.slice(-4)}`);
  for (const [index, state] of history.entries()) {
    assert.notEqual(state.imgSrc, AVATAR_A, `frame ${index}: wallet A avatar reached the visible button`);
    if (state.name === 'Bravo') {
      assert.equal(state.imgSrc, AVATAR_B, `frame ${index}: wallet B name beside a foreign avatar`);
    }
  }
  assertNeverFlickers(history, 'A superseded by B');
});

test('a cached connected identity re-initialises without a half-identity frame', async () => {
  const harness = bootHarness({
    settled: false,
    storage: {
      ...cachedIdentityStorage(WALLET_A, 'Founder', AVATAR_A),
      '@appkit/connection_status': 'connected'
    },
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
  });
  const { history, record } = track(harness);
  harness.deferDecodes();

  record();
  harness.dropdown.renderInitializingState();
  record();
  await harness.flush();

  // Requirement 4: the static guest shell must not become
  // "connected profile text + neutral avatar".
  assert.equal(harness.avatarSrc(), NEUTRAL_AVATAR);
  assert.equal(harness.avatarName(), RESOLVING_LABEL);
  assert.equal(harness.uiState(), 'resolving');
  assertNoHalfIdentity(history, 'Founder', 'cached re-initialisation');

  harness.releaseDecodes();
  await harness.flush();
  assert.equal(harness.avatarSrc(), AVATAR_A);
  assert.equal(harness.avatarName(), 'Founder');
  assert.equal(harness.uiState(), 'restoring');
  assertNoHalfIdentity(history, 'Founder', 'cached re-initialisation settled');
});

test('a same-wallet avatar change keeps the previous complete identity while decoding', async () => {
  const harness = bootHarness({
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
  });
  connect(harness, WALLET_A);
  await harness.flush();
  assert.equal(harness.avatarSrc(), AVATAR_A);

  const { history, record } = track(harness);
  harness.deferDecodes();
  record();
  harness.setProfile(WALLET_A, { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_B });
  await harness.dropdown.refresh(WALLET_A);
  await harness.flush();

  // Same account, so the complete previous identity stays on screen. No
  // resolving label and no neutral avatar for an established identity.
  assert.equal(harness.avatarSrc(), AVATAR_A);
  assert.equal(harness.avatarName(), 'Founder');
  assert.equal(harness.uiState(), 'connected');
  for (const state of history) assert.notEqual(state.name, RESOLVING_LABEL);

  harness.releaseDecodes();
  await harness.flush();
  assert.equal(harness.avatarSrc(), AVATAR_B);
  assert.equal(harness.avatarName(), 'Founder');
  assertNeverFlickers(history, 'same-wallet avatar change');
});

test('a real disconnect commits the complete guest identity at once', async () => {
  const harness = bootHarness({
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
  });
  connect(harness, WALLET_A);
  await harness.flush();
  assert.equal(harness.avatarSrc(), AVATAR_A);

  const { history, record } = track(harness);
  record();
  disconnect(harness);
  // No flush: the guest snapshot must already be complete synchronously.
  assert.equal(harness.avatarSrc(), NEUTRAL_AVATAR);
  assert.equal(harness.avatarName(), 'ArtSoul Guest');
  assert.equal(harness.avatarAddress(), '');
  assert.equal(harness.uiState(), 'disconnected');

  await harness.flush();
  assertNeverFlickers(history, 'disconnect');
  for (const state of history) {
    if (state.name === 'ArtSoul Guest') {
      assert.equal(state.imgSrc, NEUTRAL_AVATAR);
      assert.equal(state.address, '');
    }
  }
});

// ---------------------------------------------------------------------------
// 13 — geometry and label legibility
// ---------------------------------------------------------------------------

test('the desktop identity column fits the full ArtSoul Guest label', () => {
  const css = fs.readFileSync(path.join(ROOT, 'unified-styles.css'), 'utf8');
  const infoWidth = Number(css.match(/\.site-header #navButtons \.avatar-info \{[\s\S]*?width: (\d+)px !important;/)?.[1]);
  const labelWidth = Number(css.match(/\.site-header #navButtons \.avatar-info > div \{\s*width: (\d+)px !important;/)?.[1]);
  const buttonWidth = Number(css.match(/\.site-header #navButtons \.avatar-button \{[\s\S]*?width: (\d+)px !important;/)?.[1]);
  const navWidth = Number(css.match(/\.site-header #navButtons,\s*\.site-header #navButtons \.avatar-dropdown-container \{\s*width: (\d+)px !important;/)?.[1]);
  const menuWidth = Number(css.match(/\.site-header \.avatar-dropdown-menu \{\s*width: min\((\d+)px,/)?.[1]);
  const sideColumn = Number(css.match(/grid-template-columns: (\d+)px minmax\(0, 1fr\) \1px;/)?.[1]);

  // Measured in Chromium at the header's system font, 0.82rem/600:
  // "ArtSoul Guest" needs 90px,
  // a shortened address used as a display name needs 91px, "Connecting…" 88px.
  const WIDEST_HEADER_LABEL_PX = 91;
  assert.ok(infoWidth >= WIDEST_HEADER_LABEL_PX + 8, `identity column ${infoWidth}px cannot fit ${WIDEST_HEADER_LABEL_PX}px labels`);
  assert.equal(labelWidth, infoWidth, 'the label box must match the identity column');
  // avatar 30 + gap 4 + identity + gap 4 + chevron 10 + padding 12 + border 3.2
  assert.ok(buttonWidth >= infoWidth + 63, `button ${buttonWidth}px cannot hold a ${infoWidth}px identity column`);
  // Every coupled measurement moves together, and the side columns stay equal
  // so the centre column remains centred.
  assert.equal(navWidth, buttonWidth, '#navButtons and .avatar-dropdown-container must match the button');
  assert.equal(menuWidth, buttonWidth, 'the dropdown menu must align with the button');
  assert.ok(sideColumn >= buttonWidth, `header side column ${sideColumn}px must not clip a ${buttonWidth}px button`);
});

test('the account button geometry is identical in every state and on every page', async () => {
  // The harness has no layout engine, so geometry is pinned in CSS above. What
  // is asserted here is the DOM contract layout depends on: the same stable
  // nodes, never replaced, in every state.
  const states = [];
  const harness = bootHarness({
    settled: false,
    storage: {
      ...cachedIdentityStorage(WALLET_A, 'Founder', AVATAR_A),
      '@appkit/connection_status': 'connected'
    },
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
  });
  const identity = () => {
    const button = harness.button();
    return {
      button,
      image: harness.avatarImage(),
      children: button.children.length,
      containers: harness.navButtons.querySelectorAll('.avatar-dropdown-container').length,
      buttons: harness.navButtons.querySelectorAll('.avatar-button').length,
      images: harness.navButtons.querySelectorAll('[data-avatar-image]').length
    };
  };

  harness.dropdown.renderInitializingState();
  states.push(identity());
  await harness.flush();
  states.push(identity());
  connect(harness, WALLET_A);
  await harness.flush();
  states.push(identity());
  disconnect(harness);
  await harness.flush();
  states.push(identity());

  const first = states[0];
  for (const [index, state] of states.entries()) {
    assert.equal(state.button, first.button, `state ${index}: the account button node was replaced`);
    assert.equal(state.image, first.image, `state ${index}: the avatar image node was replaced`);
    assert.equal(state.children, first.children, `state ${index}: the button child count changed`);
    assert.equal(state.containers, 1, `state ${index}: duplicate dropdown container`);
    assert.equal(state.buttons, 1, `state ${index}: duplicate account button`);
    assert.equal(state.images, 1, `state ${index}: duplicate avatar image`);
  }
});

test('every shared-header page ships exactly one of each header node', () => {
  for (const page of SHARED_HEADER_PAGES) {
    const html = readPage(page);
    const count = pattern => (html.match(pattern) || []).length;
    assert.equal(count(/id="navButtons"/g), 1, `${page}: #navButtons`);
    assert.equal(count(/class="avatar-dropdown-container"/g), 1, `${page}: .avatar-dropdown-container`);
    assert.equal(count(/class="avatar-button"/g), 1, `${page}: .avatar-button`);
    assert.equal(count(/data-avatar-image/g), 1, `${page}: [data-avatar-image]`);
    assert.equal(count(/data-avatar-name/g), 1, `${page}: [data-avatar-name]`);
    assert.equal(count(/data-avatar-address/g), 1, `${page}: [data-avatar-address]`);
    assert.equal(count(/data-avatar-resolving/g), 1, `${page}: [data-avatar-resolving]`);
    assert.equal(count(/class="site-header"/g), 1, `${page}: .site-header`);
  }
});

// ---------------------------------------------------------------------------
// 14 — paint-ready cached header avatar
//
// ArtSoul is an MPA: every navigation is a fresh document whose static shell
// carries the canonical avatar, which users read as "wallet disconnected".
// Caching only the remote URL still costs a network validation and a decode per
// document, so the previously confirmed identity could not be restored before
// the first frame and the header showed guest, then "Connecting…", then the
// profile — on every navigation. A tiny validated local raster fixes that.
// ---------------------------------------------------------------------------

const PREVIEW_WEBP = 'data:image/webp;base64,V0VCUFBSRVZJRVc=';
const PREVIEW_MAX_LENGTH = 32 * 1024;

/** Storage for a wallet whose avatar has already been rendered once. */
function restorableStorage(wallet, name, avatarUrl, previewOverrides = {}) {
  return {
    artsoul_wallet: wallet,
    artsoul_header_ui_state: 'connected',
    '@appkit/connection_status': 'connected',
    artsoul_header_identity: JSON.stringify({
      wallet,
      name,
      avatarUrl,
      preview: { wallet, name, source: avatarUrl, dataUri: PREVIEW_WEBP, ...previewOverrides }
    })
  };
}

test('a successful avatar render stores a bounded paint-ready preview', async () => {
  const harness = bootHarness({
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
  });
  connect(harness, WALLET_A);
  await harness.flush();

  const stored = JSON.parse(harness.storage.get('artsoul_header_identity'));
  assert.equal(stored.preview.wallet, WALLET_A);
  assert.equal(stored.preview.name, 'Founder');
  assert.equal(stored.preview.source, AVATAR_A, 'the preview is bound to the avatar URL it came from');
  assert.match(stored.preview.dataUri, /^data:image\/(?:png|jpeg|webp);base64,/);
  assert.ok(stored.preview.dataUri.length <= PREVIEW_MAX_LENGTH, 'the preview must respect the size ceiling');
  // Captured from the image the header had already decoded: no second request.
  assert.equal(harness.imageLoads.filter(src => src === AVATAR_A).length, 2);
});

test('a restorable cached identity is already on screen at the earliest bootstrap point', async () => {
  const harness = bootHarness({
    settled: false,
    storage: restorableStorage(WALLET_A, 'Founder', AVATAR_A),
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
  });
  const { history, record } = track(harness);
  // Nothing may resolve during this test: no image load, no decode, no timers.
  harness.deferDecodes();

  record();
  harness.dropdown.renderInitializingState();
  record();

  // Synchronous, before any flush: the previously confirmed identity is back.
  assert.equal(harness.avatarSrc(), PREVIEW_WEBP);
  assert.equal(harness.avatarSource(), AVATAR_A);
  assert.equal(harness.avatarName(), 'Founder');
  assert.equal(harness.avatarAddress(), `${WALLET_A.slice(0, 6)}...${WALLET_A.slice(-4)}`);
  assert.equal(harness.uiState(), 'restoring');
  // No guest and no "Connecting…" in any recorded frame.
  for (const state of history) {
    assert.notEqual(state.name, RESOLVING_LABEL, 'a restorable identity must not show the resolving label');
    if (state.uiState === 'restoring') assert.notEqual(state.name, 'ArtSoul Guest');
  }
  assert.deepEqual(transitions(history, 'name'), ['ArtSoul Guest', 'Founder']);
  assertNeverFlickers(history, 'restorable bootstrap');
});

test('a two-second remote avatar cannot pull a restored identity back to neutral', async () => {
  const harness = bootHarness({
    settled: false,
    storage: restorableStorage(WALLET_A, 'Founder', AVATAR_A),
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
  });
  const { history, record } = track(harness);
  // The original remote avatar never resolves for the whole test.
  harness.deferDecodes();
  const holdRemote = harness.holdProfileReads();

  record();
  harness.dropdown.renderInitializingState();
  await harness.flush();

  assert.equal(harness.avatarSrc(), PREVIEW_WEBP, 'the restored profile visual must survive a slow remote avatar');
  assert.equal(harness.avatarName(), 'Founder');
  for (const state of history) {
    // Never falls back to the neutral avatar, and never shows the resolving
    // label, while a restorable identity for this wallet exists.
    if (state.name === 'Founder') assert.notEqual(state.imgSrc, NEUTRAL_AVATAR);
    assert.notEqual(state.name, RESOLVING_LABEL);
  }
  holdRemote();
  await harness.flush();
  assert.equal(harness.avatarName(), 'Founder');
  assertNeverFlickers(history, 'slow remote avatar');
});

test('the provider settling with the same wallet repaints nothing', async () => {
  const harness = bootHarness({
    settled: false,
    storage: restorableStorage(WALLET_A, 'Founder', AVATAR_A),
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
  });
  harness.dropdown.renderInitializingState();
  await harness.flush();

  const before = {
    button: harness.button(),
    image: harness.avatarImage(),
    src: harness.avatarSrc(),
    source: harness.avatarSource(),
    name: harness.avatarName(),
    address: harness.avatarAddress(),
    children: harness.button().children.length
  };
  const imageRequests = harness.imageLoads.length;
  const { history, record } = track(harness);
  record();

  connect(harness, WALLET_A);
  await harness.flush();

  assert.equal(harness.button(), before.button, 'the button node must not be replaced');
  assert.equal(harness.avatarImage(), before.image, 'the image node must not be replaced');
  assert.equal(harness.avatarSrc(), before.src, 'no image-src transition');
  assert.equal(harness.avatarSource(), before.source);
  assert.equal(harness.avatarName(), before.name, 'no name transition');
  assert.equal(harness.avatarAddress(), before.address, 'no address transition');
  assert.equal(harness.button().children.length, before.children, 'no geometry-affecting child change');
  assert.equal(harness.imageLoads.length, imageRequests, 'a confirmed same wallet must not re-request the avatar');
  // Only the UI state advances, from the cached presentation to the confirmed one.
  assert.deepEqual(transitions(history, 'uiState'), ['restoring', 'connected']);
  assert.deepEqual(transitions(history, 'imgSrc'), [before.src]);
  assert.deepEqual(transitions(history, 'name'), [before.name]);
});

test('the provider settling disconnected commits guest in one transition', async () => {
  const harness = bootHarness({
    settled: false,
    storage: restorableStorage(WALLET_A, 'Founder', AVATAR_A)
  });
  harness.dropdown.renderInitializingState();
  await harness.flush();
  assert.equal(harness.avatarSrc(), PREVIEW_WEBP);

  const { history, record } = track(harness);
  record();
  disconnect(harness);

  assert.equal(harness.avatarSrc(), NEUTRAL_AVATAR);
  assert.equal(harness.avatarName(), 'ArtSoul Guest');
  assert.equal(harness.avatarAddress(), '');
  assert.equal(harness.uiState(), 'disconnected');
  await harness.flush();
  assert.deepEqual(transitions(history, 'uiState'), ['restoring', 'disconnected']);
  assertNeverFlickers(history, 'settled disconnect from a restored identity');
});

test('the provider settling with wallet B never shows wallet A beside B address', async () => {
  const harness = bootHarness({
    settled: false,
    storage: restorableStorage(WALLET_A, 'Alpha', AVATAR_A),
    profiles: { [WALLET_B]: { wallet_address: WALLET_B, username: 'Bravo', avatar_url: AVATAR_B } }
  });
  harness.dropdown.renderInitializingState();
  await harness.flush();
  assert.equal(harness.avatarSrc(), PREVIEW_WEBP);

  const { history, record } = track(harness);
  record();
  connect(harness, WALLET_B);
  await harness.flush();

  const shortB = `${WALLET_B.slice(0, 6)}...${WALLET_B.slice(-4)}`;
  assert.equal(harness.avatarSource(), AVATAR_B);
  assert.equal(harness.avatarName(), 'Bravo');
  for (const [index, state] of history.entries()) {
    if (state.address === shortB) {
      assert.notEqual(state.imgSrc, PREVIEW_WEBP, `frame ${index}: wallet A visual beside wallet B address`);
      assert.notEqual(state.name, 'Alpha', `frame ${index}: wallet A name beside wallet B address`);
    }
  }
  assertNeverFlickers(history, 'wallet B supersedes a restored wallet A');
});

test('an invalid stored preview is rejected and the safe resolving path is used', async () => {
  const shortA = `${WALLET_A.slice(0, 6)}...${WALLET_A.slice(-4)}`;
  const rejected = {
    'missing preview': { preview: undefined },
    'wrong wallet': { wallet: WALLET_B },
    'stale name': { name: 'Someone Else' },
    'stale source': { source: 'https://cdn.artsoul.test/old.png' },
    'oversized': { dataUri: `data:image/png;base64,${'A'.repeat(PREVIEW_MAX_LENGTH)}` },
    'svg': { dataUri: 'data:image/svg+xml;base64,PHN2Zy8+' },
    'javascript url': { dataUri: 'javascript:alert(1)' },
    'html data url': { dataUri: 'data:text/html;base64,PHNjcmlwdD4=' },
    'not a string': { dataUri: 12345 },
    'corrupt base64 charset': { dataUri: 'data:image/png;base64,<<<>>>' }
  };

  for (const [label, override] of Object.entries(rejected)) {
    const storage = restorableStorage(WALLET_A, 'Founder', AVATAR_A);
    if ('preview' in override && override.preview === undefined) {
      const identity = JSON.parse(storage.artsoul_header_identity);
      delete identity.preview;
      storage.artsoul_header_identity = JSON.stringify(identity);
    } else {
      const identity = JSON.parse(storage.artsoul_header_identity);
      identity.preview = { ...identity.preview, ...override };
      storage.artsoul_header_identity = JSON.stringify(identity);
    }

    const harness = bootHarness({ settled: false, storage });
    harness.deferDecodes();
    harness.dropdown.renderInitializingState();

    assert.equal(harness.avatarSrc(), NEUTRAL_AVATAR, `${label}: must not paint a rejected preview`);
    assert.equal(harness.avatarName(), RESOLVING_LABEL, `${label}: must fall back to the resolving state`);
    assert.equal(harness.avatarAddress(), shortA, `${label}: the resolving state stays coherent`);
    assert.equal(harness.uiState(), 'resolving', `${label}: resolving, not restoring`);
  }
});

test('corrupt identity JSON never restores anything', () => {
  const harness = bootHarness({
    settled: false,
    storage: {
      artsoul_wallet: WALLET_A,
      artsoul_header_ui_state: 'connected',
      '@appkit/connection_status': 'connected',
      artsoul_header_identity: '{"wallet":'
    }
  });
  harness.dropdown.renderInitializingState();
  assert.equal(harness.avatarSrc(), NEUTRAL_AVATAR);
  assert.equal(harness.avatarName(), RESOLVING_LABEL);
  assert.equal(harness.document.head.children.length, 0, 'no preload for a corrupt record');
});

test('a broken avatar never persists a preview', async () => {
  const harness = bootHarness({
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } },
    failingImages: [AVATAR_A]
  });
  connect(harness, WALLET_A);
  await harness.flush();

  const stored = JSON.parse(harness.storage.get('artsoul_header_identity') || 'null');
  assert.equal(stored?.preview, undefined, 'a failed avatar must not leave a preview behind');
  assert.equal(harness.avatarSrc(), NEUTRAL_AVATAR);
  assert.equal(harness.avatarName(), 'Founder');
});

test('a tainted canvas fails safely and keeps the coherent resolving path', async () => {
  const harness = bootHarness({
    canvasExport: 'tainted',
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
  });
  connect(harness, WALLET_A);
  await harness.flush();

  // The profile is intact — only the optimisation is skipped.
  assert.equal(harness.avatarSource(), AVATAR_A);
  assert.equal(harness.avatarName(), 'Founder');
  assert.equal(harness.uiState(), 'connected');
  const stored = JSON.parse(harness.storage.get('artsoul_header_identity'));
  assert.equal(stored.preview, undefined);
});

test('an avatar host without CORS headers still renders, without a preview', async () => {
  const harness = bootHarness({
    corsBlockedImages: [AVATAR_A],
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
  });
  connect(harness, WALLET_A);
  await harness.flush();

  assert.equal(harness.avatarSource(), AVATAR_A, 'the avatar must still render');
  assert.equal(harness.avatarSrc(), AVATAR_A);
  assert.equal(harness.avatarName(), 'Founder');
  const stored = JSON.parse(harness.storage.get('artsoul_header_identity'));
  assert.equal(stored.preview, undefined, 'no preview is possible without CORS');
  // Exactly one bounded retry, never a loop.
  assert.equal(harness.imageLoads.filter(src => src === AVATAR_A).length, 3);
});

test('an oversized or non-raster canvas export is never persisted', async () => {
  for (const mode of ['oversized', 'svg', 'no-context']) {
    const harness = bootHarness({
      canvasExport: mode,
      profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
    });
    connect(harness, WALLET_A);
    await harness.flush();
    const stored = JSON.parse(harness.storage.get('artsoul_header_identity'));
    assert.equal(stored.preview, undefined, `${mode}: must not be persisted`);
    assert.equal(harness.avatarSource(), AVATAR_A, `${mode}: the avatar still renders`);
  }
});

test('changing or removing the avatar invalidates the stored preview', async () => {
  const harness = bootHarness({
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
  });
  connect(harness, WALLET_A);
  await harness.flush();
  assert.ok(JSON.parse(harness.storage.get('artsoul_header_identity')).preview);

  // A changed avatar replaces the preview with one for the new source.
  harness.setProfile(WALLET_A, { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_B });
  await harness.dropdown.refresh(WALLET_A);
  await harness.flush();
  const afterChange = JSON.parse(harness.storage.get('artsoul_header_identity'));
  assert.equal(afterChange.avatarUrl, AVATAR_B);
  assert.equal(afterChange.preview.source, AVATAR_B, 'the preview must follow the new avatar');

  // A removed avatar leaves no preview at all.
  harness.setProfile(WALLET_A, { wallet_address: WALLET_A, username: 'Founder', avatar_url: null });
  await harness.dropdown.refresh(WALLET_A);
  await harness.flush();
  const afterRemoval = JSON.parse(harness.storage.get('artsoul_header_identity'));
  assert.equal(afterRemoval.avatarUrl, NEUTRAL_AVATAR);
  assert.equal(afterRemoval.preview, undefined, 'a removed avatar must not keep a preview');
  assert.equal(harness.avatarSrc(), NEUTRAL_AVATAR);
  assert.equal(harness.avatarName(), 'Founder');
});

test('an explicit disconnect followed by a reload never resurrects the connected visual', async () => {
  const harness = bootHarness({
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
  });
  connect(harness, WALLET_A);
  await harness.flush();
  assert.ok(JSON.parse(harness.storage.get('artsoul_header_identity')).preview);

  disconnect(harness);
  await harness.flush();
  assert.equal(harness.storage.get('artsoul_header_identity'), undefined, 'disconnect clears the cached identity');
  assert.equal(harness.storage.get('artsoul_header_ui_state'), 'disconnected');

  // The next document boots from exactly what the disconnect left behind.
  const reloaded = bootHarness({ settled: false, storage: Object.fromEntries(harness.storage) });
  const { history, record } = track(reloaded);
  record();
  reloaded.dropdown.renderInitializingState();
  await reloaded.flush();

  assert.equal(reloaded.avatarSrc(), NEUTRAL_AVATAR);
  assert.equal(reloaded.avatarName(), 'ArtSoul Guest');
  assert.equal(reloaded.uiState(), 'disconnected');
  for (const state of history) {
    assert.notEqual(state.name, 'Founder', 'the connected visual must never come back');
    assert.equal(state.imgSrc, NEUTRAL_AVATAR);
  }
});

test('the preview contract is pinned in the component source', () => {
  const component = fs.readFileSync(path.join(ROOT, 'avatar-dropdown.js'), 'utf8');
  assert.match(component, /const AVATAR_PREVIEW_MAX_LENGTH = 32 \* 1024;/);
  assert.match(component, /const AVATAR_PREVIEW_PATTERN = \/\^data:image\\\/\(\?:png\|jpeg\|webp\);base64,\[A-Za-z0-9\+\/\]\+=\{0,2\}\$\/;/);
  assert.match(component, /const AVATAR_PREVIEW_EDGE_PX = 64;/);
  // Bound to wallet, display name and the original avatar URL on every read.
  assert.match(component, /if \(String\(preview\.wallet \|\| ''\)\.toLowerCase\(\) !== normalizedWallet\) return null;/);
  assert.match(component, /if \(preview\.name !== name\) return null;/);
  assert.match(component, /if \(preview\.source !== avatarUrl\) return null;/);
  assert.match(component, /if \(dataUri\.length > AVATAR_PREVIEW_MAX_LENGTH\) return null;/);
  // No second request: the capture reads the image the header already decoded.
  assert.match(component, /const dataUri = this\.captureAvatarPreview\(preloader\);/);
  // Never a dependency, a fetch, a timer or a worker for any of this.
  assert.doesNotMatch(component, /new Worker|serviceWorker|setInterval/);
});

test('every shared-header page and both themes keep one stable button geometry', () => {
  const css = fs.readFileSync(path.join(ROOT, 'unified-styles.css'), 'utf8');
  assert.match(css, /\.site-header #navButtons \.avatar-button \{[\s\S]*?width: 180px !important;[\s\S]*?height: 42px !important;/);
  assert.match(css, /\.site-header #navButtons \.avatar-button \{[\s\S]*?width: 48px !important;[\s\S]*?height: 42px !important;/);
  // Classic stays animation-free: nothing was hidden behind a fade.
  assert.match(css, /\.classic[\s\S]{0,400}?\.avatar-button,[\s\S]{0,200}?animation: none !important;/);
  assert.doesNotMatch(css, /\[data-wallet-ui-state="restoring"\][^{]*\{[^}]*(?:opacity|transition|animation)/);
  for (const page of SHARED_HEADER_PAGES) {
    const html = readPage(page);
    assert.equal((html.match(/class="avatar-button"/g) || []).length, 1, `${page}: one account button`);
    assert.equal((html.match(/data-avatar-image/g) || []).length, 1, `${page}: one avatar image`);
  }
});

test('the account menu hydrates itself once the document is parsed', () => {
  const source = fs.readFileSync(path.join(ROOT, 'avatar-dropdown.js'), 'utf8');

  // Deferred scripts normally run after parsing, but the same file is also
  // loaded by pages that may already be interactive, so both states are
  // covered rather than assuming one.
  assert.match(source, /document\.readyState === 'loading'/);
  assert.match(source, /addEventListener\('DOMContentLoaded', \(\) => window\.AvatarDropdown\.renderInitializingState\(\), \{ once: true \}\)/);
});
