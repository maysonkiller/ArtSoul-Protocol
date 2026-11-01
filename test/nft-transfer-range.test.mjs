import assert from 'node:assert/strict';
import test from 'node:test';
import { Interface, keccak256 } from 'ethers';
import EventListener from '../src/indexer/event-listener.js';
import { readNftTransferRange } from '../src/indexer/nft-deployment-proof.js';

const address = n => `0x${n.toString(16).padStart(40, '0')}`;
const hash = n => `0x${n.toString(16).padStart(64, '0')}`;
const hex = n => `0x${n.toString(16)}`;
const CORE = address(1), NFT = address(2), A = address(3), B = address(4), C = address(5);
const CORE_CODE = '0x6001600055', NFT_CODE = '0x6002600055';
const abi = new Interface(['function nftContract() view returns(address)', 'function totalSupply() view returns(uint256)',
    'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)']);
const log = (block, index, from, to, token = 9n) => ({ ...abi.encodeEventLog('Transfer', [from, to, token]),
    address: NFT, blockNumber: hex(block), logIndex: hex(index), blockHash: hash(block),
    transactionHash: hash(block * 100), transactionIndex: '0x0', removed: false });
function fixture() {
    const f = { calls: [], current: true, logs: [log(110, 9, B, C), log(100, 1, address(0), A), log(110, 3, A, B)], supply: 0n };
    f.options = { chainId: 84532, coreAddress: CORE, nftAddress: NFT, expectedCoreCodeHash: keccak256(CORE_CODE),
        expectedNftCodeHash: keccak256(NFT_CODE), fromBlock: 100, previousBlockHash: hash(99), blockNumber: 110,
        blockHash: hash(110), bootstrap: true, isCurrent: () => f.current };
    f.provider = { async send(method, params) {
        f.calls.push({ method, params });
        const intercepted = await f.hook?.(method, params, f.calls.length);
        if (intercepted !== undefined) return intercepted;
        if (method === 'eth_chainId') return '0x14a34';
        if (method === 'eth_getBlockByNumber') return { number: params[0], hash: hash(Number(BigInt(params[0]))), timestamp: '0x64' };
        if (method === 'eth_getCode') {
            assert.equal(params[1].requireCanonical, true);
            assert.ok([hash(99), hash(110)].includes(params[1].blockHash));
            return params[0] === CORE ? CORE_CODE : NFT_CODE;
        }
        if (method === 'eth_call') {
            assert.equal(params[1].requireCanonical, true);
            const parsed = abi.parseTransaction(params[0]);
            assert.ok(parsed, 'no mutable reverse binding is required to follow existing tokens');
            if (parsed.name === 'totalSupply') {
                assert.deepEqual(params[1], { blockHash: hash(99), requireCanonical: true });
                return abi.encodeFunctionResult(parsed.name, [f.supply]);
            }
            assert.equal(params[0].to, CORE);
            assert.deepEqual(params[1], { blockHash: hash(110), requireCanonical: true });
            return abi.encodeFunctionResult('nftContract', [NFT]);
        }
        assert.equal(method, 'eth_getLogs');
        assert.deepEqual(params, [{ address: NFT, topics: [abi.getEvent('Transfer').topicHash], fromBlock: '0x64', toBlock: '0x6e' }]);
        return f.logs;
    } };
    f.listener = Object.assign(Object.create(EventListener.prototype), { chainId: 84532, contractAddress: CORE,
        nftAddress: NFT, readProviders: [f.provider], readRpcs: ['https://fixture.invalid/rpc'], readRpcUnavailableUntil: [0], baseTimeout: 1500 });
    f.run = () => readNftTransferRange(f.listener, f.options);
    return f;
}

test('ordered mint and ordinary transfers retain exact IDs, timestamps and deployment without sale fields', async () => {
    const f = fixture(), batch = await f.run();
    assert.deepEqual(batch.events.map(e => [e.blockNumber, e.logIndex, e.eventData.from, e.eventData.to]),
        [[100, 1, address(0), A], [110, 3, A, B], [110, 9, B, C]]);
    assert.equal(batch.fromBlock, 100); assert.equal(batch.previousBlockHash, hash(99)); assert.equal(batch.bootstrap, true);
    for (const event of batch.events) {
        assert.equal(event.timestamp, 100000); assert.equal(event.contractAddress, NFT);
        assert.deepEqual(Object.keys(event.eventData), ['from', 'to', 'tokenId']);
        assert.ok(Object.isFrozen(event)); assert.ok(Object.isFrozen(event.eventData));
    }
    assert.ok(Object.isFrozen(batch)); assert.ok(Object.isFrozen(batch.events));
    assert.equal(f.calls.length, 13);
});
test('empty complete range is explicit; it is not mistaken for an unavailable RPC', async () => {
    const f = fixture(); f.logs = []; const batch = await f.run();
    assert.deepEqual(batch.events, []); assert.equal(batch.blockNumber, 110); assert.equal(f.calls.length, 11);
});

