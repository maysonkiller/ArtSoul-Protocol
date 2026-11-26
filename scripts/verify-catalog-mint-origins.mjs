import assert from 'node:assert/strict';
import records from '../src/api/catalog-finalized-mints.json' with { type: 'json' };
import { catalogOriginDigest, readFinalizedCatalogMint } from '../src/api/catalog-mint-origin.js';
import { createRegistrationReaders } from '../src/api/upload-registration-evidence.js';
import { setTimeout } from 'node:timers/promises';

// With no arguments, reproduce the evidence bundled for the historical testnet.
// Explicit hashes print candidate records for review. Neither mode writes to the indexer.
const requested = process.argv.slice(2);
const providers = createRegistrationReaders(['https://base-sepolia.api.onfinality.io/public',
    'https://base-sepolia.gateway.tenderly.co']).map(rpc => {
    let next = Promise.resolve();
    return (...args) => {
        const result = next.then(() => rpc(...args));
        next = result.catch(() => {}).then(() => setTimeout(1200));
        return result;
    };
});
const result = {};
for (const hash of requested.length ? requested : Object.keys(records)) {
    const receipt = await readFinalizedCatalogMint(hash, providers, 20000);
    assert.ok(receipt, 'Two independent archives must agree on the finalized mint: ' + hash);
    result[hash] = { blockNumber:receipt.blockNumber, blockHash:receipt.blockHash,
        digest:catalogOriginDigest(hash, receipt.origin) };
}
if (!requested.length) assert.deepEqual(result, records);
console.log(JSON.stringify(result, null, 2));
