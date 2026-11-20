import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// The Hardhat contract suite runs separately via `npm run test:contracts`
// and must never be collected by the generic Node runner.
export const CONTRACT_SUITE = 'ArtSoulV41.test.cjs';
export const CONTRACT_SUITES = [CONTRACT_SUITE, 'CollectionLaunch.test.cjs', 'MintReservationEscrow.test.cjs', 'ArtSoulDonations.test.cjs',
    'SettledArtworkNFT.test.cjs', 'OrdinaryArtAuctions.test.cjs', 'OrdinaryArtResales.test.cjs', 'TreasuryBoundOrdinaryArt.test.cjs',
    'OrdinaryRunnerUp.test.cjs', 'OrdinaryAuctionKeeper.test.cjs', 'OrdinaryArtDonations.test.cjs',
    'launch/PartnerFirstWorkLaunch.test.cjs', 'genesis/ArtSoulGenesis.cjs'];

// Every supported Node unit-test extension. Shell globs are avoided so the
// same rule is applied identically on Windows and Ubuntu.
const SUPPORTED_TEST_FILE = /\.test\.(cjs|mjs|js)$/;

// Pure, deterministic collection: filter to supported test extensions,
// exclude the contract suite, and sort alphabetically (locale-independent
// code-unit order, identical across platforms). Exported for regression
// coverage.
export function collectUnitTestFiles(entries) {
    return entries
        .filter(file => SUPPORTED_TEST_FILE.test(file) && !CONTRACT_SUITES.includes(file))
        .sort();
}

function runUnitTests() {
    const unitTests = collectUnitTestFiles(readdirSync('test'))
        .map(file => join('test', file));

    // Several test files start independent PostgreSQL containers on the same disk.
    const concurrency = Math.min(4, Math.max(1, availableParallelism() - 1));
    const result = spawnSync(process.execPath, ['--test', `--test-concurrency=${concurrency}`, ...unitTests], {
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
