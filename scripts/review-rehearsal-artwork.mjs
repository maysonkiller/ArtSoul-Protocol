import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Interface, getAddress, isHexString, keccak256, toQuantity } from 'ethers';
import { verifyArtworkRegistration as readPublicationEvidence } from '../src/api/upload-registration-evidence.js';
import { rehearsalArtwork as fixture, rehearsalMetadataUri as uri, rehearsalOpening } from './rehearsal-review/client.mjs';
import { listenForReview, sequencedRead } from './serve-rehearsal-review.mjs';
import { confirmFinalizedBlock, finalizedBlock, requireIndependentProviders, verifyTreasurySafesWithTwoProviders } from './verify-treasury-safes.mjs';

const market = new Interface([
    'function registerArtwork(string uri) returns (uint256)',
    'function createAuction(uint256 artworkId,uint256 startPrice,uint256 duration) returns (uint256)',
    'function auctionCount() view returns (uint256)',
    'function workCount() view returns (uint256)',
    'function works(uint256) view returns (address creator, string metadataURI, uint256 activeAuction, uint256 floor)',
    'function artworkToToken(uint256 artworkId) view returns (uint256 tokenId)',
    'event ArtworkRegistered(uint256 indexed artworkId, address indexed creator, string metadataURI)'
]);
const data = market.encodeFunctionData('registerArtwork', [uri]);
const openingData = market.encodeFunctionData('createAuction', [1n, rehearsalOpening.reserveWei, Number(rehearsalOpening.hours) * 3600]);
const chain = '0x14a34';
const sha = bytes => createHash('sha256').update(Buffer.from(bytes.slice(2), 'hex')).digest('hex');
assert.equal(sha(data), fixture.dataSha256, 'Unsigned fixture differs from the browser review');
assert.equal(sha(openingData), rehearsalOpening.dataSha256, 'Unsigned auction differs from the browser review');

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

async function checkWork(rpc, id, payer, at) {
    const work = await view(rpc, 'works', [id], at);
    assert.equal(work.creator, payer, 'Another account registered this work. Check your receipt before retrying.');
    assert.equal(work.metadataURI, uri, 'A different work occupies this ID. Check your receipt before retrying.');
    return work;
}

export async function registrationAtHead(rpc, payer, block) {
    const at = { blockHash: block.hash, requireCanonical: true };
    const [finalized] = await view(rpc, 'workCount', [], at);
    if (finalized > 0n) {
        await checkWork(rpc, 1n, payer, at);
        return { complete: true, finalizedArtwork: { id: '1' } };
    }
    const [latest] = await view(rpc, 'workCount', [], 'latest');
    if (latest > 0n) {
        await checkWork(rpc, 1n, payer, 'latest');
        return { waitingForFinality: { role: 'registerArtwork' } };
    }
    return firstWorkRequest(rpc, payer, 'registerArtwork', data);
}

async function firstWorkRequest(rpc, payer, operation, callData) {
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
    assert.equal(predicted.toLowerCase(), market.encodeFunctionResult(operation, [1n]), 'Pending rehearsal history changed');
    return { operation, nonce: toQuantity(BigInt(nonce)), target: fixture.core,
        ...(operation === 'registerArtwork' && { metadataUri: uri }),
        data: callData, dataHash: keccak256(callData), dataSha256: sha(callData), deployments: [], codeChecks };
}

export async function openingAtHead(rpc, payer, block) {
    const at = { blockHash: block.hash, requireCanonical: true };
    const [finalized] = await view(rpc, 'auctionCount', [], at);
    if (finalized > 0n) return { complete: true, existingAuctionHistory: true };
    const [latest] = await view(rpc, 'auctionCount', [], 'latest');
    if (latest > 0n) return { waitingForFinality: { role: 'createAuction' } };
    await simulateRegisteredOpening(rpc, payer, block, rehearsalOpening.reserveWei, rehearsalOpening.hours);
    return firstWorkRequest(rpc, payer, 'createAuction', openingData);
}

