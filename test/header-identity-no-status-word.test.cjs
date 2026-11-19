const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { paintCachedHeader } = require('./helpers/avatar-dropdown-harness.cjs');
const wallet = '0x' + 'a'.repeat(40);
const shortAddress = '0xaaaa...aaaa';
const prepaint = fs.readFileSync('header-prepaint.js', 'utf8');
const avatarDropdown = fs.readFileSync('avatar-dropdown.js', 'utf8');

test('an account with no picture is named, never given a status word', () => {
  for (const name of ['Artist', shortAddress]) {
    const paint = paintCachedHeader({ wallet, name, avatarUrl: '/default-avatar.png' });
    assert.equal(paint.avatarName(), name);
    assert.equal(paint.avatarSource(), '/default-avatar.png');
  }
});

test('a name still never appears beside an undecoded custom avatar', () => {
  const paint = paintCachedHeader({ wallet, name: 'Artist', avatarUrl: '/custom-avatar.png' });
  assert.equal(paint.uiState(), 'resolving');
  assert.equal(paint.avatarName(), shortAddress);
  assert.equal(paint.avatarSource(), '/default-avatar.png');
  assert.equal(paint.avatarSrc(), paint.context.ArtSoulHeaderPrepaint.neutralAvatar);
});

test('the preview branch still requires a validated preview', () => {
  // The base64 preview stays gated on its own validation. This fix changed the
  // label of the fall-through, not what may be painted as an image.
  assert.match(prepaint, /const preview = readPreview\(\);/);
  assert.match(prepaint, /if \(preview\) \{/);
  assert.match(prepaint, /paintSource: preview,/);
});

test('the identity cache accepts an account that has no profile yet', () => {
  // getProfileDisplayName resolves a nameless account to its shortened address
  // and getProfileAvatarUrl falls back to the neutral image, so such an account
  // is cacheable and reaches the branch above.
  assert.match(avatarDropdown, /name: this\.getProfileDisplayName\(profile, wallet\),/);
  assert.match(avatarDropdown, /avatarUrl: this\.getProfileAvatarUrl\(profile\)/);
  assert.match(avatarDropdown, /resolver\?\.\(profile, NEUTRAL_AVATAR_URL\) \|\| NEUTRAL_AVATAR_URL/);
});

test('the neutral avatar survives resizing untouched', () => {
  // The branch above recognises a nameless account by avatarUrl === the neutral
  // image. Header avatars are now requested at a display size, so if that
  // resizing rewrote the neutral URL the comparison would fail and the status
  // word would come back for exactly the accounts this fix was written for.
  // The sizing lives in storage-image.js, loaded before every consumer.
  const source = fs.readFileSync('storage-image.js', 'utf8');
  const win = {};
  new Function('window', 'URL', source)(win, URL);
  const helper = win.ArtSoulStorageImage.sized;
  assert.equal(helper('/default-avatar.png', 128), '/default-avatar.png');
  assert.match(avatarDropdown, /const NEUTRAL_AVATAR_URL = '\/default-avatar\.png';/);
});

test('one wallet line, not two, when the name is the address', () => {
  assert.match(prepaint, /const displayAddress = shortAddress && label\.toLowerCase\(\) !== shortAddress\.toLowerCase\(\)/);
});

test('guest remains the only label for a page with no wallet at all', () => {
  assert.match(prepaint, /appKitDisconnectedAtBoot \|\| !hasWallet/);
  assert.match(prepaint, /label: 'ArtSoul Guest'/);
});
