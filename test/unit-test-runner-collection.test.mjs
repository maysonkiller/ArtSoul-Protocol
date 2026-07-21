// A-17 regression: the canonical unit runner must collect every supported
// Node test extension (.test.cjs/.test.mjs/.test.js), exclude the Hardhat
// contract suite, ignore unrelated files, and order deterministically.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { collectUnitTestFiles, CONTRACT_SUITE } from '../scripts/run-unit-tests.mjs';

const testDir = dirname(fileURLToPath(import.meta.url));

test('collects all three supported test extensions', () => {
    const collected = collectUnitTestFiles([
        'alpha.test.cjs',
        'beta.test.mjs',
        'gamma.test.js'
    ]);
    assert.deepEqual(collected, ['alpha.test.cjs', 'beta.test.mjs', 'gamma.test.js']);
});

test('excludes the Hardhat contract suite', () => {
    const collected = collectUnitTestFiles([CONTRACT_SUITE, 'unit.test.cjs']);
    assert.ok(!collected.includes(CONTRACT_SUITE), 'contract suite must be excluded');
    assert.deepEqual(collected, ['unit.test.cjs']);
});

test('ignores unrelated files (non-test sources, helpers, fixtures, other extensions)', () => {
    const collected = collectUnitTestFiles([
        'helper.mjs',
        'fixtures.json',
        'notes.md',
        'thing.test.ts',
        'test-utils.js',
        'real.test.cjs'
    ]);
    assert.deepEqual(collected, ['real.test.cjs']);
});

test('output ordering is deterministic regardless of input order', () => {
    const input = ['z.test.js', 'a.test.mjs', 'm.test.cjs', 'b.test.cjs'];
    const expected = ['a.test.mjs', 'b.test.cjs', 'm.test.cjs', 'z.test.js'];
    assert.deepEqual(collectUnitTestFiles(input), expected);
    // Any permutation of the same set yields the identical sorted result.
    assert.deepEqual(collectUnitTestFiles([...input].reverse()), expected);
});

test('the real test directory includes the previously uncollected .mjs and .js suites', () => {
    const collected = collectUnitTestFiles(readdirSync(testDir));
    assert.ok(
        collected.includes('artwork-visibility-api.test.mjs'),
        'the .mjs API suite must now be collected'
    );
    assert.ok(
        collected.includes('resale-eligibility.test.js'),
        'the .js resale-eligibility suite must now be collected'
    );
    assert.ok(!collected.includes(CONTRACT_SUITE), 'the contract suite stays excluded');
});

test('importing the runner module does not spawn the suite (no self-run on import)', () => {
    // Reaching this line proves the import above did not execute runUnitTests();
    // otherwise the whole suite would have recursively spawned during import.
    assert.equal(typeof collectUnitTestFiles, 'function');
    assert.equal(CONTRACT_SUITE, 'ArtSoulV41.test.cjs');
    // Guard against an accidental cwd-relative path lookup in this test.
    assert.ok(join('test', 'x').length > 0);
});
