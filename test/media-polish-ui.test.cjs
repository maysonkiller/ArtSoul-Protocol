const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const source = fs.readFileSync('src/ui/components/artwork-card.js', 'utf8');
const css = fs.readFileSync('unified-styles.css', 'utf8');
const detail = fs.readFileSync('artwork.html', 'utf8') + fs.readFileSync('src/entries/artwork.jsx', 'utf8');
const gallery = fs.readFileSync('gallery.html', 'utf8') + fs.readFileSync('src/entries/gallery.jsx', 'utf8');
const homepage = fs.readFileSync('index.html', 'utf8') + fs.readFileSync('src/entries/index.js', 'utf8');
const profile = fs.readFileSync('profile.html', 'utf8') + fs.readFileSync('src/entries/profile.jsx', 'utf8');

test('all card surfaces use the shared first-paint media descriptor', () => {
  assert.match(source, /const descriptor = mediaDescriptor\(artwork\)/);
  assert.match(source, /if \(!descriptor\.known\)[\s\S]*createMediaLoadingElement/);
  assert.match(homepage, /surface: 'homepage'/);
  assert.match(gallery, /surface="gallery"/);
  assert.match(profile, /ArtSoulArtworkCard\?\.ReactMedia/);
});

test('detail uses the shared descriptor and never defaults unresolved media to audio UI', () => {
  assert.match(detail, /ArtSoulArtworkCard\?\.mediaDescriptor\?\.\(artwork\)/);
  assert.match(detail, /mediaType === 'unknown'[\s\S]*artsoul-media-loading/);
  assert.match(detail, /mediaType === 'video'[\s\S]*mediaType === 'audio'/);
  assert.doesNotMatch(detail, /const getMediaType =/);
});

test('title polish is surface-scoped and keeps homepage shimmer available', () => {
  assert.match(css, /artsoul-artwork-card-gallery \.artsoul-card-title[\s\S]*animation: none !important/);
  assert.match(css, /profile-artwork-card \.artsoul-card-title/);
  assert.match(css, /\.future h1,[\s\S]*\.future h3[\s\S]*animation: gradientFlow/);
  assert.doesNotMatch(css, /artsoul-artwork-card-homepage \.artsoul-card-title[\s\S]*animation: none/);
});

test('borders, Add New alignment, and status pills use shared themed styling', () => {
  assert.match(css, /--c-card-border:/);
  assert.match(css, /border: 1px solid var\(--c-card-border\)/);
  assert.match(css, /TODO: Use an iridescent ownership border/);
  assert.match(profile, /artsoul-add-new-card text-center/);
  assert.match(css, /artsoul-add-new-card \.artsoul-card-body[\s\S]*text-align: center/);
  assert.match(css, /\.artsoul-card-status,[\s\S]*justify-content: center/);
});
