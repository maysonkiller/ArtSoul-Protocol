const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const avatarDropdown = fs.readFileSync('avatar-dropdown.js', 'utf8');
const unifiedStyles = fs.readFileSync('unified-styles.css', 'utf8');
const sharedHeaderPages = [
  'index.html',
  'gallery.html',
  'artwork.html',
  'profile.html',
  'upload.html',
  'admin.html',
  'docs-protocol.html'
];

test('guest avatar uses the local ArtSoul image with the generated fallback', () => {
  // The one neutral avatar lives in publicDir so Vite serves it at exactly
  // '/default-avatar.png' instead of emitting a second hashed copy that the
  // legacy component would treat as a different image.
  assert.equal(fs.existsSync('public/default-avatar.png'), true);
  assert.equal(fs.existsSync('default-avatar.png'), false);
  assert.match(avatarDropdown, /src="\/default-avatar\.png"/);
  // A failed avatar load OR decode commits the canonical ArtSoul image TOGETHER
  // with the connected name and address as one final state, so the identity is
  // never left pending and the visible <img> is never blanked.
  assert.match(avatarDropdown, /const source = failed \? NEUTRAL_AVATAR_URL : snapshot\.avatarUrl;/);
  assert.match(avatarDropdown, /const paintSrc = failed \? NEUTRAL_AVATAR_URL : \(snapshot\.paintSrc \|\| snapshot\.avatarUrl\);/);
  // One bounded retry without CORS so an avatar host that sends no CORS headers
  // still renders; only then does the load count as failed.
  assert.match(avatarDropdown, /preloader\.onerror = \(\) => \{\s*if \(corsAttempt\) \{[\s\S]*?withoutCors: true[\s\S]*?\}\s*settle\(true\);/);
  // A decode rejection routes to the same coherent fallback commit.
  assert.match(avatarDropdown, /preloader\.decode\(\)\.then\(\s*\(\) => \{[\s\S]*?commitAndCapture\(\);\s*\},\s*\(\) => settle\(true\)\s*\);/);
  assert.match(avatarDropdown, /getProfileAvatarUrl\(profile\)/);
});

test('stored wallet hydration never renders a disconnected guest state', () => {
  assert.match(avatarDropdown, /localStorage\.getItem\('artsoul_wallet'\)/);
  assert.match(avatarDropdown, /document\.documentElement\.classList\.add\('wallet-state-resolving'\)/);
  assert.match(avatarDropdown, /artsoul_header_identity/);
  assert.match(avatarDropdown, /getCachedHeaderIdentity\(storedWallet\)/);
  assert.match(avatarDropdown, /getCachedHeaderNetwork\(storedWallet\)/);
  assert.match(avatarDropdown, /artsoul_header_network/);
  assert.match(avatarDropdown, /artsoul_header_ui_state/);
  assert.match(avatarDropdown, /cachedUiState === 'connected'/);
  assert.match(avatarDropdown, /cachedIdentityWithoutHint\?\.wallet/);
  assert.match(avatarDropdown, /name: cachedIdentity\.name/);
  assert.doesNotMatch(avatarDropdown, /Restoring wallet\.\.\./);
  assert.match(avatarDropdown, /dataset\.avatarRenderKey = 'cached-wallet'/);
  assert.doesNotMatch(avatarDropdown, /name: 'Wallet'/);
});

test('current network stays unique while foreign sessions expose an explicit Base Sepolia switch', () => {
  assert.match(avatarDropdown, /network-switcher-btn network-current-row/);
  assert.match(avatarDropdown, /Number\(currentChainId\) === 84532/);
  assert.match(avatarDropdown, /window\.AvatarDropdown\.selectNetwork\(84532, event\)/);
  assert.match(avatarDropdown, /<span class="network-option-name">Base Sepolia<\/span>/);
  assert.doesNotMatch(avatarDropdown, /<span class="network-option-name">ETH Sepolia<\/span>/);
  assert.doesNotMatch(avatarDropdown, /network-soon-badge">SOON/);
  assert.doesNotMatch(avatarDropdown, /avatar-network-option is-active/);
  // The Base Sepolia switch option must not duplicate the current row while a
  // mobile session is still on the "Tap to switch" (requiresConfirmation) state,
  // where chainId is intentionally null. The row itself is the switch control.
  assert.match(avatarDropdown, /renderNetworkOptions\(currentChainId, requiresConfirmation = false\)/);
  assert.match(avatarDropdown, /Number\(currentChainId\) === 84532 \|\| requiresConfirmation === true/);
  assert.match(avatarDropdown, /const networkOptions = networkInfo[\s\S]*?this\.renderNetworkOptions\(networkInfo\.chainId, networkInfo\.requiresConfirmation\)/);
  assert.match(avatarDropdown, /else if \(networkInfo\) \{[\s\S]*?role="status"/);
  // The stable menu key encodes the network state so the options list rebuilds
  // when the wallet confirms Base Sepolia — otherwise the stale option survives.
  assert.match(avatarDropdown, /networkMenuKeySegment\(networkInfo\)/);
  assert.match(avatarDropdown, /if \(networkInfo\.requiresConfirmation\) return 'pending';/);
  assert.match(avatarDropdown, /connected:\$\{currentPath\}:\$\{isOwnProfile\}:\$\{this\.networkMenuKeySegment\(networkInfo\)\}/);
});

test('the render key encodes the network so a post-connect Base Sepolia confirmation refreshes the header', () => {
  // sync() early-returns when the render key is unchanged. A wallet connects on
  // mainnet, then a second wallet-state-changed only flips the chain to 84532;
  // without the chain in the key the header keeps showing Ethereum Mainnet until
  // the next full page render. The key must include the chain and the confirmed
  // state so the confirmation triggers a re-render.
  const renderKeyFn = avatarDropdown.match(/getRenderKey\(walletAddress, state = \{\}\) \{[\s\S]*?\n        \}/)?.[0] || '';
  assert.ok(renderKeyFn, 'getRenderKey must exist');
  assert.match(renderKeyFn, /this\.getNormalizedChainId\(state\)/);
  assert.match(renderKeyFn, /isArtSoulBaseSepoliaConfirmed/);
  assert.match(renderKeyFn, /wallet:\$\{normalizedAddress\}:\$\{chainId \|\| 'none'\}:\$\{baseSepoliaConfirmed \? 'confirmed' : 'pending'\}/);
});

test('connected account menus render the current network and balance row', () => {
  // The live network/balance read now runs AFTER the identity is committed, so
  // a slow or hanging RPC cannot hold the avatar, name and address off screen.
  assert.match(avatarDropdown, /networkInfo = await this\.getCurrentNetworkInfo\(\{ walletAddress \}\);/);
  assert.match(avatarDropdown, /async applyLiveNetworkSection\(\{ walletAddress, currentPath, isOwnProfile, renderKey \}\)/);
  assert.match(avatarDropdown, /renderMenuContent\(\{ currentPath, isOwnProfile, networkInfo, connected: true \}\)/);
  assert.match(avatarDropdown, /data-network-balance/);
  assert.match(avatarDropdown, /BASE_SEPOLIA_RPC_URL = 'https:\/\/sepolia\.base\.org'/);
  assert.match(avatarDropdown, /name: 'Base Sepolia'/);
  assert.match(avatarDropdown, /balance: 'Tap to switch'/);
  assert.match(avatarDropdown, /window\.AvatarDropdown\.handleNetworkRowClick\(event\)/);
  assert.match(avatarDropdown, /window\.isArtSoulBaseSepoliaConfirmed\?\.\(\) === false/);
  assert.match(avatarDropdown, /baseSepoliaConfirmed: networkInfo\.baseSepoliaConfirmed === true/);
  assert.match(avatarDropdown, /networkInfo\.baseSepoliaConfirmed !== true/);
});

test('account menu uses the compact desktop and mobile width contracts', () => {
  assert.match(unifiedStyles, /width: min\(180px, calc\(100vw - 24px\)\) !important;/);
  assert.match(unifiedStyles, /width: min\(148px, calc\(100vw - 28px\)\) !important;/);
  assert.match(unifiedStyles, /\.profile-social-links \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});

test('account menu has one stylesheet source and a full-width compact network row', () => {
  assert.doesNotMatch(avatarDropdown, /document\.head\.appendChild\(style\)/);
  assert.doesNotMatch(avatarDropdown, /class="dropdown-item[^\"]*"\s+style=/);
  assert.match(unifiedStyles, /network-current-row,[\s\S]*?avatar-network-option \{[\s\S]*?border-color: var\(--c-border-soft\)/);
  assert.match(unifiedStyles, /avatar-network-options \{[\s\S]*?width: 100%;[\s\S]*?padding: 0\.08rem 0 0\.12rem !important;/);
  assert.match(unifiedStyles, /network-current-row \{[\s\S]*?height: 36px !important;/);
  assert.match(unifiedStyles, /avatar-network-option \{[\s\S]*?height: 36px !important;/);
  assert.match(unifiedStyles, /network-option-name \{[\s\S]*?font-size: 0\.78rem !important;/);
});

test('every product page loads the same account menu and stylesheet versions', () => {
  for (const page of sharedHeaderPages) {
    const html = fs.readFileSync(page, 'utf8');
    assert.match(html, /unified-styles\.css\?v=43/, `${page} must use the shared stylesheet cache version`);
    assert.match(html, /avatar-dropdown\.js\?v=45/, `${page} must use the shared menu cache version`);
    // Hydration moved into avatar-dropdown.js so the script can be deferred:
    // an inline call cannot see a deferred script. The page's obligation is now
    // to load the module, and the module hydrates itself.
    assert.match(html, /<script src="\/avatar-dropdown\.js\?v=45" defer><\/script>/, `${page} must load the deferred account menu`);
  }
});

test('the account button commits identity as one atomic snapshot', () => {
  // Avatar, alt, name, address, content key and visible UI state are ONE
  // transaction. Committing them separately produced the reported invalid
  // frame: neutral avatar beside a connected profile name and address.
  assert.doesNotMatch(avatarDropdown, /avatar-image-loading/);
  assert.doesNotMatch(unifiedStyles, /avatar-image-loading/);
  assert.doesNotMatch(avatarDropdown, /commitAvatarImage/);
  assert.match(avatarDropdown, /commitIdentitySnapshot\(\{ button \}, snapshot, token, failed\) \{/);
  assert.match(avatarDropdown, /holdIdentityWhilePending\(\{ button \}, snapshot\) \{/);
  assert.match(avatarDropdown, /decodeThenCommitIdentity\(structure, snapshot, token, options = \{\}\) \{/);
  // A restored local preview is what paints; the snapshot still records the
  // original avatar URL as its source, so a later render recognises it.
  assert.match(avatarDropdown, /image\.dataset\.avatarSource = source;/);
  assert.match(avatarDropdown, /preloader\.src = snapshot\.avatarUrl;/);
  // The previous identity is only kept during the decode while it belongs to
  // the account being rendered, so one wallet never wears another's avatar.
  assert.match(avatarDropdown, /image\?\.dataset\.avatarIdentity === snapshot\.identity/);
  // The visible UI state is part of the snapshot, not a separate later call.
  assert.match(avatarDropdown, /this\.commitVisibleState\(snapshot\.uiState, \{ persist: snapshot\.persistUiState \}\);/);
});

test('header typography and menu interaction geometry are shared across pages', () => {
  assert.match(unifiedStyles, /\.site-header \{[\s\S]*?font-family: system-ui, -apple-system, "Segoe UI", Arial, sans-serif !important;/);
  assert.match(unifiedStyles, /\.site-header #navButtons \.avatar-info \{[\s\S]*?text-align: center;/);
  assert.match(unifiedStyles, /\[data-avatar-name\] \{[\s\S]*?font-size: 0\.82rem !important;[\s\S]*?font-weight: 600 !important;/);
  assert.doesNotMatch(unifiedStyles, /\.site-header[\s\S]{0,500}?font-family: Inter/);
  assert.match(unifiedStyles, /avatar-theme-switch \.theme-btn \{[\s\S]*?min-height: 27px !important;[\s\S]*?font-size: 0\.75rem !important;/);
  assert.match(unifiedStyles, /avatar-disconnect-item \{[\s\S]*?min-height: 34px !important;/);
  assert.match(unifiedStyles, /\.future \.site-header \.avatar-dropdown-menu \.dropdown-item:not\(\.is-disabled\):hover[\s\S]*?var\(--c-glow-strong\)/);
});

test('account and network controls share one SVG chevron contract', () => {
  assert.equal((avatarDropdown.match(/class="[^"]*menu-chevron[^"]*"/g) || []).length, 2);
  assert.match(unifiedStyles, /\.menu-chevron \{[\s\S]*?stroke: currentColor;/);
  assert.match(unifiedStyles, /network-current-row\[aria-expanded="true"\][\s\S]*?rotate\(180deg\)/);
});

test('a connected identity can always be re-resolved and never sticks on the fallback', () => {
  // A-45: the render key encodes only wallet + chain, so it cannot express
  // "connected but the profile identity never resolved". sync() must keep the
  // render path open while the active wallet is unresolved, and must forward
  // the cache-busting flag so refresh() can actually re-read the profile.
  assert.match(avatarDropdown, /this\.resolvedIdentityWallet = null;/);
  assert.match(avatarDropdown, /const identityUnresolved = !!confirmedAddress && this\.resolvedIdentityWallet !== confirmedAddress;/);
  assert.match(avatarDropdown, /!options\.refreshProfile\s*\n\s*&& !identityUnresolved/);
  assert.match(avatarDropdown, /refreshProfile: options\.refreshProfile === true/);
  // A failed read must never be cached: ArtSoulDB keeps only a 15s read cache,
  // so a permanent component entry would outlive it and block every recovery.
  assert.match(avatarDropdown, /this\.profileCache\.delete\(cacheKey\);\s*\n\s*throw error;/);
  // Recovery runs on deliberate bounded events only — no timer, no polling, and
  // no retry driven by arbitrary document mutations (the nav observer watches
  // the whole document, so that would amplify a failing backend into one
  // request per unrelated render).
  assert.match(avatarDropdown, /recoverUnresolvedIdentity\(options = \{\}\) \{/);
  // A transient rejection from an already-ready backend is repaired by a
  // FINITE pre-declared backoff, never by a poll: no interval, one pending
  // retry at a time, and the same per-generation budget as every other
  // automatic recovery.
  assert.doesNotMatch(avatarDropdown, /setInterval\(/);
  assert.match(avatarDropdown, /const AUTOMATIC_RECOVERY_BACKOFF_MS = \[400, 1600\];/);
  assert.match(avatarDropdown, /if \(this\.recoveryTimer !== null\) return false;/);
  assert.match(avatarDropdown, /if \(this\.automaticRecoveries >= MAX_AUTOMATIC_IDENTITY_RECOVERIES\) return false;\s*\n\s*const delay/);
  assert.match(avatarDropdown, /if \(this\.identityGeneration !== generation\) return;/);
  assert.match(avatarDropdown, /this\.cancelAutomaticRecovery\(\);/);
  const navObserver = avatarDropdown.match(/const navObserver = new MutationObserver\(\(\) => \{[\s\S]*?\n    \}\);/)?.[0] || '';
  assert.ok(navObserver, 'the nav observer must exist');
  assert.doesNotMatch(navObserver, /recoverUnresolvedIdentity/);
});

test('the ArtSoulDB readiness signal is announced once and consumed without polling', () => {
  const supabaseClient = fs.readFileSync('supabase-client.js', 'utf8');
  // Dispatched only AFTER the complete public API is assigned.
  assert.ok(
    supabaseClient.indexOf("new CustomEvent('artsoul:db-ready')")
      > supabaseClient.indexOf('window.ArtSoulDB = {'),
    'readiness must be announced after the full ArtSoulDB API is assigned'
  );
  assert.equal((supabaseClient.match(/artsoul:db-ready/g) || []).length, 1);

  // The header checks immediately first, then listens once. No polling.
  assert.match(avatarDropdown, /const DB_READY_EVENT = 'artsoul:db-ready';/);
  assert.match(avatarDropdown, /isProfileBackendReady = \(\) => typeof window\.ArtSoulDB\?\.getProfile === 'function'/);
  assert.match(avatarDropdown, /if \(!isProfileBackendReady\(\)\) \{\s*\n\s*this\.armProfileBackendRecovery\(\);/);
  assert.match(avatarDropdown, /if \(this\.profileBackendListener\) return false;/);
  // Automatic recoveries are hard-capped per wallet generation.
  assert.match(avatarDropdown, /const MAX_AUTOMATIC_IDENTITY_RECOVERIES = 2;/);
  assert.match(avatarDropdown, /if \(this\.automaticRecoveries >= MAX_AUTOMATIC_IDENTITY_RECOVERIES\) return false;/);
});

test('the stylized "A" identity is gone from the shared header', () => {
  // The generated data-URI read as a third identity state and was mistaken for
  // a stale cached avatar. One canonical neutral avatar remains.
  assert.doesNotMatch(avatarDropdown, /getDefaultAvatar/);
  assert.doesNotMatch(avatarDropdown, /data:image\/svg\+xml,\$\{encodeURIComponent/);
  assert.doesNotMatch(avatarDropdown, /logoGradient/);
  assert.match(avatarDropdown, /const NEUTRAL_AVATAR_URL = '\/default-avatar\.png';/);
  // A stale image result from a superseded render must not touch the current
  // one, at any asynchronous boundary — load, decode settlement or error.
  // Any newer snapshot takes a newer token, so a late load, decode or error
  // belonging to an older wallet or a superseded render can never commit.
  assert.match(avatarDropdown, /const token = \+\+this\.identityCommitToken;/);
  assert.match(avatarDropdown, /commitIdentitySnapshot\([^)]*\) \{\s*if \(token !== this\.identityCommitToken\) return false;/);
  assert.match(avatarDropdown, /const settle = \(failed\) => \{\s*if \(token !== this\.identityCommitToken\) return;/);
  assert.match(avatarDropdown, /preloader\.onload = \(\) => \{\s*if \(token !== this\.identityCommitToken\) return;/);
});

test('wallet transitions invalidate identity so a late response cannot leak an avatar', () => {
  assert.match(avatarDropdown, /beginIdentityTransition\(nextWallet\) \{[\s\S]*?this\.identityGeneration \+= 1;[\s\S]*?this\.profile = null;/);
  assert.match(avatarDropdown, /const isCurrent = \(\) => this\.identityGeneration === generation\s*\n\s*&& this\.identityWallet === normalizedWallet;/);
  assert.match(avatarDropdown, /if \(!isCurrent\(\)\) return;/);
  // Persistence happens behind the guard, never inside the shared request, so a
  // superseded read cannot overwrite the stored identity or re-cache the
  // previous wallet after beginIdentityTransition() removed it.
  assert.match(avatarDropdown, /if \(profile\) this\.cacheHeaderIdentity\(profile, walletAddress\);/);
  assert.match(avatarDropdown, /if \(this\.identityWallet === cacheKey\) \{\s*\n\s*this\.profileCache\.set\(cacheKey, profile \|\| null\);/);
  assert.equal((avatarDropdown.match(/this\.cacheHeaderIdentity\(/g) || []).length, 1);
  // Disconnect clears wallet-bound identity in memory and in storage.
  // Only leaving a real wallet clears the stored identity, so the
  // early-hydration guest render cannot reintroduce the A-05 flicker.
  assert.match(avatarDropdown, /const previousWallet = this\.identityWallet;/);
  assert.match(avatarDropdown, /if \(previousWallet && previousWallet !== this\.identityWallet\) \{\s*\n\s*this\.profileCache\.delete\(previousWallet\);\s*\n\s*this\.clearCachedHeaderIdentity\(\);/);
});

test('an avatar image failure records the failure instead of claiming a successful render', () => {
  // The failed key is stamped as part of the same atomic snapshot commit, so a
  // later render for the same (or a newer) URL re-requests the image once
  // instead of treating the fallback as a successful render.
  assert.match(avatarDropdown, /button\.dataset\.avatarContentKey = failed\s*\? `\$\{snapshot\.contentKey\}\|image-error`\s*: snapshot\.contentKey;/);
});

test('Profile and Home are always visible with Profile first and no permanent profile styling', () => {
  assert.ok(avatarDropdown.indexOf("href: '/profile'") < avatarDropdown.indexOf("href: '/'"));
  assert.doesNotMatch(avatarDropdown, /filter\(item => !\(item\.profile && options\.isOwnProfile\)\)/);
  assert.doesNotMatch(avatarDropdown, /filter\(item => item\.profile \|\| !this\.isCurrentNavigationItem/);
});
