const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('profile.html', 'utf8');
const profile = fs.readFileSync('src/entries/profile.jsx', 'utf8');
const skeletons = fs.readFileSync('src/entries/loading-skeletons.jsx', 'utf8');

test('a targeted profile paints a static skeleton before its module loads', () => {
  const app = html.indexOf('<div id="app"></div>');
  const template = html.indexOf('<template id="profileInitialSkeleton">');
  const staticSkeleton = html.indexOf('data-profile-static-skeleton');
  const entry = html.indexOf('<script type="module" src="/src/entries/profile.jsx"></script>');

  assert.ok(app >= 0 && app < template);
  assert.ok(template < staticSkeleton && staticSkeleton < entry);
  assert.match(html, /viewAddress \|\| walletHint/);
  assert.match(html, /template\.content\.cloneNode\(true\)/);
  assert.match(html, /aria-label="Loading profile" aria-busy="true"/);
  assert.doesNotMatch(
    html.slice(staticSkeleton, entry),
    /artsoul-placeholder/,
    'the first painted skeleton must not depend on a delayed animation'
  );
});

test('React adopts the static profile skeleton instead of replacing it', () => {
  assert.match(profile, /import \{ React, createRoot, hydrateRoot \} from '\.\/react-runtime\.js'/);
  assert.match(profile, /function ProfilePage\(\{ initialSkeletonVisible = false \}\)/);
  assert.match(profile, /profileAppRoot\.querySelector\('\[data-profile-static-skeleton\]'\)/);
  assert.match(profile, /data-profile-static-skeleton=\{initialSkeletonVisible \? '' : undefined\}/);
  assert.match(profile, /<ProfilePageSkeleton immediate=\{initialSkeletonVisible\} \/>/);
  assert.match(profile, /hydrateRoot\(profileAppRoot, profilePage\)/);
  assert.match(profile, /createRoot\(profileAppRoot\)\.render\(profilePage\)/);
});

test('immediate profile skeletons bypass both placeholder delays', () => {
  assert.match(skeletons, /ProfilePageSkeleton\(\{ className = '', immediate = false \}\)/);
  assert.match(skeletons, /\$\{immediate \? '' : PLACEHOLDER\}/);
  assert.match(skeletons, /<CardGridSkeleton count=\{6\} immediate=\{immediate\} \/>/);
});

test('profile identity and initial gallery commit as one coherent frame', () => {
  const loadStart = profile.indexOf('async function loadProfile');
  const loadEnd = profile.indexOf('async function fetchProfileArtworks', loadStart);
  const block = profile.slice(loadStart, loadEnd);
  const combinedAwait = block.indexOf('await Promise.allSettled([');
  const identityCommit = block.indexOf('setProfile(profileData);');
  const galleryCommit = block.indexOf('setMyArtworks(artworkData.items);');
  const loadingRelease = block.lastIndexOf('setLoading(false);');

  assert.ok(combinedAwait >= 0 && combinedAwait < identityCommit);
  assert.ok(identityCommit < galleryCommit && galleryCommit < loadingRelease);
  assert.doesNotMatch(
    block.slice(identityCommit, galleryCommit),
    /setLoading\(false\)/,
    'the loading surface must not disappear between the identity and gallery commits'
  );
  assert.match(profile, /displayedGallery !== selectedGallery \|\| \(artworksLoading && !hasSettledArtworks\) \? null : \(/);
});
