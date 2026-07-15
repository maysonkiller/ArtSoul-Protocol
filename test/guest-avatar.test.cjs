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
  'docs-protocol.html'
];

test('guest avatar uses the local ArtSoul image with the generated fallback', () => {
  assert.equal(fs.existsSync('default-avatar.png'), true);
  assert.match(avatarDropdown, /src="\/default-avatar\.png"/);
  assert.match(avatarDropdown, /image\.onerror = \(\) => \{/);
  assert.match(avatarDropdown, /image\.src = fallback;/);
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
  assert.match(avatarDropdown, /<span class="network-option-name">ETH Sepolia<\/span>/);
  assert.match(avatarDropdown, /<img src="\$\{ETHEREUM_NETWORK_ICON\}" alt="" aria-hidden="true" \/>/);
  assert.match(avatarDropdown, /network-soon-badge">SOON/);
  const ethereumStart = avatarDropdown.indexOf('class="dropdown-item avatar-network-option is-disabled"');
  const ethereumOption = ethereumStart >= 0
    ? avatarDropdown.slice(ethereumStart, avatarDropdown.indexOf('</button>', ethereumStart))
    : '';
  assert.doesNotMatch(ethereumOption, /network-option-indicator/);
  assert.doesNotMatch(avatarDropdown, /avatar-network-option is-active/);
  // The Base Sepolia switch option must not duplicate the current row while a
  // mobile session is still on the "Tap to switch" (requiresConfirmation) state,
  // where chainId is intentionally null. The row itself is the switch control.
  assert.match(avatarDropdown, /renderNetworkOptions\(currentChainId, requiresConfirmation = false\)/);
  assert.match(avatarDropdown, /Number\(currentChainId\) === 84532 \|\| requiresConfirmation === true/);
  assert.match(avatarDropdown, /renderNetworkOptions\(networkInfo\.chainId, networkInfo\.requiresConfirmation\)/);
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
  assert.match(avatarDropdown, /const networkInfo = await this\.getCurrentNetworkInfo\(\{ walletAddress \}\);/);
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
  assert.match(unifiedStyles, /width: min\(164px, calc\(100vw - 24px\)\) !important;/);
  assert.match(unifiedStyles, /width: min\(148px, calc\(100vw - 28px\)\) !important;/);
  assert.match(unifiedStyles, /\.profile-social-links \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});

test('account menu has one stylesheet source and a full-width compact future network row', () => {
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
    assert.match(html, /unified-styles\.css\?v=37/, `${page} must use the shared stylesheet cache version`);
    assert.match(html, /avatar-dropdown\.js\?v=36/, `${page} must use the shared menu cache version`);
    assert.match(html, /window\.AvatarDropdown\?\.renderInitializingState\(\);/, `${page} must hydrate the cached header before main content`);
  }
});

test('stable button hydration does not reassign identical avatar content', () => {
  assert.match(avatarDropdown, /const contentAlreadyMatches =/);
  assert.match(avatarDropdown, /if \(contentAlreadyMatches\) \{[\s\S]*?button\.dataset\.avatarContentKey = contentKey;[\s\S]*?return structure;/);
  assert.match(avatarDropdown, /image\.classList\.add\('avatar-image-loading'\)/);
  assert.match(unifiedStyles, /avatar-button > img\.avatar-image-loading \{[\s\S]*?visibility: hidden !important;/);
});

test('header typography and menu interaction geometry are shared across pages', () => {
  assert.match(unifiedStyles, /\.site-header \{[\s\S]*?font-family: Inter, Arial, sans-serif !important;/);
  assert.match(unifiedStyles, /\[data-avatar-name\] \{[\s\S]*?font-size: 0\.82rem !important;[\s\S]*?font-weight: 650 !important;/);
  assert.match(unifiedStyles, /avatar-theme-switch \.theme-btn \{[\s\S]*?min-height: 27px !important;[\s\S]*?font-size: 0\.75rem !important;/);
  assert.match(unifiedStyles, /avatar-disconnect-item \{[\s\S]*?min-height: 34px !important;/);
  assert.match(unifiedStyles, /\.future \.site-header \.avatar-dropdown-menu \.dropdown-item:not\(\.is-disabled\):hover[\s\S]*?var\(--c-glow-strong\)/);
});

test('account and network controls share one SVG chevron contract', () => {
  assert.equal((avatarDropdown.match(/class="[^"]*menu-chevron[^"]*"/g) || []).length, 2);
  assert.match(unifiedStyles, /\.menu-chevron \{[\s\S]*?stroke: currentColor;/);
  assert.match(unifiedStyles, /network-current-row\[aria-expanded="true"\][\s\S]*?rotate\(180deg\)/);
});

test('Profile and Home are always visible with Profile first and no permanent profile styling', () => {
  assert.ok(avatarDropdown.indexOf("href: 'profile.html'") < avatarDropdown.indexOf("href: 'index.html'"));
  assert.doesNotMatch(avatarDropdown, /filter\(item => !\(item\.profile && options\.isOwnProfile\)\)/);
  assert.doesNotMatch(avatarDropdown, /filter\(item => item\.profile \|\| !this\.isCurrentNavigationItem/);
});
