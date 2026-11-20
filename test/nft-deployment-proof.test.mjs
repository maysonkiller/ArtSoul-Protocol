import assert from 'node:assert/strict';
import test from 'node:test';
import { Interface, keccak256 } from 'ethers';
import EventListener from '../src/indexer/event-listener.js';
import { readNftDeploymentProof } from '../src/indexer/nft-deployment-proof.js';

const CORE = `0x${'a'.repeat(40)}`, NFT = `0x${'b'.repeat(40)}`, OTHER = `0x${'c'.repeat(40)}`;
const HASH = `0x${'d'.repeat(64)}`, OTHER_HASH = `0x${'e'.repeat(64)}`;
const CORE_CODE = '0x6001600055', NFT_CODE = '0x6002600055';
const abi = new Interface(['function nftContract() view returns (address)', 'function nft() view returns (address)', 'function core() view returns (address)']);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function fixture({ blockNumber = 100, blockHash = HASH, coreGetter = 'nftContract', chainId = 84532 } = {}) {
    const value = { current: true, calls: [], replacements: new Map(), hook: null };
    const pin = { blockHash, requireCanonical: true };
    value.options = { chainId, coreAddress: CORE, nftAddress: NFT, blockNumber, blockHash,
        expectedCoreCodeHash: keccak256(CORE_CODE), expectedNftCodeHash: keccak256(NFT_CODE),
        isCurrent: () => value.current };
    const reply = (method, params) => {
        if (method === 'eth_chainId') { assert.deepEqual(params, []); return '0x' + chainId.toString(16); }
        if (method === 'eth_getBlockByNumber') {
            assert.deepEqual(params, [`0x${blockNumber.toString(16)}`, false]);
            return { number: `0x${blockNumber.toString(16)}`, hash: blockHash };
        }
        assert.deepEqual(params[1], pin, 'every code/getter read must use the canonical block hash');
        if (method === 'eth_getCode') {
            assert.ok([CORE, NFT].includes(params[0])); return params[0] === CORE ? CORE_CODE : NFT_CODE;
        }
        assert.equal(method, 'eth_call');
        const getter = params[0].to === CORE ? coreGetter : 'core';
        assert.ok([CORE, NFT].includes(params[0].to));
        assert.equal(params[0].data, abi.encodeFunctionData(getter));
        return abi.encodeFunctionResult(getter, [getter === 'core' ? CORE : NFT]);
    };
    value.provider = { async send(method, params) {
        const index = value.calls.push({ method, params });
        await value.hook?.(index, method, params);
        if (value.replacements.has(index)) {
            const replacement = value.replacements.get(index);
            if (replacement instanceof Error) throw replacement;
            return replacement;
        }
        return reply(method, params);
    } };
    // Use the real timeout/failover implementation without constructing a live provider.
    value.listener = Object.assign(Object.create(EventListener.prototype), {
        chainId, contractAddress: CORE, readProviders: [value.provider],
        readRpcs: ['https://rpc.invalid/first'], readRpcUnavailableUntil: [0], baseTimeout: 1000
    });
    value.run = () => readNftDeploymentProof(value.listener, value.options);
    return value;
}

test('a reciprocal deployment proof is immutable, block-scoped and exactly eight RPC calls', async () => {
    const value = fixture(), proof = await value.run();
    assert.deepEqual(proof, { chainId: 84532, coreAddress: CORE, nftAddress: NFT, blockNumber: 100,
        blockHash: HASH, coreCodeHash: keccak256(CORE_CODE), nftCodeHash: keccak256(NFT_CODE) });
    assert.ok(Object.isFrozen(proof));
    assert.throws(() => { proof.nftAddress = OTHER; }, TypeError);
    assert.deepEqual(value.calls.map(call => call.method), ['eth_chainId', 'eth_getBlockByNumber',
        'eth_getCode', 'eth_getCode', 'eth_call', 'eth_call', 'eth_getBlockByNumber', 'eth_chainId']);
});

