import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Interface, getAddress, isHexString, keccak256, toQuantity } from 'ethers';
import { verifyArtworkRegistration as readPublicationEvidence } from '../src/api/upload-registration-evidence.js';
import { rehearsalArtwork as fixture, rehearsalMetadataUri as uri, rehearsalOpening, rehearsalLateBid, refundWork } from './rehearsal-review/client.mjs';
import { listenForReview, sequencedRead } from './serve-rehearsal-review.mjs';
import { confirmFinalizedBlock, finalizedBlock, requireIndependentProviders, verifyTreasurySafesWithTwoProviders } from './verify-treasury-safes.mjs';

const market = new Interface([
    'function registerArtwork(string uri) returns (uint256)',
    'function createAuction(uint256 artworkId,uint256 startPrice,uint256 duration) returns (uint256)',
    'function auctionCount() view returns (uint256)',
    'function auctions(uint256) view returns(uint256 artworkId,uint256 startPrice,uint256 originalEnd,uint256 end,uint256 deadline,address highestBidder,uint256 price,uint256 deposit,uint8 state,address firstCollector)',
    'function workCount() view returns (uint256)',
    'function works(uint256) view returns (address creator, string metadataURI, uint256 activeAuction, uint256 floor)',
    'function artworkToToken(uint256 artworkId) view returns (uint256 tokenId)',
    'event ArtworkRegistered(uint256 indexed artworkId, address indexed creator, string metadataURI)',
    'event AuctionOpened(uint256 indexed auctionId,uint256 indexed artworkId,uint256 startPrice,uint256 end)'
]);
const data = market.encodeFunctionData('registerArtwork', [uri]);
const refundData = market.encodeFunctionData('registerArtwork', [refundWork.metadataUri]);
const openingData = market.encodeFunctionData('createAuction', [1n, rehearsalOpening.reserveWei, Number(rehearsalOpening.hours) * 3600]);
const refundOpeningData = market.encodeFunctionData('createAuction', [2n, rehearsalOpening.reserveWei, Number(rehearsalOpening.hours) * 3600]);
const chain = '0x14a34';
const signedRegistration = '0xe6e6f19235b714814c40bb1ab20aebd4ff2408f17c9e8bc4f15e1e7ee391eacf';
const sha = bytes => createHash('sha256').update(Buffer.from(bytes.slice(2), 'hex')).digest('hex');
assert.equal(sha(data), fixture.dataSha256, 'Unsigned fixture differs from the browser review');
assert.equal(sha(refundData), refundWork.dataSha256, 'Refund fixture differs from the browser review');
assert.equal(sha(openingData), rehearsalOpening.dataSha256, 'Unsigned auction differs from the browser review');
assert.equal(sha(refundOpeningData), refundWork.openingSha256, 'Refund auction differs from the browser review');

function checkedPayer(review, register) {
    assert.equal(review.chainId, 84532);
    assert.equal(register.chainId, 84532);
    for (const [role, field] of [['core', 'expectedCore'], ['nft', 'expectedNFT']]) {
        assert.equal(getAddress(review[field]), fixture[role], 'Review differs from the payout pair');
        assert.equal(getAddress(register[role].address), fixture[role], 'Custody register differs from the payout pair');
        assert.equal(register[role].codeHash, fixture[role + 'Hash'], 'Runtime differs from payout release');
    }
    return getAddress(review.payer);
}

async function view(rpc, name, params, at, to = fixture.core) {
    const raw = await rpc('eth_call', [{ to, data: market.encodeFunctionData(name, params) }, at]);
    const result = market.decodeFunctionResult(name, raw);
    assert.equal(market.encodeFunctionResult(name, result), raw.toLowerCase(), 'Noncanonical contract read');
    return result;
}

async function checkWork(rpc, id, payer, at, metadata = uri) {
    const work = await view(rpc, 'works', [id], at);
    assert.equal(work.creator, payer, 'Another account registered this work. Check your receipt before retrying.');
    assert.equal(work.metadataURI, metadata, 'A different work occupies this ID. Check your receipt before retrying.');
    return work;
}

