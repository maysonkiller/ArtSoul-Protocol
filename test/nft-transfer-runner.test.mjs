import assert from 'node:assert/strict';
import test from 'node:test';
import ProductionIndexer from '../src/indexer/production-runner.js';

const address = n => `0x${String(n).padStart(40, '0')}`;
const hash = n => `0x${String(n).padStart(64, '0')}`;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture(t) {
    t.mock.method(console, 'log', () => {}); t.mock.method(console, 'warn', () => {}); t.mock.method(console, 'error', () => {});
    const f = { calls: [], rows: [] };
    const runner = f.runner = Object.create(ProductionIndexer.prototype);
    f.state = { chain_id: '84532', contract_address: address(1), last_indexed_block: '115', last_confirmed_block: '115',
        recovery_cache_token: null, revision: '1', started_at: new Date().toISOString() };
    Object.assign(runner, { config: { chainId: 84532, nftTransferConfig: Object.freeze({ chainId: 84532,
        coreAddress: address(1), nftAddress: address(2), expectedCoreCodeHash: hash(1), expectedNftCodeHash: hash(2),
        fromBlock: 100, previousBlockHash: hash(99), maxBlocks: 10 }) },
        isLeader: true, isRunning: true, isStopping: false, confirmationInFlight: null,
        lastReorgCheckAt: Date.now(), reorgCheckInterval: 60000, healthMaxBlocksBehind: 20,
        db: { healthCheck: async () => ({ connected: true }) },
        distributedLock: { lockName: 'fixture', instanceId: 'worker', epoch: 1,
            getFencingToken: () => '1', isLeaderInstance: () => true,
            startHeartbeat: () => f.calls.push('heartbeat'), stopHeartbeat() {} },
        eventListener: { getCurrentBlock: async () => 118, getRpcHealth: () => [] },
        syncEngine: { getIndexerState: async () => f.state, getUnresolvedErrors: async () => [],
            getEventFailureCounts: async () => ({ failed: 0, dead: 0 }),
            db: { query: async () => (f.rows.length ? f.rows : [{ covered_through: null }]).map(row => ({ ...row,
                state_block: f.state.last_indexed_block, state_revision: f.state.revision,
                state_cache_token: f.state.recovery_cache_token, ...f.databaseState })) }, start: async () => f.calls.push('recover'),
            stop: async () => f.calls.push('stop'),
            _purgeRecoveryCache: async () => { f.calls.push('purge'); return false; },
            detectReorg: async () => { f.calls.push('reorg'); return false; } },
        _refreshEventFailureMetric: async () => f.calls.push('metrics'),
        _catchUpToSafeBlock: async () => { f.calls.push('core'); return { currentBlock: 118, safeBlock: 115 }; },
        _processConfirmations: async () => f.calls.push('confirm'),
        _refreshResaleState: async () => f.calls.push('resale'),
        _syncNftTransfers: async () => f.calls.push('nft'),
        _refreshSearchMetadata: () => f.calls.push('search'),
        _startConfirmationPolling: () => f.calls.push('poll-timer'),
        _startStuckProcessorReaper: () => f.calls.push('reaper-timer')
    });
    f.cover = n => { f.rows = [{ from_block: '100', origin_block_hash: hash(99), covered_through: String(n),
        covered_hash: hash(n), retained_hash: hash(n), core_code_hash: hash(1), nft_code_hash: hash(2) }]; };
    return f;
}
for (const change of [{ state_block: '116' }, { state_cache_token: 'new-obligation' }, { state_revision: '2' }]) {
    test(`health refuses a changed boundary during the coverage read: ${JSON.stringify(change)}`, async t => {
        const f = fixture(t); f.cover(115); f.databaseState = change;
        const result = await f.runner.getHealth(); assert.equal(result.status, 'degraded');
        assert.equal(result.indexer.isSynced, false); assert.equal(result.indexer.nftTransfers.ready, false);
    });
}