test('the ordinary listener reads the specific auction from its pinned pair and canonical receipt', async () => {
    const tx = OTHER_HASH, zero = '0x' + '0'.repeat(40), bidder = '0x' + '1'.repeat(40);
    const events = new Interface([
        'event AuctionSettled(uint256 indexed auctionId,uint256 indexed artworkId,uint256 tokenId,uint256 price)',
        'event SettledArtworkIssued(uint256 indexed auctionId,uint256 indexed artworkId,uint256 indexed tokenId,address creator,address firstCollector)',
        'event RunnerUpOfferAccepted(uint256 indexed auctionId,address indexed bidder,uint256 price)',
        'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)'
    ]);
    const log = (address, name, args, index) => ({ address, ...events.encodeEventLog(name, args),
        blockHash: HASH, blockNumber: '0x64', transactionHash: tx, logIndex: '0x' + index.toString(16) });
    const logs = [
        log(OTHER, 'AuctionSettled', [2, 17, 19, 99], 3),
        log(CORE, 'AuctionSettled', [1, 13, 20, 11], 4),
        log(CORE, 'RunnerUpOfferAccepted', [2, bidder, 31], 5),
        log(NFT, 'SettledArtworkIssued', [2, 17, 19, OTHER, bidder], 6),
        log(NFT, 'Transfer', [zero, bidder, 19], 7),
        log(NFT, 'Transfer', [bidder, OTHER, 19], 8),
        log(CORE, 'AuctionSettled', [2, 17, 19, 31], 9)
    ];
    const check = (modifyReceipt = () => {}, configure = () => {}, chainId = 84532) => {
        const f = fixture({ coreGetter: 'nft', chainId });
        f.listener.nftAddress = NFT;
        const receipt = { status: '0x1', blockHash: HASH, transactionHash: tx, blockNumber: '0x64', logs: structuredClone(logs) };
        modifyReceipt(receipt);
        f.replacements.set(7, { number: '0x64', hash: HASH });
        f.replacements.set(8, receipt);
        f.hook = (index, method, params) => {
            if (index === 7) assert.deepEqual([method, params], ['eth_getBlockByNumber', ['finalized', false]]);
            if (index === 8) assert.deepEqual([method, params], ['eth_getTransactionReceipt', [tx]]);
        };
        configure(f);
        return f.listener.readOrdinarySettlement({ ...f.options, transactionHash: tx, auctionId: '2' });
    };
    const result = await check();
    assert.equal(result.chainId, 84532);
    assert.equal(result.coreAddress, CORE);
    assert.equal(result.nftAddress, NFT);
    assert.equal(result.auctionId, '2');
    assert.equal(result.artworkId, '17');
    assert.equal(result.tokenId, '19');
    assert.equal(result.firstCollector, bidder);
    assert.equal(result.priceWei, '31');
    assert.equal(result.logIndex, 9);
    assert.equal(result.runnerUpAccepted, true);
    const base = await check(undefined, undefined, 8453);
    assert.deepEqual(base, { ...result, chainId: 8453 });
    await assert.rejects(check(undefined, f => { f.listener.chainId = 84532; }, 8453), /authority changed/);
    await assert.rejects(check(undefined, f => { f.replacements.set(1, '0x14a34'); }, 8453), /RPC chain mismatch/);
    await assert.rejects(check(undefined, f => { f.replacements.set(6, abi.encodeFunctionResult('core', [OTHER])); }, 8453), /reciprocal binding mismatch/);
    await assert.rejects(check(undefined, undefined, 1), /Invalid NFT deployment proof inputs/);
    await assert.rejects(check(r => { r.logs[3].address = OTHER; }), /Expected one SettledArtworkIssued/);
    await assert.rejects(check(r => { r.logs[2] = log(CORE, 'RunnerUpOfferAccepted', [2, OTHER, 31], 5); }), /acceptance and settlement disagree/);
    await assert.rejects(check(r => { r.logs[2] = log(CORE, 'RunnerUpOfferAccepted', [2, bidder, 32], 5); }), /acceptance and settlement disagree/);
    await assert.rejects(check(r => { r.logs[4] = log(NFT, 'Transfer', [zero, OTHER, 19], 7); }), /settlement and mint disagree/);
    await assert.rejects(check(r => { r.logs[4].blockHash = OTHER_HASH; }), /log position/);
    await assert.rejects(check(r => { r.logs.push(r.logs[6]); }), /Expected one AuctionSettled/);
    await assert.rejects(check(r => { r.status = '0x0'; }), /successful ordinary settlement receipt/);
    await assert.rejects(check(undefined, f => { f.listener.nftAddress = ''; }), /authority changed/);
    await assert.rejects(check(undefined, f => { f.replacements.set(7, { number: '0x63', hash: HASH }); }), /not finalized/);
    await assert.rejects(check(undefined, f => { f.replacements.set(6, abi.encodeFunctionResult('core', [OTHER])); }), /reciprocal binding mismatch/);
});