export async function registrationAtHead(rpc, payer, block, secondWork = false) {
    const at = { blockHash: block.hash, requireCanonical: true };
    const expectedId = secondWork ? 2n : 1n, metadata = secondWork ? refundWork.metadataUri : uri;
    if (secondWork) {
        const [first, auction, [tokenId]] = await Promise.all([checkWork(rpc, 1n, payer, at), view(rpc, 'auctions', [1n], at),
            view(rpc, 'artworkToToken', [1n], at, fixture.nft)]);
        const price = BigInt(rehearsalOpening.reserveWei);
        assert(first.activeAuction === 0n && first.floor === price && tokenId === 1n &&
            auction.artworkId === 1n && auction.state === 4n && auction.price === price &&
            auction.firstCollector === rehearsalLateBid.bidder, 'Auction 1 must have its reviewed finalized settlement first');
    }
    const [finalized] = await view(rpc, 'workCount', [], at);
    if (finalized >= expectedId) {
        await checkWork(rpc, expectedId, payer, at, metadata);
        return { complete: true, finalizedArtwork: { id: String(expectedId) } };
    }
    const [latest] = await view(rpc, 'workCount', [], 'latest');
    if (latest >= expectedId) {
        await checkWork(rpc, expectedId, payer, 'latest', metadata);
        return { waitingForFinality: { role: 'registerArtwork' } };
    }
    assert.equal(finalized, expectedId - 1n);
    assert.equal(latest, finalized, 'Registry changed since finality');
    return workRequest(rpc, payer, 'registerArtwork', secondWork ? refundData : data, expectedId);
}

async function workRequest(rpc, payer, operation, callData, expectedId = 1n) {
    const [nonce, pending, code, predicted, ...codeChecks] = await Promise.all([
        rpc('eth_getTransactionCount', [payer, 'latest']), rpc('eth_getTransactionCount', [payer, 'pending']),
        rpc('eth_getCode', [payer, 'latest']), rpc('eth_call', [{ from: payer, to: fixture.core, data: callData, value: '0x0' }, 'pending']),
        ...['core', 'nft'].map(async key => {
            const runtime = await rpc('eth_getCode', [fixture[key], 'latest']);
            assert.equal(keccak256(runtime), fixture[key + 'Hash'], 'Latest runtime differs from review');
            return { address: fixture[key], sha256: sha(runtime) };
        })
    ]);
    assert.equal(code, '0x', 'Select the reviewed externally owned test payer');
    assert.equal(nonce, pending, 'A payer request is pending. Check the wallet activity before retrying.');
    assert.equal(predicted.toLowerCase(), market.encodeFunctionResult(operation, [expectedId]), 'Pending rehearsal history changed');
    return { operation, nonce: toQuantity(BigInt(nonce)), target: fixture.core,
        ...(operation === 'registerArtwork' && { metadataUri: expectedId === 2n ? refundWork.metadataUri : uri }),
        ...(expectedId === 2n && { rehearsalWorkId: '2' }),
        data: callData, dataHash: keccak256(callData), dataSha256: sha(callData), deployments: [], codeChecks };
}

export async function openingAtHead(rpc, payer, block, secondWork = false, registrationHash) {
    const id = secondWork ? 2n : 1n;
    if (secondWork) {
        await checkedRefundRegistration(rpc, payer, registrationHash, block);
    }
    const at = { blockHash: block.hash, requireCanonical: true };
    const [finalized] = await view(rpc, 'auctionCount', [], at);
    if (finalized >= id) return { complete: true, existingAuctionHistory: true, ...(secondWork && {rehearsalWorkId: '2'}) };
    assert.equal(finalized, id - 1n, 'Unexpected previous auction count');
    const [latest] = await view(rpc, 'auctionCount', [], 'latest');
    if (latest >= id) return { waitingForFinality: { role: 'createAuction' } };
    assert.equal(latest, finalized, 'Auction history changed since finality');
    await simulateRegisteredOpening(rpc, payer, block, rehearsalOpening.reserveWei, rehearsalOpening.hours, secondWork);
    const request = await workRequest(rpc, payer, 'createAuction', secondWork ? refundOpeningData : openingData, id);
    return secondWork ? { ...request, registrationHash: registrationHash.toLowerCase() } : request;
}

