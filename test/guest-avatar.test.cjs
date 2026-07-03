const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const avatarDropdown = fs.readFileSync('avatar-dropdown.js', 'utf8');

test('guest avatar uses the local ArtSoul image with the generated fallback', () => {
  assert.equal(fs.existsSync('default-avatar.png'), true);
  assert.match(avatarDropdown, /src="\/default-avatar\.png"/);
  assert.match(avatarDropdown, /image\.onerror = \(\) => \{/);
  assert.match(avatarDropdown, /image\.src = fallback;/);
  assert.match(avatarDropdown, /getProfileAvatarUrl\(profile\)/);
});

test('stored wallet hydration never renders a disconnected guest state', () => {
  assert.match(avatarDropdown, /localStorage\.getItem\('artsoul_wallet'\)/);
  assert.match(avatarDropdown, /name: 'Wallet'/);
  assert.match(avatarDropdown, /Restoring wallet\.\.\./);
  assert.match(avatarDropdown, /stateKey: 'restoring-wallet'/);
});

test('Base is the only selected network and Ethereum Sepolia is visibly future-only', () => {
  assert.match(avatarDropdown, /avatar-network-option is-active/);
  assert.match(avatarDropdown, /aria-current="true"/);
  assert.match(avatarDropdown, /Ethereum Sepolia/);
  assert.match(avatarDropdown, /network-soon-badge">SOON/);
  const ethereumStart = avatarDropdown.indexOf('class="dropdown-item avatar-network-option is-disabled"');
  const ethereumOption = ethereumStart >= 0
    ? avatarDropdown.slice(ethereumStart, avatarDropdown.indexOf('</button>', ethereumStart))
    : '';
  assert.doesNotMatch(ethereumOption, /network-option-indicator/);
});
