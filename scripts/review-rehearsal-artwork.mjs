import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Interface, getAddress, isHexString, keccak256, toQuantity } from 'ethers';
import { rehearsalArtwork as fixture, rehearsalMetadataUri as uri } from './rehearsal-review/client.mjs';
import { listenForReview, sequencedRead } from './serve-rehearsal-review.mjs';
import { confirmFinalizedBlock, finalizedBlock, requireIndependentProviders, verifyTreasurySafesWithTwoProviders } from './verify-treasury-safes.mjs';

const market = new Interface([
    'function registerArtwork(string uri) returns (uint256)',
    'function workCount() view returns (uint256)',
    'function works(uint256) view returns (address creator, string metadataURI, uint256 activeAuction, uint256 floor)',
    'event ArtworkRegistered(uint256 indexed artworkId, address indexed creator, string metadataURI)'
]);
const data = market.encodeFunctionData('registerArtwork', [uri]);
const chain = '0x14a34';
const sha = bytes => createHash('sha256').update(Buffer.from(bytes.slice(2), 'hex')).digest('hex');
assert.equal(sha(data), fixture.dataSha256, 'Unsigned fixture differs from the browser review');

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

async function view(rpc, name, params, at) {
    const result = await rpc('eth_call', [{ to: fixture.core, data: market.encodeFunctionData(name, params) }, at]);
    return market.decodeFunctionResult(name, result);
}

async function checkWork(rpc, id, payer, at) {
    const work = await view(rpc, 'works', [id], at);
    assert.equal(work.creator, payer, 'Another account registered this work. Check your receipt before retrying.');
    assert.equal(work.metadataURI, uri, 'A different work occupies this ID. Check your receipt before retrying.');
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
    const [nonce, pending, code, predicted, ...codeChecks] = await Promise.all([
        rpc('eth_getTransactionCount', [payer, 'latest']), rpc('eth_getTransactionCount', [payer, 'pending']),
        rpc('eth_getCode', [payer, 'latest']), rpc('eth_call', [{ from: payer, to: fixture.core, data, value: '0x0' }, 'pending']),
        ...['core', 'nft'].map(async key => {
            const runtime = await rpc('eth_getCode', [fixture[key], 'latest']);
            assert.equal(keccak256(runtime), fixture[key + 'Hash'], 'Latest runtime differs from review');
            return { address: fixture[key], sha256: sha(runtime) };
        })
    ]);
    assert.equal(code, '0x', 'Select the reviewed externally owned test payer');
    assert.equal(nonce, pending, 'A payer request is pending. Check the wallet activity before retrying.');
    assert.equal(market.decodeFunctionResult('registerArtwork', predicted)[0], 1n, 'Pending rehearsal registry changed');
    return { operation: 'registerArtwork', nonce: toQuantity(BigInt(nonce)), target: fixture.core,
        metadataUri: uri, data, dataHash: keccak256(data), dataSha256: fixture.dataSha256, deployments: [], codeChecks };
}

export async function buildArtworkReview(review, register, providers) {
    const payer = checkedPayer(review, register);
    const { block } = await verifyTreasurySafesWithTwoProviders(register, ...providers, { requirePair: true });
    const [first, second] = await Promise.all(providers.map(rpc => registrationAtHead(rpc, payer, block)));
    assert.deepEqual(first, second, 'Providers disagree on the registration state. Refresh later.');
    return { chainId: chain, payer, block, ...first };
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
    assert(!log.removed, 'Removed registration event');
    const event = market.parseLog(log);
    assert.equal(event?.name, 'ArtworkRegistered');
    assert(event.args.artworkId > 0n);
    assert.equal(event.args.creator, payer);
    assert.equal(event.args.metadataURI, uri);
    const at = { blockHash: block.hash, requireCanonical: true };
    await checkWork(rpc, event.args.artworkId, payer, at);
    return { block, txHash: hash, transactionIndex: receipt.transactionIndex, workId: String(event.args.artworkId),
        creator: payer, core: fixture.core, metadataUri: uri, logCount: receipt.logs.length };
}

export async function verifyArtworkRegistration(review, register, txHash, providers) {
    const payer = checkedPayer(review, register);
    assert(isHexString(txHash, 32), 'Expected the public registration transaction hash');
    requireIndependentProviders(providers);
    const [first, second] = await Promise.all(providers.map(rpc => inspectRegistrationReceipt(rpc, txHash.toLowerCase(), payer)));
    assert.deepEqual(first, second, 'Providers disagree on the registration receipt');
    await verifyTreasurySafesWithTwoProviders(register, ...providers, { requirePair: true, expectedBlock: first.block });
    return { ...first, rpcReadings: 2 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const [reviewFile, registerFile, option, hash, ...extra] = process.argv.slice(2);
        assert(reviewFile && registerFile && !extra.length && ((!option && !hash) || (option === '--plan' && !hash) ||
            (option === '--verify-receipt' && hash)), 'Usage: node scripts/review-rehearsal-artwork.mjs <payout-core-review.json> <payout-pair-register.json> [--plan | --verify-receipt <hash>]');
        const [review, register] = await Promise.all([reviewFile, registerFile].map(async path => JSON.parse(await readFile(path, 'utf8'))));
        const providers = ['https://sepolia.base.org', 'https://base-sepolia-rpc.publicnode.com'].map(sequencedRead);
        const getPlan = () => buildArtworkReview(review, register, providers);
        if (option) console.log(JSON.stringify(option === '--plan' ? await getPlan() : await verifyArtworkRegistration(review, register, hash, providers), null, 2));
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
