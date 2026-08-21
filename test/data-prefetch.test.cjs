const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const script = fs.readFileSync('data-prefetch.js', 'utf8');
const client = fs.readFileSync('supabase-client.js', 'utf8');

const SHARED_HEADER_PAGES = [
  'index.html', 'gallery.html', 'artwork.html',
  'profile.html', 'upload.html', 'docs-protocol.html', 'admin.html'
];

function run(pathname, search, storage = {}) {
  const calls = [];
  const win = {
    location: { pathname, search },
    localStorage: { getItem: (k) => (k in storage ? storage[k] : null) }
  };
  const fetchStub = (url, init) => {
    calls.push({ url, init });
    return { catch() { return this; } };
  };
  new Function('window', 'fetch', 'URLSearchParams', 'localStorage', 'Map', script)(
    win, fetchStub, URLSearchParams, win.localStorage, Map
  );
  return { calls, api: win.ArtSoulPrefetch };
}

const MIXED = '0x6EC8C121043357aC231E36D403EdAbf90AE6989B';

test('a profile starts its own gallery request from the head', () => {
  // Measured on the apex, iPhone viewport, 6x CPU slowdown: the document is
  // interactive at 674 ms but the modules finish at 3276 ms, and the content
  // request was not issued until 3410 ms because it waited for them. The
  // network sat idle for 2.7 seconds of blank screen.
  const { calls } = run('/profile', `?address=${MIXED}`);
  assert.deepEqual(calls.map((c) => c.url), [
    '/api/public/config',
    `/api/public/artworks?creator=${MIXED}&limit=200`
  ]);
  assert.equal(calls[0].init.credentials, 'include');
});

test('your own profile carries no address, so the cached wallet is used', () => {
  const { calls } = run('/profile', '', { artsoul_wallet: MIXED.toLowerCase() });
  assert.equal(calls[1].url, `/api/public/artworks?creator=${MIXED.toLowerCase()}&limit=200`);
});

test('no wallet anywhere means no gallery guess', () => {
  const { calls } = run('/profile', '');
  assert.deepEqual(calls.map((c) => c.url), ['/api/public/config']);
});

test('a request is handed to exactly one consumer, never cached', () => {
  const { api } = run('/profile', `?address=${MIXED}`);
  const path = `/api/public/artworks?creator=${MIXED}&limit=200`;
  assert.ok(api.take(path), 'the first consumer receives it');
  assert.equal(api.take(path), null, 'a second consumer must issue its own request');
});

test('an address is matched whatever case it was written in', () => {
  // The URL carries the checksummed form and the database row is lower case.
  const { api } = run('/profile', `?address=${MIXED}`);
  assert.ok(api.take(`/api/public/artworks?creator=${MIXED.toLowerCase()}&limit=200`));
});

test('a path nobody prefetched returns nothing', () => {
  const { api } = run('/', '');
  assert.equal(api.take('/api/public/auction-live?auction_id=7'), null);
});

test('the homepage asks for the feed it actually renders', () => {
  const { calls } = run('/', '');
  assert.deepEqual(calls.map((c) => c.url), ['/api/public/config', '/api/public/artworks?limit=100']);
});

test('backendRead consumes the head start when there is one', () => {
  assert.match(client, /const started = window\.ArtSoulPrefetch\?\.take\?\.\(path\);/);
  assert.match(client, /const response = started \? await started : await fetch\(path, \{/);
});

test('the request string matches what the page will ask for', () => {
  // The key is the request string, so parameter order matters. profile.jsx
  // builds { creator, limit } and index.js builds { limit }.
  const profile = fs.readFileSync('src/entries/profile.jsx', 'utf8');
  assert.match(profile, /\{ creator: walletAddress, limit: 200/);
  const index = fs.readFileSync('src/entries/index.js', 'utf8');
  assert.match(index, /getPublicProjectionArtworks\(\{ limit: 100 \}\)/);
});

test('every shared-header page loads it, and the build ships it', () => {
  for (const page of SHARED_HEADER_PAGES) {
    const html = fs.readFileSync(page, 'utf8');
    // Async, never blocking: only the prepaint bridge may hold up parsing, and
    // this is not a first-paint concern. It still executes within a few hundred
    // milliseconds, long before the modules that would otherwise issue this
    // request at 3.3 seconds.
    assert.match(html, /<script src="\/data-prefetch\.js\?v=1" async><\/script>/, `${page} must load the prefetch asynchronously`);
    assert.ok(
      html.indexOf('data-prefetch.js') > html.indexOf('header-prepaint.js'),
      `${page}: the first paint comes before the data`
    );
  }
  assert.match(fs.readFileSync('vite.config.js', 'utf8'), /'data-prefetch\.js',/);
});

test('a tab already seen this visit is shown without another round trip', () => {
  // Switching tabs went to the network every time, so the previous tab's cards
  // stayed on screen for the round trip and read as a flash of the wrong
  // content. Each tab's result is kept for this visit only.
  const profile = fs.readFileSync('src/entries/profile.jsx', 'utf8');
  assert.match(profile, /const galleryCacheRef = useRef\(new Map\(\)\);/);
  assert.match(profile, /const cached = galleryCacheRef\.current\.get\(cacheKey\);/);
  // Keyed by wallet too, so one profile can never read another's list.
  assert.match(profile, /const cacheKey = `\$\{String\(activeProfile\?\.wallet_address \|\| ''\)\.toLowerCase\(\)\}:\$\{requestedGallery\}`/);
  // A transaction just changed the chain: those callers ask for a fresh read.
  assert.equal((profile.match(/loadMyArtworks\(null, \{ fresh: true \}\)/g) || []).length, 3);
  assert.match(profile, /if \(fresh\) galleryCacheRef\.current\.clear\(\);/);
  // It never becomes a source of truth: the network result always replaces it.
  assert.match(profile, /galleryCacheRef\.current\.set\(cacheKey, result\.items\);/);
});

test('a placeholder does not announce itself', () => {
  // The skeleton carried the Future glow and a sweeping highlight, so a page
  // that waited a second read as a fault rather than as loading.
  const css = fs.readFileSync('unified-styles.css', 'utf8');
  assert.doesNotMatch(css, /artsoulSkeletonSweep/);
  assert.doesNotMatch(css, /body\.future \.artsoul-skeleton/);
});