const resaleGetter = new Interface(['function getActiveResale(uint256) view returns (bool, address, uint256, uint256)']);
const maxUint = 2n ** 256n - 1n;
const zeroAddress = '0x' + '0'.repeat(40);

test('runner-up terms require a canonical timestamp, finalized pair and matching auction state', async () => {
    const auctionAbi = new Interface([
        'function auctions(uint256) view returns(uint256,uint256,uint256,uint256,uint256,address,uint256,uint256,uint8,address)',
        'function runnerUpOffers(uint256) view returns(address,uint256,uint256)'
    ]);
    const auction = (state, first = zeroAddress) => auctionAbi.encodeFunctionResult('auctions', [1, 2, 4, 4, 5, CORE, 8, 1, state, first]);
    const offer = (bidder, price, deadline) => auctionAbi.encodeFunctionResult('runnerUpOffers', [bidder, price, deadline]);
    const header = { number: '0x64', hash: HASH, timestamp: '0x10' };
    for (const [index, reply, message] of [
        [2, { ...header, timestamp: '0x00' }, /block timestamp/],
        [5, abi.encodeFunctionResult('nft', [OTHER]), /binding mismatch/],
        [7, { number: '0x63', hash: OTHER_HASH }, /not finalized/],
        [8, auction(0), /Unknown ordinary auction/],
        [8, auction(7), /Inconsistent ordinary/],
        [8, auction(4, NFT), /Inconsistent ordinary/],
        [8, auction(6) + '00', /Invalid ordinary offer response/],
        [9, offer(OTHER, 5, 0), /Inconsistent ordinary/],
        [9, offer(zeroAddress, 5, 16), /Inconsistent ordinary/],
        [9, offer(OTHER, 0, 16), /Inconsistent ordinary/],
        [9, '0x', /Invalid ordinary offer response/],
        [10, { ...header, hash: OTHER_HASH }, /canonical block mismatch/]
    ]) {
        const f = fixture({ coreGetter: 'nft' });
        f.listener.nftAddress = NFT;
        f.replacements.set(2, header);
        f.replacements.set(7, header);
        f.replacements.set(8, auction(6));
        f.replacements.set(9, offer(OTHER, 5, 16));
        f.replacements.set(index, reply);
        await assert.rejects(f.listener.readOrdinaryRunnerUpOffer({ ...f.options, auctionId: '1' }), message);
    }
    const f = fixture({ coreGetter: 'nft' });
    for (const auctionId of ['0', '01', 1, (maxUint + 1n).toString()]) {
        await assert.rejects(f.listener.readOrdinaryRunnerUpOffer({ ...f.options, auctionId }), /Invalid ordinary auction ID/);
    }
    assert.equal(f.calls.length, 0);
});

function resaleFixture(response, chainId = 84532) {
    const f = fixture({ coreGetter: 'nft', chainId });
    f.listener.nftAddress = NFT;
    f.replacements.set(7, { number: '0x65', hash: OTHER_HASH });
    f.replacements.set(8, response);
    f.quote = (tokenId = maxUint.toString()) => f.listener.readOrdinaryResaleQuote({ ...f.options, tokenId });
    return f;
}

