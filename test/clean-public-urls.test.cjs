const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

test('Vercel serves extensionless HTML routes and keeps legacy paths redirectable', () => {
  const config = JSON.parse(read('vercel.json'));

  assert.equal(config.cleanUrls, true);
  assert.ok(config.redirects.some(route => route.source === '/index' && route.destination === '/'));
  assert.ok(config.redirects.some(route => route.source === '/docs' && route.destination === '/docs-protocol'));
  assert.ok(config.redirects.some(route => route.source === '/auction-system' && route.destination === '/docs-protocol'));
  assert.ok(config.redirects.every(route => !/\.html(?:$|[?#])/.test(route.source + route.destination)));
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