export async function buildArtworkReview(review, register, providers, { opening = false, secondWork = false, registrationHash } = {}) {
    const payer = checkedPayer(review, register);
    const { block } = await verifyTreasurySafesWithTwoProviders(register, ...providers, { requirePair: true });
    const observe = opening ? openingAtHead : registrationAtHead;
    const [first, second] = await Promise.all(providers.map(rpc => observe(rpc, payer, block, secondWork, registrationHash)));
    assert.deepEqual(first, second, 'Providers disagree on the rehearsal state. Refresh later.');
    await Promise.all(providers.map(async rpc => confirmFinalizedBlock(rpc, await finalizedBlock(84532, rpc), block)));
    return { chainId: chain, payer, block, ...first };
}

// This read exercises the actual registered work and never requests a wallet or opens the review server.
export async function simulateRegisteredOpening(rpc, payer, block, reserveWei, hours, secondWork = false) {
    assert(/^[1-9]\d{0,77}$/.test(reserveWei) && BigInt(reserveWei) < (1n << 256n), 'Use a positive uint256 reserve in wei');
    assert(['24', '36', '48'].includes(hours), 'Choose 24, 36 or 48 hours');
    const at = { blockHash: block.hash, requireCanonical: true };
    const id = secondWork ? 2n : 1n;
    const [work, [token], [count]] = await Promise.all([checkWork(rpc, id, payer, at, secondWork ? refundWork.metadataUri : uri),
        view(rpc, 'artworkToToken', [id], at, fixture.nft), view(rpc, 'auctionCount', [], at)]);
    assert.equal(work.activeAuction, 0n, 'This work already has an auction');
    assert(work.floor === 0n && token === 0n, 'This work already settled or minted');
    const call = { from: payer, to: fixture.core, value: '0x0',
        data: market.encodeFunctionData('createAuction', [id, reserveWei, Number(hours) * 3600]) };
    const raw = await rpc('eth_call', [call, at]);
    assert.equal(raw.toLowerCase(), market.encodeFunctionResult('createAuction', [count + 1n]), 'Unexpected simulated auction ID');
    return { chainId: 84532, block, artworkId: String(id), core: fixture.core, creator: payer,
        reserveWei, durationHours: Number(hours), simulatedAuctionId: (count + 1n).toString(), calldataHash: keccak256(call.data) };
}

