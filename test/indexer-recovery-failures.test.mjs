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
                last_indexed_block: String(indexed), last_confirmed_block: String(confirmed),
                contract_address: 'fixture-core', revision: '1'
            }] };
            if (sql.startsWith('SELECT *, xmin::TEXT AS revision')) return { rows: emptyState ? [] : [{
                chain_id: '84532', last_indexed_block: indexed, last_confirmed_block: confirmed,
                contract_address: 'fixture-core', revision: '1'
            }] };
            if (sql.includes('FROM public.distributed_locks')) return { rows: [{ lock_name: 'fixture' }] };
            if (sql.includes('string_agg')) return { rows: [{ hash: 'a'.repeat(64) }] };
            return { rows: [] };
        },
        release() { calls.push({ sql: 'release' }); }
    };
    const engine = Object.create(Engine.prototype);
    Object.assign(engine, { chainId: 84532,
        getRecoveryAuthority: () => ({ lockName: 'fixture', instanceId: 'worker', fencingToken: '1', isCurrent: () => true }), db: {
        query() { throw new Error('pooled query used inside a transaction'); },
        pool: { async connect() { calls.push({ sql: 'connect' }); return client; } }
    }, async _purgeRecoveryCache() { calls.push({ sql: 'purge' }); } });
    return { engine, calls, failure };
}

test('rewind uses one client, commits before cache work and never advances a cursor', async () => {
    const { engine, calls } = transactionFixture({ indexed: 99, confirmed: 90 });
    await engine._handleReorg(110);
    const begin = calls.findIndex(call => call.sql === 'BEGIN ISOLATION LEVEL READ COMMITTED');
    assert.ok(begin > 1, 'prepare before taking transaction locks');
    assert.match(calls[begin + 1].sql, /distributed_locks[\s\S]*FOR SHARE$/);
    assert.match(calls[begin + 3].sql, /indexer_state[\s\S]*FOR UPDATE$/);
    const update = calls.find(call => call.sql.startsWith('UPDATE indexer_state'));
    assert.deepEqual(update.params, [99, 90, `0x${'a'.repeat(64)}`, '84532']);
    assert.deepEqual(calls.slice(-3).map(call => call.sql), ['COMMIT', 'release', 'purge']);
    assert.deepEqual(calls.find(call => call.sql.includes('string_agg')).params, ['84532', 90]);
    assert.deepEqual(calls.find(call => call.sql.includes('rollback_events_from_block')).params, [100, '84532']);
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
    const { engine, failure } = transactionFixture({ failAt: /^UPDATE indexer_state/, confirmed: 109 });
    engine.eventListener = { getCurrentBlock() { assert.fail('must not read chain after failed rewind'); } };
    engine.syncHistoricalEvents = () => assert.fail('must not replay after failed rewind');
    await assert.rejects(engine.recoverFromSafeBlock({ chain_id: '84532', last_indexed_block: 115,
        last_confirmed_block: 109, contract_address: 'fixture-core', revision: '1' }), error => error === failure);
});

test('startup rejects unversioned hints and changed snapshots without deleting events', async () => {
    const { engine, calls } = transactionFixture({ indexed: 99, confirmed: 90 });
    await assert.rejects(engine.recoverFromSafeBlock({ last_confirmed_block: '109' }), /Invalid startup recovery snapshot/);
    assert.deepEqual(calls, []);
    await assert.rejects(engine.recoverFromSafeBlock({ chain_id: '84532', last_indexed_block: 115,
        last_confirmed_block: 109, contract_address: 'fixture-core', revision: '1' }), /snapshot is stale/);
    assert.equal(calls.some(call => call.sql.includes('rollback_events_from_block')), false);
});

test('startup finishes its rewind before becoming running and leaves replay to confirmed catch-up', async () => {
    const { engine, calls } = transactionFixture({ indexed: 115, confirmed: 109 });
    engine.getIndexerState = async () => ({ chain_id: '84532', last_indexed_block: 115,
        last_confirmed_block: 109, contract_address: 'fixture-core', revision: '1' });
    engine.db.query = async sql => { calls.push({ sql }); };
    engine.eventListener = { contractAddress: 'fixture-core', getCurrentBlock() { assert.fail('startup must not replay to unconfirmed head'); } };
    engine.syncHistoricalEvents = () => assert.fail('catch-up belongs to runner');
    await engine.start();
    assert.equal(engine.isRunning, true);
    const statements = calls.map(call => call.sql);
    assert.ok(statements.indexOf('purge') < statements.findIndex(sql => sql.includes("status = 'running'")));
});

