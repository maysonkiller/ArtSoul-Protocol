const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

const vm = require('node:vm');

/** Run src/ui/artwork-url.js as the browser does and return its global. */
function loadArtworkUrlGlobal() {
  const sandbox = { window: {}, URLSearchParams };
  vm.runInNewContext(read('src/ui/artwork-url.js'), sandbox);
  assert.ok(sandbox.window.ArtSoulArtworkUrl, 'the script must publish window.ArtSoulArtworkUrl');
  return sandbox.window.ArtSoulArtworkUrl;
}

test('Vercel serves extensionless HTML routes and keeps legacy paths redirectable', () => {
  const config = JSON.parse(read('vercel.json'));

  assert.equal(config.cleanUrls, true);
  assert.ok(config.redirects.some(route => route.source === '/index' && route.destination === '/'));
  assert.ok(config.redirects.some(route => route.source === '/docs' && route.destination === '/docs-protocol'));
  assert.ok(config.redirects.some(route => route.source === '/auction-system' && route.destination === '/docs-protocol'));
  assert.ok(config.redirects.every(route => !/\.html(?:$|[?#])/.test(route.source + route.destination)));
});

test('short artwork URLs are routed and trailing slashes are normalised', () => {
  const config = JSON.parse(read('vercel.json'));

  assert.equal(config.trailingSlash, false);
  assert.ok(
    config.rewrites.some(route => route.source === '/artwork/:id' && route.destination === '/artwork?id=:id'),
    'the short artwork path must rewrite onto the existing artwork route'
  );

  // The short path must not fall out of the no-store cache group.
  assert.ok(
    config.headers.some(entry => /artwork/.test(entry.source) && /\(\/\.\*\)\?/.test(entry.source)),
    'the page cache rule must also cover /artwork/<id>'
  );
});

test('artwork URLs shorten only where the chain is unambiguous', () => {
  // Evaluated the way a browser runs it: a classic script that publishes a
  // global. require() cannot be used - package.json declares "type": "module".
  const { artworkPath, expandArtworkId, currentArtworkId } = loadArtworkUrlGlobal();

  // /artwork/<id> is a server-side rewrite: the browser keeps the path and
  // carries no query string, so reading only location.search finds nothing on
  // exactly the URLs the product links to.
  assert.equal(currentArtworkId({ pathname: '/artwork/27', search: '' }), 'v41:84532:27');
  assert.equal(currentArtworkId({ pathname: '/artwork/27/', search: '' }), 'v41:84532:27');
  assert.equal(
    currentArtworkId({ pathname: '/artwork', search: '?id=v41:11155111:27' }),
    'v41:11155111:27'
  );
  assert.equal(currentArtworkId({ pathname: '/artwork', search: '' }), '');

  assert.equal(artworkPath('v41:84532:27'), '/artwork/27');
  assert.equal(expandArtworkId('27'), 'v41:84532:27');

  // Legacy Ethereum Sepolia keeps the explicit composite: a bare number there
  // would collide with the Base Sepolia artwork of the same number.
  assert.equal(artworkPath('v41:11155111:27'), '/artwork?id=v41%3A11155111%3A27');
  assert.equal(expandArtworkId('v41:11155111:27'), 'v41:11155111:27');

  assert.equal(artworkPath(''), '');
  assert.equal(artworkPath(null), '');
});

test('runtime navigation builds artwork URLs through the shared helper', () => {
  for (const file of [
    'src/entries/gallery.jsx',
    'src/entries/index.js',
    'src/entries/upload.js',
    'src/entries/admin.jsx'
  ]) {
    assert.doesNotMatch(
      read(file),
      /`\/artwork\?id=\$\{/,
      `${file} must not hand-build an artwork URL`
    );
  }
});

test('public metadata and runtime navigation use canonical extensionless URLs', () => {
  const canonicalPages = new Map([
    ['index.html', 'https://artsoulprotocol.com/'],
    ['gallery.html', 'https://artsoulprotocol.com/gallery'],
    ['artwork.html', 'https://artsoulprotocol.com/artwork'],
    ['profile.html', 'https://artsoulprotocol.com/profile'],
    ['upload.html', 'https://artsoulprotocol.com/upload'],
    ['docs-protocol.html', 'https://artsoulprotocol.com/docs-protocol']
  ]);

  for (const [file, canonicalUrl] of canonicalPages) {
    const source = read(file);
    assert.ok(source.includes(`<link rel="canonical" href="${canonicalUrl}">`), `${file} canonical URL`);
    assert.ok(source.includes(`content="${canonicalUrl}"`), `${file} Open Graph URL`);
  }

  const runtimeFiles = [
    'index.html',
    'admin.html',
    'artwork.html',
    'gallery.html',
    'profile.html',
    'upload.html',
    'src/api/routes/oauth.js',
    'src/entries/admin.jsx',
    'src/entries/artwork.jsx',
    'src/entries/gallery.jsx',
    'src/entries/index.js',
    'src/entries/profile.jsx',
    'src/entries/upload.js',
    'src/ui/components/artwork-card.js',
    'src/ui/components/BackButton.js',
    'src/ui/components/ProfileButton.js'
  ];

  for (const file of runtimeFiles) {
    assert.doesNotMatch(
      read(file),
      /(?:href|location(?:\.href|\.assign|\.replace)?|navigateAfterPublish|external_url|Location)[^\n]{0,120}\.html(?:[?#'"`]|$)/,
      `${file} must not emit an .html navigation URL`
    );
  }

  for (const file of ['avatar-dropdown.js', 'appkit-init.js', 'src/ui/navigation-manager.js']) {
    const source = read(file);
    assert.doesNotMatch(source, /(?:href|includes|location\.href)[^\n]{0,100}\.html(?:[?#'"`]|$)/);
    assert.ok(source.includes(".replace(/\\.html$/, '')"), `${file} must normalize legacy .html paths`);
  }
});

test('the public artworks route resolves a short artwork id', async () => {
  const source = read('src/api/routes/public/artworks.js');

  // Both the fetch and the post-fetch filter must understand the short form,
  // otherwise the row is read and then dropped.
  assert.ok(source.includes('const CANONICAL_PUBLIC_CHAIN_ID = 84532;'));
  assert.ok(
    source.includes('return { chain: CANONICAL_PUBLIC_CHAIN_ID, artworkId: rawId };'),
    'the direct lookup must resolve a bare id on the product chain'
  );
  assert.ok(
    source.includes('const compositeId =') && source.includes('card.id === compositeId'),
    'the card filter must compare against the widened composite id'
  );
});

test('a page served at a subpath must not use relative asset references', () => {
  // /artwork/<id> is served by rewrite, so the browser resolves relative
  // references against /artwork/ and requests files that do not exist there.
  // Every same-origin reference on this page has to be root-absolute.
  const relative = /\s(?:src|href)="(?!\/|https?:\/\/|data:|#|mailto:)([^"]+)"/g;

  for (const file of ['artwork.html', 'dist/artwork.html']) {
    let source;
    try {
      source = read(file);
    } catch {
      continue; // dist only exists after a build
    }

    const offenders = [...source.matchAll(relative)].map(match => match[1]);
    assert.deepEqual(offenders, [], `${file} must not reference assets relatively`);
  }
});

test('one module owns artwork URLs and every surface loads it', () => {
  // artwork-card.js builds card markup during classic-script execution, before
  // deferred modules run. A module owner would be missing at that moment and
  // the homepage and the cards would emit different URLs for the same artwork.
  for (const page of ['artwork.html', 'index.html', 'gallery.html', 'profile.html', 'upload.html', 'admin.html']) {
    const html = read(page);
    assert.ok(html.includes('/src/ui/artwork-url.js'), `${page} must load the artwork URL owner`);

    const owner = html.indexOf('/src/ui/artwork-url.js');
    const card = html.indexOf('/src/ui/components/artwork-card.js');
    if (card !== -1) {
      assert.ok(owner < card, `${page}: the URL owner must load before artwork-card.js`);
    }
  }

  // No surface may keep a private copy of the URL shape.
  for (const file of [
    'src/entries/artwork.jsx',
    'src/entries/gallery.jsx',
    'src/entries/index.js',
    'src/entries/upload.js',
    'src/entries/admin.jsx',
    'src/ui/components/artwork-card.js'
  ]) {
    assert.doesNotMatch(read(file), /`\/artwork\?id=\$\{/, `${file} must not hand-build an artwork URL`);
  }

  assert.doesNotMatch(
    read('src/entries/artwork.jsx'),
    /URLSearchParams\(window\.location\.search\)\.get\('id'\)/,
    'the artwork page must resolve its id through the owner, not from search alone'
  );
});
