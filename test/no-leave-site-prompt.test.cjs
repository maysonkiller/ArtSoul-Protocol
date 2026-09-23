// A-82: leave-site confirmation is limited to explicit authoring pages.
//
// `beforeunload` with preventDefault() or returnValue produces the browser's
// "Leave site?" dialog on every navigation away. It is wanted for an unfinished
// upload or an unsaved local collection draft; everywhere else it is a
// defect waiting for an import, because a constructor side effect can ship it
// across the whole site without anyone choosing it.
//
// It is also a back/forward-cache hazard in the browsers that refuse the cache
// for `beforeunload`, which would reopen A-48 with a cause nobody would look for.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

// These two authoring pages protect unsaved work. Keep an explicit allowlist
// so a shared lifecycle helper cannot add a site-wide navigation prompt.
const ALLOWED = new Set(['src/entries/upload.js', 'src/entries/collection-builder.jsx']);

function sourceFiles(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceFiles(full, found);
    } else if (/\.(js|jsx|mjs|cjs|html)$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

test('only the two explicit authoring pages may register a leave-site confirmation', () => {
  const offenders = [];

  for (const file of sourceFiles(ROOT)) {
    const relative = path.relative(ROOT, file).split(path.sep).join('/');
    if (relative.startsWith('test/') || relative.startsWith('scripts/')) continue;

    const source = fs.readFileSync(file, 'utf8');
    // A comment explaining why there is no handler must not count as one.
    const registers = /addEventListener\(\s*['"`]beforeunload['"`]/.test(source)
      || /onbeforeunload\s*=/.test(source);
    if (registers && !ALLOWED.has(relative)) offenders.push(relative);
  }

  assert.deepEqual(
    offenders,
    [],
    `these files register a leave-site confirmation outside the authoring pages: ${offenders.join(', ')}`
  );
});

test('collection draft navigation protection exists only while unsaved and cleans up its listener', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src/entries/collection-builder.jsx'), 'utf8');
  const body = source.match(/useEffect\(\(\) => \{([\s\S]*?)\}, \[dirty\]\)/)?.[1];
  assert.ok(body, 'the effect is tied to the actual dirty state');
  const listeners = new Map();
  const window = {
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener(name, listener) { if (listeners.get(name) === listener) listeners.delete(name); }
  };
  assert.equal(vm.runInNewContext(`(function () { ${body} })()`, { dirty: false, window }), undefined);
  assert.equal(listeners.size, 0, 'saved and untouched drafts allow navigation');
  const cleanup = vm.runInNewContext(`(function () { ${body} })()`, { dirty: true, window });
  let prevented = false;
  const event = { preventDefault() { prevented = true; }, returnValue: undefined };
  listeners.get('beforeunload')(event);
  assert.equal(prevented, true, 'unsaved work requests the native navigation warning');
  assert.equal(event.returnValue, '');
  cleanup();
  assert.equal(listeners.size, 0, 'saving or unmounting removes the exact handler');
});

test('the shutdown manager keeps its process signals and grows no browser branch', () => {
  // The Node half is real and belongs to the indexer: SIGINT, SIGTERM, uncaught
  // exceptions and unhandled rejections all have to drain work before exit.
  const source = fs.readFileSync(path.join(ROOT, 'src', 'core', 'graceful-shutdown.js'), 'utf8');

  for (const signal of ['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection']) {
    assert.match(source, new RegExp(signal), `${signal} handling must stay`);
  }

  assert.doesNotMatch(
    source,
    /addEventListener\(\s*['"`]beforeunload['"`]/,
    'the browser branch was removed in A-82 and must not come back'
  );
});