async function readReviewedEvent(rpc, hash, payer, calldata, eventName) {
    const [head, tx, receipt] = await Promise.all([finalizedBlock(84532, rpc),
        rpc('eth_getTransactionByHash', [hash]), rpc('eth_getTransactionReceipt', [hash])]);
    assert(tx && receipt, 'Transaction or receipt is unavailable');
    assert.equal(tx.hash?.toLowerCase(), hash);
    assert.equal(receipt.transactionHash?.toLowerCase(), hash);
    assert.equal(tx.chainId, chain);
    assert.equal(tx.input, calldata, 'Unexpected reviewed calldata');
    assert.equal(BigInt(tx.value), 0n);
    assert.equal(receipt.status, '0x1', 'Transaction failed');
    for (const item of [tx, receipt]) {
        assert.equal(getAddress(item.from), payer, 'Unexpected author');
        assert.equal(getAddress(item.to), fixture.core, 'Unexpected Core');
    }
    const block = { number: receipt.blockNumber, hash: receipt.blockHash };
    assert.equal(tx.blockHash, block.hash);
    assert.equal(tx.blockNumber, block.number);
    assert(isHexString(block.hash, 32) && /^0x[0-9a-f]+$/i.test(receipt.transactionIndex));
    assert.equal(tx.transactionIndex, receipt.transactionIndex);
    const included = await confirmFinalizedBlock(rpc, head, block);
    assert.equal(included?.transactions?.[Number(BigInt(receipt.transactionIndex))]?.toLowerCase(), hash,
        'Receipt is absent from its canonical position');
    assert.equal(receipt.logs?.length, 1, 'Expected only the reviewed event');
    const [log] = receipt.logs;
    assert.equal(getAddress(log.address), fixture.core);
    assert.equal(log.transactionHash?.toLowerCase(), hash);
    assert.equal(log.blockHash, block.hash);
    assert.equal(log.blockNumber, block.number);
    assert.equal(log.transactionIndex, receipt.transactionIndex);
    assert.match(log.logIndex, /^0x(?:0|[1-9a-f][0-9a-f]*)$/i);
    assert(!log.removed, 'Removed event');
    const event = market.parseLog(log);
    assert.equal(event?.name, eventName);
    const encoded = market.encodeEventLog(event.fragment, event.args);
    assert.deepEqual(log.topics.map(topic => topic.toLowerCase()), encoded.topics);
    assert.equal(log.data.toLowerCase(), encoded.data);
    return { block, included, tx, receipt, event, log };
}

export async function inspectRegistrationReceipt(rpc, hash, payer, secondWork = false) {
    const metadata = secondWork ? refundWork.metadataUri : uri;
    const { block, receipt, event, log } = await readReviewedEvent(rpc, hash, payer, secondWork ? refundData : data, 'ArtworkRegistered');
    assert(event.args.artworkId > 0n);
    if (secondWork) assert.equal(event.args.artworkId, 2n, 'Unexpected ID for the refund rehearsal work');
    assert.equal(event.args.creator, payer);
    assert.equal(event.args.metadataURI, metadata);
    const at = { blockHash: block.hash, requireCanonical: true };
    const [work, [tokenId]] = await Promise.all([checkWork(rpc, event.args.artworkId, payer, at, metadata),
        view(rpc, 'artworkToToken', [event.args.artworkId], at, fixture.nft)]);
    assert.equal(tokenId, 0n, 'Unexpected token at the registration block');
    assert.equal(work.floor, 0n, 'Unexpected floor at the registration block');
    return { block, txHash: hash, transactionIndex: receipt.transactionIndex, workId: String(event.args.artworkId),
        creator: payer, core: fixture.core, metadataUri: metadata, logCount: receipt.logs.length, logIndex: BigInt(log.logIndex).toString(),
        atRegistrationBlock: { activeAuctionId: work.activeAuction === 0n ? null : String(work.activeAuction),
            canonicalFloorWei: String(work.floor), tokenId: null } };
}

async function checkedRefundRegistration(rpc, payer, hash, at, openingIndex) {
    assert(isHexString(hash, 32), 'Supply the finalized registration transaction hash for work 2');
    const registration = await inspectRegistrationReceipt(rpc, hash.toLowerCase(), payer, true);
    const height = BigInt(registration.block.number), end = BigInt(at.number);
    assert(height < end || (height === end && registration.block.hash === at.hash &&
        (openingIndex === undefined || BigInt(registration.transactionIndex) < BigInt(openingIndex))), 'Registration must precede the reviewed opening');
    return registration;
}

