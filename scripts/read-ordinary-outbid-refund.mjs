import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { Interface, isHexString, toQuantity } from 'ethers';
import { readOrdinaryRefundBatch, readOrdinaryRefundEntry } from '../src/indexer/nft-deployment-proof.js';
import { InputError, readReviewedOrdinaryPair, verifyPairReading } from './read-reviewed-ordinary-pair.mjs';
import { confirmFinalizedBlock, finalizedBlock, readRpc, requireIndependentProviders } from './verify-treasury-safes.mjs';
import { readFinalizedFee } from './read-testnet-fee.mjs';

const refundQueue = new Interface([
    'function refundProgress(uint256) view returns (uint256 cursor,uint256 total)',
    'event OutbidRefundProcessed(uint256 indexed auctionId,uint256 indexed index,address indexed creditor,uint256 amount,bool paid)'
]);

// The Core's refund cursor only advances. Locate the first block that includes
// this entry's payout, then let the receipt reader authenticate the actual event.
async function discoverProcessing(queued, providers) {
    const heads = await Promise.all(providers.map(rpc => finalizedBlock(queued.chainId, rpc)));
    const common = BigInt(heads[0].number) <= BigInt(heads[1].number) ? heads[0] : heads[1];
    const upper = BigInt(common.number);
    assert(upper >= BigInt(queued.blockNumber) && upper <= BigInt(Number.MAX_SAFE_INTEGER), 'Invalid finalized refund interval');
    await Promise.all(providers.map((rpc, index) => confirmFinalizedBlock(rpc, heads[index], common)));
    const call = { to: queued.coreAddress, data: refundQueue.encodeFunctionData('refundProgress', [queued.auctionId]) };
    const topics = refundQueue.encodeFilterTopics('OutbidRefundProcessed', [queued.auctionId, queued.entry, queued.creditor]);
    const entry = BigInt(queued.entry);
    const locations = await Promise.all(providers.map(async rpc => {
        async function processedThrough(at) {
            const raw = await rpc('eth_call', [call, at]);
            assert(isHexString(raw, 64), 'Invalid refund progress encoding');
            const [cursor, total] = refundQueue.decodeFunctionResult('refundProgress', raw);
            assert(cursor <= total && entry < total, 'Queue entry absent at finalized height');
            return cursor > entry;
        }
        if (!await processedThrough({ blockHash: common.hash, requireCanonical: true })) return null;
        let low = BigInt(queued.blockNumber), high = upper;
        while (low < high) {
            const midpoint = (low + high) / 2n;
            if (await processedThrough(toQuantity(midpoint))) high = midpoint;
            else low = midpoint + 1n;
        }
        const height = toQuantity(low);
        const logs = await rpc('eth_getLogs', [{ address: queued.coreAddress, fromBlock: height, toBlock: height, topics }]);
        assert(Array.isArray(logs) && logs.length === 1, 'Expected one matching refund in the discovered block');
        const [log] = logs;
        assert(log.blockNumber === height && !log.removed && isHexString(log.blockHash, 32) && isHexString(log.transactionHash, 32),
            'Invalid discovered refund location');
        return { blockNumber: Number(low), blockHash: log.blockHash.toLowerCase(), transactionHash: log.transactionHash.toLowerCase() };
    }));
    assert.deepEqual(locations[0], locations[1], 'Independent providers disagree on the refund location');
    return { location: locations[0], checkedThrough: { blockNumber: Number(upper), blockHash: common.hash } };
}

