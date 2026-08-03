// A-45 shared header avatar/identity consistency.
//
// Production symptom (iPhone Chrome): the account menu showed Base Sepolia, a
// balance and Disconnect — so the wallet was connected — while the circular
// account button kept the generated ArtSoul "A" fallback instead of the
// connected user's profile avatar.
//
// Root cause: the shared header had no way to express "connected, but the
// profile identity never resolved". sync() early-returned on an unchanged
// wallet+chain render key, refresh() never forwarded its cache-busting flag to
// init(), a null read was cached for the whole page lifetime, and a failed
// image stamped a content key claiming the requested avatar had rendered. A
// single transient profile read failure was therefore permanent.
//
// These tests drive the real avatar-dropdown.js through the shared DOM harness
// (test/helpers/avatar-dropdown-harness.cjs) and assert observed component
// behaviour. Source-text assertions live in guest-avatar.test.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createAvatarHarness } = require('./helpers/avatar-dropdown-harness.cjs');

const WALLET_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const WALLET_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const AVATAR_A = 'https://cdn.artsoul.test/avatar-a.png';
const AVATAR_B = 'https://cdn.artsoul.test/avatar-b.png';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 CriOS/126.0';

const SHARED_HEADER_PAGES = [
  'index.html',
  'gallery.html',
  'artwork.html',
  'profile.html',
  'upload.html',
  'admin.html',
  'docs-protocol.html'
];

// The one canonical ArtSoul avatar. The previously generated stylized "A"
// data-URI was removed: it read as a third identity state and was mistaken for
// a stale cached avatar.
const NEUTRAL_AVATAR = '/default-avatar.png';
const STYLIZED_A = /^data:image\/svg\+xml,/;

/** No surface may ever paint the retired stylized "A". */
function assertNoStylizedA(harness) {
  assert.doesNotMatch(harness.avatarSrc(), STYLIZED_A, 'the stylized "A" must never render');
  for (const src of harness.imageLoads) {
    assert.doesNotMatch(src, STYLIZED_A, 'the stylized "A" must never even be requested');
  }
}

function connectedHarness(options = {}) {
  const harness = createAvatarHarness({
    userAgent: IPHONE_UA,
    pathname: '/gallery.html',
    ...options
  });
  const { window } = harness.context;
  window.currentChainId = 84532;
  window.isArtSoulBaseSepoliaConfirmed = () => true;
  return harness;
}

function connect(harness, address) {
  harness.context.window.currentWalletAddress = address;
  harness.context.window.artsoulSettledWalletState = { address, chainId: 84532, isConnected: true };
  harness.dispatchWalletState({ address, chainId: 84532, isConnected: true });
}

/** The header must never present a connected wallet as a disconnected guest. */
function assertConnectedIdentity(harness, address) {
  assert.equal(harness.uiState(), 'connected');
  assert.notEqual(harness.avatarName(), 'ArtSoul Guest');
  assert.equal(harness.avatarAddress(), `${address.slice(0, 6)}...${address.slice(-4)}`);
  assert.match(harness.menuHtml(), /Disconnect/);
  assert.doesNotMatch(harness.menuHtml(), /Connect Wallet/);
}

// 1 — connected wallet + profile avatar
test('connected wallet with a profile avatar displays that avatar', async () => {
  const harness = connectedHarness({
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
  });
  connect(harness, WALLET_A);
  await harness.flush();

  assert.equal(harness.avatarSrc(), AVATAR_A);
  assert.equal(harness.avatarName(), 'Founder');
  assertConnectedIdentity(harness, WALLET_A);
  // Identity, network, balance and Disconnect all describe the same wallet.
  assert.match(harness.menuHtml(), /Base Sepolia/);
  assert.match(harness.menuHtml(), /data-network-balance/);
});

// 2 — connected wallet + no avatar
test('connected wallet without an avatar shows the connected-user fallback, never guest', async () => {
  const harness = connectedHarness({
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: null } }
  });
  connect(harness, WALLET_A);
  await harness.flush();

  assert.equal(harness.avatarSrc(), NEUTRAL_AVATAR);
  assertNoStylizedA(harness);
  assert.equal(harness.avatarName(), 'Founder');
  assertConnectedIdentity(harness, WALLET_A);
});

