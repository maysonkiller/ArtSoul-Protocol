// A fixed, user-reviewed Base Sepolia bid. The CLI only issues read RPCs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Interface, ZeroAddress, isHexString, keccak256, toQuantity } from 'ethers';
import { inspectOpeningReceipt } from './review-rehearsal-artwork.mjs';
import { rehearsalArtwork as pair, rehearsalLateBid as bid, rehearsalOpening, lateBidWindow } from './rehearsal-review/client.mjs';
import { listenForReview, sequencedRead } from './serve-rehearsal-review.mjs';
import { requireIndependentProviders } from './verify-treasury-safes.mjs';

const creator = '0xE6d6658DD5013B30Ab8cA9CBD667D0b5a5A1b215';
const openingHash = '0x9c13f650612551c6a13d0be018ce0cdc44036ba43de0e36e7a8b74f29e45d42d';
const market = new Interface([
    'function auctions(uint256) view returns(uint256 artworkId,uint256 startPrice,uint256 originalEnd,uint256 end,uint256 deadline,address highestBidder,uint256 price,uint256 deposit,uint8 state,address firstCollector)',
    'function minimumBid(uint256) view returns(uint256)',
    'function requiredDepositForBid(uint256) view returns(uint256)',
    'function placeBid(uint256,uint256) payable'
]);
const price = BigInt(rehearsalOpening.reserveWei);
const call = { from: bid.bidder, to: pair.core, data: market.encodeFunctionData('placeBid', [1n, price]), value: bid.deposit };
const sha256 = hex => createHash('sha256').update(Buffer.from(hex.slice(2), 'hex')).digest('hex');
assert.equal(sha256(call.data), bid.dataSha256);

async function view(rpc, name, args, at) {
    const raw = await rpc('eth_call', [{ to: pair.core, data: market.encodeFunctionData(name, args) }, at]);
    const result = market.decodeFunctionResult(name, raw);
    assert.equal(market.encodeFunctionResult(name, result), raw.toLowerCase(), 'Malformed contract state');
    return result;
}

export async function inspectFirstBid(rpc, now) {
    const head = await rpc('eth_getBlockByNumber', ['latest', false]);
    assert(isHexString(head?.hash, 32), 'A canonical recent head is required');
    const at = { blockHash: head.hash, requireCanonical: true };
    const [auction, ...codeChecks] = await Promise.all([view(rpc, 'auctions', [1n], at),
        ...['core', 'nft'].map(async role => {
            const runtime = await rpc('eth_getCode', [pair[role], at]);
            assert.equal(keccak256(runtime), pair[role + 'Hash'], 'Unexpected live ' + role + ' runtime');
            return { address: pair[role], sha256: sha256(runtime) };
        })]);
    return prepareFirstBid(rpc, at, Number(BigInt(head.timestamp)), auction, codeChecks, now);
}

export async function prepareFirstBid(rpc, at, timestamp, auction, codeChecks, now) {
    assert(auction.artworkId === 1n && auction.startPrice === price && auction.originalEnd === BigInt(bid.deadline),
        'The auction does not match its recorded opening');
    if (auction.state !== 1n || auction.end !== auction.originalEnd || auction.highestBidder !== ZeroAddress ||
        auction.price !== 0n || auction.deposit !== 0n || auction.deadline !== 0n) {
        return { complete: true, lateBidStatus: 'changed' };
    }
    const phase = lateBidWindow(timestamp, now);
    if (phase !== 'open') return { lateBidStatus: phase };
    const [[minimum], [required], code, latest, pending, balance, simulated] = await Promise.all([
        view(rpc, 'minimumBid', [1n], at), view(rpc, 'requiredDepositForBid', [price], at),
        rpc('eth_getCode', [bid.bidder, at]), rpc('eth_getTransactionCount', [bid.bidder, 'latest']),
        rpc('eth_getTransactionCount', [bid.bidder, 'pending']), rpc('eth_getBalance', [bid.bidder, 'pending']),
        rpc('eth_call', [call, 'pending'])
    ]);
    assert(minimum === price && required === BigInt(call.value), 'Bid or deposit has changed');
    assert.equal(code, '0x', 'The reviewed bidder must be an externally owned account');
    assert.equal(latest, pending, 'The bidder has a pending transaction. Check wallet activity.');
    assert(BigInt(balance) > required, 'The bidder needs the deposit plus test gas');
    assert.equal(simulated, '0x', 'The pending bid simulation failed');
    if (lateBidWindow(timestamp, now) !== 'open') return { complete: true, lateBidStatus: 'expired' };
    return { operation: 'placeBid', target: pair.core, value: bid.deposit, nonce: toQuantity(BigInt(pending)),
        data: call.data, dataHash: keccak256(call.data), dataSha256: bid.dataSha256, codeChecks, deployments: [] };
}

export async function firstLateBidReview(providers) {
    requireIndependentProviders(providers);
    const openings = await Promise.all(providers.map(rpc => inspectOpeningReceipt(rpc, openingHash, creator)));
    assert.deepEqual(openings[0], openings[1], 'RPC providers disagree on the finalized opening');
    const opening = openings[0];
    assert(opening.auctionId === '1' && opening.artworkId === '1' && opening.reserveWei === String(price) &&
        opening.originalEnd === new Date(bid.deadline * 1000).toISOString(), 'Unexpected finalized opening');
    const plans = await Promise.all(providers.map(rpc => inspectFirstBid(rpc)));
    assert.deepEqual(plans[0], plans[1], 'RPC providers disagree on bid availability. Refresh after the next block.');
    return { chainId: '0x14a34', payer: bid.bidder, block: opening.block, ...plans[0] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const [mode, ...extra] = process.argv.slice(2);
        assert(!extra.length && ['--plan', '--serve'].includes(mode), 'Usage: node scripts/review-rehearsal-late-bid.mjs --plan|--serve');
        const providers = ['https://sepolia.base.org', 'https://base-sepolia-rpc.publicnode.com'].map(sequencedRead);
        const load = () => firstLateBidReview(providers);
        if (mode === '--plan') console.log(JSON.stringify(await load(), null, 2));
        else console.log('Open the private Base Sepolia bid review on this computer:\n' + (await listenForReview(load)).url);
    } catch (error) { console.error(error.shortMessage ?? error.message); process.exitCode = 1; }
}
