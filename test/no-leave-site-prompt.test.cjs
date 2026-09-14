// A-82: nothing shipped to a browser may register a leave-site confirmation.
//
// `beforeunload` with preventDefault() or returnValue produces the browser's
// "Leave site?" dialog on every navigation away. ArtSoul has exactly one place
// where that is wanted - an unfinished upload - and everywhere else it is a
// defect waiting for an import, because a constructor side effect can ship it
// across the whole site without anyone choosing it.
//
// It is also a back/forward-cache hazard in the browsers that refuse the cache
// for `beforeunload`, which would reopen A-48 with a cause nobody would look for.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

// The upload page warns before losing an in-progress upload. That is the one
// legitimate case, and it is listed rather than pattern-matched so adding a
// second one is a decision somebody makes on purpose.
const ALLOWED = new Set(['src/entries/upload.js']);

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

test('only the upload page may register a leave-site confirmation', () => {
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
    `these files register a leave-site confirmation outside the upload page: ${offenders.join(', ')}`
  );
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
