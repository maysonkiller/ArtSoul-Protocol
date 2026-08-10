const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const artwork = fs.readFileSync('src/entries/artwork.jsx', 'utf8');

test('the exact-artwork pending state retries projection reads in a bounded visible-tab loop', () => {
  assert.match(artwork, /error\?\.code !== 'V41_ARTWORK_NOT_INDEXED'/);
  assert.match(artwork, /projectionRetryCount >= PROJECTION_RETRY_DELAYS_MS\.length/);
  assert.match(artwork, /PROJECTION_RETRY_DELAYS_MS\[projectionRetryCount\]/);
  assert.match(artwork, /document\.visibilityState === 'visible'/);
  assert.match(artwork, /document\.addEventListener\('visibilitychange'/);
});

test('the retry ladder starts fast and stays bounded', () => {
  const declaration = artwork.match(/const PROJECTION_RETRY_DELAYS_MS = \[([^\]]+)\]/);
  assert.ok(declaration, 'the retry ladder must be declared as an explicit list of delays');

  const delays = declaration[1].split(',').map(value => Number(value.trim()));
  assert.ok(delays.every(Number.isFinite), 'every delay must be a number');

  // The first check has to happen well inside a second: a projection that is
  // already there must not be hidden behind a long fixed interval.
  assert.ok(delays[0] <= 500, 'the first retry must fire within 500ms');

  // The ladder may only widen, and the whole loop stays bounded.
  for (let index = 1; index < delays.length; index += 1) {
    assert.ok(delays[index] >= delays[index - 1], 'delays must not shrink');
  }
  assert.ok(delays.reduce((total, delay) => total + delay, 0) <= 30000, 'the bounded loop must stay under 30s');
});

test('a successful retry clears the pending projection state', () => {
  const success = artwork.slice(
    artwork.indexOf("console.log('[Artwork] Loaded data:', data);"),
    artwork.indexOf('setNewAuctionPrice', artwork.indexOf("console.log('[Artwork] Loaded data:', data);"))
  );

  assert.match(success, /setError\(null\)/);
  assert.match(success, /setProjectionRetryCount\(0\)/);
  assert.doesNotMatch(artwork, /public V4\.1 projection/);
});

test('the pending screen shows the wordmark and nothing else', () => {
  const pending = artwork.slice(
    artwork.indexOf("error?.code === 'V41_ARTWORK_NOT_INDEXED'"),
    artwork.indexOf('if (error) {', artwork.indexOf("error?.code === 'V41_ARTWORK_NOT_INDEXED'"))
  );

  // The wait state is the ArtSoul mark centred on the screen. Explanatory copy,
  // the raw id chip and the escape buttons were noise on a screen that resolves
  // itself in under a second.
  assert.match(pending, /artsoul-wait-word/);
  assert.doesNotMatch(pending, /Refresh now|Explore Art/);
  assert.doesNotMatch(pending, /artsoul-wait-copy|artsoul-wait-id/);

  // The id still has to reach assistive technology.
  assert.match(pending, /className="sr-only">Loading artwork/);
});

test('the pending screen is the branded wait indicator, not raw theme hex', () => {
  assert.match(artwork, /className="artsoul-wait/);
  assert.match(artwork, /artsoul-wait-dot/);
  assert.match(artwork, /aria-live="polite"/);

  // Canon 16: theme colors live in unified-styles.css as variables, never as
  // hardcoded utility colors on the page.
  const pending = artwork.slice(
    artwork.indexOf("error?.code === 'V41_ARTWORK_NOT_INDEXED'"),
    artwork.indexOf('if (error) {', artwork.indexOf("error?.code === 'V41_ARTWORK_NOT_INDEXED'"))
  );
  assert.doesNotMatch(pending, /bg-(gray|cyan)-\d/);
  assert.doesNotMatch(pending, /text-(gray|cyan)-\d/);
});