// 3 — cached fallback followed by a successful live profile
test('a cached header identity is replaced by the live profile once the wallet settles', async () => {
  const harness = createAvatarHarness({
    userAgent: IPHONE_UA,
    pathname: '/gallery.html',
    settled: false,
    storage: {
      artsoul_wallet: WALLET_A,
      artsoul_header_ui_state: 'connected',
      artsoul_header_identity: JSON.stringify({
        wallet: WALLET_A,
        name: 'Founder',
        avatarUrl: AVATAR_A
      })
    },
    profiles: {
      [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder Renamed', avatar_url: AVATAR_B }
    }
  });
  harness.context.window.currentChainId = 84532;
  harness.context.window.isArtSoulBaseSepoliaConfirmed = () => true;

  harness.dropdown.renderInitializingState();
  await harness.flush();
  // Restoring from cache still reads as a connected identity, not as a guest.
  // 'restoring' is a cached presentation of this exact wallet; it authorizes
  // nothing until the provider settles.
  assert.equal(harness.avatarSrc(), AVATAR_A);
  assert.equal(harness.avatarName(), 'Founder');
  assert.equal(harness.uiState(), 'restoring');

  harness.context.window.artsoulWalletStateSettled = true;
  connect(harness, WALLET_A);
  await harness.flush();

  assert.equal(harness.avatarSrc(), AVATAR_B);
  assert.equal(harness.avatarName(), 'Founder Renamed');
  assertConnectedIdentity(harness, WALLET_A);
});

// 4 — requested avatar load error followed by a successful retry
test('an avatar image error falls back but never suppresses a later retry', async () => {
  const harness = connectedHarness({
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } },
    failingImages: [AVATAR_A]
  });
  connect(harness, WALLET_A);
  await harness.flush();

  // The fallback is displayed, but the wallet still reads as connected.
  assert.equal(harness.avatarSrc(), NEUTRAL_AVATAR);
  assertNoStylizedA(harness);
  assertConnectedIdentity(harness, WALLET_A);
  // Two attempts for a broken avatar: the CORS-aware request that would also
  // feed the paint-ready preview, then the single bounded retry without CORS so
  // a host that sends no CORS headers still renders. Both fail here.
  assert.equal(harness.imageLoads.filter(src => src === AVATAR_A).length, 2);
  // The stamped key records the failure instead of claiming a successful render.
  assert.match(harness.button().dataset.avatarContentKey, /\|image-error$/);

  harness.allowImage(AVATAR_A);
  await harness.dropdown.refresh(WALLET_A);
  await harness.flush();

  assert.equal(harness.avatarSrc(), AVATAR_A);
  // Two requests per successful render: the off-screen decode, then the visible
  // <img> assignment that the browser serves from the same cache entry. The
  // failed first attempt contributed one. What matters is that the retry
  // actually re-requested the avatar instead of being suppressed.
  assert.equal(harness.imageLoads.filter(src => src === AVATAR_A).length, 4);
});

// 5 — profile/avatar update while wallet and chain are unchanged
test('a newer profile updates the button even though wallet and chain never changed', async () => {
  const harness = connectedHarness({
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
  });
  connect(harness, WALLET_A);
  await harness.flush();
  assert.equal(harness.avatarSrc(), AVATAR_A);
  const readsBefore = harness.profileCalls.length;

  // Exactly what profile.jsx saveProfile() now does after a successful write.
  harness.setProfile(WALLET_A, { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_B });
  await harness.dropdown.refresh(WALLET_A);
  await harness.flush();

  assert.equal(harness.avatarSrc(), AVATAR_B);
  assert.equal(harness.profileCalls.length, readsBefore + 1, 'refresh() must actually re-read the profile');
  assertConnectedIdentity(harness, WALLET_A);
});

// 6 — repeated identical wallet-state events stay cheap
test('repeated identical wallet-state events issue no further profile or balance reads', async () => {
  const harness = connectedHarness({
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
  });
  connect(harness, WALLET_A);
  await harness.flush();
  const profileReads = harness.profileCalls.length;
  const balanceReads = harness.balanceCalls.length;
  assert.equal(profileReads, 1);

  for (let i = 0; i < 5; i += 1) {
    harness.dispatchWalletState({ address: WALLET_A, chainId: 84532, isConnected: true });
  }
  await harness.flush();

  assert.equal(harness.profileCalls.length, profileReads, 'resolved identity must not re-read');
  assert.equal(harness.balanceCalls.length, balanceReads, 'resolved identity must not re-poll balance');
  assert.equal(harness.avatarSrc(), AVATAR_A);
});

// 7 — Gallery tab / hash transition while connected
test('gallery tab and hash transitions keep the connected identity and cost nothing', async () => {
  const harness = connectedHarness({
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
  });
  connect(harness, WALLET_A);
  await harness.flush();
  const profileReads = harness.profileCalls.length;

  // gallery.jsx switches tabs through React state plus the location hash; it
  // never owns header identity. Every tab must leave the header untouched.
  for (const hash of ['#live_auctions', '#nft', '#discover', '#marketplace', '#collections']) {
    harness.context.window.location.hash = hash;
    harness.triggerMutationObservers();
    await harness.flush();
    assert.equal(harness.avatarSrc(), AVATAR_A, `avatar must survive ${hash}`);
    assert.equal(harness.avatarName(), 'Founder', `name must survive ${hash}`);
    assertConnectedIdentity(harness, WALLET_A);
  }
  assert.equal(harness.profileCalls.length, profileReads, 'tab switching must not re-read the profile');
});