test('a finalized ordinary resale quote returns immutable pair identity and full-width terms', async () => {
    for (const chainId of [8453, 84532]) {
        const f = resaleFixture(resaleGetter.encodeFunctionResult('getActiveResale', [true, OTHER, maxUint - 8n, maxUint - 4n]), chainId);
        const quote = await f.quote();
        assert.deepEqual(quote, { chainId, coreAddress: CORE, nftAddress: NFT, blockNumber: 100, blockHash: HASH,
            coreCodeHash: keccak256(CORE_CODE), nftCodeHash: keccak256(NFT_CODE), tokenId: maxUint.toString(),
            active: true, seller: OTHER, priceWei: (maxUint - 8n).toString(), version: (maxUint - 4n).toString() });
        assert.ok(Object.isFrozen(quote));
        assert.deepEqual(f.calls[6], { method: 'eth_getBlockByNumber', params: ['finalized', false] });
        assert.deepEqual(f.calls[7], { method: 'eth_call', params: [{ to: CORE, data: resaleGetter.encodeFunctionData('getActiveResale', [maxUint]) },
            { blockHash: HASH, requireCanonical: true }] });
        assert.deepEqual(f.calls.slice(8), [{ method: 'eth_getBlockByNumber', params: ['0x64', false] }, { method: 'eth_chainId', params: [] }]);
    }
});

test('an inactive quote discloses no executable terms and retains the current listing version', async () => {
    for (const version of [0n, 9n]) {
        const f = resaleFixture(resaleGetter.encodeFunctionResult('getActiveResale', [false, zeroAddress, 0n, version]));
        const quote = await f.quote('1');
        assert.equal(quote.active, false);
        assert.equal(quote.seller, null);
        assert.equal(quote.priceWei, '0');
        assert.equal(quote.version, version.toString());
    }
});

test('missing or malformed active-quote results never fall back to a legacy listing or an absent price', async () => {
    const encode = args => resaleGetter.encodeFunctionResult('getActiveResale', args);
    const valid = encode([true, OTHER, 5n, 1n]);
    for (const answer of [new Error('method unavailable'), '0x', valid + '00', '0x' + '2'.padStart(64, '0') + valid.slice(66),
        encode([true, zeroAddress, 1n, 1n]), encode([true, OTHER, 0n, 1n]), encode([true, OTHER, 1n, 0n]),
        encode([false, OTHER, 0n, 1n]), encode([false, zeroAddress, 1n, 1n])]) {
        const f = resaleFixture(answer);
        await assert.rejects(f.quote('1'), /ordinary resale quote|method unavailable/);
        assert.equal(f.calls.length, 8);
        assert.equal(f.calls.at(-1).params[0].data, resaleGetter.encodeFunctionData('getActiveResale', [1]));
    }
});

test('foreign networks, wrong immutable bindings and unfinalized blocks cannot produce ordinary quotes', async () => {
    for (const [index, replacement, message] of [[1, '0x1', /RPC chain mismatch/],
        [5, abi.encodeFunctionResult('nft', [OTHER]), /reciprocal binding mismatch/],
        [6, abi.encodeFunctionResult('core', [OTHER]), /reciprocal binding mismatch/],
        [7, { number: '0x63', hash: OTHER_HASH }, /not finalized/],
        [7, { number: '0x64', hash: OTHER_HASH }, /not finalized/]]) {
        const f = resaleFixture(null);
        f.replacements.set(index, replacement);
        await assert.rejects(f.quote('1'), message);
        assert.equal(f.calls.length, index);
    }
    const f = resaleFixture(null);
    for (const id of ['0', '01', 1, (maxUint + 1n).toString()]) await assert.rejects(f.quote(id), /Invalid ordinary resale token ID/);
    assert.equal(f.calls.length, 0);
});

const invalidInputs = [
    ['chainId', 1], ['chainId', 11155111], ['chainId', 8453], ['chainId', '84532'],
    ['blockNumber', -1], ['blockNumber', 1.5], ['blockNumber', '100'], ['blockNumber', Number.MAX_SAFE_INTEGER + 1],
    ['blockHash', null], ['blockHash', '0x12'], ['blockHash', `0x${'0'.repeat(64)}`],
    ['coreAddress', null], ['coreAddress', '0x12'], ['coreAddress', `0x${'0'.repeat(40)}`],
    ['nftAddress', null], ['nftAddress', '0x12'], ['nftAddress', `0x${'0'.repeat(40)}`], ['nftAddress', CORE],
    ['expectedCoreCodeHash', undefined], ['expectedCoreCodeHash', '0x12'],
    ['expectedNftCodeHash', undefined], ['expectedNftCodeHash', `0x${'0'.repeat(64)}`], ['isCurrent', null],
    ['coreAddress', [CORE]], ['blockHash', [HASH]], ['expectedCoreCodeHash', [keccak256(CORE_CODE)]]
];
for (const [index, [field, replacement]] of invalidInputs.entries()) test(`invalid input ${field} case ${index} stops before RPC`, async () => {
    const value = fixture(); value.options[field] = replacement;
    await assert.rejects(value.run(), /Invalid NFT deployment proof inputs/);
    assert.equal(value.calls.length, 0);
});