test('a failed startup purge retries before reading state without another rewind', async () => {
    const { engine, calls: transactionCalls } = transactionFixture({ indexed: 109, confirmed: 109 });
    const calls = [];
    let fail = true;
    Object.assign(engine, { chainId: 84532, recoveryCachePurgePending: true,
        eventListener: { contractAddress: 'fixture-core' },
        async _purgeRecoveryCache() {
            calls.push('purge');
            if (fail) throw new Error('purge failed');
            this.recoveryCachePurgePending = false;
        },
        async getIndexerState() { calls.push('state'); return { chain_id: '84532', contract_address: 'fixture-core',
            revision: '1', last_indexed_block: 109, last_confirmed_block: 109 }; },
        async recoverFromSafeBlock() { assert.fail('committed rewind must not repeat'); }
    });
    await assert.rejects(engine.start(), /purge failed/);
    assert.equal(Boolean(engine.isRunning), false);
    assert.deepEqual(calls, ['purge']);
    fail = false;
    await engine.start();
    assert.equal(engine.isRunning, true);
    assert.deepEqual(calls, ['purge', 'purge', 'state', 'state']);
    assert.ok(transactionCalls.some(call => call.sql.includes("status = 'running'")));
    assert.deepEqual(transactionCalls.slice(-2).map(call => call.sql), ['COMMIT', 'release']);
});

test('listener cleanup failure leaves the engine stopped so a later start cannot skip recovery', async () => {
    const engine = Object.create(Engine.prototype);
    engine.isRunning = true;
    engine.eventListener = { async stopListening() { throw new Error('listener cleanup failed'); } };
    await assert.rejects(engine.stop(), /listener cleanup failed/);
    assert.equal(engine.isRunning, false);
});

test('a detected mismatch cannot swallow recovery failure as an RPC error', async t => {
    t.mock.method(console, 'error', () => {});
    const engine = Object.create(Engine.prototype);
    const failure = new Error('rollback failed');
    Object.assign(engine, {
        chainId: 84532,
        async _purgeRecoveryCache() { return false; },
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
        syncEngine: { async _purgeRecoveryCache() { return false; },
            async detectReorg() { if (++attempts < 3) throw new Error('rewind unavailable'); return true; } },
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

test('runner drains durable cache work before catch-up when the periodic reorg check is not due', async t => {
    t.mock.method(console, 'error', () => {});
    const runner = Object.create(ProductionIndexer.prototype);
    let fail = true, pending = true, catchUps = 0, purges = 0;
    Object.assign(runner, { isLeader: true, isRunning: true, lastReorgCheckAt: Date.now(),
        reorgCheckInterval: 60000, resaleCursor: '8', resaleSweepEnd: '11',
        syncEngine: { async detectReorg() { assert.fail('chain check is not due'); },
            async _purgeRecoveryCache() {
                purges++;
                if (fail) throw new Error('configured cache unavailable');
                const result = pending; pending = false; return result;
            } },
        async _catchUpToSafeBlock() { catchUps++; },
    });
    await runner._runConfirmationPoll();
    assert.equal(catchUps, 0); assert.equal(runner.resaleCursor, '8');
    fail = false;
    await runner._runConfirmationPoll();
    assert.equal(catchUps, 0); assert.equal(runner.resaleCursor, '0');
    assert.equal(runner.resaleSweepEnd, null);
    await runner._runConfirmationPoll();
    assert.equal(catchUps, 1); assert.equal(purges, 3);
});

test('real cache purge propagates deletion failure only for strict recovery', async t => {
    t.mock.method(console, 'warn', () => {});
    t.mock.method(console, 'log', () => {});
    const failure = new Error('cache deletion failed');
    let fail = true, deletes = 0;
    t.mock.method(cacheService, 'getRedis', async () => ({
        async set() { return 'OK'; },
        async keys() { return ['artsoul:auction:1']; },
        async del() { deletes++; if (fail) throw failure; }
    }));
    const engine = Object.create(Engine.prototype);
    let token = '1d4d37bb-3aa3-4e7e-9ec9-900222329923';
    const contexts = [];
    engine._captureWriteContext = async () => ({ recoveryCacheToken: token, chainId: '84532', contractAddress: 'fixture-core' });
    engine._withWriteContext = async (context, operation) => {
        contexts.push(context);
        await operation({ async query(sql, params) {
            assert.match(sql, /SET recovery_cache_token = NULL[\s\S]*RETURNING chain_id/);
            assert.deepEqual(params, ['84532', 'fixture-core', token]);
            token = null;
            return { rows: [{ chain_id: '84532' }] };
        } });
    };
    await assert.rejects(engine._purgeRecoveryCache(), error => error === failure);
    assert.equal(engine.recoveryCachePurgePending, true);
    assert.equal(contexts.length, 0, 'failed purge cannot acknowledge its obligation');
    assert.equal(await cacheService.purge(), false); // Ordinary callers remain best-effort.
    fail = false;
    assert.equal(await engine.detectReorg(), true, 'retry completes before normal reorg detection');
    assert.equal(engine.recoveryCachePurgePending, false);
    assert.equal(token, null);
    assert.equal(contexts.length, 1);
    assert.equal(deletes, 3);
});

test('strict purge distinguishes disabled cache from an unavailable configured cache', async t => {
    const previous = process.env.REDIS_URL;
    t.after(() => { if (previous === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = previous; });
    t.mock.method(cacheService, 'getRedis', async () => null);
    process.env.REDIS_URL = '';
    assert.equal(await cacheService.purge({ strict: true }), false);
    process.env.REDIS_URL = 'redis://invalid.example';
    await assert.rejects(cacheService.purge({ strict: true }), /Recovery cache connection unavailable/);
});
