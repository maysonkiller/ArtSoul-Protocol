// A-41: the processEvent ownership heartbeat must be a wakeable sleep.
//
// The heartbeat interval used to be a plain `setTimeout(resolve, 30000)` with
// no external handle. Shutdown could only set a boolean the loop noticed AFTER
// the full interval elapsed, and `finally` awaited that loop, so every event -
// however fast - blocked for the remaining ~30 seconds before releasing its
// pooled connection. The fix captures the timer's resolver so teardown wakes
// the sleep immediately and clears the pending timer.
//
// These tests drive the REAL processEvent against a minimal fake database and
// a controllable handler, and use the instance `heartbeatIntervalMs` seam so
// no global timer is patched. They assert prompt return, effective heartbeat
// cadence, clean cancellation with no late query, fenced lost-ownership
// shutdown, and exactly-once connection release.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const CHAIN_ID = 84532;

function moduleUrl(relativePath) {
    return pathToFileURL(path.join(ROOT, relativePath)).href;
}

const syncEngineModule = import(moduleUrl('src/indexer/sync-engine.js'));

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function validEvent(index = 1) {
    return {
        eventName: 'AuctionCreated',
        transactionHash: `0x${String(index).padStart(64, '0')}`,
        logIndex: 0,
        blockNumber: 500 + index,
        timestamp: Date.now(),
        eventData: {
            auctionId: String(index),
            artworkId: String(index),
            creator: '0x1111111111111111111111111111111111111111',
            startPrice: '1000',
            duration: '86400',
            endTime: '2',
            chainId: String(CHAIN_ID)
        }
    };
}

// Minimal PostgreSQL stand-in covering exactly the statements processEvent
// issues. It counts heartbeat UPDATEs and client releases, and lets each test
// choose whether the owner-fenced heartbeat succeeds.
function createFakeDb({ heartbeatRowCount = 1 } = {}) {
    const registry = new Map();
    const calls = {
        heartbeatQueries: 0,
        releases: 0,
        completedUpdates: 0,
        failureUpdates: []
    };

    function runQuery(sql, params) {
        if (/^\s*SELECT encode\(/i.test(sql)) return [{ hash: 'a'.repeat(64) }];
        if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*$/i.test(sql)) return { rows: [] };
        if (/SELECT block_hash FROM block_hashes/i.test(sql)) return [];

        if (/INSERT INTO event_processing_registry/i.test(sql)) {
            const row = {
                event_hash: params[0],
                chain_id: String(params[1]),
                transaction_hash: params[2],
                log_index: Number(params[3]),
                processing_status: 'processing',
                retry_count: 0,
                owner_worker_id: params[6],
                processing_started_at: new Date().toISOString()
            };
            registry.set(`${params[1]}:${params[2]}:${params[3]}`, row);
            return [row];
        }

        if (/SELECT processing_status, retry_count, owner_worker_id, processing_started_at/i.test(sql)) {
            const row = registry.get(`${params[0]}:${params[1]}:${params[2]}`);
            return row ? [row] : [];
        }

        if (/UPDATE event_processing_registry/i.test(sql) && /SET last_heartbeat_at = clock_timestamp\(\)/i.test(sql)) {
            calls.heartbeatQueries += 1;
            const row = registry.get(`${params[0]}:${params[1]}:${params[2]}`);
            if (!heartbeatRowCount || !row) {
                if (row) {
                    row.processing_status = 'pending';
                    row.owner_worker_id = null;
                    row.processing_started_at = null;
                }
                return [];
            }
            return [{ event_hash: row.event_hash }];
        }

        if (/UPDATE event_processing_registry/i.test(sql) && /processing_status = 'completed'/i.test(sql)) {
            calls.completedUpdates += 1;
            const row = registry.get(`${params[0]}:${params[1]}:${params[2]}`);
            if (!row ||
                row.event_hash !== params[3] ||
                row.owner_worker_id !== params[4] ||
                row.processing_started_at !== params[5] ||
                row.processing_status !== 'processing') {
                return [];
            }
            row.processing_status = 'completed';
            return [{ event_hash: row.event_hash }];
        }

        if (/UPDATE event_processing_registry/i.test(sql) && /SET processing_status = \$7/i.test(sql)) {
            const row = registry.get(`${params[0]}:${params[1]}:${params[2]}`);
            if (!row ||
                row.event_hash !== params[3] ||
                row.owner_worker_id !== params[4] ||
                row.processing_started_at !== params[5] ||
                row.processing_status !== 'processing') {
                return [];
            }
            row.processing_status = params[6];
            calls.failureUpdates.push({ status: params[6], at: Date.now() });
            return [{ processing_status: row.processing_status, retry_count: row.retry_count }];
        }

        if (/INSERT INTO contract_events/i.test(sql)) return { rows: [] };

        throw new Error(`Unexpected SQL: ${sql.slice(0, 100)}`);
    }

    const db = {
        calls,
        async query(sql, params = []) {
            const result = runQuery(sql, params);
            return Array.isArray(result) ? result : result.rows;
        },
        pool: {
            async connect() {
                return {
                    async query(sql, params = []) {
                        const result = runQuery(sql, params);
                        return Array.isArray(result) ? { rows: result, rowCount: result.length } : result;
                    },
                    release() { calls.releases += 1; }
                };
            }
        },
        isBackpressure() { return false; }
    };

    return db;
}

