const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const pages = ['index.html','gallery.html','artwork.html','profile.html','upload.html','admin.html','docs-protocol.html','collection-builder.html','visual-lab.html'];
const css = fs.readFileSync('unified-styles.css', 'utf8');
const home = fs.readFileSync('index.html','utf8');

test('all product screens load the same shared geometry CSS v72', () => {
  for (const path of pages) {
    const html = fs.readFileSync(path,'utf8');
    assert.equal((html.match(/unified-styles\.css\?v=72/g) || []).length, 1, path);
  }
});

test('single responsive header geometry owns all three viewport groups in both themes', () => {
  assert.match(css,/B18\.2 — one measured visual system/);
  for (const bp of ['min-width: 1001px','min-width: 769px','max-width: 1000px','max-width: 768px'])
    assert.ok(css.includes(bp),bp);
  for (const px of ['76px','116px','105px'])
    assert.ok(css.includes(`--site-header-height: ${px} !important`),px);
  assert.match(css,/site-header-shell \{ max-width: 1720px !important/);
  assert.match(css,/site-header-row \{[\s\S]*?grid-template-rows: 44px 44px !important/);
  assert.match(css,/site-header-actions \{[\s\S]*?min-height: 44px/);
});

test('Home uses the wide shared canvas without increasing editorial copy width', () => {
  assert.match(css,/#homeSection \{ max-width: 1720px !important/);
  assert.match(css,/#homeSection \.home-hero-copy \{[\s\S]*?max-width: 700px/);
  assert.match(css,/#homeSection \.home-showcase \{[\s\S]*?max-width: 780px/);
  assert.match(home,/<h1[^>]*>Discover artworks<\/h1>/);
  assert.doesNotMatch(home,/Discover artworks\.<\/h1>/);
});

test('Explore uses density breakpoints while leaving card controls and loading skeletons in the same grid', () => {
  const gallery = fs.readFileSync('src/entries/gallery.jsx','utf8');
  assert.match(gallery,/className="gallery-results-grid"/);
  assert.match(gallery,/CardGridSkeleton className="gallery-results-grid"/);
  const layout = css.slice(css.indexOf('/* B18.2 — one measured visual system'));
  for (const cols of [4,5,6,7]) {
    assert.ok(layout.includes(`grid-template-columns: repeat(${cols}, minmax(0, 1fr))`), cols);
  }
  assert.match(layout,/\.gallery-results-grid \.artsoul-card-body \{/);
  assert.doesNotMatch(layout,/display: none !important;[^\n]*\.artsoul-card-menu/);
});

test('showcase artwork title and byline stay readable and clickable, without opaque controls or new media requests', () => {
  const js = fs.readFileSync('src/ui/home-showcase.js','utf8');
  const layout = css.slice(css.indexOf('/* B18.2 — one measured visual system'));
  assert.match(layout, /home-showcase-slide::after \{[\s\S]*?pointer-events: none/);
  assert.match(layout, /home-showcase-caption \{[\s\S]*?z-index: 2/);
  assert.match(layout, /home-showcase-caption :is\([\s\S]*?-webkit-text-fill-color: currentColor/);
  assert.match(layout, /#homeShowcaseControls \{[\s\S]*?z-index: 3/);
  assert.match(js, /const picture = document\.createElement\('img'\)/);
  assert.doesNotMatch(js, /getPublicProjectionArtworks|\.fetch\(|fetch\(/);
});