for (const change of ['chain', 'core', 'nft', 'reader', 'authority']) test(`invalid listener ${change} stops before RPC`, async () => {
    const value = fixture();
    if (change === 'chain') value.listener.chainId = 1;
    if (change === 'core') value.listener.contractAddress = OTHER;
    if (change === 'nft') value.listener.nftAddress = OTHER;
    if (change === 'reader') value.listener._readRpcCall = null;
    if (change === 'authority') value.current = false;
    await assert.rejects(value.run(), /authority changed/);
    assert.equal(value.calls.length, 0);
});

for (const index of [1, 8]) for (const [label, answer] of [
    ['wrong chain', '0x1'], ['decimal', '84532'], ['leading zero', '0x014a34'], ['missing', null], ['array', ['0x14a34']]
]) test(`invalid ${label} chain response at call ${index}`, async () => {
    const value = fixture(); value.replacements.set(index, answer);
    await assert.rejects(value.run(), /RPC chain mismatch/);
    assert.equal(value.calls.length, index);
});

for (const index of [2, 7]) for (const [label, answer] of [
    ['missing', null], ['height', { number: '0x65', hash: HASH }],
    ['malformed number', { number: '100', hash: HASH }], ['missing hash', { number: '0x64' }],
    ['different hash', { number: '0x64', hash: OTHER_HASH }], ['array number', { number: ['0x64'], hash: HASH }]
]) test(`invalid ${label} header at call ${index}`, async () => {
    const value = fixture(); value.replacements.set(index, answer);
    await assert.rejects(value.run(), /canonical block mismatch/);
    assert.equal(value.calls.length, index);
});

for (const index of [3, 4]) for (const code of ['0x', '0x0', '0xzz', null, '0x6000']) test(`invalid runtime code at call ${index}: ${code}`, async () => {
    const value = fixture(); value.replacements.set(index, code);
    await assert.rejects(value.run(), /runtime code mismatch/);
    assert.equal(value.calls.length, index);
});

for (const index of [5, 6]) for (const [label, result] of [
    ['missing', null], ['short', '0x'], ['extra data', `0x${'0'.repeat(128)}`],
    ['zero', `0x${'0'.repeat(64)}`], ['wrong address', abi.encodeFunctionResult('core', [OTHER])],
    ['invalid padding', `0x${'f'.repeat(24)}${CORE.slice(2)}`]
]) test(`invalid reciprocal getter ${label} at call ${index}`, async () => {
    const value = fixture(); value.replacements.set(index, result);
    await assert.rejects(value.run());
    assert.equal(value.calls.length, index);
});

for (let index = 1; index <= 8; index++) test(`provider failure at call ${index} never falls back to an unpinned read`, async () => {
    const value = fixture(); value.replacements.set(index, new Error('fixture RPC unsupported or unavailable'));
    await assert.rejects(value.run(), /fixture RPC unsupported or unavailable/);
    assert.equal(value.calls.length, index);
});

for (let index = 1; index <= 8; index++) test(`lost authority during call ${index} stops the callback`, async () => {
    const value = fixture(); value.hook = call => { if (call === index) value.current = false; };
    await assert.rejects(value.run(), /authority changed/);
    assert.equal(value.calls.length, index);
});

for (const field of ['chainId', 'contractAddress', 'nftAddress']) test(`listener ${field} changes during proof fail closed`, async () => {
    const value = fixture(); value.hook = index => { if (index === 3) value.listener[field] = field === 'chainId' ? 1 : OTHER; };
    await assert.rejects(value.run(), /authority changed/);
    assert.equal(value.calls.length, 3);
});

