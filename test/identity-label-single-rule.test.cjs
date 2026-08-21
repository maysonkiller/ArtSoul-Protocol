const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const avatarDropdown = fs.readFileSync('avatar-dropdown.js', 'utf8');
const supabaseClient = fs.readFileSync('supabase-client.js', 'utf8');
const headerPrepaint = fs.readFileSync('header-prepaint.js', 'utf8');
const profileEntry = fs.readFileSync('src/entries/profile.jsx', 'utf8');

test('one rule names an account, and it lives in supabase-client', () => {
  // A-52. The canonical rule: a real username wins, otherwise the account is
  // named by its shortened wallet address. Nothing invents a placeholder.
  assert.match(supabaseClient, /function displayName\(profile = \{\}, address = ''\) \{/);
  assert.match(supabaseClient, /return shortWalletAddress\(profile\?\.wallet_address \|\| address\);/);
});

test('no surface invents a placeholder for a wallet it can already name', () => {
  // "ArtSoul User" was never a design choice. It only ever appeared while
  // supabase-client had not loaded, so the header showed it and then replaced
  // it with the address, which read as the label changing its mind.
  for (const [name, source] of Object.entries({ avatarDropdown, headerPrepaint, profileEntry })) {
    assert.doesNotMatch(source, /ArtSoul User/, `${name} must not reintroduce the placeholder`);
  }
});

test('the pre-load fallbacks agree with the canonical rule', () => {
  // Every avatar-dropdown fallback now derives the name from the address it
  // already holds, so a connected wallet is never painted as a guest.
  assert.match(avatarDropdown, /shortWalletAddress\(address\) \{/);
  assert.match(avatarDropdown, /value\.length <= 12 \? value : `\$\{value\.slice\(0, 6\)\}\.\.\.\$\{value\.slice\(-4\)\}`/);
  assert.match(avatarDropdown, /const nextName = name \|\| this\.shortWalletAddress\(address\) \|\| 'ArtSoul Guest';/);
  assert.match(avatarDropdown, /const fallback = this\.shortWalletAddress\(walletAddress\) \|\| 'ArtSoul Guest';/);
  assert.match(avatarDropdown, /const displayedName = cachedIdentity\?\.name \|\| shortAddress;/);
});

test('ArtSoul Guest survives only where no wallet exists at all', () => {
  // Guest is a real state, not a placeholder: it means no connected wallet.
  // The prepaint bridge keeps it for the disconnected boot, and uses its
  // separate resolving label when a wallet exists but its identity does not.
  assert.match(headerPrepaint, /appKitDisconnectedAtBoot \|\| !hasWallet/);
  assert.match(headerPrepaint, /label: 'ArtSoul Guest'/);
  // A-56 made this conditional: an account whose avatar is the neutral image
  // has nothing left to resolve, so it is named rather than given a status
  // word. The resolving label survives for an undecoded custom avatar.
  assert.match(headerPrepaint, /label: settledWithoutPicture \? identity\.name : RESOLVING_LABEL,/);
});

test('an unnamed connected wallet shows its shortened address only once', () => {
  assert.match(avatarDropdown, /const nextAddress = address && nextName\.toLowerCase\(\) !== String\(address\)\.toLowerCase\(\)/);
  assert.match(avatarDropdown, /address: nextAddress,/);
  assert.match(headerPrepaint, /const displayAddress = shortAddress && label\.toLowerCase\(\) !== shortAddress\.toLowerCase\(\)/);
  assert.match(headerPrepaint, /writeAddress\(address, displayAddress\)/);
});