export async function inspectOpeningReceipt(rpc, hash, payer, secondWork = false, registrationHash) {
    const { block, included, tx, receipt, event, log } = await readReviewedEvent(rpc, hash, payer, secondWork ? refundOpeningData : openingData, 'AuctionOpened');
    if (secondWork) await checkedRefundRegistration(rpc, payer, registrationHash, block, receipt.transactionIndex);
    const { auctionId, artworkId, startPrice, end } = event.args;
    const durationSeconds = BigInt(rehearsalOpening.hours) * 3600n;
    assert((secondWork ? auctionId === 2n && artworkId === 2n : auctionId > 0n && artworkId === 1n) &&
        startPrice === BigInt(rehearsalOpening.reserveWei), 'Unexpected auction opening terms');
    assert.equal(end, BigInt(included.timestamp) + durationSeconds, 'Auction deadline differs from the signed duration');
    const at = { blockHash: block.hash, requireCanonical: true };
    const [work, auction, [token]] = await Promise.all([checkWork(rpc, artworkId, payer, at, secondWork ? refundWork.metadataUri : uri),
        view(rpc, 'auctions', [auctionId], at), view(rpc, 'artworkToToken', [artworkId], at, fixture.nft)]);
    assert(work.activeAuction === auctionId && work.floor === 0n && token === 0n, 'Work state differs at the opening block');
    assert(auction.artworkId === artworkId && auction.startPrice === startPrice && auction.originalEnd === end &&
        auction.end === end && auction.state === 1n, 'Stored auction differs from the opening event');
    return { block, txHash: hash, creator: payer, core: fixture.core, transactionIndex: receipt.transactionIndex,
        nonce: String(BigInt(tx.nonce)), gasUsed: String(BigInt(receipt.gasUsed)), logIndex: String(BigInt(log.logIndex)),
        artworkId: String(artworkId), auctionId: String(auctionId), reserveWei: String(startPrice), durationSeconds: String(durationSeconds),
        ...(secondWork && { registrationHash: registrationHash.toLowerCase() }),
        openedAt: new Date(Number(BigInt(included.timestamp)) * 1000).toISOString(), originalEnd: new Date(Number(end) * 1000).toISOString(),
        atOpeningBlock: { bidWei: String(auction.price), depositWei: String(auction.deposit), tokenId: null, canonicalFloorWei: '0' } };
}

export async function verifyArtworkOpening(review, register, hash, providers, secondWork = false, registrationHash) {
    const payer = checkedPayer(review, register);
    assert(isHexString(hash, 32), 'Expected a public auction opening transaction hash');
    requireIndependentProviders(providers);
    const [first, second] = await Promise.all(providers.map(rpc => inspectOpeningReceipt(rpc, hash.toLowerCase(), payer, secondWork, registrationHash)));
    assert.deepEqual(first, second, 'Providers disagree on the opening receipt');
    await verifyTreasurySafesWithTwoProviders(register, ...providers, { requirePair: true, expectedBlock: first.block });
    return { ...first, rpcReadings: 2 };
}

// Exercise the publication recovery reader on this receipt without submitting its evidence to the catalog.
export async function checkRegistrationPublication(receipt, register, providers) {
    const blockNumber = BigInt(receipt.block.number).toString();
    const result = await readPublicationEvidence({
        deployment: { chainId: register.chainId, core: register.core.address, coreCodeHash: register.core.codeHash, startBlock: blockNumber },
        creator: receipt.creator, metadataUri: receipt.metadataUri, transactionHash: receipt.txHash
    }, { rpcs: providers });
    assert.equal(result.state, 'verified', 'Publication reader returned ' + (result.reason || result.state));
    assert.deepEqual(result.registrations, [{ artwork_id: receipt.workId, creator_wallet: receipt.creator.toLowerCase(),
        metadata_uri: receipt.metadataUri, transaction_hash: receipt.txHash, block_number: blockNumber,
        block_hash: receipt.block.hash, log_index: receipt.logIndex }], 'Publication evidence differs from the reviewed registration');
    return result;
}

