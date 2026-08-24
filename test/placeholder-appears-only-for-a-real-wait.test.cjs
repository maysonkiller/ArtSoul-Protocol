const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const skeletons = fs.readFileSync('src/entries/loading-skeletons.jsx', 'utf8');
const styles = fs.readFileSync('unified-styles.css', 'utf8');
const artwork = fs.readFileSync('src/entries/artwork.jsx', 'utf8');

test('a load that finishes quickly shows no placeholder at all', () => {
  // A placeholder that appears instantly and disappears 200ms later is a flash,
  // not information: the eye registers that something went wrong, never what
  // was loading. Reported from desktop and phones on every page, worst opening
  // an artwork.
  assert.match(styles, /\.artsoul-placeholder \{\s*\n\s*opacity: 0;\s*\n\s*animation: artsoulPlaceholderReveal 1ms linear 320ms forwards;/);
  assert.match(styles, /@keyframes artsoulPlaceholderReveal \{\s*\n\s*to \{ opacity: 1; \}/);
});

test('new placeholder roots wait while already-visible static skeletons stay visible', () => {
  const roots = [...skeletons.matchAll(/role="status" aria-label="Loading/g)];
  assert.equal(roots.length, 3, 'card grid, artwork page, profile page');
  assert.equal((skeletons.match(/\$\{immediate \? '' : PLACEHOLDER\}/g) || []).length, 3,
    'each placeholder waits by default but can adopt an already-painted static tree');
  assert.match(skeletons, /CardGridSkeleton\(\{[\s\S]*?immediate = false[\s\S]*?\}\)/);
  assert.match(skeletons, /ArtworkPageSkeleton\(\{ immediate = false \}\)/);
  assert.match(skeletons, /ProfilePageSkeleton\(\{ className = '', immediate = false \}\)/);
  assert.match(skeletons, /\$\{immediate \? '' : PLACEHOLDER\}/,
    'React must not hide a skeleton the document already painted');
  assert.match(skeletons, /const PLACEHOLDER = 'artsoul-placeholder';/);
});

test('the element keeps its box the whole time', () => {
  // Opacity only. Anything that removed it from layout would make the page jump
  // when it appeared, which is worse than the flash.
  const block = styles.slice(styles.indexOf('.artsoul-placeholder {'), styles.indexOf('@keyframes artsoulPlaceholderReveal'));
  assert.doesNotMatch(block, /display\s*:\s*none/);
  assert.doesNotMatch(block, /visibility/);
  assert.doesNotMatch(block, /height|width/);
});

test('a wait we can name is never held back', () => {
  // The branded mark after publishing answers a question the person just asked,
  // so it appears at once.
  assert.doesNotMatch(artwork, /artsoul-wait-screen[^"]*artsoul-placeholder/);
  const wait = artwork.slice(artwork.indexOf('artsoul-wait-screen'));
  assert.doesNotMatch(wait.slice(0, 400), /artsoul-placeholder/);
});
