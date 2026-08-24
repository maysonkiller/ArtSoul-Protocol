const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

test('branded runtime media resolves from the site root on clean subpath routes', () => {
  const runtimeFiles = [
    'src/entries/artwork.jsx',
    'src/entries/gallery.jsx',
    'src/entries/index.js',
    'src/entries/generate-favicon.js',
    'src/ui/components/artwork-card.js'
  ];
  const relativeBrandAsset = /(['"])ARTSOULlogo(?:-clean)?\.png(?:\?[^'"]*)?\1/g;

  for (const file of runtimeFiles) {
    assert.doesNotMatch(
      read(file),
      relativeBrandAsset,
      `${file} must keep branded assets root-absolute for /artwork/<id>`
    );
  }

  assert.match(
    read('src/entries/artwork.jsx'),
    /src="\/ARTSOULlogo\.png"/,
    'the audio detail must render its branded visual from the site root'
  );
});
