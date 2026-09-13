const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const detail = fs.readFileSync('src/entries/artwork.jsx', 'utf8');

test('artwork ownership never paints a third-party identicon while the creator profile loads', () => {
  const fallback = detail.slice(
    detail.indexOf('function getDefaultProfileAvatar'),
    detail.indexOf('function getProfileDisplayName')
  );

  assert.match(fallback, /return ['"]\/default-avatar\.png['"]/);
  assert.doesNotMatch(fallback, /dicebear/i);
});

test('the exact projection seeds creator identity before the first content frame', () => {
  const loadArtwork = detail.slice(
    detail.indexOf('async function loadArtwork()'),
    detail.indexOf('function updateTimeLeft()')
  );
  const seed = loadArtwork.indexOf('setCreatorProfile(projectedCreatorAddress ?');
  const release = loadArtwork.indexOf('setLoading(false);');
  const profileRequest = loadArtwork.indexOf('window.ArtSoulDB.getProfile(address)');

  assert.ok(seed >= 0, 'creator identity is seeded from the exact artwork projection');
  assert.ok(release > seed, 'the seeded identity exists before content replaces the skeleton');
  assert.ok(profileRequest > release, 'supplementary profile hydration remains off the page-load gate');
  assert.match(loadArtwork, /username: data\.creator_name \|\| ''/);
  assert.match(loadArtwork, /avatar_url: data\.creator_avatar_url \|\| ''/);
  assert.match(loadArtwork, /if \(hydratedCreatorProfile\) setCreatorProfile\(hydratedCreatorProfile\)/);
  assert.doesNotMatch(loadArtwork, /setCreatorProfile\(profiles\.get\([^)]+\) \|\| null\)/);
});

test('ownership decodes the avatar without hiding the known name or painting a second background image', () => {
  const ownership = detail.slice(detail.indexOf('function OwnershipIdentity'), detail.indexOf('const ZERO_ADDRESS'));
  assert.match(ownership, /useDecodedImage\(source, '\/default-avatar\.png'\)/);
  assert.match(ownership, /image\.url \? <img/);
  assert.match(ownership, /style=\{nameStyle\}>\{name\}/);
  assert.doesNotMatch(ownership, /backgroundImage/);
  assert.match(detail, /identityResolved \? getProfileAvatarUrl\(resolvedProfile, address\) : ''/);
  assert.match(detail, /key=\{address\.toLowerCase\(\)\}/);
});
