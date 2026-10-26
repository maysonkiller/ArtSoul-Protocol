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
  const socialImage = fs.readFileSync(path.join(root, 'artsoul-social-preview-v2.png'));
  assert.equal(socialImage.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(socialImage.toString('ascii', 12, 16), 'IHDR');
  assert.equal(socialImage.readUInt32BE(16), 1730);
  assert.equal(socialImage.readUInt32BE(20), 909);
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
    for (const tag of ['property="og:image"', 'name="twitter:image"']) {
      assert.ok(source.includes(`${tag} content="${canonicalOrigin}/artsoul-social-preview-v2.png"`), `${page} must use the versioned canonical social image for ${tag}`);
    }
    assert.ok(!source.includes('artsoul-social-preview.png?v=1'), `${page} must not retain the old default image`);
    assert.ok(source.includes(`property="og:image:width" content="${socialImage.readUInt32BE(16)}"`), `${page} must declare the actual PNG width`);
    assert.ok(source.includes(`property="og:image:height" content="${socialImage.readUInt32BE(20)}"`), `${page} must declare the actual PNG height`);
    assert.ok(source.includes('property="og:image:type" content="image/png"'));
    for (const tag of ['property="og:image:alt"', 'name="twitter:image:alt"']) {
      assert.ok(source.includes(`${tag} content="ArtSoul wordmark beside a cyan and violet glass sculpture on a dark background."`));
    }
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

test('old default-image links redirect to the approved image without changing artwork media', () => {
  const {redirects} = JSON.parse(read('vercel.json'));
  const alias = redirects.find(route => route.source === '/artsoul-social-preview.png');
  assert.deepEqual(alias, {
    source: '/artsoul-social-preview.png', destination: '/artsoul-social-preview-v2.png', permanent: true
  });
  // The exact path is unconditional: old metadata with or without ?v=1 works
  // for every crawler, while no artwork or media-storage path is redirected.
  for (const path of ['/artsoul-social-preview.png', '/artsoul-social-preview.png?v=1']) {
    assert.equal(new URL(path, canonicalOrigin).pathname, alias.source);
  }
  assert.notEqual(alias.source, alias.destination);
  assert.ok(read('vite.config.js').includes("'artsoul-social-preview-v2.png'"));
  assert.equal(fs.readFileSync(path.join(root, alias.destination.slice(1))).subarray(0, 8).toString('hex'),
    '89504e470d0a1a0a', 'the target is a real PNG, matching its served MIME type');
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
