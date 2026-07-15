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
  assert.match(profile, /isOwnProfile && selectedGallery === 'created'/);
  assert.doesNotMatch(profile, /ProfileArtworkSkeleton/);
  assert.doesNotMatch(profile, /profile-card-skeleton/);
  assert.match(profile, /artworksLoading \? \([\s\S]*CardGridSkeleton count=\{6\}[\s\S]*\) : \(/);
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
  assert.match(profile, /selectedGallery === 'created' && 'No created artworks yet\.'/);
  assert.match(profile, /selectedGallery === 'auction' && 'No live auctions right now\.'/);
  assert.match(profile, /selectedGallery === 'sold' && 'No completed sales yet\.'/);
  assert.match(profile, /selectedGallery === 'collected' && 'No collected NFTs yet\.'/);
});
