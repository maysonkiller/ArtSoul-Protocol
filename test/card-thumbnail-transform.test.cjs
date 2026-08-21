const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('src/ui/components/artwork-card.js', 'utf8');

// The sizing lives in storage-image.js, a plain script loaded before every
// consumer. Loading the real function keeps this test honest: a stub would let
// the card and the header drift apart without anything failing.
function loadStorageRenderUrl() {
  const source = fs.readFileSync('storage-image.js', 'utf8');
  const win = {};
  new Function('window', 'URL', source)(win, URL);
  return (url, width, quality) => win.ArtSoulStorageImage.sized(url, width, quality);
}

function loadCard() {
  const win = {
    ArtSoulStorageImage: { sized: loadStorageRenderUrl() },
    addEventListener() {},
    document: { addEventListener() {}, querySelectorAll: () => [] }
  };
  new Function('window', 'document', 'URL', 'console', source)(win, win.document, URL, console);
  return win.ArtSoulArtworkCard;
}

// The real allowed host, because the sizing validates it.
const OBJECT = 'https://bexigvqrunomwtjsxlej.supabase.co/storage/v1/object/public/artworks/uploads/a/b.png';

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

test('a page without the shared helper still renders cards', () => {
  // artwork-card.js is a classic script and supabase-client.js is a module, so
  // the helper is read at call time and its absence must cost the sizing only.
  const win = { addEventListener() {}, document: { addEventListener() {}, querySelectorAll: () => [] } };
  new Function('window', 'document', 'URL', 'console', source)(win, win.document, URL, console);
  const d = win.ArtSoulArtworkCard.mediaDescriptor({ file_type: 'image/png', file_url: OBJECT });
  assert.equal(d.thumbnailUrl, OBJECT);
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
    'https://bexigvqrunomwtjsxlej.supabase.co/storage/v1/object/public/artworks/1777588989698_Image',
    'https://bexigvqrunomwtjsxlej.supabase.co/storage/v1/object/public/artworks/logo.svg'
  ]) {
    const d = card.mediaDescriptor({ file_type: 'image', file_url: url });
    assert.equal(d.thumbnailUrl, url);
  }
});

test('a bare "image" file_type on a .gif URL still classifies as gif', () => {
  const card = loadCard();
  const url = 'https://bexigvqrunomwtjsxlej.supabase.co/storage/v1/object/public/artworks/loop.gif';
  const d = card.mediaDescriptor({ file_type: 'image', file_url: url });
  assert.equal(d.type, 'gif');
  assert.equal(d.thumbnailUrl, url);
});

// The lines of a function definition, from its opening line to the first line
// whose indentation returns to the definition's own level.
function functionBody(source, definitionLine) {
  const lines = source.split('\n');
  const start = lines.findIndex((l) => l.includes(definitionLine));
  assert.ok(start > -1, `definition not found: ${definitionLine}`);
  const indent = lines[start].match(/^\s*/)[0].length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const l = lines[i];
    if (l.trim() && l.match(/^\s*/)[0].length <= indent) return lines.slice(start, i + 1).join('\n');
  }
  return lines.slice(start).join('\n');
}

test('the surfaces large enough to reframe an avatar show the upload itself', () => {
  // Live uploads are 400x400, 832x1248, 1254x1254 and 4032x3024. At 112px and
  // above, forcing them all through one render width visibly reframes the
  // non-square ones and upscales the small ones, which is what made the profile
  // wrong. These two keep the upload.
  const definitions = {
    'src/entries/profile.jsx': 'function getProfileAvatarUrl(profileData) {',
    'src/entries/artwork.jsx': 'function getProfileAvatarUrl(profileData, address'
  };
  for (const [file, definition] of Object.entries(definitions)) {
    const body = functionBody(fs.readFileSync(file, 'utf8'), definition);
    assert.doesNotMatch(body, /storageRenderUrl/, `${file}: getProfileAvatarUrl must return the upload itself`);
  }
});

test('the 40px account button does not wait on megabytes', () => {
  // Loading the upload into a 40px circle means the identity cannot commit
  // until it decodes - measured 2.37 MB - so the button shows a half-drawn
  // picture and the resolving label stays on screen. At this size 128px cannot
  // be told apart from the original.
  const body = functionBody(fs.readFileSync('avatar-dropdown.js', 'utf8'), 'getProfileAvatarUrl(profile) {');
  assert.match(body, /resize\(source, HEADER_BUTTON_AVATAR_WIDTH\)/);
  assert.match(fs.readFileSync('avatar-dropdown.js', 'utf8'), /const HEADER_BUTTON_AVATAR_WIDTH = 128;/);
});

test('the cached preview is captured from a copy nobody sees', () => {
  const dropdown = fs.readFileSync('avatar-dropdown.js', 'utf8');
  assert.match(dropdown, /const AVATAR_PREVIEW_SOURCE_WIDTH = 128;/);
  assert.match(dropdown, /captureAvatarPreviewFor\(snapshot, corsAttempt, preloader\)/);
  // The small copy is only ever a capture source: it is never written to an
  // element that paints.
  const body = functionBody(dropdown, 'captureAvatarPreviewFor(snapshot, corsAttempt, decodedDisplayImage)');
  assert.match(body, /source\.src = small;/);
  assert.doesNotMatch(body, /paintSrc/);
  assert.doesNotMatch(body, /image\.src/);
});

test('artwork cards still ask for a sized copy', () => {
  // Cards are unaffected by the avatar revert: a card thumbnail is a crop of a
  // work, not a portrait, and the dark cards were reported separately.
  const card = fs.readFileSync('src/ui/components/artwork-card.js', 'utf8');
  assert.match(card, /const CARD_THUMBNAIL_WIDTH = 600;/);
  assert.match(card, /resize\(url, CARD_THUMBNAIL_WIDTH\)/);
});

test('the sizing exists before anything that paints an image', () => {
  // This is the whole bug. The helper lived in supabase-client.js, a module
  // reached only through the page bundle. avatar-dropdown.js is a classic
  // deferred script and paints the account button roughly three seconds before
  // that bundle executes on a phone, so it called a function that did not exist
  // yet and silently fell back to the upload itself - a 2.37 MB picture for a
  // 40px circle, with the guest avatar on screen until it finished.
  const PAGES = ['index.html', 'gallery.html', 'artwork.html', 'profile.html',
                 'upload.html', 'docs-protocol.html', 'admin.html'];
  for (const page of PAGES) {
    const html = fs.readFileSync(page, 'utf8');
    const sizing = html.indexOf('storage-image.js');
    assert.ok(sizing > -1, `${page} must load the sizing helper`);
    for (const consumer of ['avatar-dropdown.js', 'artwork-card.js']) {
      const at = html.indexOf(consumer);
      if (at === -1) continue;
      assert.ok(sizing < at, `${page}: the sizing must load before ${consumer}`);
    }
  }
});

test('nothing reaches for the sizing through the page bundle any more', () => {
  for (const file of ['avatar-dropdown.js', 'src/ui/components/artwork-card.js']) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /ArtSoulSecurity\?\.storageRenderUrl/,
      `${file} must not depend on a module that executes after it paints`);
    assert.match(text, /window\.ArtSoulStorageImage\?\.sized/);
  }
  // One implementation. The module name survives for module consumers and
  // delegates to it.
  const client = fs.readFileSync('supabase-client.js', 'utf8');
  assert.match(client, /const sizer = window\.ArtSoulStorageImage\?\.sized;/);
  assert.doesNotMatch(client, /RESAMPLEABLE_STILL/);
});