// 8 — shared header DOM restoration / re-render
test('a replaced shared header is rebuilt as the connected identity, not as a guest', async () => {
  const harness = connectedHarness({
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
  });
  connect(harness, WALLET_A);
  await harness.flush();

  // A page re-render wipes the nav container the shared header lives in.
  harness.navButtons.innerHTML = '';
  harness.triggerMutationObservers();
  await harness.flush();

  // The rebuild restores wallet A's avatar. It may paint the paint-ready local
  // preview of it instead of re-fetching, so assert the logical source.
  assert.equal(harness.avatarSource(), AVATAR_A);
  assert.equal(harness.avatarName(), 'Founder');
  assertConnectedIdentity(harness, WALLET_A);
});

// 9 — slow response for wallet A after switching to wallet B
test('a late profile response for the previous wallet never overwrites the current one', async () => {
  const harness = connectedHarness({
    profiles: {
      [WALLET_A]: { wallet_address: WALLET_A, username: 'Alpha', avatar_url: AVATAR_A },
      [WALLET_B]: { wallet_address: WALLET_B, username: 'Bravo', avatar_url: AVATAR_B }
    }
  });

  // Wallet A's read is still in flight when the user switches to wallet B.
  const releaseA = harness.holdProfileReads();
  connect(harness, WALLET_A);
  connect(harness, WALLET_B);
  releaseA();
  await harness.flush();

  assert.equal(harness.avatarSrc(), AVATAR_B, 'wallet B must keep its own avatar');
  assert.equal(harness.avatarName(), 'Bravo');
  assert.equal(harness.dropdown.profile?.wallet_address, WALLET_B);
  assertConnectedIdentity(harness, WALLET_B);
  assert.doesNotMatch(harness.avatarSrc(), /avatar-a/, 'wallet A avatar must not leak');
});

test('a superseded response never rewrites stored identity or component cache', async () => {
  // Deterministic ordering with independently controlled promises: wallet B must
  // resolve BEFORE wallet A. Releasing both together (as the test above does)
  // hides the defect, because A's write lands before B's.
  const harness = connectedHarness({});
  const rows = {
    [WALLET_A]: { wallet_address: WALLET_A, username: 'Alpha', avatar_url: AVATAR_A },
    [WALLET_B]: { wallet_address: WALLET_B, username: 'Bravo', avatar_url: AVATAR_B }
  };
  const gates = {};
  for (const wallet of [WALLET_A, WALLET_B]) {
    let release;
    gates[wallet] = { promise: new Promise(resolve => { release = resolve; }) };
    gates[wallet].release = () => release(rows[wallet]);
  }
  harness.setProfileBehaviour(wallet => gates[wallet].promise);

  // 1 — start wallet A's read, 2 — switch to wallet B while it is in flight.
  connect(harness, WALLET_A);
  connect(harness, WALLET_B);

  // 3 — resolve B first.
  gates[WALLET_B].release();
  await harness.flush();

  // 4 — UI and stored identity are B.
  assert.equal(harness.avatarSrc(), AVATAR_B);
  assert.equal(harness.avatarName(), 'Bravo');
  assert.equal(JSON.parse(harness.storage.get('artsoul_header_identity')).wallet, WALLET_B);

  // 5 — wallet A's superseded response lands afterwards.
  gates[WALLET_A].release();
  await harness.flush();

  // 6 — the UI is still B.
  assert.equal(harness.avatarSrc(), AVATAR_B, 'superseded A must not repaint the header');
  assert.equal(harness.avatarName(), 'Bravo');
  assert.equal(harness.dropdown.profile?.wallet_address, WALLET_B);
  assertConnectedIdentity(harness, WALLET_B);

  // 7 — the stored identity is still B, and B's own identity was not erased.
  const stored = JSON.parse(harness.storage.get('artsoul_header_identity'));
  assert.equal(stored.wallet, WALLET_B);
  assert.equal(stored.avatarUrl, AVATAR_B);

  // 8 — the superseded result did not reintroduce A into component state.
  assert.equal(harness.dropdown.profileCache.has(WALLET_A), false, 'A must not be re-cached');
  assert.equal(harness.dropdown.identityWallet, WALLET_B);
  assert.equal(harness.dropdown.resolvedIdentityWallet, WALLET_B);
});

// 10 — disconnect after a connected profile state
test('disconnect clears wallet-bound identity and renders guest deterministically', async () => {
  const harness = connectedHarness({
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
  });
  connect(harness, WALLET_A);
  await harness.flush();
  assert.equal(harness.avatarSrc(), AVATAR_A);
  assert.ok(harness.storage.get('artsoul_header_identity'));

  harness.context.window.currentWalletAddress = null;
  harness.context.window.artsoulSettledWalletState = { address: null, chainId: null, isConnected: false };
  harness.dispatchWalletState({ address: null, chainId: null, isConnected: false });
  await harness.flush();

  assert.equal(harness.uiState(), 'disconnected');
  assert.equal(harness.avatarName(), 'ArtSoul Guest');
  assert.equal(harness.avatarSrc(), '/default-avatar.png');
  assert.equal(harness.avatarAddress(), '');
  assert.match(harness.menuHtml(), /Connect Wallet/);
  assert.equal(harness.dropdown.profile, null);
  assert.equal(harness.storage.get('artsoul_header_identity'), undefined);

  // Reconnecting the same wallet restores the real identity from a clean state.
  connect(harness, WALLET_A);
  await harness.flush();
  assert.equal(harness.avatarSrc(), AVATAR_A);
  assertConnectedIdentity(harness, WALLET_A);
});