export async function buildArtworkReview(review, register, providers, { opening = false } = {}) {
    const payer = checkedPayer(review, register);
    const { block } = await verifyTreasurySafesWithTwoProviders(register, ...providers, { requirePair: true });
    const observe = opening ? openingAtHead : registrationAtHead;
    const [first, second] = await Promise.all(providers.map(rpc => observe(rpc, payer, block)));
    assert.deepEqual(first, second, 'Providers disagree on the rehearsal state. Refresh later.');
    await Promise.all(providers.map(async rpc => confirmFinalizedBlock(rpc, await finalizedBlock(84532, rpc), block)));
    return { chainId: chain, payer, block, ...first };
}

// This read exercises the actual registered work and never requests a wallet or opens the review server.
export async function simulateRegisteredOpening(rpc, payer, block, reserveWei, hours) {
    assert(/^[1-9]\d{0,77}$/.test(reserveWei) && BigInt(reserveWei) < (1n << 256n), 'Use a positive uint256 reserve in wei');
    assert(['24', '36', '48'].includes(hours), 'Choose 24, 36 or 48 hours');
    const at = { blockHash: block.hash, requireCanonical: true };
    const [work, [token], [count]] = await Promise.all([checkWork(rpc, 1n, payer, at),
        view(rpc, 'artworkToToken', [1], at, fixture.nft), view(rpc, 'auctionCount', [], at)]);
    assert.equal(work.activeAuction, 0n, 'This work already has an auction');
    assert(work.floor === 0n && token === 0n, 'This work already settled or minted');
    const call = { from: payer, to: fixture.core, value: '0x0',
        data: market.encodeFunctionData('createAuction', [1n, reserveWei, Number(hours) * 3600]) };
    const raw = await rpc('eth_call', [call, at]);
    assert.equal(raw.toLowerCase(), market.encodeFunctionResult('createAuction', [count + 1n]), 'Unexpected simulated auction ID');
    return { chainId: 84532, block, artworkId: '1', core: fixture.core, creator: payer,
        reserveWei, durationHours: Number(hours), simulatedAuctionId: (count + 1n).toString(), calldataHash: keccak256(call.data) };
}

