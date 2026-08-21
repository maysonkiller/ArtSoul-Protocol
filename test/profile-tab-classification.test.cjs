const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const profile = fs.readFileSync('profile.html', 'utf8') + fs.readFileSync('src/entries/profile.jsx', 'utf8');

test('profile tabs use strict lifecycle and ownership predicates', () => {
  assert.match(profile, /isLiveAuction\?\.\(artwork\) === true/);
  assert.match(profile, /isMintedArtwork\(artwork\) &&[\s\S]*current_owner_address[\s\S]*creator_id \|\| artwork\.creator/);
  assert.match(profile, /filterCanonicalProfileArtworks\(projected, walletAddress, galleryType\)/);
  assert.match(profile, /galleryType === 'auction'/);
  assert.match(profile, /galleryType === 'sold'/);
  assert.match(profile, /galleryType === 'owned' \|\| galleryType === 'collected'/);
});

test('local pending artworks appear only in Created Artworks', () => {
  assert.match(profile, /if \(!walletAddress \|\| galleryType !== 'created'\)/);
  assert.doesNotMatch(profile, /galleryType !== 'auction' \|\| Boolean\(artwork\.auction_tx_hash\)/);
});

test('Add New is Created-only and loading uses one neutral skeleton state', () => {
  // A-58 keyed every description of the list to displayedGallery, the tab the
  // visible result actually belongs to, so the requirement is unchanged: Add New
  // appears for Created only. Asserting the committed value is stronger than
  // asserting the pending one, because the pending one can describe a list that
  // is not on screen.
  assert.match(profile, /isOwnProfile && displayedGallery === 'created'/);
  assert.doesNotMatch(profile, /ProfileArtworkSkeleton/);
  assert.doesNotMatch(profile, /profile-card-skeleton/);
  // Exactly one skeleton state, and it may only appear when there is no previous
  // result to keep. Replacing a settled list with it is what produced the
  // oversized transient block.
  assert.equal(profile.match(/CardGridSkeleton/g).length, 2);
  assert.match(profile, /artworksLoading && !hasSettledArtworks \? \([\s\S]*CardGridSkeleton count=\{6\}[\s\S]*\) : \(/);
  assert.match(profile, /!artworksLoading && \([\s\S]*myArtworks\.length\} items/);
  assert.doesNotMatch(profile, /Creator action|Prepare a new auction|Open publisher/);
});

test('trust is computed once from the complete creator corpus, independent of tabs', () => {
  assert.match(profile, /function buildDiscoveryProfile\(profileData, fullArtworkCorpus, genesisState\)/);
  assert.match(profile, /computeTrustProfile\(profileData, fullArtworkCorpus/);
  assert.match(profile, /Promise\.allSettled\(\[/);
  assert.match(profile, /buildDiscoveryProfile\(profileData, artworkData\.corpus, genesisState\)/);
  assert.doesNotMatch(profile, /computeTrustProfile\(profileData, artworkData\.items/);
});

test('profile omits missing and failed media cards', () => {
  assert.match(profile, /filter\(artwork => window\.ArtSoulArtworkCard\?\.hasSafeMedia/);
  assert.match(profile, /onUnavailable=\{\(\) => setMediaUnavailable\(true\)\}/);
});

test('empty states render only after loading for all four tabs', () => {
  // All four tabs keep an explicit empty message, now keyed to the committed
  // tab so the message can never describe a result that is not on screen. A
  // first load still cannot reach them: hasSettledArtworks is false until a
  // fetch commits, so the skeleton branch owns that render.
  assert.match(profile, /displayedGallery === 'created' && 'No created artworks yet\.'/);
  assert.match(profile, /displayedGallery === 'auction' && 'No live auctions right now\.'/);
  assert.match(profile, /displayedGallery === 'sold' && 'No completed sales yet\.'/);
  assert.match(profile, /displayedGallery === 'collected' && 'No collected NFTs yet\.'/);
  assert.match(profile, /const \[hasSettledArtworks, setHasSettledArtworks\] = useState\(false\);/);
});
