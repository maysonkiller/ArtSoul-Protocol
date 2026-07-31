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

const GENERATED_FALLBACK = /^data:image\/svg\+xml,/;

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

  assert.match(harness.avatarSrc(), GENERATED_FALLBACK);
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
  // Restoring from cache still reads as connected, not as a guest.
  assert.equal(harness.avatarSrc(), AVATAR_A);
  assert.equal(harness.avatarName(), 'Founder');
  assert.equal(harness.uiState(), 'connected');

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
  assert.match(harness.avatarSrc(), GENERATED_FALLBACK);
  assertConnectedIdentity(harness, WALLET_A);
  assert.equal(harness.imageLoads.filter(src => src === AVATAR_A).length, 1);
  // The stamped key records the failure instead of claiming a successful render.
  assert.match(harness.button().dataset.avatarContentKey, /\|image-error$/);

  harness.allowImage(AVATAR_A);
  await harness.dropdown.refresh(WALLET_A);
  await harness.flush();

  assert.equal(harness.avatarSrc(), AVATAR_A);
  assert.equal(harness.imageLoads.filter(src => src === AVATAR_A).length, 2);
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

  assert.equal(harness.avatarSrc(), AVATAR_A);
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
  let attempts = 0;
  harness.setProfileBehaviour(() => {
    attempts += 1;
    if (attempts === 1) return Promise.reject(new Error('profile backend unavailable'));
    return undefined;
  });

  connect(harness, WALLET_A);
  await harness.flush();

  // The exact production symptom: connected menu, generated fallback avatar.
  assert.match(harness.avatarSrc(), GENERATED_FALLBACK);
  assert.equal(harness.avatarName(), 'ArtSoul User');
  assertConnectedIdentity(harness, WALLET_A);
  assert.match(harness.menuHtml(), /Base Sepolia/);
  // The failure must not be cached, or every later attempt would be a no-op.
  assert.equal(harness.dropdown.profileCache.has(WALLET_A), false);
  assert.equal(harness.dropdown.resolvedIdentityWallet, null);

  // Recovery path 1: the next wallet-state event retries.
  harness.dispatchWalletState({ address: WALLET_A, chainId: 84532, isConnected: true });
  await harness.flush();
  assert.equal(harness.avatarSrc(), AVATAR_A);
  assert.equal(harness.avatarName(), 'Founder');
  assert.equal(harness.dropdown.resolvedIdentityWallet, WALLET_A);
});

test('opening the account menu recovers an unresolved identity exactly once', async () => {
  const harness = connectedHarness({
    profiles: { [WALLET_A]: { wallet_address: WALLET_A, username: 'Founder', avatar_url: AVATAR_A } }
  });
  let attempts = 0;
  harness.setProfileBehaviour(() => {
    attempts += 1;
    if (attempts === 1) return Promise.reject(new Error('profile backend unavailable'));
    return undefined;
  });

  connect(harness, WALLET_A);
  await harness.flush();
  assert.match(harness.avatarSrc(), GENERATED_FALLBACK);

  // Recovery path 2: the founder opens the account menu (a user gesture, the
  // moment the defect was actually noticed in production).
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
  const readsAfterFailure = harness.profileCalls.length;
  assert.equal(readsAfterFailure, 1);
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
  let attempts = 0;
  harness.setProfileBehaviour(() => {
    attempts += 1;
    if (attempts === 1) return Promise.reject(new Error('profile backend down'));
    return undefined;
  });

  connect(harness, WALLET_A);
  await harness.flush();
  assert.match(harness.avatarSrc(), GENERATED_FALLBACK);
  assert.equal(harness.profileCalls.length, 1);

  // Unrelated mutations still cost nothing.
  harness.triggerMutationObservers();
  await harness.flush();
  assert.equal(harness.profileCalls.length, 1);

  // The header is genuinely removed — the intended rebuild path recovers it.
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
