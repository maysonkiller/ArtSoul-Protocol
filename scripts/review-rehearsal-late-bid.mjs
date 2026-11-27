// A fixed, user-reviewed Base Sepolia bid. The CLI only issues read RPCs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Interface, ZeroAddress, getAddress, isHexString, keccak256, toQuantity } from 'ethers';
import { checkReceipt, decodeReceiptLog, verifyTransactionPosition } from '../src/indexer/settlement-receipt.js';
import { inspectOpeningReceipt } from './review-rehearsal-artwork.mjs';
import { rehearsalArtwork as pair, rehearsalLateBid as bid, rehearsalOpening, lateBidWindow, settlementDigest, withdrawalDigest, surplusWei } from './rehearsal-review/client.mjs';
import { verifyPairReading } from './read-reviewed-ordinary-pair.mjs';
import { readOrdinarySettlement, readOrdinaryToken } from '../src/indexer/nft-deployment-proof.js';
import { listenForReview, sequencedRead } from './serve-rehearsal-review.mjs';
import { confirmFinalizedBlock, finalizedBlock, requireIndependentProviders } from './verify-treasury-safes.mjs';

const creator = '0xE6d6658DD5013B30Ab8cA9CBD667D0b5a5A1b215';
const openingHash = '0x9c13f650612551c6a13d0be018ce0cdc44036ba43de0e36e7a8b74f29e45d42d';
const firstBidHash = '0xe486f15933f6892b415e4d5c93d174c459f85268e8ee2a56059dbe2e4aee9b89';
const market = new Interface([
    'function auctions(uint256) view returns(uint256 artworkId,uint256 startPrice,uint256 originalEnd,uint256 end,uint256 deadline,address highestBidder,uint256 price,uint256 deposit,uint8 state,address firstCollector)',
    'function minimumBid(uint256) view returns(uint256)',
    'function requiredDepositForBid(uint256) view returns(uint256)',
    'function dueAuctionAction(uint256) view returns(uint8)',
    'function runnerUpOffers(uint256) view returns(address bidder,uint256 price,uint256 deadline)',
    'function placeBid(uint256,uint256) payable',
    'function settleAuction(uint256) payable returns(uint256)',
    'function credits(address) view returns(uint256)',
    'function withdraw()',
    'event CreditWithdrawn(address indexed creditor,uint256 amount)',
    'event BidAccepted(uint256 indexed auctionId,address indexed bidder,uint256 price,uint256 deposit)',
    'event AuctionExtended(uint256 indexed auctionId,uint256 oldEnd,uint256 newEnd)'
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

async function readAuction(rpc, at) {
    const [auction, ...codeChecks] = await Promise.all([view(rpc, 'auctions', [1n], at),
        ...['core', 'nft'].map(async role => {
            const runtime = await rpc('eth_getCode', [pair[role], at]);
            assert.equal(keccak256(runtime), pair[role + 'Hash'], 'Unexpected live ' + role + ' runtime');
            return { address: pair[role], sha256: sha256(runtime) };
        })]);
    return { auction, codeChecks };
}

function checkOpening(auction) {
    assert(auction.artworkId === 1n && auction.startPrice === price && auction.originalEnd === BigInt(bid.deadline),
        'The auction does not match its recorded opening');
}

export async function inspectFirstBid(rpc, now) {
    const head = await rpc('eth_getBlockByNumber', ['latest', false]);
    assert(isHexString(head?.hash, 32), 'A canonical recent head is required');
    const at = { blockHash: head.hash, requireCanonical: true };
    const { auction, codeChecks } = await readAuction(rpc, at);
    return prepareFirstBid(rpc, at, Number(BigInt(head.timestamp)), auction, codeChecks, now);
}

// Historical evidence only. The wallet planner still checks each provider's recent head and pending state.
export async function finalizedAuctionStatus(providers) {
    requireIndependentProviders(providers);
    const heads = await Promise.all(providers.map(rpc => finalizedBlock(84532, rpc)));
    const block = BigInt(heads[0].number) <= BigInt(heads[1].number) ? heads[0] : heads[1];
    const at = { blockHash: block.hash, requireCanonical: true };
    const iso = seconds => new Date(Number(seconds) * 1000).toISOString();
    const observations = await Promise.all(providers.map(async (rpc, index) => {
        const header = await confirmFinalizedBlock(rpc, heads[index], block);
        const { auction } = await readAuction(rpc, at);
        checkOpening(auction);
        const states = ['None', 'Open', 'Payment', 'No bids', 'Settled', 'Defaulted', 'Runner-up offer'];
        const actions = ['None', 'Close auction', 'Finalize default', 'Expire runner-up offer'];
        const [action] = await view(rpc, 'dueAuctionAction', [1n], at);
        assert(states[auction.state] && auction.state !== 0n && actions[action], 'Unknown auction lifecycle state');
        const offer = auction.state === 6n ? await view(rpc, 'runnerUpOffers', [1n], at) : null;
        return { chainId: 84532, core: pair.core, nft: pair.nft, artworkId: '1', auctionId: '1', block,
            observedAt: iso(BigInt(header.timestamp)), state: states[auction.state], dueAction: actions[action],
            reserveWei: String(auction.startPrice), highestBidWei: String(auction.price),
            highestBidder: auction.highestBidder === ZeroAddress ? null : auction.highestBidder,
            originalBiddingEnd: iso(auction.originalEnd), biddingEnd: iso(auction.end),
            winnerPaymentEnd: auction.state === 2n ? iso(auction.deadline) : null,
            runnerUpOffer: offer ? { bidder: offer.bidder, priceWei: String(offer.price), end: iso(offer.deadline) } : null };
    }));
    assert.deepEqual(observations[0], observations[1], 'Providers disagree on finalized auction evidence');
    return { ...observations[0], rpcReadings: 2 };
}

export async function prepareFirstBid(rpc, at, timestamp, auction, codeChecks, now) {
    checkOpening(auction);
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

export function checkWinnerSettlement(auction, timestamp) {
    checkOpening(auction);
    assert(auction.highestBidder === bid.bidder && auction.price === price && auction.deposit === BigInt(bid.deposit) &&
        auction.end === BigInt(bid.deadline + bid.window), 'The winning bid or deposit changed, or settlement is complete.');
    assert((auction.state === 1n && timestamp >= auction.end) ||
        (auction.state === 2n && timestamp < auction.deadline), 'Auction is outside the winner settlement window.');
}

async function winnerSettlementReview(providers) {
    const proof = await verifyFirstBidReceipt(firstBidHash, providers);
    const data = market.encodeFunctionData('settleAuction', [1n]);
    assert.equal(sha256(data), settlementDigest);
    const tx = { from: bid.bidder, to: pair.core, value: '0x0', data };
    const plans = await Promise.all(providers.map(async rpc => {
        const head = await rpc('eth_getBlockByNumber', ['latest', false]);
        const { auction, codeChecks } = await readAuction(rpc, { blockHash: head.hash, requireCanonical: true });
        checkWinnerSettlement(auction, BigInt(head.timestamp));
        const [nonce, pending, simulation] = await Promise.all([rpc('eth_getTransactionCount', [bid.bidder, 'latest']),
            rpc('eth_getTransactionCount', [bid.bidder, 'pending']), rpc('eth_call', [tx, 'pending'])]);
        assert.equal(nonce, pending, 'Winner has a pending transaction.');
        assert.equal(simulation, market.encodeFunctionResult('settleAuction', [1n]), 'Unexpected minted token ID.');
        return {chainId: '0x14a34', operation: 'settleAuction', payer: bid.bidder, target: pair.core,
            block: {number: toQuantity(BigInt(proof.blockNumber)), hash: proof.blockHash}, nonce, value: tx.value,
            data, dataHash: keccak256(data), dataSha256: settlementDigest, codeChecks, deployments: []};
    }));
    assert.deepEqual(plans[0], plans[1], 'RPC providers disagree on winner settlement.');
    return plans[0];
}

const issuer = { chainId: 84532, coreAddress: pair.core, nftAddress: pair.nft,
    expectedCoreCodeHash: pair.coreHash, expectedNftCodeHash: pair.nftHash };

async function firstSale(providers) {
    const receipt = JSON.parse(await readFile(new URL('../docs/testnet/ordinary-auction-1-settlement.json', import.meta.url), 'utf8'));
    const sale = await verifyPairReading(issuer, receipt, providers, readOrdinarySettlement);
    assert(sale.auctionId === '1' && sale.artworkId === '1' && sale.tokenId === '1');
    assert.equal(getAddress(sale.firstCollector), bid.bidder);
    assert.equal(BigInt(sale.priceWei), price);
    return sale;
}

export async function firstSaleHistory(providers) {
    const sale = await firstSale(providers);
    const heads = await Promise.all(providers.map(rpc => finalizedBlock(issuer.chainId, rpc)));
    const head = BigInt(heads[0].number) <= BigInt(heads[1].number) ? heads[0] : heads[1];
    const blockNumber = Number(BigInt(head.number));
    assert(Number.isSafeInteger(blockNumber) && blockNumber >= sale.blockNumber);
    const token = await verifyPairReading(issuer, { tokenId: sale.tokenId, blockNumber, blockHash: head.hash },
        providers, readOrdinaryToken);
    assert(token.artworkId === sale.artworkId && token.creator === sale.creator && token.firstCollector === sale.firstCollector,
        'Finalized token provenance differs from its primary sale');
    return { sale, owner: token.owner, ownerBlock: token.blockNumber, ownerBlockHash: token.blockHash };
}

export async function winnerCreditReview(providers) {
    const sale = await firstSale(providers);
    const data = market.encodeFunctionData('withdraw');
    assert.equal(sha256(data), withdrawalDigest);
    const plans = await Promise.all(providers.map(async rpc => {
        const [last, pending] = await Promise.all([rpc('eth_getTransactionCount',[bid.bidder,'latest']),
            rpc('eth_getTransactionCount',[bid.bidder,'pending'])]);
        assert.equal(last, pending, 'Winner has a pending transaction.');
        const head = await rpc('eth_getBlockByNumber',['latest',false]);
        const at = {blockHash:head.hash,requireCanonical:true};
        const [{auction,codeChecks}, [credit]] = await Promise.all([readAuction(rpc,at), view(rpc,'credits',[bid.bidder],at)]);
        assert(auction.state === 4n && getAddress(auction.firstCollector) === bid.bidder && auction.artworkId === 1n,
            'The reviewed sale is not settled.');
        if (credit === 0n) return {complete:true,emptyWinnerCredit:true};
        assert.equal(credit, surplusWei, 'Current credit differs from the surplus of auction 1.');
        const tx = {from:bid.bidder,to:pair.core,value:'0x0',data};
        assert.equal(await rpc('eth_call',[tx,'pending']), '0x', 'The winner cannot currently receive this credit.');
        return {chainId:'0x14a34',operation:'withdraw',payer:bid.bidder,target:pair.core,
            block:{number:toQuantity(sale.blockNumber),hash:sale.blockHash},nonce:last,value:tx.value,
            data,dataHash:keccak256(data),dataSha256:withdrawalDigest,codeChecks,deployments:[]};
    }));
    assert.deepEqual(plans[0],plans[1],'RPC providers disagree on winner credit.');
    return plans[0];
}

export function readBidExtension(tx, receipt, header, hash, {core, bidder, deadline}) {
    assert.equal(tx?.hash?.toLowerCase(), hash, 'Unexpected bid transaction');
    assert.equal(tx.chainId, '0x14a34', 'Wrong bid network');
    assert.equal(tx.blockHash, header.hash);
    assert.equal(tx.blockNumber, header.number);
    assert.equal(tx.transactionIndex, receipt.transactionIndex);
    checkReceipt(receipt, {blockHash:header.hash, blockNumber:header.number}, hash, 'first late bid');
    verifyTransactionPosition(receipt, header, hash);
    for (const envelope of [tx,receipt]) {
        assert.equal(getAddress(envelope.from), bidder, 'Unexpected bidder');
        assert.equal(getAddress(envelope.to), core, 'Unexpected bid destination');
    }
    assert.equal(tx.input?.toLowerCase(), call.data, 'Unexpected bid calldata');
    assert.equal(BigInt(tx.value), BigInt(call.value), 'Unexpected bid deposit');
    const timestamp = Number(BigInt(header.timestamp));
    assert(timestamp >= deadline-bid.window && timestamp < deadline, 'Bid was outside the original late window');
    assert.equal(receipt.logs.length, 2, 'Expected only BidAccepted and AuctionExtended');
    for (const log of receipt.logs) assert.equal(getAddress(log.address), core, 'Unexpected bid event emitter');
    const accepted = decodeReceiptLog(market, 'BidAccepted', receipt.logs[0], receipt);
    const extended = decodeReceiptLog(market, 'AuctionExtended', receipt.logs[1], receipt);
    assert.equal(extended.index, accepted.index+1, 'Bid extension must immediately follow the accepted bid');
    assert.deepEqual([...accepted.args], [1n, bidder, price, BigInt(bid.deposit)], 'Unexpected accepted bid');
    assert.deepEqual([...extended.args], [1n, BigInt(deadline), BigInt(deadline+bid.window)], 'Unexpected deadline extension');
    const time = seconds => new Date(seconds*1000).toISOString();
    return { transactionHash:hash, blockNumber:String(BigInt(header.number)), blockHash:header.hash, bidder, core,
        auctionId:'1', artworkId:'1', bidWei:String(price), depositWei:String(BigInt(bid.deposit)),
        acceptedLogIndex:accepted.index, extendedLogIndex:extended.index, includedAt:time(timestamp),
        previousDeadline:time(deadline), deadlineAfterThisBid:time(deadline+bid.window), gasUsed:String(BigInt(receipt.gasUsed)) };
}

export function readWinnerWithdrawal(tx, receipt, header, hash) {
    checkReceipt(receipt,{blockNumber:header.number,blockHash:header.hash},hash,'withdrawal');
    verifyTransactionPosition(receipt,header,hash);
    assert(tx.hash.toLowerCase() === hash && tx.chainId === '0x14a34' && tx.blockHash === header.hash &&
        tx.blockNumber === header.number && tx.transactionIndex === receipt.transactionIndex &&
        tx.input === market.encodeFunctionData('withdraw') && BigInt(tx.value) === 0n, 'Unexpected withdrawal transaction');
    for (const item of [tx,receipt]) assert(getAddress(item.from) === bid.bidder && getAddress(item.to) === pair.core,
        'Unexpected withdrawal sender or destination');
    assert(receipt.logs.length === 1 && getAddress(receipt.logs[0].address) === pair.core, 'Unexpected withdrawal events');
    const {args,index} = decodeReceiptLog(market,'CreditWithdrawn',receipt.logs[0],receipt);
    assert.deepEqual([...args],[bid.bidder,surplusWei], 'Unexpected withdrawal recipient or amount');
    return {transactionHash:hash,blockNumber:String(BigInt(header.number)),blockHash:header.hash,logIndex:index,
        creditor:bid.bidder,amountWei:String(surplusWei),gasUsed:String(BigInt(receipt.gasUsed))};
}

async function verifyRehearsalReceipt(hash, providers, withdrawal) {
    assert(isHexString(hash,32), 'Supply a public transaction hash');
    requireIndependentProviders(providers);
    hash = hash.toLowerCase();
    const results = await Promise.all(providers.map(async rpc => {
        const [head,tx,receipt] = await Promise.all([finalizedBlock(84532,rpc),
            rpc('eth_getTransactionByHash',[hash]),rpc('eth_getTransactionReceipt',[hash])]);
        assert(receipt && tx, 'Transaction is not yet included');
        const block = await confirmFinalizedBlock(rpc,head,{number:receipt.blockNumber,hash:receipt.blockHash});
        const at = {blockHash:block.hash,requireCanonical:true};
        const {auction} = await readAuction(rpc,at);
        if (withdrawal) {
            assert(auction.state === 4n && auction.artworkId === 1n && getAddress(auction.firstCollector) === bid.bidder,
                'Unexpected settled auction at withdrawal');
            return readWinnerWithdrawal(tx,receipt,block,hash);
        }
        const proof = readBidExtension(tx,receipt,block,hash,{core:pair.core,bidder:bid.bidder,deadline:bid.deadline});
        assert(auction.artworkId === 1n && auction.startPrice === price && auction.originalEnd === BigInt(bid.deadline) &&
            auction.state === 1n && auction.end === BigInt(bid.deadline+bid.window) && auction.price >= price,
            'Stored auction differs from the bid receipt');
        return {...proof, highestBidderAtBlock:auction.highestBidder, highestBidWeiAtBlock:String(auction.price)};
    }));
    assert.deepEqual(results[0],results[1],'RPC providers disagree on the finalized transaction');
    return {...results[0],rpcReadings:2};
}

export function verifyFirstBidReceipt(hash, providers) {
    return verifyRehearsalReceipt(hash, providers, false);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const [mode, hash, ...extra] = process.argv.slice(2);
        const receiptMode = mode === '--verify-receipt' || mode === '--verify-withdrawal';
        assert(!extra.length && ((receiptMode && isHexString(hash,32)) ||
            (!hash && ['--plan','--serve','--status','--settle-plan','--settle','--withdraw-plan','--withdraw','--sale'].includes(mode))), 'Expected --status, --plan, --serve, --settle-plan, --settle, --withdraw-plan, --withdraw, --sale, --verify-receipt HASH or --verify-withdrawal HASH');
        const providers = ['https://sepolia.base.org', 'https://base-sepolia-rpc.publicnode.com'].map(sequencedRead);
        const review = mode.startsWith('--withdraw') ? winnerCreditReview : mode.startsWith('--settle') ? winnerSettlementReview : firstLateBidReview;
        const load = () => review(providers);
        if (receiptMode) console.log(JSON.stringify(await verifyRehearsalReceipt(hash,providers,mode==='--verify-withdrawal'),null,2));
        else if (mode.endsWith('-plan') || mode === '--plan') console.log(JSON.stringify(await load(), null, 2));
        else if (mode === '--status') console.log(JSON.stringify(await finalizedAuctionStatus(providers), null, 2));
        else console.log('Open the private Base Sepolia auction review on this computer:\n' + (await listenForReview(mode === '--sale' ? null : load, {
            loadAuction: () => finalizedAuctionStatus(providers),
            loadSale: () => firstSaleHistory(providers)
        })).url + (mode === '--sale' ? 'settlement' : ''));
    } catch (error) { console.error(error.shortMessage ?? error.message); process.exitCode = 1; }
}
