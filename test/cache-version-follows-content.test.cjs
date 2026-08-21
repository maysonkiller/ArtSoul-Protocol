const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');

/**
 * Classic runtime files are served from the site root with a hand-written
 * ?v=<n>, so a browser holds the previous copy until that number changes.
 *
 * avatar-dropdown.js and header-prepaint.js were edited five times in one day
 * while ?v= stayed at 48 and 2. Every one of those fixes was deployed and none
 * of them reached a browser that had already loaded the page - the fixes were
 * reported as not working, and they were not, because the old file was still
 * being executed.
 *
 * This pins each file's content to the version it is served under. Editing one
 * of them fails here until both the recorded hash and the ?v= in every page are
 * updated together, which is the only way the two can stay honest.
 */
const RUNTIME = {
  'avatar-dropdown.js': { version: 49, sha256: 'b1340a041fe85904' },
  'header-prepaint.js': { version: 3, sha256: '716135d2f3299f64' },
  'data-prefetch.js': { version: 1, sha256: '05d10f2bff576223' }
};

const PAGES = fs.readdirSync('.').filter((n) => n.endsWith('.html'));

function shortHash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);
}

test('a changed runtime file forces its cache version to change with it', () => {
  for (const [file, expected] of Object.entries(RUNTIME)) {
    assert.equal(
      shortHash(file), expected.sha256,
      `${file} changed. Bump its ?v= in every page that loads it, and record the new hash here. ` +
      `Otherwise browsers keep running the old copy and the fix appears not to work.`
    );
  }
});

test('every page agrees on the version of every runtime file', () => {
  for (const [file, expected] of Object.entries(RUNTIME)) {
    const escaped = file.replace('.', '\.');
    for (const page of PAGES) {
      const html = fs.readFileSync(page, 'utf8');
      const found = [...html.matchAll(new RegExp(`${escaped}\?v=(\d+)`, 'g'))].map((m) => Number(m[1]));
      if (!found.length) continue;
      for (const version of found) {
        assert.equal(version, expected.version, `${page} loads ${file} at v=${version}, expected v=${expected.version}`);
      }
    }
  }
});

test('no page loads one of these without a version at all', () => {
  for (const file of Object.keys(RUNTIME)) {
    const escaped = file.replace('.', '\.');
    const unversioned = new RegExp(`src="/${escaped}"`);
    for (const page of PAGES) {
      assert.doesNotMatch(fs.readFileSync(page, 'utf8'), unversioned,
        `${page} loads ${file} with no ?v=, so it can never be invalidated`);
    }
  }
});
