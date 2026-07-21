import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// The Hardhat contract suite runs separately via `npm run test:contracts`
// and must never be collected by the generic Node runner.
export const CONTRACT_SUITE = 'ArtSoulV41.test.cjs';

// Every supported Node unit-test extension. Shell globs are avoided so the
// same rule is applied identically on Windows and Ubuntu.
const SUPPORTED_TEST_FILE = /\.test\.(cjs|mjs|js)$/;

// Pure, deterministic collection: filter to supported test extensions,
// exclude the contract suite, and sort alphabetically (locale-independent
// code-unit order, identical across platforms). Exported for regression
// coverage.
export function collectUnitTestFiles(entries) {
    return entries
        .filter(file => SUPPORTED_TEST_FILE.test(file) && file !== CONTRACT_SUITE)
        .sort();
}

function runUnitTests() {
    const unitTests = collectUnitTestFiles(readdirSync('test'))
        .map(file => join('test', file));

    const result = spawnSync(process.execPath, ['--test', ...unitTests], {
        stdio: 'inherit'
    });

    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
}

// Only run the suite when invoked directly (`node scripts/run-unit-tests.mjs`),
// so importing this module for tests never spawns the whole suite.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    runUnitTests();
}
