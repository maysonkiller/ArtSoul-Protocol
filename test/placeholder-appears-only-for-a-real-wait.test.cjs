const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const skeletons = fs.readFileSync('src/entries/loading-skeletons.jsx', 'utf8');
const styles = fs.readFileSync('unified-styles.css', 'utf8');
const artwork = fs.readFileSync('src/entries/artwork.jsx', 'utf8');

function mountPlaceholder(immediate = false) {
  let ready = false, effect, cleanup;
  const timers = new Map();
  const context = vm.createContext({
    React: { useState: () => [ready, value => { ready = value; }], useEffect: fn => { effect = fn; } },
    window: { setTimeout: (fn, delay) => { timers.set(1, { fn, delay }); return 1; }, clearTimeout: id => timers.delete(id) }
  });
  const helper = skeletons.slice(skeletons.indexOf('const PLACEHOLDER'), skeletons.indexOf('function LoadingMark'));
  vm.runInContext(helper, context);
  const render = () => vm.runInContext(`usePlaceholderClass(${immediate})`, context);
  const initial = render();
  cleanup = effect();
  return { initial, render, timers, unmount: () => cleanup?.() };
}

test('a short load stays invisible and cancels its delayed reveal on unmount', () => {
  const view = mountPlaceholder();
  assert.equal(view.initial, 'artsoul-placeholder');
  assert.equal(view.timers.get(1).delay, 320);
  view.unmount();
  assert.equal(view.timers.size, 0);
  assert.equal(view.render(), 'artsoul-placeholder');
});

test('a longer load becomes visible without relying on animation', () => {
  const view = mountPlaceholder();
  view.timers.get(1).fn();
  assert.equal(view.render(), '');
  assert.doesNotMatch(styles, /animation:\s*artsoulPlaceholderReveal/);
  view.unmount();
});

test('an immediate mark is visible without scheduling a reveal', () => {
  const view = mountPlaceholder(true);
  assert.equal(view.initial, '');
  assert.equal(view.timers.size, 0);
});

test('new placeholder roots wait while already-visible static skeletons stay visible', () => {
  const roots = [...skeletons.matchAll(/role="status" aria-label="Loading/g)];
  assert.equal(roots.length, 1, 'the gallery has a compact status; full pages share the branded mark');
  assert.equal((skeletons.match(/const placeholder = usePlaceholderClass\(immediate\)/g) || []).length, 3,
    'each placeholder waits by default but can adopt an already-painted static tree');
  assert.match(skeletons, /CardGridSkeleton\(\{[\s\S]*?immediate = false[\s\S]*?\}\)/);
  assert.match(skeletons, /ArtworkPageSkeleton\(\{ immediate = false, artworkId = '' \}\)/);
  assert.match(skeletons, /ProfilePageSkeleton\(\{ className = '', immediate = false \}\)/);
  assert.match(skeletons, /return immediate \|\| ready \? '' : PLACEHOLDER;/,
    'React must not hide a skeleton the document already painted');
  assert.match(skeletons, /const PLACEHOLDER = 'artsoul-placeholder';/);
});

test('the element keeps its box the whole time', () => {
  // Opacity only. Anything that removed it from layout would make the page jump
  // when it appeared, which is worse than the flash.
  const block = styles.match(/\.artsoul-placeholder \{([^}]+)\}/)[1];
  assert.match(block, /opacity:\s*0/);
  assert.doesNotMatch(block, /display\s*:\s*none/);
  assert.doesNotMatch(block, /visibility/);
  assert.doesNotMatch(block, /height|width/);
});

test('a wait we can name is never held back', () => {
  // The branded mark after publishing answers a question the person just asked,
  // so it appears at once.
  assert.match(artwork, /immediate=\{initialSkeletonVisible \|\| justPublished \|\| Boolean\(error\)\}/);
});