// Builds an engine whose single event handler is controllable. `handler` is an
// async function invoked as the event's processing body.
async function createEngine({ heartbeatIntervalMs, heartbeatRowCount, handler } = {}) {
    const { default: IndexerSyncEngine } = await syncEngineModule;
    const db = createFakeDb({ heartbeatRowCount });
    const listener = { chainId: CHAIN_ID, async getCurrentBlock() { return 1000; } };
    const engine = new IndexerSyncEngine(db, listener, null);
    engine.chainId = CHAIN_ID;
    if (typeof heartbeatIntervalMs === 'number') engine.heartbeatIntervalMs = heartbeatIntervalMs;
    engine._handleAuctionCreatedTx = async (event) => {
        if (handler) await handler(event);
    };
    return { engine, db };
}

test('the production heartbeat interval is exactly 30000 ms and is not an env option', async () => {
    const { engine } = await createEngine();
    assert.equal(engine.heartbeatIntervalMs, 30000);

    const source = fs.readFileSync(path.join(ROOT, 'src/indexer/sync-engine.js'), 'utf8');
    assert.match(source, /this\.heartbeatIntervalMs = 30000;/);
    // The seam must not be wired to any environment or config knob.
    assert.doesNotMatch(source, /heartbeatIntervalMs\s*=\s*[^;]*process\.env/);
    assert.doesNotMatch(source, /process\.env\.[A-Z_]*HEARTBEAT/);
    // The old non-wakeable literal sleep is gone.
    assert.doesNotMatch(source, /setTimeout\(resolve, 30000\)/);
});

test('a fast successful event returns without waiting for the heartbeat interval', async () => {
    // Interval is the real 30000 ms; the test must finish far sooner.
    const { engine, db } = await createEngine({ handler: async () => {} });

    const started = Date.now();
    await engine.processEvent(validEvent(1));
    const elapsed = Date.now() - started;

    assert.ok(elapsed < 5000, `processEvent should return promptly, took ${elapsed}ms`);
    assert.equal(db.calls.completedUpdates, 1);
    // No heartbeat could fire in that window, and the woken timer issues none.
    assert.equal(db.calls.heartbeatQueries, 0);
    assert.equal(db.calls.releases, 1);
});

test('a failed event returns promptly after the failure record is persisted', async () => {
    const { engine, db } = await createEngine({
        handler: async () => { throw new Error('handler exploded'); }
    });

    const started = Date.now();
    await assert.rejects(engine.processEvent(validEvent(2)), /handler exploded/);
    const elapsed = Date.now() - started;

    assert.ok(elapsed < 5000, `failed processEvent should return promptly, took ${elapsed}ms`);
    // The durable failure record was written before processEvent settled.
    assert.equal(db.calls.failureUpdates.length, 1);
    assert.equal(db.calls.failureUpdates[0].status, 'failed');
    assert.equal(db.calls.completedUpdates, 0);
    assert.equal(db.calls.releases, 1);
});

test('a long-running handler refreshes its committed processing lease at the configured cadence', async () => {
    const handlerGate = deferred();
    const { engine, db } = await createEngine({
        heartbeatIntervalMs: 25,
        heartbeatRowCount: 1, // fixture: keep the loop alive so cadence is observable
        handler: async () => { await handlerGate.promise; }
    });

    const processing = engine.processEvent(validEvent(3));
    // Hold the handler open across several intervals, then release it.
    await new Promise(resolve => setTimeout(resolve, 130));
    const midFlightHeartbeats = db.calls.heartbeatQueries;
    handlerGate.resolve();
    await processing;

    assert.ok(midFlightHeartbeats >= 1, `expected at least one heartbeat attempt, saw ${midFlightHeartbeats}`);
    assert.equal(db.calls.releases, 1);
});

test('cancellation clears the pending timer and issues no late heartbeat query', async () => {
    // A short interval: if the pending timer were NOT cleared on teardown it
    // would fire several times during the post-return wait below.
    const { engine, db } = await createEngine({ heartbeatIntervalMs: 40, handler: async () => {} });

    await engine.processEvent(validEvent(4));
    const afterReturn = db.calls.heartbeatQueries;

    // Wait well beyond several intervals; a cleared timer fires nothing.
    await new Promise(resolve => setTimeout(resolve, 200));

    assert.equal(afterReturn, 0, 'no heartbeat should have run for a fast event');
    assert.equal(db.calls.heartbeatQueries, 0, 'no late heartbeat query after processEvent resolved');
    assert.equal(db.calls.releases, 1);
});

test('lost ownership stops the heartbeat and prevents the stale attempt from committing', async () => {
    const source = fs.readFileSync(path.join(ROOT, 'src/indexer/sync-engine.js'), 'utf8');
    assert.doesNotMatch(source, /result\.rowCount/);
    assert.match(source, /if \(!refreshed\) \{[\s\S]*?leaseLost = true;[\s\S]*?break;/);

    const handlerGate = deferred();
    const { engine, db } = await createEngine({
        heartbeatIntervalMs: 25,
        heartbeatRowCount: 0,
        handler: async () => { await handlerGate.promise; }
    });

    const processing = engine.processEvent(validEvent(5));
    await new Promise(resolve => setTimeout(resolve, 130));
    const midFlightHeartbeats = db.calls.heartbeatQueries;
    handlerGate.resolve();
    await assert.rejects(
        processing,
        error => error.code === 'INDEXER_EVENT_LEASE_LOST'
    );

    assert.equal(midFlightHeartbeats, 1);
    assert.equal(db.calls.completedUpdates, 0);
    assert.equal(db.calls.releases, 1);
});

test('the connection is released exactly once on both success and failure', async () => {
    const ok = await createEngine({ handler: async () => {} });
    await ok.engine.processEvent(validEvent(6));
    assert.equal(ok.db.calls.releases, 1);

    const bad = await createEngine({ handler: async () => { throw new Error('boom'); } });
    await assert.rejects(bad.engine.processEvent(validEvent(7)), /boom/);
    assert.equal(bad.db.calls.releases, 1);
});