test('an early guest hydration render preserves a stored identity (A-05 flicker guard)', async () => {
  // renderConnectButton also runs during hydration before the wallet settles.
  // Clearing the stored identity there would repaint guest on the next load.
  const harness = createAvatarHarness({
    userAgent: IPHONE_UA,
    pathname: '/gallery.html',
    settled: false,
    storage: {
      artsoul_header_identity: JSON.stringify({ wallet: WALLET_A, name: 'Founder', avatarUrl: AVATAR_A })
    }
  });

  harness.dropdown.renderInitializingState();
  await harness.flush();

  assert.equal(harness.uiState(), 'disconnected');
  assert.ok(harness.storage.get('artsoul_header_identity'), 'stored identity must survive guest hydration');
});

// 11 — profile fetch failure and later recovery (the production defect)
test('a failed profile read keeps a connected fallback and recovers on a later refresh', async () => {
  const harness = connectedHarness({
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
  });
  // The backend stays down long enough to exhaust the bounded retry schedule,
  // so the unresolved shell can be observed before any recovery lands.
  let healthy = false;
  harness.setProfileBehaviour(() => (
    healthy ? undefined : Promise.reject(new Error('profile backend unavailable'))
  ));

  connect(harness, WALLET_A);
  await harness.flush();

  // The exact production symptom: connected menu, neutral avatar, no identity.
  assert.equal(harness.avatarSrc(), NEUTRAL_AVATAR);
  assertNoStylizedA(harness);
  assert.equal(harness.avatarName(), 'ArtSoul User');
  assertConnectedIdentity(harness, WALLET_A);
  assert.match(harness.menuHtml(), /Base Sepolia/);
  // The failure must not be cached, or every later attempt would be a no-op.
  assert.equal(harness.dropdown.profileCache.has(WALLET_A), false);
  assert.equal(harness.dropdown.resolvedIdentityWallet, null);
  // The automatic budget is spent; nothing is still armed.
  assert.equal(harness.profileCalls.length, 3);
  assert.equal(harness.pendingTimerCount(), 0);

  // Recovery path: an explicit refresh() once the backend is healthy again.
  healthy = true;
  await harness.dropdown.refresh(WALLET_A);
  await harness.flush();
  assert.equal(harness.avatarSrc(), AVATAR_A);
  assert.equal(harness.avatarName(), 'Founder');
  assert.equal(harness.dropdown.resolvedIdentityWallet, WALLET_A);
});

test('opening the account menu recovers an unresolved identity exactly once', async () => {
  const harness = connectedHarness({
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
  });
  // Keep the backend down until the bounded automatic schedule is exhausted,
  // so this test still proves the user-gesture path rather than the timer.
  let healthy = false;
  harness.setProfileBehaviour(() => (
    healthy ? undefined : Promise.reject(new Error('profile backend unavailable'))
  ));

  connect(harness, WALLET_A);
  await harness.flush();
  assert.equal(harness.avatarSrc(), NEUTRAL_AVATAR);
  assertNoStylizedA(harness);
  assert.equal(harness.profileCalls.length, 3, 'automatic budget spent');

  // Recovery path: the founder opens the account menu. A user gesture is not
  // capped by the automatic budget.
  healthy = true;
  harness.dropdown.toggle();
  await harness.flush();
  assert.equal(harness.avatarSrc(), AVATAR_A);
  const readsAfterRecovery = harness.profileCalls.length;

  // Once resolved, further openings must never re-read.
  harness.dropdown.toggle();
  harness.dropdown.toggle();
  harness.dropdown.toggle();
  await harness.flush();
  assert.equal(harness.profileCalls.length, readsAfterRecovery);
});

test('unrelated document mutations never amplify into repeated profile reads', async () => {
  // The observer watches document.documentElement with subtree: true, so every
  // unrelated React render is a mutation. Treating those as retry opportunities
  // would turn a persistently failing backend into an unbounded event-driven
  // retry loop — no timer needed.
  const harness = connectedHarness({
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
  });
  harness.setProfileBehaviour(() => Promise.reject(new Error('profile backend down')));

  connect(harness, WALLET_A);
  await harness.flush();
  // The bounded automatic schedule has run to completion: 1 initial + 2 retries.
  const readsAfterFailure = harness.profileCalls.length;
  assert.equal(readsAfterFailure, 3);
  assert.equal(harness.pendingTimerCount(), 0);
  assert.equal(harness.dropdown.resolvedIdentityWallet, null, 'identity must stay unresolved');

  // The header survived; only unrelated page content changed.
  for (let i = 0; i < 5; i += 1) {
    harness.triggerMutationObservers();
    await harness.flush();
  }

  assert.equal(
    harness.profileCalls.length,
    readsAfterFailure,
    'a surviving header plus unrelated mutations must not start another read'
  );
  // The connected fallback is still correct throughout.
  assertConnectedIdentity(harness, WALLET_A);
});

