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
 * `identityTextHidden` mirrors the one CSS rule that withholds content during
 * hydration; the css-contract test below pins that rule to the identity text
 * only, so the avatar and the button shell are always on screen.
 */
function snapshot(harness) {
  const button = harness.button();
  const image = harness.avatarImage();
  return {
    hasButton: !!button,
    childCount: button ? button.children.length : 0,
    imgSrc: image ? (image.getAttribute('src') || '') : null,
    imgHiddenByClass: image ? image.classList.contains('avatar-image-loading') : false,
    identityTextHidden: harness.documentElement.classList.contains('wallet-state-resolving'),
    name: harness.avatarName(),
    address: harness.avatarAddress(),
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
  harness.dispatchWalletState({ address, chainId: 84532, isConnected: true });
}

function disconnect(harness) {
  harness.context.window.artsoulWalletStateSettled = true;
  harness.context.window.currentWalletAddress = null;
  harness.context.window.artsoulSettledWalletState = { address: null, chainId: null, isConnected: false };
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
    assert.deepEqual(transitions(history, 'name'), ['ArtSoul Guest', 'Founder']);
    // The guest name is only ever on screen while nothing claims a connection.
    for (const state of history) {
      if (state.name === 'ArtSoul Guest') assert.notEqual(state.uiState, 'connected');
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
  assert.deepEqual(transitions(history, 'uiState'), [null, 'connected', 'disconnected']);
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
    assert.match(html, /<link rel="stylesheet" href="unified-styles\.css\?v=43">/, `${page} stylesheet pin`);
    assert.match(html, /<script src="avatar-dropdown\.js\?v=44"><\/script>/, `${page} component pin`);

    const stylesheet = html.indexOf('unified-styles.css?v=43');
    const component = html.indexOf('avatar-dropdown.js?v=44');
    const appkit = html.indexOf('appkit-init.js?v=');
    const shell = html.indexOf('<div id="navButtons"');
    const hydration = html.indexOf('window.AvatarDropdown?.renderInitializingState();');

    // The stylesheet must be render-blocking before the shell exists, the
    // component must be a synchronous head script that runs before the shell is
    // parsed, and hydration must run immediately after the shell — otherwise a
    // page can paint an identity the others never show.
    assert.ok(stylesheet < component, `${page}: the stylesheet must load before the component`);
    assert.ok(component < appkit, `${page}: the component must run before appkit-init`);
    assert.ok(appkit < shell, `${page}: the boot scripts must precede the header shell`);
    assert.ok(shell < hydration, `${page}: hydration must follow the static shell`);
  }
});

// ---------------------------------------------------------------------------
// 9 — the CSS and head-boot contracts the behaviour above depends on
// ---------------------------------------------------------------------------

test('hydration withholds the identity text only, never the whole account button', () => {
  const css = fs.readFileSync(path.join(ROOT, 'unified-styles.css'), 'utf8');
  // The retired rule blanked every child, which on mobile (.avatar-info is
  // display:none) left an empty pill on every document navigation.
  assert.doesNotMatch(css, /wallet-state-resolving[^{]*\.avatar-button > \*/);
  assert.match(css, /html\.wallet-state-resolving \.site-header #navButtons \.avatar-info > \* \{\s*visibility: hidden !important;/);
  // Nothing may hide the account-button image any more.
  assert.doesNotMatch(css, /avatar-image-loading/);
  // The reserved geometry that makes a stable shell possible must stay.
  assert.match(css, /\.site-header #navButtons \.avatar-button \{[\s\S]*?width: 164px !important;/);
  assert.match(css, /\.site-header #navButtons \.avatar-button > img \{[\s\S]*?width: 30px !important;/);
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
  assert.equal(harness.avatarName(), 'Founder');
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
  // The visible image is unchanged: still the canonical avatar, never blank.
  assert.equal(harness.avatarSrc(), NEUTRAL_AVATAR, 'load alone must not commit');
  assertNeverFlickers(history, 'load pending decode');
  // Identity text is already correct; only the picture waits.
  assert.equal(harness.avatarName(), 'Founder');
  assert.equal(harness.uiState(), 'connected');

  // 2 — the swap happens only once decode resolves.
  harness.releaseDecodes();
  await harness.flush();

  assert.deepEqual(harness.decodeCalls, [AVATAR_A]);
  assert.equal(harness.avatarSrc(), AVATAR_A);
  assertNeverFlickers(history, 'decode resolved');
  assertMonotonic(history, 'imgSrc', 'decode resolved');
  assert.deepEqual(transitions(history, 'imgSrc'), [NEUTRAL_AVATAR, AVATAR_A]);
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
  assert.match(
    component,
    /preloader\.decode\(\)\.then\(\s*\(\) => commit\(nextUrl, false\),\s*\(\) => commit\(neutral, true\)\s*\);/
  );
  assert.match(component, /if \(typeof preloader\.decode !== 'function'\) \{\s*commit\(nextUrl, false\);/);
});