export async function verifyRefundBatch(pair, transactionHash, providers) {
    requireIndependentProviders(providers);
    if (pair.chainId !== 84532 || !isHexString(transactionHash,32)) throw new InputError('Supply a Base Sepolia pair and refund batch transaction hash.');
    const receipt = await providers[0]('eth_getTransactionReceipt',[transactionHash]);
    if (!receipt?.blockNumber) throw new InputError('The refund batch has no mined receipt.');
    const batch = await verifyPairReading(pair, { transactionHash, blockNumber: Number(BigInt(receipt.blockNumber)),
        blockHash: receipt.blockHash }, providers, readOrdinaryRefundBatch);
    const fees = await readFinalizedFee(transactionHash, batch.sender, pair.coreAddress, providers);
    if (fees.status !== 'success' || fees.blockHash.toLowerCase() !== batch.blockHash) throw new Error('Refund batch fee disagrees with the receipt');
    return { batch, fees, matchesReviewedLimits: batch.configuredBatchLimit === '8' && batch.configuredGasArgument === '30000',
        perRecipientGasMeasurement: 'not_in_receipt' };
}

// The originating bid and the payout batch may contain events for other entries.
export async function verifyOutbidRefund(pair, auctionId, entry, queuedHash, processedHash, providers) {
    requireIndependentProviders(providers);
    const discover = processedHash === '--discover';
    if (!isHexString(queuedHash, 32) || (!discover && !isHexString(processedHash, 32))) {
        throw new InputError('Supply both transaction hashes or use --discover for the processing receipt.');
    }
    if (discover && pair.chainId !== 84532) throw new InputError('Refund discovery requires the reviewed Base Sepolia deployment.');
    async function read(event, transactionHash) {
        const receipt = await providers[0]('eth_getTransactionReceipt', [transactionHash]);
        if (!receipt?.blockNumber) throw new InputError('A supplied transaction has no mined receipt.');
        return verifyPairReading(pair, { auctionId, entry, transactionHash, event,
            blockHash: receipt.blockHash, blockNumber: Number(BigInt(receipt.blockNumber)) }, providers, readOrdinaryRefundEntry);
    }
    const queued = await read('OutbidRefundQueued', queuedHash);
    let discovered;
    if (discover) {
        const { location, checkedThrough } = await discoverProcessing(queued, providers);
        if (!location) return { queued, checkedThrough, disposition: 'pending-at-finality' };
        discovered = location;
    }
    const processed = await read('OutbidRefundProcessed', discovered?.transactionHash ?? processedHash);
    if (discovered && (processed.blockHash !== discovered.blockHash || processed.blockNumber !== discovered.blockNumber)) {
        throw new Error('Refund receipt is outside the discovered canonical block');
    }
    if (queued.creditor !== processed.creditor || queued.amountWei !== processed.amountWei ||
        queued.blockNumber > processed.blockNumber || (queued.blockNumber === processed.blockNumber &&
        (queued.blockHash !== processed.blockHash || queued.logIndex >= processed.logIndex))) {
        throw new Error('Refund obligation and disposition do not match');
    }
    return { queued, processed, disposition: processed.paid ? 'delivered' : 'credited-for-withdrawal' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const [file, auctionId, entry, queued, processed, ...extra] = process.argv.slice(2);
        const batch = auctionId === '--batch';
        if (!file || (batch ? !entry || queued !== undefined : !processed) || extra.length) throw new InputError('Usage: node scripts/read-ordinary-outbid-refund.mjs reviewed-pair.json AUCTION_ID QUEUE_INDEX OUTBIDDING_TX PROCESSING_TX|--discover or reviewed-pair.json --batch PROCESSING_TX');
        const urls = [process.env.ARTSOUL_ORDINARY_RPC_URL, process.env.ARTSOUL_ORDINARY_RPC_CHECK_URL];
        if (!urls.every(Boolean)) throw new InputError('Configure both independent ordinary RPC endpoints.');
        const pair = await readReviewedOrdinaryPair(file);
        const providers = urls.map(readRpc);
        const report = batch ? await verifyRefundBatch(pair, entry, providers) :
            await verifyOutbidRefund(pair, auctionId, entry, queued, processed, providers);
        console.log(JSON.stringify(report, null, 2));
    } catch (error) {
        console.error(error instanceof InputError ? error.message : 'Could not match the finalized outbid deposit and its disposition on both providers.');
        process.exitCode = 1;
    }
}