test('a removed shared header still rebuilds and recovers, without repeated reads', async () => {
  const harness = connectedHarness({
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
  });
  let healthy = false;
  harness.setProfileBehaviour(() => (
    healthy ? undefined : Promise.reject(new Error('profile backend down'))
  ));

  connect(harness, WALLET_A);
  await harness.flush();
  assert.equal(harness.avatarSrc(), NEUTRAL_AVATAR);
  assertNoStylizedA(harness);
  assert.equal(harness.profileCalls.length, 3, 'automatic budget spent');

  // Unrelated mutations still cost nothing once the schedule is exhausted.
  harness.triggerMutationObservers();
  await harness.flush();
  assert.equal(harness.profileCalls.length, 3);

  // The header is genuinely removed — the intended rebuild path recovers it.
  healthy = true;
  harness.navButtons.innerHTML = '';
  harness.triggerMutationObservers();
  await harness.flush();

  assert.equal(harness.avatarSrc(), AVATAR_A);
  assert.equal(harness.avatarName(), 'Founder');
  assertConnectedIdentity(harness, WALLET_A);
  const readsAfterRebuild = harness.profileCalls.length;

  // Once resolved, further mutations are free again.
  for (let i = 0; i < 5; i += 1) {
    harness.triggerMutationObservers();
    await harness.flush();
  }
  assert.equal(harness.profileCalls.length, readsAfterRebuild);
});

test('a wallet with no profile row resolves and stays cheap', async () => {
  // A confirmed-absent profile is a resolved identity: the connected fallback is
  // correct and repeat events must not retry it forever.
  const harness = connectedHarness({});
  connect(harness, WALLET_A);
  await harness.flush();

  assert.equal(harness.dropdown.resolvedIdentityWallet, WALLET_A);
  assert.equal(harness.avatarName(), 'ArtSoul User');
  assertConnectedIdentity(harness, WALLET_A);

  const reads = harness.profileCalls.length;
  harness.dispatchWalletState({ address: WALLET_A, chainId: 84532, isConnected: true });
  harness.dropdown.toggle();
  harness.triggerMutationObservers();
  await harness.flush();
  assert.equal(harness.profileCalls.length, reads);
});

// ---------------------------------------------------------------------------
// ArtSoulDB readiness race (A-45 P1-2 / P1-3).
//
// avatar-dropdown.js is a synchronous head script; supabase-client.js is a
// deferred module. A wallet can therefore be confirmed before window.ArtSoulDB
// exists. That is an UNRESOLVED identity — not a failed profile, not guest —
// and it must resolve itself when the backend announces readiness.
// ---------------------------------------------------------------------------

test('a wallet confirmed before ArtSoulDB exists renders connected, never guest and never a stylized A', async () => {
  const harness = connectedHarness({
    dbReady: false,
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
  });
  assert.equal(harness.context.window.ArtSoulDB, undefined);

  connect(harness, WALLET_A);
  await harness.flush();

  // No exception escaped and no profile read was attempted against a missing API.
  assert.equal(harness.profileCalls.length, 0);
  assertConnectedIdentity(harness, WALLET_A);
  assert.notEqual(harness.uiState(), 'disconnected');
  assert.equal(harness.avatarSrc(), NEUTRAL_AVATAR);
  assertNoStylizedA(harness);
  assert.equal(harness.dropdown.resolvedIdentityWallet, null, 'identity must stay unresolved');
});

test('ArtSoulDB readiness resolves the avatar without opening the menu or any wallet event', async () => {
  const harness = connectedHarness({
    dbReady: false,
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
  });
  connect(harness, WALLET_A);
  await harness.flush();
  assert.equal(harness.avatarSrc(), NEUTRAL_AVATAR);

  // Only the readiness signal — no menu toggle, no wallet-state event, no DOM
  // rebuild, no mutation observer.
  harness.makeDbReady();
  await harness.flush();

  assert.equal(harness.avatarSrc(), AVATAR_A);
  assert.equal(harness.avatarName(), 'Founder');
  assert.equal(harness.dropdown.resolvedIdentityWallet, WALLET_A);
  assert.equal(harness.dropdown.isOpen, false, 'the menu was never opened');
  assertConnectedIdentity(harness, WALLET_A);
  assertNoStylizedA(harness);
});