test('startup recovers before Core and NFT catch-up, then admits normal timers', async t => {
    const f = fixture(t); f.runner.isRunning = false; await f.runner._startAsLeader();
    assert.deepEqual(f.calls, ['heartbeat','recover','metrics','core','nft','poll-timer','reaper-timer']);
    assert.equal(f.runner.confirmationInFlight, null);
});
test('poll orders recovery, Core, confirmations, resale and NFT work in one serialized cycle', async t => {
    const f = fixture(t); await f.runner._runConfirmationPoll();
    assert.deepEqual(f.calls, ['purge','core','confirm','resale','nft','search']);
});
for (const startup of [true, false]) test(`failed Core range skips NFT ingestion (${startup ? 'startup' : 'poll'})`, async t => {
    const f = fixture(t); f.runner._catchUpToSafeBlock = async () => { f.calls.push('core-failed'); return undefined; };
    if (startup) { f.runner.isRunning = false; await f.runner._startAsLeader(); } else await f.runner._runConfirmationPoll();
    assert(!f.calls.includes('nft')); assert(!f.calls.includes('confirm'));
});
test('a detected recovery defers NFT work until a subsequent cycle', async t => {
    const f = fixture(t); f.runner.lastReorgCheckAt = 0;
    f.runner.syncEngine.detectReorg = async () => { f.calls.push('recovered'); return true; };
    await f.runner._runConfirmationPoll(); assert.deepEqual(f.calls, ['recovered']);
});
test('pending cache work finishes before admitting a new range', async t => {
    const f = fixture(t); f.runner.syncEngine._purgeRecoveryCache = async () => { f.calls.push('purged'); return true; };
    await f.runner._runConfirmationPoll(); assert.deepEqual(f.calls, ['purged']);
});
for (const startup of [true,false]) test(`leadership loss drains pending NFT work without overlap (${startup ? 'startup' : 'poll'})`, async t => {
    const f = fixture(t), entered = deferred(), pending = deferred();
    f.runner._syncNftTransfers = async () => { f.calls.push('nft-enter'); entered.resolve(); await pending.promise; f.calls.push('nft-finish'); };
    if (startup) f.runner.isRunning = false;
    const active = startup ? f.runner._startAsLeader() : f.runner._runConfirmationPoll();
    await entered.promise; const second = f.runner._runConfirmationPoll();
    const stop = f.runner._stopAsFollower();
    t.after(async () => { pending.resolve(); await Promise.all([active,second,stop]); });
    assert(!f.calls.includes('stop')); assert.equal(f.calls.filter(c => c === 'nft-enter').length, 1);
    pending.resolve(); await Promise.all([active,second,stop]);
    assert(f.calls.indexOf('stop') > f.calls.indexOf('nft-finish'));
    assert(!f.calls.includes('poll-timer')); assert.equal(f.runner.confirmationInFlight, null);
});
for (const flag of ['disabled','follower','stopping']) test(`NFT refresh has no side effects when ${flag}`, async t => {
    const f = fixture(t); if (flag === 'disabled') delete f.runner.config.nftTransferConfig;
    if (flag === 'follower') f.runner.isLeader = false; if (flag === 'stopping') f.runner.isStopping = true;
    f.runner.syncEngine.getRecoveryAuthority = () => { throw new Error('must not be reached'); };
    await ProductionIndexer.prototype._syncNftTransfers.call(f.runner);
    assert.equal(f.runner.nftTransferError, undefined);
});
test('NFT refresh records failure without pretending coverage is current', async t => {
    const f = fixture(t); f.runner.syncEngine.getRecoveryAuthority = () => { throw new Error('fixture lease missing'); };
    await ProductionIndexer.prototype._syncNftTransfers.call(f.runner);
    assert.equal(f.runner.nftTransferError, 'Verified NFT history refresh failed');
});
for (const scenario of ['disabled','complete','partial','missing','pending-purge','bad-header','read-failed','refresh-failed']) {
    test(`health reports NFT readiness truthfully: ${scenario}`, async t => {
        const f = fixture(t); f.cover(115);
        if (scenario === 'disabled') { delete f.runner.config.nftTransferConfig; f.runner.syncEngine.db.query = () => { throw new Error('unexpected query'); }; }
        if (scenario === 'partial') f.cover(109);
        if (scenario === 'missing') f.rows = [];
        if (scenario === 'pending-purge') f.state.recovery_cache_token = 'pending';
        if (scenario === 'bad-header') f.rows[0].retained_hash = hash(987);
        if (scenario === 'read-failed') f.runner.syncEngine.db.query = async () => { throw new Error('fixture SQL unavailable'); };
        if (scenario === 'refresh-failed') f.runner.nftTransferError = 'Verified NFT history refresh failed';
        const result = await f.runner.getHealth(), ready = ['disabled','complete'].includes(scenario);
        assert.equal(result.indexer.isSynced, ready);
        assert.equal(result.status, ready ? 'healthy' : ['bad-header','read-failed','refresh-failed'].includes(scenario) ? 'degraded' : 'syncing');
        assert.equal(result.indexer.nftTransfers.enabled, scenario !== 'disabled');
    });
}