test('caller mutation cannot retarget a validated in-flight proof', async () => {
    const value = fixture();
    value.hook = index => { if (index === 1) Object.assign(value.options, { coreAddress: OTHER, nftAddress: OTHER,
        blockNumber: 101, blockHash: OTHER_HASH, expectedCoreCodeHash: OTHER_HASH, isCurrent: () => false }); };
    const proof = await value.run();
    assert.equal(proof.coreAddress, CORE); assert.equal(proof.nftAddress, NFT);
    assert.equal(proof.blockNumber, 100); assert.equal(proof.blockHash, HASH);
});

test('an earlier proof is not reused after the mutable reverse binding changes', async () => {
    const value = fixture(), first = await value.run(), later = fixture({ blockNumber: 101, blockHash: OTHER_HASH });
    later.replacements.set(6, abi.encodeFunctionResult('core', [OTHER]));
    value.listener.readProviders = [later.provider]; value.options = later.options;
    await assert.rejects(value.run(), /reciprocal binding mismatch/);
    assert.equal(later.calls.length, 6);
    assert.equal(first.blockNumber, 100); assert.equal(first.blockHash, HASH);
});

test('authority lost after the RPC callback returns prevents publishing the proof', async () => {
    const value = fixture(), realRead = value.listener._readRpcCall;
    value.listener._readRpcCall = async function (...args) {
        const proof = await realRead.apply(this, args); value.current = false; return proof;
    };
    await assert.rejects(value.run(), /authority changed/);
    assert.equal(value.calls.length, 8);
});

test('RPC failover restarts the complete proof without mixing provider results', async () => {
    const value = fixture(), fallback = fixture();
    value.replacements.set(6, new Error('fixture first provider failed'));
    value.listener.readProviders.push(fallback.provider);
    value.listener.readRpcs.push('https://rpc.invalid/second'); value.listener.readRpcUnavailableUntil.push(0);
    const proof = await value.run();
    assert.equal(proof.nftAddress, NFT); assert.equal(value.calls.length, 6); assert.equal(fallback.calls.length, 8);
});

for (const fallbackEnabled of [false, true]) for (const blockedCall of [1, 4, 6, 8]) test(
    `timed-out callback at call ${blockedCall} stops ${fallbackEnabled ? 'during fallback' : 'after rejection'}`,
    async () => {
        const value = fixture(), fallback = fixture(), blocked = deferred(), releaseLate = deferred();
        const fallbackStarted = deferred(), releaseFallback = deferred(), lateSettled = deferred();
        value.listener.baseTimeout = 40;
        value.hook = async index => { if (index === blockedCall) { blocked.resolve(); await releaseLate.promise; } };
        const realRead = value.listener._readRpcCall;
        value.listener._readRpcCall = function (operation, context) {
            return realRead.call(this, provider => {
                const attempt = operation(provider);
                if (provider === value.provider) attempt.then(
                    () => lateSettled.resolve(null), error => lateSettled.resolve(error));
                return attempt;
            }, context);
        };
        if (fallbackEnabled) {
            fallback.hook = async index => { if (index === 1) { fallbackStarted.resolve(); await releaseFallback.promise; } };
            value.listener.readProviders.push(fallback.provider);
            value.listener.readRpcs.push('https://rpc.invalid/second'); value.listener.readRpcUnavailableUntil.push(0);
        }
        const running = value.run();
        const outcome = running.then(proof => ({ proof }), error => ({ error }));
        try {
            await blocked.promise;
            if (fallbackEnabled) await fallbackStarted.promise;
            else assert.match((await outcome).error?.message || '', /timed out/);
            releaseLate.resolve();
            assert.match((await lateSettled.promise)?.message || '', /superseded/);
            assert.equal(value.calls.length, blockedCall, 'the expired callback cannot send another request');
            releaseFallback.resolve();
            if (fallbackEnabled) {
                assert.equal((await outcome).proof?.nftAddress, NFT);
                assert.equal(fallback.calls.length, 8);
            }
        } finally { releaseLate.resolve(); releaseFallback.resolve(); await outcome; }
    }
);
