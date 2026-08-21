const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const profileEntry = fs.readFileSync('src/entries/profile.jsx', 'utf8');
const styles = fs.readFileSync('unified-styles.css', 'utf8');

test('the visible result and its heading are committed together', () => {
  // A-58. selectedGallery changes on the click. displayedGallery only changes
  // when a fetch commits, so the heading can never describe a list it is not
  // showing, and the previous list is never destroyed before its replacement
  // exists.
  assert.match(profileEntry, /const \[displayedGallery, setDisplayedGallery\] = useState\('created'\);/);
  const commit = profileEntry.slice(
    profileEntry.indexOf('const requestedGallery = selectedGallery;'),
    profileEntry.indexOf('async function handleAvatarUpload')
  );
  assert.ok(commit, 'the loader commit block must be discoverable');
  // Both success and failure commit the list and its tab in the same guarded step.
  assert.equal(commit.match(/setDisplayedGallery\(requestedGallery\);/g).length, 2);
  assert.equal(commit.match(/if \(requestId === artworksRequestRef\.current\) \{/g).length, 2);
  // The fetch uses the tab captured at call time, not a later value.
  assert.match(commit, /fetchProfileArtworks\(activeProfile, requestedGallery\)/);
});

test('a tab switch never falls back to the six-card skeleton', () => {
  // The skeleton reserves a height unrelated to the incoming tab. It is correct
  // for a first load, where there is nothing to keep, and wrong for a switch.
  assert.match(profileEntry, /\{artworksLoading && !hasSettledArtworks \? \(\s*\n\s*<CardGridSkeleton count=\{6\} className="contents" \/>/);
  assert.match(profileEntry, /const \[hasSettledArtworks, setHasSettledArtworks\] = useState\(false\);/);
});

test('everything describing the list follows the committed tab', () => {
  // A stale heading, empty message or Add New tile would trade one wrongness
  // for another.
  for (const site of [
    /\{GALLERY_TYPES\.find\(g => g\.id === displayedGallery\)\?\.label\}/,
    /\{isOwnProfile && displayedGallery === 'created' && \(/,
    /\{displayedGallery === 'sold' && 'No completed sales yet\.'\}/,
    /\{displayedGallery === 'collected' && 'No collected NFTs yet\.'\}/
  ]) {
    assert.match(profileEntry, site);
  }
  // The tapped tab still highlights immediately: that feedback must not lag.
  assert.match(profileEntry, /selectedGallery === gallery\.id/);
  assert.match(profileEntry, /if \(gallery\.id !== selectedGallery\) \{/);
});

test('the stale state is signalled without motion or theme colour', () => {
  // Canon 16: no theme hex outside the variables, and reduced motion honoured.
  const block = styles.slice(
    styles.indexOf('.profile-artwork-grid[aria-busy="true"]'),
    styles.indexOf('.artwork-fallback-facts {')
  );
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b/);
  assert.match(block, /opacity:/);
  assert.match(block, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(block, /animation: none;/);
  // aria-busy is what drives it, so assistive tech and CSS agree.
  assert.match(profileEntry, /aria-busy=\{artworksLoading\}/);
});

test('no arbitrary min-height, timeout or overflow masking was introduced', () => {
  const block = styles.slice(
    styles.indexOf('.profile-artwork-grid[aria-busy="true"]'),
    styles.indexOf('.artwork-fallback-facts {')
  );
  assert.doesNotMatch(block, /min-height/);
  assert.doesNotMatch(block, /overflow\s*:\s*hidden/);
  assert.doesNotMatch(profileEntry, /setTimeout\([^)]*setArtworksLoading/);
});
