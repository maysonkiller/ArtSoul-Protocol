const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const upload = fs.readFileSync('src/entries/upload.js', 'utf8');
const artwork = fs.readFileSync('src/entries/artwork.jsx', 'utf8');
const styles = fs.readFileSync('unified-styles.css', 'utf8');

test('publishing hands the artwork page the one fact it cannot work out', () => {
  // The page cannot otherwise tell a normal visit from one straight out of a
  // publish, so its first frame was the generic page skeleton even though the
  // only thing being waited for is the indexer catching up.
  assert.match(upload, /\$\{path\}&published=1/);
  assert.match(upload, /\$\{path\}\?published=1/);
  assert.match(artwork, /get\('published'\) === '1'/);
});

test('that wait is named, not filled with a placeholder', () => {
  assert.match(artwork, /if \(\(loading && justPublished\) \|\| error\?\.code === 'V41_ARTWORK_NOT_INDEXED'\) \{/);
  // It is decided before the skeleton branch, which would otherwise own it.
  assert.ok(
    artwork.indexOf('loading && justPublished') < artwork.indexOf('<ArtworkPageSkeleton />'),
    'the branded wait must be chosen before the skeleton'
  );
  // One renderer for both waits, not two that can drift apart.
  assert.equal((artwork.match(/artsoul-wait-screen/g) || []).length, 1);
  assert.equal((artwork.match(/artsoul-wait-word/g) || []).length, 1);
});

test('an ordinary visit still gets the skeleton', () => {
  // Nothing is being waited for that we can name, so nothing is claimed.
  assert.match(artwork, /if \(loading\) \{[\s\S]{0,120}<ArtworkPageSkeleton \/>/);
});

test('the branded wait keeps its own styling and its accessible text', () => {
  assert.match(styles, /\.artsoul-wait-screen \{/);
  assert.match(styles, /\.artsoul-wait-stage \{/);
  assert.match(artwork, /role="status" aria-live="polite" aria-busy="true"/);
  assert.match(artwork, /<span className="sr-only">Loading artwork/);
});

test('justPublished is declared inside the component that uses it', () => {
  // It was first declared in a module-level helper, so every artwork page threw
  // "justPublished is not defined" and rendered nothing at all. The suite stayed
  // green because these assertions read source text, which cannot see scope.
  const componentStart = artwork.indexOf('function ArtworkPage() {');
  const declaration = artwork.indexOf('const justPublished =');
  const usage = artwork.indexOf('loading && justPublished');
  assert.ok(componentStart > -1, 'the component must be discoverable');
  assert.ok(declaration > componentStart, 'declared inside the component, not above it');
  assert.ok(usage > declaration, 'declared before it is read');
});

test('the render branches read only values the component declares', () => {
  // The same shape of mistake, checked across the values those branches depend
  // on. Cheap, and it is the check that was missing.
  const component = artwork.slice(artwork.indexOf('function ArtworkPage() {'));
  const declarations = {
    justPublished: /const justPublished =/,
    artworkId: /const artworkId = window\.ArtSoulArtworkUrl\.currentArtworkId\(\)/,
    loading: /const \[loading, setLoading\] = useState/,
    error: /const \[error, setError\] = useState/
  };
  for (const [name, pattern] of Object.entries(declarations)) {
    assert.match(component, pattern, `${name} must be declared inside the component`);
  }
});
