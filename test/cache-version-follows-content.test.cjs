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
  'src/ui/theme-manager.js': { version: 1, sha256: 'aba43648758927f8' },
  'src/ui/navigation-manager.js': { version: 7, sha256: 'fac3e3baca90f002' },
  'src/ui/components/artwork-card.js': { version: 23, sha256: 'ef343be5c814bd8a' },
  'contracts-integration.js': { version: 15, sha256: '3ab534527f8b5332' },
  'modal-system.js': { version: 1, sha256: '73be2dadc241ea78' },
  'webmcp-tools.js': { version: 8, sha256: '69ec7cff1a0314b7' },
  'voice-commands.js': { version: 7, sha256: '9084dd723dfb706d' },
  'avatar-dropdown.js': { version: 57, sha256: '07cf616b2741bc9b' },
  'header-prepaint.js': { version: 8, sha256: '2ca7f2d8f0612be6' },
  'data-prefetch.js': { version: 6, sha256: '339cad21ebc03f47' },
  'base-network.js': { version: 2, sha256: 'bc527f32ea3df5f9' },
  'storage-image.js': { version: 3, sha256: '99078de8e41f962d' }
};

const PAGES = fs.readdirSync('.').filter((n) => n.endsWith('.html'));

// Line endings are normalised before hashing. The repository stores these files
// with CRLF and a Linux checkout can present them as LF, so hashing the raw
// bytes passed on Windows and failed in CI for a file nobody had touched.
const CR = String.fromCharCode(13);

function shortHash(file) {
  const normalised = fs.readFileSync(file, 'utf8').split(CR).join('');
  return crypto.createHash('sha256').update(normalised, 'utf8').digest('hex').slice(0, 16);
}

function runtimeVersions(html, file) {
  const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const references = new RegExp(String.raw`\bsrc\s*=\s*(["'])/${escaped}(?:\?([^"']*))?\1`, 'g');
  return [...html.matchAll(references)].map(match => {
    const versions = new URLSearchParams(match[2] || '').getAll('v');
    return versions.length === 1 && /^\d+$/.test(versions[0]) ? Number(versions[0]) : null;
  });
}

function assertRuntimeVersion(html, page, file, expectedVersion) {
  for (const version of runtimeVersions(html, file)) {
    assert.equal(version, expectedVersion, `${page} loads ${file} at v=${version}, expected v=${expectedVersion}`);
  }
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
    for (const page of PAGES) {
      const html = fs.readFileSync(page, 'utf8');
      assertRuntimeVersion(html, page, file, expected.version);
    }
  }
});

test('on-demand command imports use the same card policy version as page scripts', () => {
  const file = 'src/ui/components/artwork-card.js';
  const match = fs.readFileSync('webmcp-tools.js', 'utf8').match(/import\('\/src\/ui\/components\/artwork-card\.js\?v=(\d+)'\)/);
  assert.ok(match, 'non-card command pages must reuse the shared action policy');
  assert.equal(Number(match[1]), RUNTIME[file].version, 'commands must not load an obsolete card policy');
});

test('no page loads one of these without a version at all', () => {
  for (const file of Object.keys(RUNTIME)) {
    for (const page of PAGES) {
      assert.ok(!runtimeVersions(fs.readFileSync(page, 'utf8'), file).includes(null),
        `${page} loads ${file} with no ?v=, so it can never be invalidated`);
    }
  }
});

test('version guard rejects a stale v15 reference when v16 is required', () => {
  const file = 'src/ui/components/artwork-card.js';
  const reference = version => `<script src="/${file}?v=${version}" defer></script>`;
  assert.doesNotThrow(() => assertRuntimeVersion(reference(16), 'fixture.html', file, 16));
  assert.throws(() => assertRuntimeVersion(reference(15), 'fixture.html', file, 16), /at v=15, expected v=16/);
  assert.throws(() => assertRuntimeVersion(reference(16) + reference(15), 'fixture.html', file, 16), /expected v=16/);
});

test('runtime matching handles bare references, quote styles and escaped filename characters', () => {
  const file = 'src/ui/components/artwork-card.js';
  for (const reference of [`<script src="/${file}"></script>`, `<script src='/${file}?v=oops'></script>`, `<script src="/${file}?v=16&v=15"></script>`]) {
    assert.throws(() => assertRuntimeVersion(reference, 'fixture.html', file, 16), /at v=null/);
  }
  assert.deepEqual(runtimeVersions(`<script src='/${file}?v=16'></script>`, file), [16]);
  assert.deepEqual(runtimeVersions('<script src="/src/ui/components/artwork-cardXjs?v=15"></script>', file), []);
  assert.deepEqual(runtimeVersions('<script src="/runtime/[core]+.js?v=16"></script>', 'runtime/[core]+.js'), [16]);
  assert.deepEqual(runtimeVersions('<script src="/runtime/coreXjs?v=15"></script>', 'runtime/[core]+.js'), []);
});