test('duplicate ArtSoulDB readiness signals stay deterministically bounded', async () => {
  const harness = connectedHarness({ dbReady: false });
  // The backend is ready but every read fails, so the identity never resolves
  // and each duplicate signal is a fresh recovery opportunity.
  harness.setProfileBehaviour(() => Promise.reject(new Error('profile backend down')));

  connect(harness, WALLET_A);
  await harness.flush();
  assert.equal(harness.profileCalls.length, 0);

  harness.makeDbReady();
  await harness.flush();
  for (let i = 0; i < 10; i += 1) {
    harness.dispatchDbReady();
    await harness.flush();
  }

  // Hard ceiling: MAX_AUTOMATIC_IDENTITY_RECOVERIES per wallet generation.
  assert.equal(harness.profileCalls.length, 2, 'automatic recoveries must be capped at 2');
  assert.equal(harness.dropdown.automaticRecoveries, 2);
  assertConnectedIdentity(harness, WALLET_A);
  assertNoStylizedA(harness);
});

test('a wallet change resets the recovery budget and isolates the previous wallet', async () => {
  const harness = connectedHarness({
    dbReady: false,
    profiles: { [WALLET_B]: { wallet_address: WALLET_B, username: 'Bravo', avatar_url: AVATAR_B } }
  });
  connect(harness, WALLET_A);
  await harness.flush();

  connect(harness, WALLET_B);
  await harness.flush();
  assert.equal(harness.dropdown.automaticRecoveries, 0, 'a new wallet gets a fresh budget');

  harness.makeDbReady();
  await harness.flush();

  assert.equal(harness.avatarSrc(), AVATAR_B);
  assert.equal(harness.profileCalls.every(wallet => wallet === WALLET_B), true, 'wallet A must never be read');
  assertConnectedIdentity(harness, WALLET_B);
});

test('a late profile response for the previous wallet cannot render or persist after readiness', async () => {
  const harness = connectedHarness({
    profiles: {
      [WALLET_A]: { wallet_address: WALLET_A, username: 'Alpha', avatar_url: AVATAR_A },
      [WALLET_B]: { wallet_address: WALLET_B, username: 'Bravo', avatar_url: AVATAR_B }
    }
  });
  const gates = {};
  for (const wallet of [WALLET_A, WALLET_B]) {
    let release;
    gates[wallet] = { promise: new Promise(resolve => { release = resolve; }) };
    gates[wallet].release = () => release(
      wallet === WALLET_A
        ? { wallet_address: WALLET_A, username: 'Alpha', avatar_url: AVATAR_A }
        : { wallet_address: WALLET_B, username: 'Bravo', avatar_url: AVATAR_B }
    );
  }
  harness.setProfileBehaviour(wallet => gates[wallet].promise);

  connect(harness, WALLET_A);
  connect(harness, WALLET_B);
  gates[WALLET_B].release();
  await harness.flush();
  assert.equal(harness.avatarSrc(), AVATAR_B);

  gates[WALLET_A].release();
  await harness.flush();

  assert.equal(harness.avatarSrc(), AVATAR_B, 'wallet A must not render over B');
  assert.equal(JSON.parse(harness.storage.get('artsoul_header_identity')).wallet, WALLET_B);
  assert.equal(harness.dropdown.profileCache.has(WALLET_A), false);
});

test('a disconnect while a profile read is pending cannot restore the connected avatar', async () => {
  const harness = connectedHarness({
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
  });
  const release = harness.holdProfileReads();

  connect(harness, WALLET_A);
  // The user disconnects while wallet A's read is still in flight.
  harness.context.window.currentWalletAddress = null;
  harness.context.window.artsoulSettledWalletState = { address: null, chainId: null, isConnected: false };
  harness.dispatchWalletState({ address: null, chainId: null, isConnected: false });
  await harness.flush();
  assert.equal(harness.uiState(), 'disconnected');

  // Wallet A's response lands after the disconnect.
  release();
  await harness.flush();

  assert.equal(harness.uiState(), 'disconnected', 'a late read must not reconnect the header');
  assert.equal(harness.avatarName(), 'ArtSoul Guest');
  assert.equal(harness.avatarSrc(), NEUTRAL_AVATAR);
  assert.equal(harness.avatarAddress(), '');
  assert.equal(harness.dropdown.profile, null);
  assert.equal(harness.storage.get('artsoul_header_identity'), undefined);

  // A readiness signal after the disconnect must not resurrect anything.
  harness.dispatchDbReady();
  await harness.flush();
  assert.equal(harness.uiState(), 'disconnected');
});

test('ArtSoulDB already ready before initialization resolves normally', async () => {
  const harness = connectedHarness({
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
  });
  assert.notEqual(harness.context.window.ArtSoulDB, undefined);

  connect(harness, WALLET_A);
  await harness.flush();

  assert.equal(harness.avatarSrc(), AVATAR_A);
  assert.equal(harness.profileCalls.length, 1);
  assert.equal(harness.dropdown.automaticRecoveries, 0, 'no recovery was needed');
  assertConnectedIdentity(harness, WALLET_A);
});

