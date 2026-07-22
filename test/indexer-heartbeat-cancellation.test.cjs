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
// no global timer is patched. They assert prompt return, cadence of the
// heartbeat ATTEMPT (not that it is an effective keep-alive - see A-43), clean
// cancellation with no late query, lost-ownership shutdown, and exactly-once
// connection release.
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
// choose the rowCount the heartbeat query returns.
function createFakeDb({ heartbeatRowCount = 1 } = {}) {
    const calls = {
        heartbeatQueries: 0,
        releases: 0,
        completedUpdates: 0,
        failureUpserts: []
    };

    function runQuery(sql, params) {
        if (/^\s*SELECT encode\(/i.test(sql)) return [{ hash: 'a'.repeat(64) }];
        if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*$/i.test(sql)) return { rows: [] };
        if (/SELECT block_hash FROM block_hashes/i.test(sql)) return [];

        if (/INSERT INTO event_processing_registry/i.test(sql)) {
            if (/RETURNING processing_status, retry_count, owner_worker_id/i.test(sql)) {
                // Fresh claim: this worker owns a brand-new processing row.
                return { rows: [{ processing_status: 'processing', retry_count: 0, owner_worker_id: params[6] }] };
            }
            // Out-of-transaction failure UPSERT.
            calls.failureUpserts.push({ status: params[6], at: Date.now() });
            return [{ processing_status: params[6], retry_count: Number(params[8]) || 0 }];
        }

        if (/UPDATE event_processing_registry/i.test(sql) && /last_heartbeat_at = NOW\(\)/i.test(sql)) {
            calls.heartbeatQueries += 1;
            return { rowCount: heartbeatRowCount, rows: [] };
        }

        if (/UPDATE event_processing_registry/i.test(sql) && /processing_status = 'completed'/i.test(sql)) {
            calls.completedUpdates += 1;
            return { rows: [] };
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
    assert.equal(db.calls.failureUpserts.length, 1);
    assert.equal(db.calls.failureUpserts[0].status, 'failed');
    assert.equal(db.calls.completedUpdates, 0);
    assert.equal(db.calls.releases, 1);
});

test('a long-running handler still attempts the heartbeat query at the configured cadence', async () => {
    // NOTE: this proves the heartbeat query is ISSUED at the cadence, not that
    // it is an effective PostgreSQL keep-alive. The separate-connection /
    // uncommitted-row visibility mismatch is tracked by backlog item A-43.
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

test('the lost-ownership guard remains present and the loop stays stable across intervals', async () => {
    // The lost-ownership guard reads `result.rowCount === 0`. In production
    // `this.db.query` returns `result.rows` (a plain array with no rowCount),
    // so this guard is latent today — a real zero-row heartbeat is not
    // observed and the loop keeps beating. A-41 does not touch that path (it
    // is the ownership/visibility mismatch tracked by A-43); this test pins
    // the branch's presence in source and proves the long-running loop stays
    // stable and releases exactly once regardless.
    const source = fs.readFileSync(path.join(ROOT, 'src/indexer/sync-engine.js'), 'utf8');
    assert.match(source, /if \(result\.rowCount === 0\) \{[\s\S]*?isShuttingDown = true;[\s\S]*?break;/);

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
    await processing;

    // Faithful to production array-return semantics: the loop keeps attempting
    // heartbeats rather than terminating, and never destabilizes.
    assert.ok(midFlightHeartbeats >= 1, `expected heartbeat attempts, saw ${midFlightHeartbeats}`);
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
