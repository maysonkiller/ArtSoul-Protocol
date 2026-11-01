import assert from 'node:assert/strict';
import test from 'node:test';
import ProductionIndexer from '../src/indexer/production-runner.js';

const hash = n => `0x${String(n).padStart(64, '0')}`;
const core = `0x${'a'.repeat(40)}`, nft = `0x${'b'.repeat(40)}`;
function fixture(t) {
    t.mock.method(console, 'log', () => {}); t.mock.method(console, 'error', () => {});
    const f = { now: 100000, head: 140, calls: [], covered: 115 };
    t.mock.method(Date, 'now', () => f.now);
    const state = { chain_id: '84532', contract_address: core, revision: '1', last_indexed_block: '115', recovery_cache_token: null };
    f.runner = Object.assign(Object.create(ProductionIndexer.prototype), {
        config: { chainId: 84532, nftTransferConfig: { chainId: 84532, coreAddress: core, nftAddress: nft,
            fromBlock: 100, previousBlockHash: hash(99), maxBlocks: 10,
            expectedCoreCodeHash: hash(1), expectedNftCodeHash: hash(2) } },
        confirmationDepth: 12, catchUpInProgress: false,
        eventListener: { getCurrentBlock: async () => f.head },
        syncEngine: { getIndexerState: async () => state, db: { query: async () => [{
            from_block: 100, origin_block_hash: hash(99), covered_through: f.covered, covered_hash: hash(f.covered),
            retained_hash: hash(f.covered), core_code_hash: hash(1), nft_code_hash: hash(2),
            state_revision: '1', state_block: 115, state_cache_token: null }] },
        syncHistoricalEvents: async (...args) => { f.calls.push(['legacy', ...args]); return 1; } },
        _syncNftTransfers: async () => f.calls.push(['bootstrap']),
        _publishCoordinatedRange: async (...args) => { f.calls.push(['atomic', ...args]); if (f.fail) throw Error('fixture'); return { processedCount: f.events || 0 }; },
        _refreshEventFailureMetric: async reason => f.calls.push(['metrics', reason])
    });
    f.run = () => f.runner._catchUpToSafeBlock('fixture');
    return f;
}
test('ready NFT deployment publishes a bounded common range instead of legacy Core writes', async t => {
    const f = fixture(t), result = await f.run();
    assert.deepEqual(result, { currentBlock: 140, safeBlock: 125, lastIndexedBlock: 125 });
    assert.equal(f.calls[0][0], 'atomic'); assert.deepEqual(f.calls[0].slice(2), [125, 140]);
    assert.equal(f.calls.some(call => call[0] === 'legacy'), false);
});
test('partial coverage holds Core still while the reviewed history catches up', async t => {
    const f = fixture(t); f.covered = 110; assert.equal(await f.run(), undefined);
    assert.deepEqual(f.calls, [['bootstrap']]);
});
test('publication cadence does not stop observed head freshness', async t => {
    const f = fixture(t); await f.run(); f.head = 145; f.now += 2000;
    assert.equal(await f.run(), undefined); assert.equal(f.runner.lastObservedBlock, 145);
    assert.equal(f.calls.length, 1); f.now += 8000; await f.run(); assert.equal(f.calls.length, 2);
});
test('failed publication is degraded and bounded before a fresh retry', async t => {
    const f = fixture(t); f.fail = true; assert.equal(await f.run(), undefined);
    assert.equal(f.runner.nftTransferError, 'Verified publication refresh failed');
    f.fail = false; f.now += 2000; await f.run(); assert.equal(f.calls.filter(c => c[0] === 'atomic').length, 1);
    f.now += 8000; await f.run(); assert.equal(f.runner.nftTransferError, null);
});
test('no new confirmed blocks creates no empty publication', async t => {
    const f = fixture(t); f.head = 127; assert.equal((await f.run()).lastIndexedBlock, 115);
    assert.deepEqual(f.calls, []);
});
test('default-disabled worker preserves legacy range and failure metrics', async t => {
    const f = fixture(t); delete f.runner.config.nftTransferConfig;
    assert.equal((await f.run()).lastIndexedBlock, 128);
    assert.deepEqual(f.calls, [['legacy', 116, 128, { currentBlock: 140 }], ['metrics', 'range_completed']]);
});
test('a publication with events refreshes the durable failure summary', async t => {
    const f = fixture(t); f.events = 2; await f.run(); assert.deepEqual(f.calls[1], ['metrics', 'range_completed']);
});
