import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Interface, keccak256, ZeroAddress } from 'ethers';
import { checkCollectionMetadata, checkIssuedFirstWork } from '../scripts/check-collection-metadata.mjs';
import { createDraft, createFirstArtworkDraft } from '../src/features/collections/launch-config.js';
import { MAX_METADATA_BYTES } from '../src/config/upload-policy.js';

const cid = 'Qm' + 'a'.repeat(44);
const prefix = `ipfs://${cid}/items/`;
const metadata = { name: 'First work', image: `ipfs://${cid}/cover.png`, animation_url: 'https://art.example/work.webm' };

function draft(uri = prefix) {
    const config = createDraft();
    config.media.metadataBaseURI = uri;
    return JSON.stringify(config);
}

test('a saved collection draft checks exactly token 1 and retains the fingerprint of the served bytes', async t => {
    const body = JSON.stringify(metadata, null, 2) + '\n';
    const sha256 = createHash('sha256').update(body).digest('hex');
    const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
        assert.equal(url.href, `https://ipfs.io/ipfs/${cid}/items/1`);
        assert.equal(options.redirect, 'error');
        return new Response(body);
    });
    const report = await checkCollectionMetadata(draft(), sha256.toUpperCase());
    assert.equal(report.metadataURI, prefix + '1');
    assert.equal(report.sha256, sha256);
    assert.equal(report.bytes, Buffer.byteLength(body));
    assert.equal(report.image, metadata.image);
    assert.equal(report.animation_url, metadata.animation_url);
    assert.equal(report.tokenId, '1');
    assert.equal(fetch.mock.callCount(), 1, 'only the metadata document is requested');
    await assert.rejects(checkCollectionMetadata(draft(), '0'.repeat(64)), /differs from the expected/);
});

test('invalid prefixes, unsupported stores and malformed digests stop before any network read', async t => {
    const fetch = t.mock.method(globalThis, 'fetch');
    await assert.rejects(checkCollectionMetadata(draft('ipfs://')), /valid token metadata prefix/);
    await assert.rejects(checkCollectionMetadata(draft('https://example.com/items/')), /outside the supported/);
    await assert.rejects(checkCollectionMetadata(draft(), 'bad'), /64-character hex/);
    assert.equal(fetch.mock.callCount(), 0);
});

test('an unreadable, oversized or malformed response never produces a metadata check result', async t => {
    const cases = [
        [() => new Response('missing', { status: 404 }), /complete metadata response/],
        [() => new Response(new Uint8Array(MAX_METADATA_BYTES + 1)), /complete metadata response/],
        [() => new Response('not JSON'), /invalid UTF-8 or JSON/],
        [() => new Response(Uint8Array.of(0xff)), /invalid UTF-8 or JSON/],
        [() => Response.json({ image: metadata.image }), /display name/],
        [() => Response.json({ name: 'First work' }), /for image/],
        [() => Response.json({ ...metadata, animation_url: 'ipfs://invalid/work.mp4' }), /for animation_url/]
    ];
    for (const [response, message] of cases) {
        const mock = t.mock.method(globalThis, 'fetch', response);
        try { await assert.rejects(checkCollectionMetadata(draft()), message); }
        finally { mock.mock.restore(); }
    }
});

