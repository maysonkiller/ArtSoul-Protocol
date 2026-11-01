const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const gallery = fs.readFileSync('src/entries/gallery.jsx','utf8');
const css = fs.readFileSync('unified-styles.css','utf8');
const docs = fs.readFileSync('src/content/protocol-docs.js','utf8');

test('Gallery explains ranking signals with a collapsed native disclosure, not a paid analysis module', () => {
  assert.match(gallery,/<details className="gallery-signal-help">/);
  assert.match(gallery,/<summary>What do Discovery Rank and signals mean\?<\/summary>/);
  assert.doesNotMatch(gallery,/<details className="gallery-signal-help" open/);
  for (const label of ['Discovery Rank','Would Buy','Watching','Trust','Floor']) {
    assert.ok(gallery.includes('<dt>' + label + '</dt>'), label);
  }
  assert.match(gallery, /expression of interest, not a bid, offer or payment/);
  assert.match(gallery, /Trust<\/dt><dd>Changes discovery visibility only, never ownership, price, floor or royalties/);
  assert.match(gallery, /Floor<\/dt><dd>Exists only after a successful primary auction settlement/);
});

test('FAQ links point to real canonical public documentation anchors', () => {
  for (const id of ['trust-community','discovery','settlement']) {
    assert.ok(gallery.includes('/docs-protocol#' + id), id);
    assert.ok(docs.includes('id: "' + id + '"'), id);
  }
});

test('disclosure retains keyboard and mobile access, no overlay or new contract behavior', () => {
  assert.match(css, /B18-V5: native disclosure/);
  assert.match(css, /\.gallery-signal-help > summary \{[\s\S]*?min-height: 44px;/);
  assert.match(css, /\.gallery-signal-help-content a \{[\s\S]*?min-height: 44px;/);
  assert.match(css, /@media \(max-width: 640px\) \{[\s\S]*?\.gallery-signal-help-content dl/);
  const section = gallery.slice(gallery.indexOf('{/* B18-V5:'), gallery.indexOf('{/* Results Count */}'));
  assert.doesNotMatch(section, /fetch\(|setState|setSortBy|contract|wallet|useEffect|Math\.random/);
});
