import assert from 'node:assert/strict';
import test from 'node:test';
import Engine from '../src/indexer/sync-engine.js';
import ProductionIndexer from '../src/indexer/production-runner.js';
import cacheService from '../src/services/cache-service.js';

function transactionFixture({ failAt, emptyState = false, indexed = 115, confirmed = 115 } = {}) {
    const calls = [];
    const failure = new Error('forced transaction failure');
    const client = {
        async query(sql, params) {
            calls.push({ sql, params });
            if (failAt?.test(sql)) throw failure;
            if (sql.startsWith('SELECT last_indexed_block')) return { rows: emptyState ? [] : [{
                last_indexed_block: String(indexed), last_confirmed_block: String(confirmed)
            }] };
            if (sql.includes('string_agg')) return { rows: [{ hash: 'a'.repeat(64) }] };
            return { rows: [] };
        },
        release() { calls.push({ sql: 'release' }); }
    };
    const engine = Object.create(Engine.prototype);
    Object.assign(engine, { chainId: 84532, db: {
        query() { throw new Error('pooled query used inside a transaction'); },
        pool: { async connect() { calls.push({ sql: 'connect' }); return client; } }
    }, async _purgeRecoveryCache() { calls.push({ sql: 'purge' }); } });
    return { engine, calls, failure };
}

test('rewind uses one client, commits before cache work and never advances a cursor', async () => {
    const { engine, calls } = transactionFixture({ indexed: 99, confirmed: 90 });
    await engine._handleReorg(110);
    assert.equal(calls[1].sql, 'BEGIN ISOLATION LEVEL READ COMMITTED');
    assert.match(calls[2].sql, /FOR UPDATE$/);
    const update = calls.find(call => call.sql.startsWith('UPDATE indexer_state'));
    assert.deepEqual(update.params, [99, 90, `0x${'a'.repeat(64)}`, '84532']);
    assert.deepEqual(calls.slice(-3).map(call => call.sql), ['COMMIT', 'release', 'purge']);
    assert.deepEqual(calls.find(call => call.sql.includes('string_agg')).params, ['84532', 90]);
});

for (const failAt of [/^BEGIN/, /^SELECT last_indexed_block/, /rollback_events_from_block/,
    /^DELETE FROM block_hashes/, /string_agg/, /^UPDATE indexer_state/, /^COMMIT/]) {
    test(`recovery propagates ${failAt} failure, releases and skips cache work`, async () => {
        const { engine, calls, failure } = transactionFixture({ failAt });
        await assert.rejects(engine._handleReorg(110), error => error === failure);
        assert.deepEqual(calls.slice(-2).map(call => call.sql), ['ROLLBACK', 'release']);
        assert.equal(calls.some(call => call.sql === 'purge'), false);
    });
}

test('missing state cannot delete events; invalid boundary cannot acquire a connection', async () => {
    const { engine, calls } = transactionFixture({ emptyState: true });
    await assert.rejects(engine._handleReorg(110), /Missing indexer state/);
    assert.equal(calls.some(call => call.sql.includes('rollback_events_from_block')), false);
    calls.length = 0;
    for (const boundary of [0, -1, 1.5, NaN, Infinity, 'not a block', Number.MAX_SAFE_INTEGER + 1]) {
        await assert.rejects(engine._handleReorg(boundary), /Invalid reorg boundary/);
    }
    assert.deepEqual(calls, []);
});

test('startup recovery propagates failure before any chain read or replay', async () => {
    const { engine, failure } = transactionFixture({ failAt: /^UPDATE indexer_state/ });
    engine.eventListener = { getCurrentBlock() { assert.fail('must not read chain after failed rewind'); } };
    engine.syncHistoricalEvents = () => assert.fail('must not replay after failed rewind');
    await assert.rejects(engine.recoverFromSafeBlock({ last_confirmed_block: '109' }), error => error === failure);
});

test('a detected mismatch cannot swallow recovery failure as an RPC error', async t => {
    t.mock.method(console, 'error', () => {});
    const engine = Object.create(Engine.prototype);
    const failure = new Error('rollback failed');
    Object.assign(engine, {
        chainId: 84532,
        async getIndexerState() { return { last_indexed_block: 115, last_confirmed_block: 0 }; },
        db: { async query() { return [{ block_number: '110', block_hash: 'old' }]; } },
        eventListener: { async getBlock() { return { hash: 'replacement' }; } },
        async _handleReorg() { throw failure; }
    });
    await assert.rejects(engine.detectReorg(), error => error === failure);
});

test('runner retries recovery on the next poll before catch-up or confirmations', async t => {
    t.mock.method(console, 'error', () => {});
    t.mock.method(console, 'warn', () => {});
    const runner = Object.create(ProductionIndexer.prototype);
    let attempts = 0, catchUps = 0;
    Object.assign(runner, { isLeader: true, isRunning: true, lastReorgCheckAt: 0,
        reorgCheckInterval: 60000, reorgSampleSize: 12, resaleCursor: '8', resaleSweepEnd: '11',
        syncEngine: { async detectReorg() { if (++attempts < 3) throw new Error('rewind unavailable'); return true; } },
        async _catchUpToSafeBlock() { catchUps++; return { currentBlock: 120 }; },
        async _processConfirmations() {}, async _refreshResaleState() {}, _refreshSearchMetadata() {} });
    await runner._runConfirmationPoll();
    assert.equal(runner.lastReorgCheckAt, 0);
    await runner._runConfirmationPoll();
    assert.equal(attempts, 2); assert.equal(catchUps, 0);
    await runner._runConfirmationPoll();
    assert.equal(catchUps, 0);
    assert.equal(runner.resaleCursor, '0'); assert.equal(runner.resaleSweepEnd, null);
    await runner._runConfirmationPoll();
    assert.equal(attempts, 3); assert.equal(catchUps, 1);
});

test('real cache purge propagates deletion failure only for strict recovery', async t => {
    t.mock.method(console, 'warn', () => {});
    t.mock.method(console, 'log', () => {});
    const failure = new Error('cache deletion failed');
    let fail = true, deletes = 0;
    t.mock.method(cacheService, 'getRedis', async () => ({
        async keys() { return ['artsoul:auction:1']; },
        async del() { deletes++; if (fail) throw failure; }
    }));
    const engine = Object.create(Engine.prototype);
    engine.recoveryCachePurgePending = true;
    await assert.rejects(engine._purgeRecoveryCache(), error => error === failure);
    assert.equal(engine.recoveryCachePurgePending, true);
    await cacheService.purge(); // Ordinary best-effort callers remain compatible.
    fail = false;
    assert.equal(await engine.detectReorg(), true, 'retry completes before any database or chain read');
    assert.equal(engine.recoveryCachePurgePending, false);
    assert.equal(deletes, 3);
});

test('strict purge distinguishes disabled cache from an unavailable configured cache', async t => {
    const previous = process.env.REDIS_URL;
    t.after(() => { if (previous === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = previous; });
    t.mock.method(cacheService, 'getRedis', async () => null);
    process.env.REDIS_URL = '';
    await cacheService.purge({ strict: true });
    process.env.REDIS_URL = 'redis://invalid.example';
    await assert.rejects(cacheService.purge({ strict: true }), /Recovery cache connection unavailable/);
});
