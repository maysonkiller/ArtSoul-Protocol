// A-79: the opening gallery read is bounded to one screenful.
//
// Two accepted repairs disagreed about the profile's first paint. A-54 committed
// identity as soon as the narrow profile read resolved; a competing change
// published one coherent frame instead, because the founder's video showed the
// page assembling in stages. Both were right about what they saw, and neither
// could be merged as a fix for the other: one frame arrives no earlier than the
// slowest read, and the slowest read was the whole corpus - up to 200 works.
//
// Bounding the first read settles it rather than picking a side. These tests pin
// the three properties that make that true, because each of them silently
// reverts to the old behaviour if someone edits the loader without reading this.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'entries', 'profile.jsx'),
  'utf8'
);

test('the opening read asks for one page, not the whole corpus', () => {
  const firstPage = Number((source.match(/const FIRST_GALLERY_PAGE = (\d+)/) || [])[1]);
  const fullLimit = Number((source.match(/const FULL_GALLERY_LIMIT = (\d+)/) || [])[1]);

  assert.ok(Number.isFinite(firstPage), 'the first page size must be a named constant');
  assert.ok(Number.isFinite(fullLimit), 'the full limit must be a named constant');
  assert.ok(firstPage > 0 && firstPage < fullLimit, 'the first page must be smaller than the corpus');
  // Large enough to fill an opening screen on a desktop grid, small enough that
  // the frame does not wait on a long tail nobody has scrolled to.
  assert.ok(firstPage >= 12 && firstPage <= 48, `first page of ${firstPage} is outside a screenful`);

  assert.match(
    source,
    /fetchProfileArtworks\(\s*\{ wallet_address: walletAddress \},\s*requestedGallery,\s*db,\s*\{ limit: FIRST_GALLERY_PAGE \}/,
    'the initial profile load must request the bounded page'
  );
});

test('a full first page is read again without a bound', () => {
  // A short page cannot tell a full gallery from a short one, so the follow-up
  // has to be conditional on the page filling rather than on a count nobody has.
  assert.match(
    source,
    /if \(artworkData\.corpus\.length >= FIRST_GALLERY_PAGE\)/,
    'the remainder must be fetched when the first page fills'
  );
  assert.match(
    source,
    /\{ limit: FULL_GALLERY_LIMIT \}/,
    'the follow-up read must be unbounded by the page size'
  );
});

test('the follow-up never shows a loading state over content that is already correct', () => {
  // Showing a spinner over cards that are already right is the staging effect
  // this row exists to remove, so the second read must not set the flag.
  const start = source.indexOf('if (artworkData.corpus.length >= FIRST_GALLERY_PAGE)');
  assert.notEqual(start, -1);
  const block = source.slice(start, start + 1800);

  assert.doesNotMatch(block, /setArtworksLoading\(true\)/, 'the remainder must not raise a loading state');
  assert.doesNotMatch(block, /setHasSettledArtworks\(false\)/, 'the settled gallery must not be unsettled');
});

test('a slower remainder cannot overwrite a newer profile or a newer tab', () => {
  // #258 made request generation shared across initial, profile and tab loads so
  // an older response cannot replace a newer one. A read that starts before a
  // tab switch and lands after it has to lose, and this is the one read that
  // lands well after its own frame.
  const start = source.indexOf('if (artworkData.corpus.length >= FIRST_GALLERY_PAGE)');
  const block = source.slice(start, start + 1800);

  assert.match(block, /requestId === profileRequestRef\.current/, 'the profile generation must be rechecked');
  assert.match(block, /artworkRequestId === artworksRequestRef\.current/, 'the gallery generation must be rechecked');
});

test('identity is still committed before the gallery, not after it', () => {
  // Bounding the read makes a coherent frame affordable; it does not reinstate
  // the gate A-54 removed. Identity must still land on the narrow profile read.
  const commit = source.indexOf('setProfile(profileData);');
  const settle = source.indexOf('const [artworksResult, genesisResult] = await Promise.allSettled');

  assert.notEqual(commit, -1);
  assert.notEqual(settle, -1);
  assert.ok(commit < settle, 'identity must be committed before the gallery is awaited');
});

test('the discovery profile is rebuilt from the full corpus, not the first page', () => {
  // Trust and discovery signals are computed from the corpus. Leaving them on a
  // 24-item sample would make a quiet, permanent accuracy defect out of a
  // presentation fix.
  const start = source.indexOf('if (artworkData.corpus.length >= FIRST_GALLERY_PAGE)');
  const block = source.slice(start, start + 1800);

  assert.match(
    block,
    /setDiscoveryProfile\(buildDiscoveryProfile\(profileData, full\.corpus, genesisState\)\)/,
    'the discovery profile must be rebuilt from the unbounded corpus'
  );
});