test('issued first-work evidence binds the draft, paying collector and current holder to one finalized contract', async t => {
    const draft = createFirstArtworkDraft();
    draft.media.metadataBaseURI = prefix;
    draft.maxSupply = 5;
    draft.phases[1].allocation = 4;
    draft.phases[0].pricing.priceEth = '0.000000000000000031';
    const json = JSON.stringify(draft);
    const address = '0x' + '1'.repeat(40), buyer = '0x' + '2'.repeat(40), holder = '0x' + '3'.repeat(40);
    const block = { number: '0x12', hash: '0x' + 'a'.repeat(64) };
    const code = '0x601160ff', runtime = keccak256(code);
    const body = JSON.stringify(metadata), digest = createHash('sha256').update(body).digest('hex');
    const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(body));
    const abi = new Interface([
        'function creator() returns (address)', 'function firstCollector(uint256) returns (address)',
        'function collectionFirstCollector() returns (address)', 'function ownerOf(uint256) returns (address)',
        'function tokenURI(uint256) returns (string)', 'function mintPrice(uint256) returns (uint256)',
        'function maxSupply() returns (uint32)', 'function configurationLocked() returns (bool)',
        'function allocatedSupply() returns (uint256)', 'function royaltyInfo(uint256,uint256) returns (address,uint256)'
    ]);
    const values = { creator: address, firstCollector: buyer, collectionFirstCollector: buyer,
        ownerOf: holder, tokenURI: prefix + '1', mintPrice: 42n, openingReserve: 31n, maxSupply: 5n,
        allocatedSupply: 5n, configurationLocked: true, royaltyInfo: [address, 550n] };
    let chain = '0x14a34', canonical = block;
    async function rpc(method, params) {
        if (method === 'eth_chainId') return chain;
        if (method === 'eth_getBlockByNumber') return params[0] === 'finalized' ? block : canonical;
        assert.deepEqual(params[1], { blockHash: block.hash, requireCanonical: true });
        if (method === 'eth_getCode') { assert.equal(params[0], address); return code; }
        assert.equal(method, 'eth_call');
        assert.equal(params[0].to, address);
        const call = abi.parseTransaction({ data: params[0].data });
        if (call.name === 'royaltyInfo') {
            assert.deepEqual([...call.args], [1n, 10000n]);
            return abi.encodeFunctionResult(call.fragment, values.royaltyInfo);
        }
        if (call.name === 'mintPrice' && call.args[0] === 0n) return abi.encodeFunctionResult(call.fragment, [values.openingReserve]);
        if (call.args.length) assert.equal(call.args[0], 1n);
        return abi.encodeFunctionResult(call.fragment, [values[call.name]]);
    }
    const other = (...args) => rpc(...args);
    const check = (second = other) => checkIssuedFirstWork(json, address, runtime, digest, [rpc, second]);
    const report = await check();
    assert.equal(report.firstCollector, buyer);
    assert.equal(report.owner, holder);
    assert.equal(report.publicMintPriceWei, '42');
    assert.equal(report.openingReserveWei, '31');
    assert.equal(report.supply, 5);
    assert.equal(report.rpcReadings, 2);
    assert.deepEqual(report.block, block);
    assert.equal(report.metadata.sha256, digest);
    for (const change of [d => { d.phases[1].pricing.sourcePhaseId = ''; }, d => { d.creatorEarnings.bps = 0; },
        d => { d.phases[1].pricing.fallback = 'fixed'; }, d => { d.maxSupply = 100; }]) {
        const different = JSON.parse(json);
        change(different);
        await assert.rejects(checkIssuedFirstWork(JSON.stringify(different), address, runtime, digest, [rpc, other]), /draft/);
    }
    await assert.rejects(check(rpc), /independent RPC/);
    await assert.rejects(check(async (method, params) => {
        const result = await rpc(method, params);
        return method === 'eth_call' && abi.parseTransaction({ data: params[0].data }).name === 'ownerOf'
            ? abi.encodeFunctionResult('ownerOf', [buyer]) : result;
    }), /providers disagree/);
    await assert.rejects(checkIssuedFirstWork(json, address, keccak256('0x01'), digest, [rpc, other]), /runtime differs/);
    for (const [field, bad, expected] of [['collectionFirstCollector', holder, /do not agree/],
        ['ownerOf', ZeroAddress, /do not agree/], ['mintPrice', 30n, /opening price/], ['tokenURI', prefix + '2', /URI differs/],
        ['maxSupply', 4n, /supply/], ['allocatedSupply', 3n, /allocation/], ['openingReserve', 32n, /opening price/],
        ['configurationLocked', false, /Locked/], ['royaltyInfo', [holder, 550n], /creator royalty/],
        ['royaltyInfo', [address, 549n], /creator royalty/]]) {
        const previous = values[field];
        values[field] = bad;
        await assert.rejects(check(), expected);
        values[field] = previous;
    }
    chain = '0x2105';
    await assert.rejects(check(), /Wrong RPC chain/);
    assert.equal(fetch.mock.callCount(), 1);
    chain = '0x14a34';
    canonical = { ...block, hash: '0x' + 'b'.repeat(64) };
    await assert.rejects(check(), /disagree on the finalized block/);
});