function archiveFixture() {
    const f = fixture();
    Object.assign(f.options, { maxBlocks: 100000, blockNumber: 100099, blockHash: hash(100099) });
    f.hook = (method, params) => {
        if (method === 'eth_getCode') {
            assert.equal(params[1].requireCanonical, true);
            assert.ok([hash(99), hash(100099)].includes(params[1].blockHash));
            return params[0] === CORE ? CORE_CODE : NFT_CODE;
        }
        if (method === 'eth_call') {
            const parsed = abi.parseTransaction(params[0]);
            assert.deepEqual(params[1], { blockHash: hash(parsed.name === 'totalSupply' ? 99 : 100099), requireCanonical: true });
            return abi.encodeFunctionResult(parsed.name, [parsed.name === 'totalSupply' ? f.supply : NFT]);
        }
        if (method === 'eth_getLogs') {
            assert.deepEqual(params, [{ address: NFT, topics: [abi.getEvent('Transfer').topicHash], fromBlock: '0x64', toBlock: hex(100099) }]);
            return f.logs;
        }
    };
    return f;
}
test('explicit sparse archive windows retain deployment, origin, ordering and represented-block checks', async () => {
    const f = archiveFixture(), batch = await f.run();
    assert.equal(batch.fromBlock, 100); assert.equal(batch.blockNumber, 100099);
    assert.deepEqual(batch.events.map(e => [e.blockNumber, e.logIndex]), [[100, 1], [110, 3], [110, 9]]);
    assert.equal(f.calls.length, 13, 'sparse history does not repeat deployment reads for every empty subrange');
    assert.equal(f.calls.filter(c => c.method === 'eth_getBlockByNumber' && c.params[0] === hex(100099)).length, 2);
});
test('explicit sparse archive windows still refuse an orphan interior transfer', async () => {
    const f = archiveFixture(); f.logs[1].blockHash = hash(999);
    await assert.rejects(f.run(), /not canonical/);
});
test('archive limits are operational bounds and never bypass the log count bound', async () => {
    const f = archiveFixture(); f.logs = new Array(10001).fill(null);
    await assert.rejects(f.run(), /log result exceeds/);
});
for (const maxBlocks of [0, -1, 1.5, '100000', 100001, Infinity]) {
    test(`invalid archive window bound ${maxBlocks} makes no RPC request`, async () => {
        const f = fixture(); f.options.maxBlocks = maxBlocks;
        await assert.rejects(f.run(), /Invalid NFT transfer range/); assert.equal(f.calls.length, 0);
    });
}
test('the caller cannot exceed its explicit archive window by one block', async () => {
    const f = archiveFixture(); f.options.blockNumber++;
    await assert.rejects(f.run(), /Invalid NFT transfer range/); assert.equal(f.calls.length, 0);
});
test('a smaller explicit range limit is enforced before RPC', async () => {
    const f = fixture(); f.options.maxBlocks = 10;
    await assert.rejects(f.run(), /Invalid NFT transfer range/); assert.equal(f.calls.length, 0);
});
test('continuation does not require zero supply or mutable NFT.core; immutable Core mapping remains required', async () => {
    const f = fixture(); f.options.bootstrap = false; f.supply = 8n;
    const batch = await f.run(); assert.equal(batch.events.length, 3);
    assert.equal(f.calls.filter(c => c.method === 'eth_call').length, 1);
    assert.equal(f.calls.length, 11);
});
test('unsafe integer token IDs are preserved exactly as decimal text', async () => {
    const f = fixture(); f.logs = [log(100, 1, A, B, (1n << 256n) - 1n)];
    assert.equal((await f.run()).events[0].eventData.tokenId, ((1n << 256n) - 1n).toString());
});
for (const [key, value] of [['fromBlock', 0], ['fromBlock', 111], ['fromBlock', '100'], ['fromBlock', 1.5],
    ['blockNumber', 1100], ['blockNumber', '110'], ['previousBlockHash', hash(0)], ['previousBlockHash', []],
    ['bootstrap', undefined], ['bootstrap', 'true']]) test(`invalid range ${key}=${value} makes no request`, async () => {
    const f = fixture(); f.options[key] = value; await assert.rejects(f.run(), /Invalid NFT transfer range/); assert.equal(f.calls.length, 0);
});
for (const supply of [1n, 10n]) test(`bootstrap rejects already minted origin with supply ${supply}`, async () => {
    const f = fixture(); f.supply = supply; await assert.rejects(f.run(), /already has minted tokens/);
    assert.ok(!f.calls.some(c => c.method === 'eth_getLogs'));
});
test('pruned historical origin is a failure, not an empty transfer history', async () => {
    const f = fixture(); f.hook = (method, params) => {
        if (method === 'eth_getCode' && params[1].blockHash === hash(99)) throw Error('pruned history unavailable');
    };
    await assert.rejects(f.run(), /pruned history/); assert.ok(!f.calls.some(c => c.method === 'eth_getLogs'));
});
test('missing origin code cannot stand in for a verified zero-supply NFT', async () => {
    const f = fixture(); f.hook = (method, params) => method === 'eth_getCode' && params[1].blockHash === hash(99) ? '0x' : undefined;
    await assert.rejects(f.run(), /origin runtime mismatch/);
});
test('predecessor hash mismatch prevents a gap or different fork from being covered', async () => {
    const f = fixture(); f.options.previousBlockHash = hash(500);
    await assert.rejects(f.run(), /predecessor changed/);
});
const malformed = [
    ['foreign NFT', { address: A }], ['missing source', { address: null }], ['removed', { removed: true }],
    ['missing removed flag', { removed: undefined }], ['block outside', { blockNumber: '0x63' }],
    ['unsafe log index', { logIndex: '0x20000000000000' }], ['leading zero', { logIndex: '0x01' }],
    ['decimal block', { blockNumber: '100' }], ['wrong end hash', { blockHash: hash(111) }],
    ['zero tx hash', { transactionHash: hash(0) }], ['missing index', { transactionIndex: null }],
    ['nonempty data', { data: '0x00' }], ['missing topics', { topics: [] }], ['unrelated event', { topics: [hash(1), hash(0), hash(1), hash(1)] }],
    ['noncanonical address padding', { topics: [abi.getEvent('Transfer').topicHash, `0x${'f'.repeat(24)}${A.slice(2)}`, hash(4), hash(9)] }],
    ['token zero', log(110, 3, A, B, 0n)], ['unsupported burn', log(110, 3, A, address(0))]
];
for (const [label, changes] of malformed) test(`malformed expected Transfer rejects entire range: ${label}`, async () => {
    const f = fixture(); f.logs[0] = { ...f.logs[0], ...changes }; await assert.rejects(f.run());
});
for (const logs of [null, {}, new Array(10001).fill(null)]) test(`invalid bounded log response ${Array.isArray(logs) ? 'too many' : String(logs)}`, async () => {
    const f = fixture(); f.logs = logs; await assert.rejects(f.run(), /log result exceeds/);
});
for (const label of ['identical duplicate', 'same position', 'same transaction different block', 'different block hash']) test(label, async () => {
    const f = fixture();
    if (label === 'identical duplicate') f.logs.push({ ...f.logs[0] });
    if (label === 'same position') f.logs.push({ ...f.logs[0], transactionHash: hash(950) });
    if (label === 'same transaction different block') f.logs[1].transactionHash = f.logs[0].transactionHash;
    if (label === 'different block hash') { f.logs[1].blockHash = hash(999); f.logs.push(log(100, 2, A, B)); }
    await assert.rejects(f.run(), /Conflicting/);
});
test('an orphan interior log cannot hide behind a canonical range endpoint', async () => {
    const f = fixture(); f.logs[1].blockHash = hash(999);
    await assert.rejects(f.run(), /not canonical/);
});
test('different transaction hashes cannot claim the same block transaction index', async () => {
    const f = fixture(); f.logs[0].transactionHash = hash(500);
    await assert.rejects(f.run(), /Conflicting/);
});
test('log ordering cannot contradict transaction ordering within one block', async () => {
    const f = fixture(); f.logs[0].transactionHash = hash(500); f.logs[2].transactionIndex = '0x1';
    await assert.rejects(f.run(), /transaction order/);
});
test('missing block timestamp cannot be replaced with wall-clock indexing time', async () => {
    const f = fixture(); f.hook = (method, params) => method === 'eth_getBlockByNumber' && params[0] === '0x64'
        ? { number: '0x64', hash: hash(100) } : undefined;
    await assert.rejects(f.run(), /not canonical/);
});
for (const failAt of [7, 9, 10, 12, 13]) test(`late authority loss at range call ${failAt} prevents publishing`, async () => {
    const f = fixture(); f.hook = (_m, _p, index) => { if (index === failAt) f.current = false; };
    await assert.rejects(f.run(), /authority changed/); assert.equal(f.calls.length, failAt);
});
test('end hash is rechecked after transfer retrieval', async () => {
    const f = fixture(); f.hook = (_m, _p, index) => index === 12 ? { number: '0x6e', hash: hash(999) } : undefined;
    await assert.rejects(f.run(), /canonical block mismatch/);
});
test('caller mutation after admission cannot change the filter, predecessor or bootstrap proof', async () => {
    const f = fixture(); f.hook = (_m, _p, index) => { if (index === 1) Object.assign(f.options, { fromBlock: 105, bootstrap: false, previousBlockHash: hash(5) }); };
    const batch = await f.run(); assert.equal(batch.fromBlock, 100); assert.equal(batch.bootstrap, true); assert.equal(batch.previousBlockHash, hash(99));
});
test('failed range starts again at deployment proof on the fallback provider', async () => {
    const f = fixture(), fallback = fixture(); f.hook = method => { if (method === 'eth_getLogs') throw Error('unavailable'); };
    f.listener.readProviders.push(fallback.provider); f.listener.readRpcs.push('https://fixture.invalid/other'); f.listener.readRpcUnavailableUntil.push(0);
    const batch = await f.run(); assert.equal(batch.events.length, 3); assert.equal(f.calls.length, 9);
    assert.equal(fallback.calls.length, 13); assert.equal(fallback.calls[0].method, 'eth_chainId');
});