export async function inspectRegistrationReceipt(rpc, hash, payer) {
    const [head, tx, receipt] = await Promise.all([finalizedBlock(84532, rpc),
        rpc('eth_getTransactionByHash', [hash]), rpc('eth_getTransactionReceipt', [hash])]);
    assert(tx && receipt, 'Transaction or receipt is unavailable');
    assert.equal(tx.hash?.toLowerCase(), hash);
    assert.equal(receipt.transactionHash?.toLowerCase(), hash);
    assert.equal(tx.chainId, chain);
    assert.equal(tx.input, data, 'Unexpected artwork registration calldata');
    assert.equal(BigInt(tx.value), 0n);
    assert.equal(receipt.status, '0x1', 'Registration failed');
    for (const item of [tx, receipt]) {
        assert.equal(getAddress(item.from), payer, 'Unexpected author');
        assert.equal(getAddress(item.to), fixture.core, 'Unexpected Core');
    }
    const block = { number: receipt.blockNumber, hash: receipt.blockHash };
    assert.equal(tx.blockHash, block.hash);
    assert.equal(tx.blockNumber, block.number);
    assert(isHexString(block.hash, 32) && /^0x[0-9a-f]+$/i.test(receipt.transactionIndex));
    assert.equal(tx.transactionIndex, receipt.transactionIndex);
    await confirmFinalizedBlock(rpc, head, block);
    const included = await rpc('eth_getBlockByNumber', [block.number, false]);
    assert.equal(included?.hash, block.hash);
    assert.equal(included?.transactions?.[Number(BigInt(receipt.transactionIndex))]?.toLowerCase(), hash,
        'Receipt is absent from its canonical position');
    assert.equal(receipt.logs?.length, 1, 'Expected only one registration event');
    const [log] = receipt.logs;
    assert.equal(getAddress(log.address), fixture.core);
    assert.equal(log.transactionHash?.toLowerCase(), hash);
    assert.equal(log.blockHash, block.hash);
    assert.equal(log.blockNumber, block.number);
    assert.equal(log.transactionIndex, receipt.transactionIndex);
    assert.match(log.logIndex, /^0x(?:0|[1-9a-f][0-9a-f]*)$/i);
    assert(!log.removed, 'Removed registration event');
    const event = market.parseLog(log);
    assert.equal(event?.name, 'ArtworkRegistered');
    assert(event.args.artworkId > 0n);
    assert.equal(event.args.creator, payer);
    assert.equal(event.args.metadataURI, uri);
    const encoded = market.encodeEventLog(event.fragment, event.args);
    assert.deepEqual(log.topics.map(topic => topic.toLowerCase()), encoded.topics);
    assert.equal(log.data.toLowerCase(), encoded.data);
    const at = { blockHash: block.hash, requireCanonical: true };
    const [work, [tokenId]] = await Promise.all([checkWork(rpc, event.args.artworkId, payer, at),
        view(rpc, 'artworkToToken', [event.args.artworkId], at, fixture.nft)]);
    assert.equal(tokenId, 0n, 'Unexpected token at the registration block');
    assert.equal(work.floor, 0n, 'Unexpected floor at the registration block');
    return { block, txHash: hash, transactionIndex: receipt.transactionIndex, workId: String(event.args.artworkId),
        creator: payer, core: fixture.core, metadataUri: uri, logCount: receipt.logs.length, logIndex: BigInt(log.logIndex).toString(),
        atRegistrationBlock: { activeAuctionId: work.activeAuction === 0n ? null : String(work.activeAuction),
            canonicalFloorWei: String(work.floor), tokenId: null } };
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

export async function verifyArtworkRegistration(review, register, txHash, providers) {
    const payer = checkedPayer(review, register);
    assert(isHexString(txHash, 32), 'Expected the public registration transaction hash');
    requireIndependentProviders(providers);
    const [first, second] = await Promise.all(providers.map(rpc => inspectRegistrationReceipt(rpc, txHash.toLowerCase(), payer)));
    assert.deepEqual(first, second, 'Providers disagree on the registration receipt');
    await verifyTreasurySafesWithTwoProviders(register, ...providers, { requirePair: true, expectedBlock: first.block });
    const publicationEvidence = await checkRegistrationPublication(first, register, providers);
    return { ...first, nft: register.nft.address, nftCodeHash: register.nft.codeHash, publicationEvidence, rpcReadings: 2 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const [reviewFile, registerFile, option, hash, ...extra] = process.argv.slice(2);
        const opening = option === '--check-opening' && hash && extra.length === 1;
        const auctionRequest = option === '--opening-plan' || option === '--serve-opening';
        assert(reviewFile && registerFile && (opening || (!extra.length && ((!hash && (!option || auctionRequest || option === '--plan')) ||
            (option === '--verify-receipt' && hash)))), 'Usage: review-rehearsal-artwork.mjs review.json register.json [--plan | --verify-receipt HASH | --check-opening RESERVE_WEI HOURS | --opening-plan | --serve-opening]');
        const [review, register] = await Promise.all([reviewFile, registerFile].map(async path => JSON.parse(await readFile(path, 'utf8'))));
        const providers = ['https://sepolia.base.org', 'https://base-sepolia-rpc.publicnode.com'].map(sequencedRead);
        const getPlan = () => buildArtworkReview(review, register, providers, { opening: auctionRequest });
        if (opening) {
            const payer = checkedPayer(review, register);
            const { block } = await verifyTreasurySafesWithTwoProviders(register, ...providers, { requirePair: true });
            const [first, second] = await Promise.all(providers.map(rpc => simulateRegisteredOpening(rpc, payer, block, hash, extra[0])));
            assert.deepEqual(first, second, 'Providers disagree on the simulated auction');
            await Promise.all(providers.map(async rpc => confirmFinalizedBlock(rpc, await finalizedBlock(84532, rpc), block)));
            console.log(JSON.stringify({ ...first, rpcReadings: 2 }, null, 2));
        } else if (option === '--verify-receipt') console.log(JSON.stringify(await verifyArtworkRegistration(review, register, hash, providers), null, 2));
        else if (option === '--plan' || option === '--opening-plan') console.log(JSON.stringify(await getPlan(), null, 2));
        else {
            checkedPayer(review, register);
            const { url } = await listenForReview(getPlan);
            console.log('Open the private Base Sepolia rehearsal page on this computer:\n' + url);
        }
    } catch (error) {
        console.error(error.shortMessage ?? error.message);
        process.exitCode = 1;
    }
}
