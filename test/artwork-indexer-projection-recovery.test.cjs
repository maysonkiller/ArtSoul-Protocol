const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const artwork = fs.readFileSync('src/entries/artwork.jsx', 'utf8');

test('the exact-artwork pending state retries projection reads in a bounded visible-tab loop', () => {
  assert.match(artwork, /error\?\.code !== 'V41_ARTWORK_NOT_INDEXED'/);
  assert.match(artwork, /projectionRetryCount >= 8/);
  assert.match(artwork, /setTimeout\([\s\S]*?3000\)/);
  assert.match(artwork, /document\.visibilityState === 'visible'/);
  assert.match(artwork, /document\.addEventListener\('visibilitychange'/);
});

test('a successful retry clears the pending projection state', () => {
  const success = artwork.slice(
    artwork.indexOf("console.log('[Artwork] Loaded data:', data);"),
    artwork.indexOf('setNewAuctionPrice', artwork.indexOf("console.log('[Artwork] Loaded data:', data);"))
  );

  assert.match(success, /setError\(null\)/);
  assert.match(success, /setProjectionRetryCount\(0\)/);
  assert.match(artwork, />\s*Refresh now\s*</);
  assert.match(artwork, /Artwork is being finalized/);
  assert.doesNotMatch(artwork, /public V4\.1 projection/);
});
