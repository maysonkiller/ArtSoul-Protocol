const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const canonicalOrigin = 'https://artsoulprotocol.com';
const legacyOrigin = 'https://artsoul.vercel.app';

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('public pages publish canonical ArtSoul domain metadata', () => {
  const pages = new Map([
    ['index.html', `${canonicalOrigin}/`],
    ['gallery.html', `${canonicalOrigin}/gallery`],
    ['profile.html', `${canonicalOrigin}/profile`],
    ['upload.html', `${canonicalOrigin}/upload`],
    ['artwork.html', `${canonicalOrigin}/artwork`],
    ['docs-protocol.html', `${canonicalOrigin}/docs-protocol`]
  ]);

  for (const [page, canonicalUrl] of pages) {
    const source = read(page);
    assert.match(source, new RegExp(`<link rel="canonical" href="${canonicalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">`));
    assert.ok(source.includes(`${canonicalOrigin}/artsoul-social-preview.png?v=1`), `${page} must use the canonical social image`);
    assert.ok(source.includes(`content="${canonicalUrl}"`), `${page} must publish its canonical URL`);
  }
});

test('runtime defaults use the canonical origin and retain a bounded rollback origin', () => {
  assert.ok(read('appkit-init.js').includes(`: '${canonicalOrigin}';`));
  assert.ok(read('ipfs-client.js').includes(`external_url: '${canonicalOrigin}/upload'`));

  for (const file of ['src/api/server.js', 'src/api/routes/oauth.js', '.env.example']) {
    const source = read(file);
    assert.ok(source.includes(canonicalOrigin), `${file} must allow the canonical origin`);
    assert.ok(source.includes(legacyOrigin), `${file} must retain the temporary rollback origin`);
  }
});

test('active operator documentation points to the canonical domain', () => {
  for (const file of [
    'README.md',
    'docs/HANDOFF.md',
    'docs/SOCIAL_LINKING_SETUP.md',
    'docs/runbooks/A11_PUBLIC_METRICS_ROLLOUT.md',
    'docs/runbooks/PERMANENT_DOMAIN_CUTOVER.md'
  ]) {
    assert.ok(read(file).includes(canonicalOrigin), `${file} must name the canonical origin`);
  }
});
