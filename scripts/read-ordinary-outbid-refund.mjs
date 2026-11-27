import { pathToFileURL } from 'node:url';
import { isHexString } from 'ethers';
import { readOrdinaryRefundBatch, readOrdinaryRefundEntry } from '../src/indexer/nft-deployment-proof.js';
import { InputError, readReviewedOrdinaryPair, verifyPairReading } from './read-reviewed-ordinary-pair.mjs';
import { readRpc, requireIndependentProviders } from './verify-treasury-safes.mjs';
import { readFinalizedFee } from './read-testnet-fee.mjs';

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
    if (![queuedHash, processedHash].every(hash => isHexString(hash, 32))) throw new InputError('Supply both transaction hashes.');
    async function read(event, transactionHash) {
        const receipt = await providers[0]('eth_getTransactionReceipt', [transactionHash]);
        if (!receipt?.blockNumber) throw new InputError('A supplied transaction has no mined receipt.');
        return verifyPairReading(pair, { auctionId, entry, transactionHash, event,
            blockHash: receipt.blockHash, blockNumber: Number(BigInt(receipt.blockNumber)) }, providers, readOrdinaryRefundEntry);
    }
    const queued = await read('OutbidRefundQueued', queuedHash);
    const processed = await read('OutbidRefundProcessed', processedHash);
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
        if (!file || (batch ? !entry || queued !== undefined : !processed) || extra.length) throw new InputError('Usage: node scripts/read-ordinary-outbid-refund.mjs reviewed-pair.json AUCTION_ID QUEUE_INDEX OUTBIDDING_TX PROCESSING_TX or reviewed-pair.json --batch PROCESSING_TX');
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
