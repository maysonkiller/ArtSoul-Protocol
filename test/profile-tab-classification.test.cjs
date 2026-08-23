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

test('Add New is Created-only and tab loading draws no transient card grid', () => {
  // A-58 keyed every description of the list to displayedGallery, the tab the
  // visible result actually belongs to, so the requirement is unchanged: Add New
  // appears for Created only. Asserting the committed value is stronger than
  // asserting the pending one, because the pending one can describe a list that
  // is not on screen.
  assert.match(profile, /isOwnProfile && selectedGallery === 'created'/);
  assert.doesNotMatch(profile, /ProfileArtworkSkeleton/);
  assert.doesNotMatch(profile, /profile-card-skeleton/);
  assert.doesNotMatch(profile, /CardGridSkeleton/);
  assert.match(profile, /displayedGallery !== selectedGallery \|\| \(artworksLoading && !hasSettledArtworks\) \? null : \(/);
  assert.match(profile, /profile-gallery-loading-note artsoul-placeholder/);
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
  // fetch commits, so the compact loading branch owns that render.
  assert.match(profile, /selectedGallery === 'created' && 'No created artworks yet\.'/);
  assert.match(profile, /selectedGallery === 'auction' && 'No live auctions right now\.'/);
  assert.match(profile, /selectedGallery === 'sold' && 'No completed sales yet\.'/);
  assert.match(profile, /selectedGallery === 'collected' && 'No collected NFTs yet\.'/);
  assert.match(profile, /const \[hasSettledArtworks, setHasSettledArtworks\] = useState\(false\);/);
});
