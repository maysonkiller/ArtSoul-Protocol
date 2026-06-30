const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const avatarDropdown = fs.readFileSync('avatar-dropdown.js', 'utf8');

test('guest avatar uses the local ArtSoul image with the generated fallback', () => {
  assert.equal(fs.existsSync('default-avatar.png'), true);
  assert.match(avatarDropdown, /src="\/default-avatar\.png"/);
  assert.match(avatarDropdown, /onerror="this\.onerror=null;this\.src='\$\{guestAvatarFallback\}'"/);
  assert.match(avatarDropdown, /getProfileAvatarUrl\(profile\)/);
});
