const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const pages = [
  'index.html',
  'gallery.html',
  'artwork.html',
  'profile.html',
  'upload.html',
  'admin.html',
  'docs-protocol.html',
  'visual-lab.html',
  'generate-favicon.html'
];

const moduleEntryPattern = /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']\/src\/entries\/[^"']+["'][^>]*><\/script>/i;
const asyncModulePattern = /<script\b(?=[^>]*\btype=["']module["'])(?=[^>]*\basync\b)[^>]*>/i;

test('HTML entry modules use deferred module semantics instead of async mount races', () => {
  for (const page of pages) {
    const source = fs.readFileSync(page, 'utf8');
    assert.match(source, moduleEntryPattern, `${page} must retain its Vite module entry`);
    assert.doesNotMatch(
      source,
      asyncModulePattern,
      `${page} must not let its entry execute before the document mount point exists`
    );
  }
});

test('the build verifier rejects async module entries in source or emitted HTML', () => {
  const verifier = fs.readFileSync('scripts/verify-build.mjs', 'utf8');
  assert.match(verifier, /const asyncModulePattern =/);
  assert.match(verifier, /async module entry that can execute before its DOM mount point exists/);
  assert.match(verifier, /asyncModulePattern\.test\(source\) \|\| asyncModulePattern\.test\(built\)/);
});
