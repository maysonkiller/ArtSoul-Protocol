const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('src/ui/components/artwork-card.js', 'utf8');

function loadCard() {
  const listeners = {};
  const win = {
    ArtSoulSecurity: { isValidStorageUrl: (u) => { try { return new URL(u).hostname === 'store.test'; } catch { return false; } } },
    addEventListener: (k, fn) => { listeners[k] = fn; },
    document: { addEventListener() {}, querySelectorAll: () => [] }
  };
  const sandbox = { window: win, document: win.document, URL, console };
  new Function('window', 'document', 'URL', 'console', source)(win, win.document, URL, console);
  return win.ArtSoulArtworkCard;
}

const OBJECT = 'https://store.test/storage/v1/object/public/artworks/uploads/a/b.png';

test('a still image from our own storage is requested as a sized copy', () => {
  // A-60. Measured on production: the first six profile cards pulled 7.9 MB of
  // original uploads, 1.32 MB each, which is why they sat dark for seconds.
  // The same image at width 600 quality 70 is 33 KB as WebP.
  const card = loadCard();
  const d = card.mediaDescriptor({ file_type: 'image/png', file_url: OBJECT });
  assert.equal(d.url, OBJECT, 'the original must stay reachable for detail views');
  assert.match(d.thumbnailUrl, /\/storage\/v1\/render\/image\/public\//);
  assert.match(d.thumbnailUrl, /width=600/);
  assert.match(d.thumbnailUrl, /quality=70/);
});

test('an animated or non-image source is never put through a still transform', () => {
  const card = loadCard();
  for (const [label, artwork] of Object.entries({
    gif: { file_type: 'image/gif', file_url: OBJECT.replace('.png', '.gif') },
    video: { file_type: 'video/mp4', file_url: OBJECT.replace('.png', '.mp4') },
    audio: { file_type: 'audio/mpeg', file_url: OBJECT.replace('.png', '.mp3') }
  })) {
    const d = card.mediaDescriptor(artwork);
    assert.equal(d.thumbnailUrl, d.url, `${label} must keep its original transport`);
  }
});

test('media hosted anywhere else is left untouched', () => {
  // IPFS and third-party hosts have no render endpoint; rewriting their URL
  // would break the image outright.
  const card = loadCard();
  for (const url of [
    'https://ipfs.io/ipfs/QmSomething/art.png',
    'https://cdn.elsewhere.test/storage/v1/object/public/x/y.png'
  ]) {
    const d = card.mediaDescriptor({ file_type: 'image/png', file_url: url });
    assert.equal(d.thumbnailUrl, url);
  }
});

test('both card renderers paint the thumbnail, not the original', () => {
  assert.match(source, /img\.src = descriptor\.thumbnailUrl \|\| url;/);
  assert.match(source, /src: descriptor\.thumbnailUrl \|\| url,/);
});

test('the transform is presentation only', () => {
  // mediaUrl still returns the original, so the artwork page, fullscreen and
  // anything reading projections are unaffected.
  const card = loadCard();
  assert.equal(card.mediaUrl({ file_type: 'image/png', file_url: OBJECT }), OBJECT);
});

test('an image the URL cannot vouch for is left alone', () => {
  // Production rows carry a bare 'image' in file_type, so an extensionless
  // upload could be a GIF. Transforming it would silently kill its animation.
  const card = loadCard();
  for (const url of [
    'https://store.test/storage/v1/object/public/artworks/1777588989698_Image',
    'https://store.test/storage/v1/object/public/artworks/logo.svg'
  ]) {
    const d = card.mediaDescriptor({ file_type: 'image', file_url: url });
    assert.equal(d.thumbnailUrl, url);
  }
});

test('a bare "image" file_type on a .gif URL still classifies as gif', () => {
  const card = loadCard();
  const url = 'https://store.test/storage/v1/object/public/artworks/loop.gif';
  const d = card.mediaDescriptor({ file_type: 'image', file_url: url });
  assert.equal(d.type, 'gif');
  assert.equal(d.thumbnailUrl, url);
});
