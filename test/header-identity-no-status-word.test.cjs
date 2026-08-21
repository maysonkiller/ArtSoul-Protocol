const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const prepaint = fs.readFileSync('header-prepaint.js', 'utf8');
const avatarDropdown = fs.readFileSync('avatar-dropdown.js', 'utf8');

test('an account with no picture is named, never given a status word', () => {
  // A-56. The header read "Connecting..." beside an address it already knew, on
  // every navigation, for any account without a profile picture. That account's
  // cached avatar is the neutral image and its cached name is its own shortened
  // address, so both are already final and there is nothing left to resolve.
  assert.match(prepaint, /const settledWithoutPicture = identity\s*\n\s*&& identity\.wallet === wallet\s*\n\s*&& identity\.avatarUrl === NEUTRAL_AVATAR_URL;/);
  assert.match(prepaint, /label: settledWithoutPicture \? identity\.name : shortAddress,/);
});

test('a name still never appears beside an undecoded custom avatar', () => {
  // The A-46 property this fix had to respect: a real name next to the neutral
  // placeholder is a half identity. It is allowed only when the neutral image
  // IS the account's avatar, which is why the guard tests avatarUrl and not
  // merely the presence of a cached identity.
  assert.doesNotMatch(prepaint, /label: identity\.name,\s*\n\s*shortAddress,\s*\n\s*imageIdentity: shortAddress,\s*\n\s*uiState: 'resolving'/);
  // The image half of the resolving branch is untouched: neutral paints
  // instantly, so the button never blanks while a remote avatar loads.
  const resolving = prepaint.slice(prepaint.indexOf('const settledWithoutPicture'));
  assert.match(resolving, /source: NEUTRAL_AVATAR_URL,\s*\n\s*paintSource: NEUTRAL_AVATAR_URL,/);
  assert.match(resolving, /uiState: 'resolving'/);
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
  const client = fs.readFileSync('supabase-client.js', 'utf8');
  const start = client.indexOf('const STORAGE_OBJECT_PATH');
  const end = client.indexOf('function sanitizeText');
  assert.ok(start > -1 && end > start, 'the sizing helper must be discoverable');
  const helper = new Function(
    'isValidStorageUrl', 'URL',
    `${client.slice(start, end)}
return storageRenderUrl;`
  )(() => true, URL);
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