test('an unresolved identity keeps the cached avatar only for the same normalized address', async () => {
  // Wallet A's identity is cached from an earlier visit, but the header is
  // restoring wallet B: B must NOT inherit A's avatar.
  const harness = connectedHarness({
    dbReady: false,
    storage: {
      artsoul_header_identity: JSON.stringify({ wallet: WALLET_A, name: 'Alpha', avatarUrl: AVATAR_A })
    }
  });

  connect(harness, WALLET_B);
  await harness.flush();
  assert.equal(harness.avatarSrc(), NEUTRAL_AVATAR, 'wallet A avatar must not leak to wallet B');
  assert.doesNotMatch(harness.avatarSrc(), /avatar-a/);
  assertConnectedIdentity(harness, WALLET_B);

  // The same wallet, however, keeps its own confirmed avatar while unresolved.
  const sameWallet = connectedHarness({
    dbReady: false,
    storage: {
      artsoul_header_identity: JSON.stringify({ wallet: WALLET_A, name: 'Alpha', avatarUrl: AVATAR_A })
    }
  });
  connect(sameWallet, WALLET_A);
  await sameWallet.flush();
  assert.equal(sameWallet.avatarSrc(), AVATAR_A);
  assert.equal(sameWallet.avatarName(), 'Alpha');
  assertConnectedIdentity(sameWallet, WALLET_A);
});

test('a definitively absent profile uses the neutral avatar and never a stale cached one', async () => {
  const harness = connectedHarness({
    storage: {
      artsoul_header_identity: JSON.stringify({ wallet: WALLET_A, name: 'Alpha', avatarUrl: AVATAR_A })
    }
  });
  // ArtSoulDB is ready and answers definitively: this wallet has no profile.
  connect(harness, WALLET_A);
  await harness.flush();

  assert.equal(harness.dropdown.resolvedIdentityWallet, WALLET_A);
  assert.equal(harness.avatarSrc(), NEUTRAL_AVATAR, 'a definitive answer must not reuse the cache');
  assert.equal(harness.avatarName(), 'ArtSoul User');
  assertNoStylizedA(harness);
  assertConnectedIdentity(harness, WALLET_A);
});

test('a stale image error from the previous wallet cannot overwrite the current one', async () => {
  const harness = connectedHarness({
    profiles: {
      [WALLET_A]: { wallet_address: WALLET_A, username: 'Alpha', avatar_url: AVATAR_A },
      [WALLET_B]: { wallet_address: WALLET_B, username: 'Bravo', avatar_url: AVATAR_B }
    },
    failingImages: [AVATAR_A]
  });

  connect(harness, WALLET_A);
  connect(harness, WALLET_B);
  await harness.flush();

  // Wallet B is on screen; wallet A's image error must not have replaced it.
  assert.equal(harness.avatarSrc(), AVATAR_B);
  assert.equal(harness.avatarName(), 'Bravo');
  assert.doesNotMatch(harness.button().dataset.avatarContentKey, /image-error/);
  assertConnectedIdentity(harness, WALLET_B);
});

// ---------------------------------------------------------------------------
// Transient rejection from an ALREADY-READY backend (A-45 final blocker).
//
// 'artsoul:db-ready' cannot repair this path: supabase-client.js announces it
// exactly once, and on this path it has already fired. Without a retry of its
// own the identity stayed unresolved until the user opened the account menu.
// ---------------------------------------------------------------------------

test('a transient profile rejection self-heals without opening the account menu', async () => {
  const harness = connectedHarness({
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
  });
  let attempts = 0;
  harness.setProfileBehaviour(() => {
    attempts += 1;
    if (attempts === 1) return Promise.reject(new Error('transient network blip'));
    return undefined;
  });

  connect(harness, WALLET_A);
  await harness.flush();

  assert.equal(harness.avatarSrc(), AVATAR_A, 'the avatar must repair itself');
  assert.equal(harness.avatarName(), 'Founder');
  assert.equal(harness.dropdown.resolvedIdentityWallet, WALLET_A);
  assert.equal(harness.dropdown.isOpen, false, 'the menu was never opened');
  assert.equal(harness.profileCalls.length, 2);
  assert.equal(harness.dropdown.automaticRecoveries, 1);
  assertConnectedIdentity(harness, WALLET_A);
  assertNoStylizedA(harness);
});

test('a permanently failing backend is capped at three reads per wallet generation', async () => {
  const harness = connectedHarness({});
  harness.setProfileBehaviour(() => Promise.reject(new Error('profile backend down')));

  connect(harness, WALLET_A);
  await harness.flush();

  // One initial read plus MAX_AUTOMATIC_IDENTITY_RECOVERIES retries, then the
  // schedule stops permanently. A finite backoff, never a poll.
  assert.equal(harness.profileCalls.length, 3, 'reads must stop at 1 + 2');
  assert.equal(harness.dropdown.automaticRecoveries, 2);
  assert.deepEqual(harness.firedDelays(), [400, 1600], 'a pre-declared finite backoff');
  assert.equal(harness.pendingTimerCount(), 0, 'no retry may stay armed');

  // Further prodding costs nothing.
  harness.dispatchDbReady();
  harness.triggerMutationObservers();
  await harness.flush();
  assert.equal(harness.profileCalls.length, 3);

  // The wallet still reads as connected throughout.
  assertConnectedIdentity(harness, WALLET_A);
  assertNoStylizedA(harness);
  assert.equal(harness.dropdown.resolvedIdentityWallet, null);
});