export async function verifyArtworkRegistration(review, register, txHash, providers, secondWork = false) {
    const payer = checkedPayer(review, register);
    assert(isHexString(txHash, 32), 'Expected the public registration transaction hash');
    requireIndependentProviders(providers);
    const [first, second] = await Promise.all(providers.map(rpc => inspectRegistrationReceipt(rpc, txHash.toLowerCase(), payer, secondWork)));
    assert.deepEqual(first, second, 'Providers disagree on the registration receipt');
    await verifyTreasurySafesWithTwoProviders(register, ...providers, { requirePair: true, expectedBlock: first.block });
    const publicationEvidence = await checkRegistrationPublication(first, register, providers);
    return { ...first, nft: register.nft.address, nftCodeHash: register.nft.codeHash, publicationEvidence, rpcReadings: 2 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const [reviewFile, registerFile, option, hash, ...extra] = process.argv.slice(2);
        const opening = option === '--check-opening' && hash && extra.length === 1;
        const refundOpening = ['--refund-opening-plan','--serve-refund-opening','--verify-refund-opening'].includes(option);
        const auctionRequest = option === '--opening-plan' || option === '--serve-opening';
        const secondWork = refundOpening || ['--refund-work-plan','--serve-refund-work','--verify-refund-work'].includes(option);
        if (refundOpening) {
            assert(isHexString(hash, 32), 'Supply the finalized registration transaction hash for work 2');
            assert(option === '--verify-refund-opening' ? extra.length === 1 && isHexString(extra[0],32) : !extra.length,
                'To verify the opening, supply the registration hash followed by the opening hash');
        }
        assert(reviewFile && registerFile && (refundOpening || opening || (!extra.length && ((!hash && (!option || auctionRequest || ['--plan','--refund-work-plan','--serve-refund-work'].includes(option))) ||
            (['--verify-receipt','--verify-opening','--verify-refund-work'].includes(option) && hash)))), 'Expected release review and register files followed by an artwork rehearsal option. See the ordinary market rehearsal runbook.');
        const [review, register] = await Promise.all([reviewFile, registerFile].map(async path => JSON.parse(await readFile(path, 'utf8'))));
        const providers = ['https://sepolia.base.org', 'https://base-sepolia-rpc.publicnode.com'].map(sequencedRead);
        const getPlan = () => buildArtworkReview(review, register, providers, { opening: auctionRequest || refundOpening, secondWork, registrationHash: refundOpening ? hash : undefined });
        if (opening) {
            const payer = checkedPayer(review, register);
            const { block } = await verifyTreasurySafesWithTwoProviders(register, ...providers, { requirePair: true });
            const [first, second] = await Promise.all(providers.map(rpc => simulateRegisteredOpening(rpc, payer, block, hash, extra[0])));
            assert.deepEqual(first, second, 'Providers disagree on the simulated auction');
            await Promise.all(providers.map(async rpc => confirmFinalizedBlock(rpc, await finalizedBlock(84532, rpc), block)));
            console.log(JSON.stringify({ ...first, rpcReadings: 2 }, null, 2));
        } else if (option === '--verify-receipt' || option === '--verify-refund-work') console.log(JSON.stringify(await verifyArtworkRegistration(review, register, hash, providers, secondWork), null, 2));
        else if (option === '--verify-opening') console.log(JSON.stringify(await verifyArtworkOpening(review, register, hash, providers), null, 2));
        else if (option === '--verify-refund-opening') console.log(JSON.stringify(await verifyArtworkOpening(review, register, extra[0], providers, true, hash), null, 2));
        else if (option?.endsWith('-plan') || option === '--plan') console.log(JSON.stringify(await getPlan(), null, 2));
        else {
            checkedPayer(review, register);
            if (refundOpening) await getPlan();
            const { url } = await listenForReview(getPlan, {
                loadRegistration: option === '--serve-opening' || option === '--serve-refund-opening'
                    ? () => verifyArtworkRegistration(review, register, refundOpening ? hash : signedRegistration, providers, refundOpening) : undefined
            });
            console.log('Open the private Base Sepolia rehearsal page on this computer:\n' + url);
        }
    } catch (error) {
        console.error(error.shortMessage ?? error.message);
        process.exitCode = 1;
    }
}
