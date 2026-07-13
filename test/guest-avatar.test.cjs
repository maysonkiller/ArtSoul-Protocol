const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const avatarDropdown = fs.readFileSync('avatar-dropdown.js', 'utf8');
const unifiedStyles = fs.readFileSync('unified-styles.css', 'utf8');

test('guest avatar uses the local ArtSoul image with the generated fallback', () => {
  assert.equal(fs.existsSync('default-avatar.png'), true);
  assert.match(avatarDropdown, /src="\/default-avatar\.png"/);
  assert.match(avatarDropdown, /image\.onerror = \(\) => \{/);
  assert.match(avatarDropdown, /image\.src = fallback;/);
  assert.match(avatarDropdown, /getProfileAvatarUrl\(profile\)/);
});

test('stored wallet hydration never renders a disconnected guest state', () => {
  assert.match(avatarDropdown, /localStorage\.getItem\('artsoul_wallet'\)/);
  assert.match(avatarDropdown, /artsoul_header_identity/);
  assert.match(avatarDropdown, /getCachedHeaderIdentity\(storedWallet\)/);
  assert.match(avatarDropdown, /name: cachedIdentity\.name/);
  assert.match(avatarDropdown, /Restoring wallet\.\.\./);
  assert.match(avatarDropdown, /dataset\.avatarRenderKey = 'cached-wallet'/);
  assert.doesNotMatch(avatarDropdown, /name: 'Wallet'/);
});

test('Base appears once as current network and ETH Sepolia is visibly future-only', () => {
  assert.match(avatarDropdown, /network-switcher-btn network-current-row/);
  assert.match(avatarDropdown, /<span class="network-option-name">ETH Sepolia<\/span>/);
  assert.match(avatarDropdown, /network-soon-badge">SOON/);
  const ethereumStart = avatarDropdown.indexOf('class="dropdown-item avatar-network-option is-disabled"');
  const ethereumOption = ethereumStart >= 0
    ? avatarDropdown.slice(ethereumStart, avatarDropdown.indexOf('</button>', ethereumStart))
    : '';
  assert.doesNotMatch(ethereumOption, /network-option-indicator/);
  assert.doesNotMatch(avatarDropdown, /avatar-network-option is-active/);
});

test('connected account menus render the current network and balance row', () => {
  assert.match(avatarDropdown, /const networkInfo = await this\.getCurrentNetworkInfo\(\);/);
  assert.match(avatarDropdown, /renderMenuContent\(\{ currentPath, isOwnProfile, networkInfo, connected: true \}\)/);
  assert.match(avatarDropdown, /data-network-balance/);
});

test('account menu uses the compact desktop and mobile width contracts', () => {
  assert.match(unifiedStyles, /width: min\(152px, calc\(100vw - 24px\)\) !important;/);
  assert.match(unifiedStyles, /width: min\(148px, calc\(100vw - 28px\)\) !important;/);
  assert.match(unifiedStyles, /\.profile-social-links \{[\s\S]*?flex-wrap: nowrap !important;/);
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