test('only one retry is ever pending at a time', async () => {
  const harness = connectedHarness({});
  harness.setProfileBehaviour(() => Promise.reject(new Error('profile backend down')));

  connect(harness, WALLET_A);
  // Repeated wallet-state events while the first read is failing must not stack
  // timers on top of the one already scheduled.
  for (let i = 0; i < 5; i += 1) {
    harness.dispatchWalletState({ address: WALLET_A, chainId: 84532, isConnected: true });
  }
  await harness.flush();

  assert.equal(harness.pendingTimerCount(), 0);
  assert.ok(harness.profileCalls.length <= 3, `reads must stay capped, saw ${harness.profileCalls.length}`);
});

test('a wallet switch discards the pending retry of the previous wallet', async () => {
  const harness = connectedHarness({
    profiles: { [WALLET_B]: { wallet_address: WALLET_B, username: 'Bravo', avatar_url: AVATAR_B } }
  });
  harness.setProfileBehaviour(wallet => (
    wallet === WALLET_A ? Promise.reject(new Error('wallet A backend down')) : undefined
  ));

  connect(harness, WALLET_A);
  connect(harness, WALLET_B);
  await harness.flush();

  assert.equal(harness.avatarSrc(), AVATAR_B);
  assert.equal(harness.dropdown.resolvedIdentityWallet, WALLET_B);
  // Wallet A's retry budget and timer went with its generation.
  assert.equal(harness.profileCalls.filter(wallet => wallet === WALLET_A).length, 1);
  assert.equal(harness.pendingTimerCount(), 0);
  assertConnectedIdentity(harness, WALLET_B);
});

test('a disconnect discards the pending retry and cannot be revived by it', async () => {
  const harness = connectedHarness({
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
  });
  let attempts = 0;
  harness.setProfileBehaviour(() => {
    attempts += 1;
    if (attempts === 1) return Promise.reject(new Error('transient blip'));
    return undefined;
  });

  connect(harness, WALLET_A);
  // Disconnect before the scheduled retry can run.
  harness.context.window.currentWalletAddress = null;
  harness.context.window.artsoulSettledWalletState = { address: null, chainId: null, isConnected: false };
  harness.dispatchWalletState({ address: null, chainId: null, isConnected: false });
  await harness.flush();

  assert.equal(harness.uiState(), 'disconnected');
  assert.equal(harness.avatarName(), 'ArtSoul Guest');
  assert.equal(harness.avatarSrc(), NEUTRAL_AVATAR);
  assert.equal(harness.dropdown.profile, null);
  assert.equal(harness.pendingTimerCount(), 0);
});

// 12 — one consistent asset version across every shared-header page
test('every shared-header page loads the same avatar-dropdown asset version', () => {
  const versions = new Set();
  for (const page of SHARED_HEADER_PAGES) {
    const html = fs.readFileSync(path.join(__dirname, '..', page), 'utf8');
    const match = html.match(/avatar-dropdown\.js\?v=(\d+)/);
    assert.ok(match, `${page} must load the shared account menu with a cache-bust version`);
    versions.add(match[1]);
  }
  assert.equal(versions.size, 1, `all pages must share one version, found: ${[...versions].join(', ')}`);
});

test('profile save refreshes the shared header through the existing shared API', () => {
  const profileEntry = fs.readFileSync(path.join(__dirname, '..', 'src', 'entries', 'profile.jsx'), 'utf8');
  assert.match(profileEntry, /window\.AvatarDropdown\?\.refresh\?\.\(walletAddress\)/);
  // The refresh must run after the write, not before it.
  assert.ok(
    profileEntry.indexOf('window.AvatarDropdown?.refresh?.(walletAddress)')
      > profileEntry.indexOf('await window.ArtSoulDB.updateProfile(walletAddress, profileData)')
  );
});

test('the harness profile-display contract still matches supabase-client.js', () => {
  // The harness mirrors window.ArtSoulProfileDisplay. If the real resolver
  // changes shape, the behavioural tests above would silently drift.
  const client = fs.readFileSync(path.join(__dirname, '..', 'supabase-client.js'), 'utf8');
  assert.match(client, /function avatarUrl\(profile = \{\}, fallbackUrl = ''\) \{\s*return profile\?\.avatar_url \|\| fallbackUrl \|\| '';/);
  assert.match(client, /window\.ArtSoulProfileDisplay = \{/);
  assert.match(client, /const PROFILE_READ_CACHE_MS = 15000;/);
});
