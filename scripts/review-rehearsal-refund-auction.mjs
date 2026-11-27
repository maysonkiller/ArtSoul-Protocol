import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { getAddress, isHexString, keccak256, toQuantity } from 'ethers';
import { readOrdinaryRefundEntry } from '../src/indexer/nft-deployment-proof.js';
import { rehearsalArtwork as pair } from './rehearsal-review/client.mjs';
import { refundCollectors, refundOpeningHash, refundRequestAt, refundStages } from './rehearsal-review/refund-auction.mjs';
import { verifyPairReading } from './read-reviewed-ordinary-pair.mjs';
import { inspectOpeningReceipt } from './review-rehearsal-artwork.mjs';
import { listenForReview, sequencedRead } from './serve-rehearsal-review.mjs';
import { confirmFinalizedBlock, finalizedBlock, requireIndependentProviders } from './verify-treasury-safes.mjs';

const creator = '0xE6d6658DD5013B30Ab8cA9CBD667D0b5a5A1b215';
const registration = '0xb2985bf66fefdcd1d32db037c23cfa4d55c99b151d19b4ba238045ace5561ac5';
const sha = data => createHash('sha256').update(Buffer.from(data.slice(2), 'hex')).digest('hex');

export async function refundAuctionPlan(stage, queuedHash, providers) {
    assert(refundStages.includes(stage), 'Choose first, outbid, close or refund.');
    const needsQueue = stage === 'close' || stage === 'refund';
    assert(needsQueue ? isHexString(queuedHash, 32) : queuedHash === undefined,
        'For closing or processing, supply the signed outbid receipt that queued the first deposit.');
    requireIndependentProviders(providers);
    const heads = await Promise.all(providers.map(rpc => finalizedBlock(84532, rpc)));
    const block = BigInt(heads[0].number) <= BigInt(heads[1].number) ? heads[0] : heads[1];
    const openingBlocks = await Promise.all(providers.map(async rpc => {
        const receipt = await rpc('eth_getTransactionReceipt', [refundOpeningHash]);
        assert(receipt?.status === '0x1' && receipt.transactionHash === refundOpeningHash &&
            getAddress(receipt.to) === pair.core && getAddress(receipt.from) === creator &&
            isHexString(receipt.blockHash, 32), 'Expected the signed auction 2 opening.');
        return { number: receipt.blockNumber, hash: receipt.blockHash };
    }));
    assert.deepEqual(openingBlocks[0], openingBlocks[1], 'Providers disagree on the opening block.');
    if (BigInt(block.number) < BigInt(openingBlocks[0].number)) {
        return { refundStatus: 'Both nodes see the auction opening at block ' + BigInt(openingBlocks[0].number) +
            '. Their common finalized height is ' + BigInt(block.number) + '. Wait for finality, then refresh.' };
    }
    const openings = await Promise.all(providers.map(rpc => inspectOpeningReceipt(rpc, refundOpeningHash, creator, true, registration)));
    assert.deepEqual(openings[0], openings[1], 'Providers disagree on the finalized auction 2 opening');
    if (needsQueue) {
        const receipt = await providers[0]('eth_getTransactionReceipt', [queuedHash]);
        assert(receipt?.blockNumber && getAddress(receipt.from) === refundCollectors[1], 'Expected the second collector’s signed outbid');
        const queued = await verifyPairReading({ chainId: 84532, coreAddress: pair.core, nftAddress: pair.nft,
            expectedCoreCodeHash: pair.coreHash, expectedNftCodeHash: pair.nftHash }, { auctionId: '2', entry: '0',
            event: 'OutbidRefundQueued', blockHash: receipt.blockHash, blockNumber: Number(BigInt(receipt.blockNumber)),
            transactionHash: queuedHash }, providers, readOrdinaryRefundEntry);
        assert(getAddress(queued.creditor) === refundCollectors[0] && queued.amountWei === '10000000000000000',
            'Unexpected displaced deposit in the signed outbid');
    }
    assert.deepEqual(openings[0].block, openingBlocks[0], 'Opening block changed. Refresh both providers.');
    const plans = await Promise.all(providers.map(async (rpc, index) => {
        await confirmFinalizedBlock(rpc, heads[index], block);
        const at = { blockHash: block.hash, requireCanonical: true };
        const finalized = await refundRequestAt(rpc, pair.core, stage, at);
        if (finalized.unavailable) return { refundStatus: finalized.unavailable };
        const live = await refundRequestAt(rpc, pair.core, stage, 'pending');
        if (live.unavailable || JSON.stringify(live) !== JSON.stringify(finalized)) {
            return { refundStatus: 'Auction 2 changed after the finalized block. Wait for finality and refresh.' };
        }
        const { payer, data, value } = live;
        const [nonce, pending, accountCode, balance, simulation, codeChecks] = await Promise.all([
            rpc('eth_getTransactionCount', [payer, 'latest']), rpc('eth_getTransactionCount', [payer, 'pending']),
            rpc('eth_getCode', [payer, 'pending']), rpc('eth_getBalance', [payer, 'pending']),
            rpc('eth_call', [{ from: payer, to: pair.core, value, data }, 'pending']),
            Promise.all(['core', 'nft'].map(async role => {
                const code = await rpc('eth_getCode', [pair[role], at]);
                assert.equal(keccak256(code), pair[role + 'Hash'], 'Unexpected payout pair code');
                return { address: pair[role], sha256: sha(code) };
            }))
        ]);
        assert(nonce === pending && accountCode === '0x' && BigInt(balance) > BigInt(value),
            'Check the collector’s pending nonce and test ETH for deposit and gas.');
        assert.equal(simulation, '0x', 'The pending transaction simulation failed.');
        return { ...live, chainId: '0x14a34', block, openingHash: refundOpeningHash, queuedHash, rehearsalWorkId: '2',
            refundStage: stage, target: pair.core, nonce: toQuantity(BigInt(nonce)), dataHash: keccak256(data),
            dataSha256: sha(data), codeChecks, deployments: [] };
    }));
    assert.deepEqual(plans[0], plans[1], 'Providers disagree on the current auction 2 request.');
    return plans[0];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const [mode, stage, queuedHash, ...extra] = process.argv.slice(2);
        assert(['--plan', '--serve'].includes(mode) && refundStages.includes(stage) && !extra.length &&
            (['close', 'refund'].includes(stage) ? isHexString(queuedHash, 32) : queuedHash === undefined),
        'Usage: node scripts/review-rehearsal-refund-auction.mjs --plan|--serve first|outbid|close|refund [OUTBID_TX]');
        const providers = ['https://sepolia.base.org', 'https://base-sepolia-rpc.publicnode.com'].map(sequencedRead);
        const load = () => refundAuctionPlan(stage, queuedHash, providers);
        if (mode === '--plan') console.log(JSON.stringify(await load(), null, 2));
        else console.log('Open this private Base Sepolia auction 2 review on this computer:\n' + (await listenForReview(load)).url);
    } catch (error) {
        console.error(error.shortMessage ?? error.message);
        process.exitCode = 1;
    }
}
