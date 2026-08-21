const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const prepaint = fs.readFileSync('header-prepaint.js', 'utf8');
const dropdown = fs.readFileSync('avatar-dropdown.js', 'utf8');

const SHARED_HEADER_PAGES = [
  'index.html', 'gallery.html', 'artwork.html',
  'profile.html', 'upload.html', 'docs-protocol.html', 'admin.html'
];

test('the resolving label is claimed only when there is nothing to paint', () => {
  // `wallet-state-resolving` is what reveals the static "Connecting..." text
  // that every shared-header page ships in its markup. It used to be set
  // unconditionally in <head> and cleared only once hydrate() ran, which is
  // after the account button has parsed. That window is one whole document:
  //
  //     artwork.html   prepaint line 69   button line 266   ~200 lines
  //     profile.html   119                233               ~114
  //     gallery.html    64                124                ~60
  //     index.html     226                250                ~24
  //
  // Reported from production in exactly that order - most visible opening an
  // artwork, not visible on the homepage. With a usable cached preview the
  // prepaint can paint the whole identity, so the label must never be claimed.
  assert.match(prepaint, /if \(!appKitDisconnectedAtBoot && !readPreview\(\)\s*\n\s*&& \(hasWallet \|\| cachedUiState === 'connected'\)\) \{/);
  // readPreview must be defined before that decision, or it is always false.
  assert.ok(
    prepaint.indexOf('const readPreview =') < prepaint.indexOf("classList.add('wallet-state-resolving')"),
    'readPreview must be defined before the class is decided'
  );
});

test('every shared-header page hydrates immediately after its button', () => {
  // The remaining window is whatever markup sits between the button and the
  // hydrate call. It must stay a few lines, on every page, or the label comes
  // back on whichever page grows.
  for (const page of SHARED_HEADER_PAGES) {
    const lines = fs.readFileSync(page, 'utf8').split('\n');
    const button = lines.findIndex((l) => l.includes('data-avatar-resolving'));
    const hydrate = lines.findIndex((l) => l.includes('ArtSoulHeaderPrepaint?.hydrate'));
    assert.ok(button > -1, `${page}: account button not found`);
    assert.ok(hydrate > button, `${page}: hydrate must come after the button`);
    assert.ok(hydrate - button <= 30, `${page}: ${hydrate - button} lines between button and hydrate`);
  }
});

test('a guest is never treated as being on their own profile', () => {
  // A guest has no profile, so no page can be it. Reading somebody's profile
  // while disconnected hid the Profile entry, because "am I on a profile page"
  // was standing in for "am I on MY profile page".
  assert.match(dropdown, /this\.renderMenuContent\(\{ currentPath, isOwnProfile: false \}\)/);
  assert.match(dropdown, /`guest:\$\{currentPath\}:false`/);
  assert.doesNotMatch(dropdown, /isOwnProfile: isProfilePage/);
});

test('the connected, restoring and guest branches all agree on the question', () => {
  // Three render paths, one definition of whose profile is on screen.
  assert.ok((dropdown.match(/isOwnProfileAddress\(/g) || []).length >= 5);
  assert.match(dropdown, /const isOwnProfile = isProfilePage && this\.isOwnProfileAddress\(/);
});

test('visual-lab is excluded on purpose, and stays a mock', () => {
  // It looks like a missing prepaint, and is not: visual-lab ships its own
  // hardcoded "ArtSoul Guest / Mock State" button with no [data-avatar-name]
  // and no [data-avatar-resolving], so it has no identity to resolve and no
  // label to flash. Adding the prepaint there would give it a real one.
  const lab = fs.readFileSync('visual-lab.html', 'utf8');
  assert.doesNotMatch(lab, /header-prepaint/);
  assert.doesNotMatch(lab, /data-avatar-resolving/);
  assert.match(lab, /Mock State/);
});
