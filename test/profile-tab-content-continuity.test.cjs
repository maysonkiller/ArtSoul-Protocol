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
  // The property, not a count of places: wherever the list is set, the tab it
  // belongs to is set on the very next line. There are three such places now -
  // a cache hit, a successful read, a failed one - and a fourth would be fine
  // as long as it keeps the pair together.
  const setsList = [...commit.matchAll(/setMyArtworks\([^)]*\);\s*\n\s*(\S[^\n]*)/g)].map((m) => m[1]);
  assert.ok(setsList.length >= 3, `expected at least three commit sites, saw ${setsList.length}`);
  for (const next of setsList) {
    assert.match(next, /setDisplayedGallery\(requestedGallery\);/,
      'a list must never be shown without committing the tab it belongs to');
  }
  // Anything that commits after an await stays guarded against a newer request.
  // The failure branch carries an extra condition, so the guard is matched by
  // its opening rather than by an exact line.
  assert.equal(commit.match(/if \(requestId === artworksRequestRef\.current[^)]*\) \{/g).length, 2);
  // The fetch uses the tab captured at call time, not a later value.
  assert.match(commit, /fetchProfileArtworks\(activeProfile, requestedGallery\)/);
});

test('a placeholder stands in until the list belongs to the tab on screen', () => {
  // A-58 kept the previous tab's result on screen while the next one loaded, so
  // the heading followed the committed tab and lagged behind the highlight. On a
  // phone that read as the header naming one gallery while the page showed
  // another - reported from production with a screenshot of Auctions highlighted
  // above a Created Artworks heading.
  //
  // The tab, the heading and the list now always name the same gallery. A
  // placeholder covers the gap, and with the per-visit cache that gap only
  // exists the first time a tab is opened.
  assert.match(profileEntry, /\{displayedGallery !== selectedGallery \|\| \(artworksLoading && !hasSettledArtworks\) \? \(/);
  assert.match(profileEntry, /<CardGridSkeleton count=\{6\} className="contents" \/>/);
  assert.match(profileEntry, /const \[hasSettledArtworks, setHasSettledArtworks\] = useState\(false\);/);
});

test('everything describing the list follows the tab that is highlighted', () => {
  // A stale heading, empty message or Add New tile would trade one wrongness for
  // another. displayedGallery survives only as the commit guard inside the
  // loader; nothing visible reads it.
  for (const site of [
    /\{GALLERY_TYPES\.find\(g => g\.id === selectedGallery\)\?\.label\}/,
    /\{isOwnProfile && selectedGallery === 'created' && \(/,
    /\{selectedGallery === 'sold' && 'No completed sales yet\.'\}/,
    /\{selectedGallery === 'collected' && 'No collected NFTs yet\.'\}/
  ]) {
    assert.match(profileEntry, site);
  }
  const rendered = profileEntry.slice(profileEntry.indexOf('profile-artwork-grid'));
  assert.doesNotMatch(rendered, /displayedGallery ===/,
    'nothing rendered may be keyed to the committed tab any more');
});

test('the outgoing list is never dimmed while the next one loads', () => {
  // The first attempt dimmed the grid to 0.55. With card media still arriving
  // that read as the old tab showing through the new one, which is worse than
  // the flash it replaced. The inline note carries the signal on its own.
  assert.doesNotMatch(styles, /\.profile-artwork-grid\[aria-busy/);
});

test('the stale state is signalled without motion or theme colour', () => {
  // Canon 16: no theme hex outside the variables, and reduced motion honoured.
  const block = styles.slice(
    styles.indexOf('.profile-gallery-loading-note'),
    styles.indexOf('.artwork-fallback-facts {')
  );
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b/);
  assert.match(block, /opacity:/);
  assert.match(block, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(block, /animation: none;/);
  // aria-busy still drives assistive tech even with nothing visual hung off it.
  assert.match(profileEntry, /aria-busy=\{artworksLoading\}/);
});

test('no arbitrary min-height, timeout or overflow masking was introduced', () => {
  const block = styles.slice(
    styles.indexOf('.profile-gallery-loading-note'),
    styles.indexOf('.artwork-fallback-facts {')
  );
  assert.doesNotMatch(block, /min-height/);
  assert.doesNotMatch(block, /overflow\s*:\s*hidden/);
  assert.doesNotMatch(profileEntry, /setTimeout\([^)]*setArtworksLoading/);
});
