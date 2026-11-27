import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { getAddress, isHexString, ZeroAddress, ZeroHash } from 'ethers';
import { expectedPhaseCommitment, preparePhaseCallReview } from '../src/features/collections/phase-call-review.js';
import { readCollectionLockReceipt } from './read-collection-opening-receipts.mjs';
import { finalizedBlock, readRpc, requireIndependentProviders } from './verify-treasury-safes.mjs';

export async function checkCollectionPhaseLock(draftJson, collection, runtimeHash, lockHash, providers) {
    const review = preparePhaseCallReview(draftJson);
    const address = getAddress(collection);
    if (address === ZeroAddress || [lockHash, runtimeHash].some(hash => !isHexString(hash, 32) || hash.toLowerCase() === ZeroHash)) {
        throw new Error('Supply the reviewed collection address, runtime hash and mined lock transaction.');
    }
    requireIndependentProviders(providers);
    const commitment = expectedPhaseCommitment(review.chainId, address, review.phases);
    const readings = await Promise.all(providers.map(async rpc => readCollectionLockReceipt(
        rpc, await finalizedBlock(review.chainId, rpc), address, runtimeHash, review.chainId, lockHash.toLowerCase(), commitment)));
    assert.deepEqual(readings[0], readings[1], 'Independent providers disagree on the collection phase lock.');
    return { chainId: review.chainId, collection: address, runtimeHash: runtimeHash.toLowerCase(),
        commitment, receipt: readings[0], rpcReadings: 2 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const [file, collection, runtime, lock] = process.argv.slice(2);
        if (process.argv.length !== 6) throw new Error('Usage: check-collection-phase-lock.mjs draft.json collection runtime-keccak256 lock-tx');
        const report = await checkCollectionPhaseLock(await readFile(file, 'utf8'), collection, runtime, lock,
            [readRpc(process.env.ARTSOUL_COLLECTION_RPC_URL), readRpc(process.env.ARTSOUL_COLLECTION_RPC_CHECK_URL)]);
        console.log(JSON.stringify(report, null, 2));
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
