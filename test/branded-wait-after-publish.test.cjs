const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const upload = fs.readFileSync('src/entries/upload.js', 'utf8');
const artwork = fs.readFileSync('src/entries/artwork.jsx', 'utf8');
const feedback = fs.readFileSync('src/entries/loading-skeletons.jsx', 'utf8');
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
  assert.match(artwork, /if \(loading \|\| error\?\.code === 'V41_ARTWORK_NOT_INDEXED'\) \{/);
  assert.match(artwork, /immediate=\{initialSkeletonVisible \|\| justPublished \|\| Boolean\(error\)\}/);
  assert.equal((artwork.match(/<ArtworkPageSkeleton\b/g) || []).length, 1);
  assert.equal((feedback.match(/artsoul-wait-word/g) || []).length, 1);
});

test('an ordinary visit uses the same branded loading component', () => {
  // The exported compatibility name now renders a loading mark without synthetic content.
  const loadingBranch = artwork.slice(
    artwork.indexOf("if (loading || error?.code === 'V41_ARTWORK_NOT_INDEXED') {"),
    artwork.indexOf('if (error) {')
  );
  assert.match(loadingBranch, /className="artwork-page-root"/);
  assert.match(loadingBranch, /<ArtworkPageSkeleton\s+immediate=\{initialSkeletonVisible \|\| justPublished/);
});

test('the branded wait keeps its own styling and its accessible text', () => {
  assert.match(styles, /\.artsoul-wait-screen \{/);
  assert.match(styles, /\.artsoul-wait-stage \{/);
  assert.match(feedback, /role="status" aria-label=\{label\} aria-busy="true" aria-live="polite"/);
  assert.match(feedback, /Loading artwork \$\{artworkId\}/);
});

test('justPublished is declared inside the component that uses it', () => {
  // It was first declared in a module-level helper, so every artwork page threw
  // "justPublished is not defined" and rendered nothing at all. The suite stayed
  // green because these assertions read source text, which cannot see scope.
  const componentStart = artwork.indexOf('function ArtworkPage({ initialSkeletonVisible = false }) {');
  const declaration = artwork.indexOf('const justPublished =');
  const usage = artwork.indexOf('initialSkeletonVisible || justPublished');
  assert.ok(componentStart > -1, 'the component must be discoverable');
  assert.ok(declaration > componentStart, 'declared inside the component, not above it');
  assert.ok(usage > declaration, 'declared before it is read');
});

test('the render branches read only values the component declares', () => {
  // The same shape of mistake, checked across the values those branches depend
  // on. Cheap, and it is the check that was missing.
  const component = artwork.slice(artwork.indexOf('function ArtworkPage({ initialSkeletonVisible = false }) {'));
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
