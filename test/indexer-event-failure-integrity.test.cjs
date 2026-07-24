// A-15: indexer event-failure integrity.
//
// A processing claim is now committed before the projection transaction.
// Handler rollback therefore leaves a durable, owner-fenced registry row that
// can be marked failed without allowing a stale attempt to overwrite newer or
// completed work. A failed range still advances no cursor.
//
// These tests drive the real sync engine against an in-memory database that
// models the committed claim plus transaction-scoped projection writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const CHAIN_ID = '84532';
const OTHER_CHAIN_ID = '11155111';

// The global.setTimeout 30000->1 shim this suite used to install is gone:
// processEvent now wakes its heartbeat sleep during teardown (A-41), so every
// event returns promptly at the production 30000 ms interval without patching
// global timers. Cancellation behavior is covered by
// indexer-heartbeat-cancellation.test.cjs.

function moduleUrl(relativePath) {
    return pathToFileURL(path.join(ROOT, relativePath)).href;
}

const syncEngineModule = import(moduleUrl('src/indexer/sync-engine.js'));

function registryKey(chainId, transactionHash, logIndex) {
    return `${chainId}:${String(transactionHash).toLowerCase()}:${Number(logIndex)}`;
}

// Minimal PostgreSQL stand-in covering exactly the statements the sync engine
// issues for this path. Transaction-scoped writes are buffered and dropped on
// ROLLBACK, which is what makes the original defect observable.
function createFakeDatabase(options = {}) {
    const registry = new Map();
    const indexerState = new Map([
        [CHAIN_ID, {
            chain_id: CHAIN_ID,
            contract_address: '0xcore',
            last_indexed_block: 100,
            last_confirmed_block: 100,
            confirmation_depth: 3,
            total_events_indexed: 0,
            state_hash: '0xseed',
            status: 'running',
            started_at: new Date().toISOString()
        }]
    ]);
    const indexerErrors = [];
    const contractEvents = [];
    const stats = { commits: 0, rollbacks: 0, handlerCalls: [] };
    let leaseSequence = 0;

    // eventName -> number of remaining forced failures
    const failuresRemaining = new Map(Object.entries(options.failHandlers || {}));

    function applyClaim(store, params) {
        const [eventHash, chainId, transactionHash, logIndex, eventName, blockNumber, workerId, correlationId] = params;
        const key = registryKey(chainId, transactionHash, logIndex);
        const existing = store.get(key);
        const startedAt = new Date(Date.now() + (++leaseSequence)).toISOString();

        if (!existing) {
            const row = {
                event_hash: eventHash,
                chain_id: String(chainId),
                transaction_hash: transactionHash,
                log_index: Number(logIndex),
                event_name: eventName,
                block_number: Number(blockNumber),
                processing_status: 'processing',
                processing_error: null,
                retry_count: 0,
                owner_worker_id: workerId,
                correlation_id: correlationId,
                processing_started_at: startedAt,
                processing_completed_at: null,
                last_heartbeat_at: new Date().toISOString()
            };
            store.set(key, row);
            return row;
        }

        if (existing.processing_status === 'completed' || existing.processing_status === 'processing') {
            return null;
        }

        existing.event_hash = eventHash;
        existing.event_name = eventName;
        existing.block_number = Number(blockNumber);
        existing.processing_status = 'processing';
        existing.processing_error = null;
        existing.processing_completed_at = null;
        existing.owner_worker_id = workerId;
        existing.retry_count = Number(existing.retry_count || 0) + 1;
        existing.processing_started_at = startedAt;
        existing.last_heartbeat_at = new Date().toISOString();
        existing.correlation_id = correlationId;
        return existing;
    }

    function runQuery(sql, params, store, isTransaction) {
        if (/^\s*SELECT encode\(/i.test(sql)) return [{ hash: 'a'.repeat(64) }];
        if (/SELECT block_hash FROM block_hashes/i.test(sql)) return [];
        if (/INSERT INTO block_hashes/i.test(sql)) return [];

        if (/SELECT \* FROM indexer_state/i.test(sql)) {
            const row = indexerState.get(String(params[0]));
            return row ? [{ ...row }] : [];
        }

        if (/UPDATE indexer_state/i.test(sql) && /last_indexed_block/i.test(sql)) {
            const row = indexerState.get(String(params[2]));
            if (row) {
                row.last_indexed_block = Number(params[0]);
                row.total_events_indexed = Number(row.total_events_indexed) + Number(params[1]);
            }
            return [];
        }

        if (/UPDATE indexer_state/i.test(sql) && /last_confirmed_block/i.test(sql) && /state_hash/i.test(sql)) {
            const row = indexerState.get(String(params[2]));
            if (row) {
                row.last_confirmed_block = Number(params[0]);
                row.state_hash = params[1];
            }
            return [];
        }

        if (/INSERT INTO event_processing_registry/i.test(sql)) {
            const row = applyClaim(store, params);
            return row ? [{ ...row }] : [];
        }

        if (/SELECT[\s\S]*processing_status[\s\S]*processing_started_at::TEXT AS processing_started_at[\s\S]*FROM event_processing_registry/i.test(sql)) {
            const row = store.get(registryKey(params[0], params[1], params[2]));
            return row ? [{ ...row }] : [];
        }

        if (/UPDATE event_processing_registry/i.test(sql) && /SET last_heartbeat_at = clock_timestamp\(\)/i.test(sql)) {
            const row = store.get(registryKey(params[0], params[1], params[2]));
            if (!row ||
                row.event_hash !== params[3] ||
                row.owner_worker_id !== params[4] ||
                row.processing_started_at !== params[5] ||
                row.processing_status !== 'processing') {
                return [];
            }
            row.last_heartbeat_at = new Date().toISOString();
            return [{ event_hash: row.event_hash }];
        }

        if (/UPDATE event_processing_registry/i.test(sql) && /processing_status = 'completed'/i.test(sql)) {
            const row = store.get(registryKey(params[0], params[1], params[2]));
            if (!row ||
                row.event_hash !== params[3] ||
                row.owner_worker_id !== params[4] ||
                row.processing_started_at !== params[5] ||
                row.processing_status !== 'processing') {
                return [];
            }
            row.processing_status = 'completed';
            row.processing_completed_at = new Date().toISOString();
            row.processing_error = null;
            return [{ event_hash: row.event_hash }];
        }

        if (/UPDATE event_processing_registry/i.test(sql) && /SET processing_status = \$7/i.test(sql)) {
            const row = store.get(registryKey(params[0], params[1], params[2]));
            if (!row ||
                row.event_hash !== params[3] ||
                row.owner_worker_id !== params[4] ||
                row.processing_started_at !== params[5] ||
                row.processing_status !== 'processing') {
                return [];
            }
            row.processing_status = params[6];
            row.processing_error = params[7];
            return [{
                processing_status: row.processing_status,
                retry_count: row.retry_count
            }];
        }

        if (/SELECT event_hash, transaction_hash/i.test(sql) && /event_processing_registry/i.test(sql)) {
            return [...store.values()]
                .filter(row => row.chain_id === String(params[0]))
                .filter(row => ['failed', 'dead'].includes(row.processing_status))
                .map(row => ({ ...row }));
        }

        if (/FROM event_processing_registry/i.test(sql) && /GROUP BY processing_status/i.test(sql)) {
            const counts = new Map();
            for (const row of store.values()) {
                if (row.chain_id !== String(params[0])) continue;
                if (!['failed', 'dead'].includes(row.processing_status)) continue;
                counts.set(row.processing_status, (counts.get(row.processing_status) || 0) + 1);
            }
            return [...counts.entries()].map(([processing_status, count]) => ({ processing_status, count }));
        }

        if (/INSERT INTO contract_events/i.test(sql)) {
            contractEvents.push({ transaction_hash: params[4], log_index: params[5] });
            return [];
        }

        if (/FROM indexer_errors/i.test(sql)) {
            return indexerErrors.filter(row => row.chain_id === String(params[0]) && !row.resolved);
        }

        if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*$/i.test(sql)) return [];

        throw new Error(`Unexpected SQL: ${sql.slice(0, 120)}`);
    }

    const db = {
        registry,
        indexerState,
        indexerErrors,
        contractEvents,
        stats,
        failuresRemaining,
        async query(sql, params = []) {
            const result = runQuery(sql, params, registry, false);
            return Array.isArray(result) ? result : result.rows;
        },
        pool: {
            async connect() {
                // Row-level copy-on-write overlay. Only rows this transaction
                // actually touched are buffered, so a COMMIT merges just those
                // keys and cannot clobber a concurrent transaction's rows —
                // which is what lets the suite run a failing and a healthy
                // event in the same batch, as production does.
                let overlay = null;
                const txStore = {
                    get(key) {
                        if (overlay.has(key)) return overlay.get(key);
                        if (!registry.has(key)) return undefined;
                        const copy = { ...registry.get(key) };
                        overlay.set(key, copy);
                        return copy;
                    },
                    set(key, row) { overlay.set(key, row); },
                    values() {
                        const merged = new Map(registry);
                        for (const [key, row] of overlay) merged.set(key, row);
                        return merged.values();
                    }
                };

                return {
                    async query(sql, params = []) {
                        if (/^\s*BEGIN\s*$/i.test(sql)) {
                            overlay = new Map();
                            return { rows: [] };
                        }
                        if (/^\s*COMMIT\s*$/i.test(sql)) {
                            if (overlay) {
                                for (const [key, row] of overlay) registry.set(key, row);
                                overlay = null;
                            }
                            stats.commits += 1;
                            return { rows: [] };
                        }
                        if (/^\s*ROLLBACK\s*$/i.test(sql)) {
                            overlay = null;
                            stats.rollbacks += 1;
                            return { rows: [] };
                        }

                        const store = overlay ? txStore : registry;
                        const result = runQuery(sql, params, store, Boolean(overlay));
                        return Array.isArray(result) ? { rows: result, rowCount: result.length } : result;
                    },
                    release() {}
                };
            }
        },
        isBackpressure() { return false; }
    };

    return db;
}

function makeEvent(index, overrides = {}) {
    return {
        eventName: 'AuctionCreated',
        transactionHash: `0x${String(index).padStart(64, '0')}`,
        logIndex: 0,
        blockNumber: 100 + index,
        timestamp: Date.now(),
        // Must satisfy V41_EVENT_REQUIRED_FIELDS: schema validation runs before
        // the handler, and an invalid payload would fail for the wrong reason.
        eventData: {
            auctionId: String(index),
            artworkId: String(index),
            creator: '0x1111111111111111111111111111111111111111',
            startPrice: '1000',
            duration: '86400',
            endTime: '2',
            chainId: CHAIN_ID
        },
        ...overrides
    };
}

function createEventListener(eventsByRange, currentBlock = 200) {
    const calls = [];
    return {
        calls,
        chainId: Number(CHAIN_ID),
        async queryAllHistoricalEvents(fromBlock, toBlock) {
            calls.push({ fromBlock, toBlock });
            const events = eventsByRange(fromBlock, toBlock);
            return events;
        },
        async getCurrentBlock() { return currentBlock; }
    };
}

// Builds a sync engine whose per-event handler can be forced to throw a fixed
// number of times, exercising the real claim/rollback/record path.
async function createEngine({ events, failures = {}, currentBlock = 200 } = {}) {
    const { default: IndexerSyncEngine } = await syncEngineModule;
    const db = createFakeDatabase({ failHandlers: failures });
    const listener = createEventListener(
        (fromBlock, toBlock) => events.filter(
            event => event.blockNumber >= fromBlock && event.blockNumber <= toBlock
        ),
        currentBlock
    );

    const engine = new IndexerSyncEngine(db, listener, null);
    engine.chainId = Number(CHAIN_ID);

    // Replace the event-specific handlers with a controllable stub. The claim,
    // transaction, rollback, failure-record and cursor logic under test are
    // untouched.
    const originalProcess = engine.processEvent.bind(engine);
    engine.processEvent = async function patchedProcessEvent(event) {
        return originalProcess(event);
    };
    engine._handleAuctionCreatedTx = async function stubHandler(event) {
        db.stats.handlerCalls.push(`${event.transactionHash}:${event.logIndex}`);
        const key = `${event.transactionHash}:${event.logIndex}`;
        const remaining = Number(db.failuresRemaining.get(key) || 0);
        if (remaining > 0) {
            db.failuresRemaining.set(key, remaining - 1);
            throw new Error(`forced handler failure for ${key}`);
        }
    };

    return { engine, db, listener };
}

function registryRow(db, event) {
    return db.registry.get(registryKey(CHAIN_ID, event.transactionHash, event.logIndex));
}

test('a first-ever handler failure leaves a durable failed registry row after rollback', async () => {
    const event = makeEvent(1);
    const { engine, db } = await createEngine({
        events: [event],
        failures: { [`${event.transactionHash}:0`]: 1 }
    });

    await assert.rejects(
        engine.syncHistoricalEvents(101, 105, { currentBlock: 200 }),
        error => error.code === 'INDEXER_RANGE_INCOMPLETE'
    );

    assert.equal(db.stats.rollbacks, 1);
    const row = registryRow(db, event);
    // The pre-fix code lost this row entirely: the claim INSERT was rolled
    // back and the follow-up UPDATE matched nothing.
    assert.ok(row, 'a failure record must survive the rolled-back transaction');
    assert.equal(row.processing_status, 'failed');
    assert.equal(row.retry_count, 0);
    assert.match(row.processing_error, /forced handler failure/);
    assert.equal(row.chain_id, CHAIN_ID);
    assert.equal(row.transaction_hash, event.transactionHash);
    assert.equal(row.log_index, 0);
    assert.equal(row.event_name, 'AuctionCreated');
    assert.equal(row.block_number, event.blockNumber);
});

test('a failed batch advances no cursor, state hash or event total', async () => {
    const event = makeEvent(1);
    const { engine, db } = await createEngine({
        events: [event],
        failures: { [`${event.transactionHash}:0`]: 1 }
    });
    const before = { ...db.indexerState.get(CHAIN_ID) };

    await assert.rejects(
        engine.syncHistoricalEvents(101, 105, { currentBlock: 200 }),
        error => error.code === 'INDEXER_RANGE_INCOMPLETE'
    );

    const after = db.indexerState.get(CHAIN_ID);
    assert.equal(after.last_indexed_block, before.last_indexed_block);
    assert.equal(after.last_confirmed_block, before.last_confirmed_block);
    assert.equal(after.state_hash, before.state_hash);
    assert.equal(after.total_events_indexed, before.total_events_indexed);
});

test('the structured range error carries the range and the failing events', async () => {
    const event = makeEvent(1);
    const { engine } = await createEngine({
        events: [event],
        failures: { [`${event.transactionHash}:0`]: 1 }
    });

    await assert.rejects(
        engine.syncHistoricalEvents(101, 105, { currentBlock: 200 }),
        error => {
            assert.equal(error.name, 'IndexerRangeProcessingError');
            assert.equal(error.code, 'INDEXER_RANGE_INCOMPLETE');
            assert.equal(error.fromBlock, 101);
            assert.equal(error.toBlock, 105);
            assert.equal(error.failedCount, 1);
            assert.equal(error.processedCount, 0);
            assert.equal(error.failures[0].transactionHash, event.transactionHash);
            return true;
        }
    );
});

test('the next poll retries the identical range and never double-applies a completed sibling', async () => {
    const failing = makeEvent(1);
    const healthy = makeEvent(2);
    const { engine, db, listener } = await createEngine({
        events: [failing, healthy],
        failures: { [`${failing.transactionHash}:0`]: 1 }
    });

    await assert.rejects(
        engine.syncHistoricalEvents(101, 105, { currentBlock: 200 }),
        error => error.code === 'INDEXER_RANGE_INCOMPLETE'
    );

    assert.equal(registryRow(db, healthy).processing_status, 'completed');
    assert.equal(registryRow(db, failing).processing_status, 'failed');
    const handlerCallsAfterFirstPass = db.stats.handlerCalls.length;

    // Cursor did not move, so the production poll loop recomputes the same
    // range from last_indexed_block and rescans it.
    const state = db.indexerState.get(CHAIN_ID);
    assert.equal(state.last_indexed_block, 100);
    const retried = await engine.syncHistoricalEvents(
        state.last_indexed_block + 1, 105, { currentBlock: 200 }
    );

    assert.deepEqual(listener.calls, [
        { fromBlock: 101, toBlock: 105 },
        { fromBlock: 101, toBlock: 105 }
    ]);
    assert.equal(retried, 2, 'both events count as processed once the range completes');

    // The already-completed sibling was skipped by the registry claim check,
    // so its handler ran exactly once across both passes.
    const healthyCalls = db.stats.handlerCalls.filter(
        call => call === `${healthy.transactionHash}:0`
    );
    assert.equal(healthyCalls.length, 1);
    assert.equal(db.stats.handlerCalls.length, handlerCallsAfterFirstPass + 1);
});

test('a live lease left by a crashed worker keeps the cursor pinned until it is reaped', async () => {
    const event = makeEvent(1);
    const { engine, db } = await createEngine({ events: [event] });
    const key = registryKey(CHAIN_ID, event.transactionHash, event.logIndex);

    db.registry.set(key, {
        event_hash: 'a'.repeat(64),
        chain_id: CHAIN_ID,
        transaction_hash: event.transactionHash,
        log_index: event.logIndex,
        event_name: event.eventName,
        block_number: event.blockNumber,
        processing_status: 'processing',
        processing_error: null,
        retry_count: 0,
        owner_worker_id: 'worker-before-crash',
        correlation_id: 'crashed-attempt',
        processing_started_at: '2026-07-24T10:00:00.123456+00:00',
        processing_completed_at: null,
        last_heartbeat_at: new Date().toISOString()
    });

    await assert.rejects(
        engine.syncHistoricalEvents(101, 105, { currentBlock: 200 }),
        error => {
            assert.equal(error.code, 'INDEXER_RANGE_INCOMPLETE');
            assert.equal(error.failedCount, 1);
            assert.match(error.failures[0].error, /lease unavailable/i);
            return true;
        }
    );

    assert.equal(db.indexerState.get(CHAIN_ID).last_indexed_block, 100);
    assert.equal(db.stats.handlerCalls.length, 0);

    // Model the committed reaper transition. The next scan may now acquire a
    // new attempt, and retry_count advances exactly once on that acquisition.
    const abandoned = db.registry.get(key);
    abandoned.processing_status = 'failed';
    abandoned.processing_started_at = null;
    abandoned.owner_worker_id = null;
    abandoned.last_heartbeat_at = null;
    abandoned.processing_error = 'Event processing lease expired before completion';

    const processed = await engine.syncHistoricalEvents(101, 105, { currentBlock: 200 });

    assert.equal(processed, 1);
    assert.equal(db.indexerState.get(CHAIN_ID).last_indexed_block, 105);
    assert.equal(db.registry.get(key).processing_status, 'completed');
    assert.equal(db.registry.get(key).retry_count, 1);
    assert.equal(db.stats.handlerCalls.length, 1);
});

test('a recovered event becomes completed and releases the cursor', async () => {
    const event = makeEvent(1);
    const { engine, db } = await createEngine({
        events: [event],
        failures: { [`${event.transactionHash}:0`]: 1 }
    });

    await assert.rejects(
        engine.syncHistoricalEvents(101, 105, { currentBlock: 200 }),
        error => error.code === 'INDEXER_RANGE_INCOMPLETE'
    );
    assert.equal(db.indexerState.get(CHAIN_ID).last_indexed_block, 100);

    const processed = await engine.syncHistoricalEvents(101, 105, { currentBlock: 200 });

    assert.equal(processed, 1);
    assert.equal(registryRow(db, event).processing_status, 'completed');
    const state = db.indexerState.get(CHAIN_ID);
    assert.equal(state.last_indexed_block, 105);
    assert.equal(state.total_events_indexed, 1);
    // 105 <= 200 - 3, so the range also confirms and rehashes.
    assert.equal(state.last_confirmed_block, 105);
    assert.notEqual(state.state_hash, '0xseed');
    assert.deepEqual(await engine.getEventFailureCounts(), { failed: 0, dead: 0 });
});

test('persistent failures escalate to dead on the existing retry policy and keep failing closed', async () => {
    const event = makeEvent(1);
    // maxRetries = 5 and shouldDLQ = retryCount >= 5, so the sixth attempt is
    // the first one recorded as dead.
    const { engine, db } = await createEngine({
        events: [event],
        failures: { [`${event.transactionHash}:0`]: 12 }
    });

    const observed = [];
    for (let attempt = 1; attempt <= 6; attempt++) {
        await assert.rejects(
            engine.syncHistoricalEvents(101, 105, { currentBlock: 200 }),
            error => error.code === 'INDEXER_RANGE_INCOMPLETE'
        );
        const row = registryRow(db, event);
        observed.push({ status: row.processing_status, retry: row.retry_count });
    }

    assert.deepEqual(observed, [
        { status: 'failed', retry: 0 },
        { status: 'failed', retry: 1 },
        { status: 'failed', retry: 2 },
        { status: 'failed', retry: 3 },
        { status: 'failed', retry: 4 },
        { status: 'dead', retry: 5 }
    ]);
    // Dead still blocks the cursor: a poisoned event stalls the indexer
    // visibly instead of being skipped.
    assert.equal(db.indexerState.get(CHAIN_ID).last_indexed_block, 100);
    assert.deepEqual(await engine.getEventFailureCounts(), { failed: 0, dead: 1 });
});

test('a completed record is never downgraded by a late failure write', async () => {
    const event = makeEvent(1);
    const { engine, db } = await createEngine({ events: [event] });

    await engine.syncHistoricalEvents(101, 105, { currentBlock: 200 });
    const completed = registryRow(db, event);
    assert.equal(completed.processing_status, 'completed');

    // Simulate a straggling worker recording a failure for an event another
    // worker already completed.
    await engine._recordEventFailure({
        lease: {
            eventHash: completed.event_hash,
            chainId: completed.chain_id,
            transactionHash: completed.transaction_hash,
            logIndex: completed.log_index,
            workerId: completed.owner_worker_id,
            processingStartedAt: completed.processing_started_at
        },
        status: 'dead',
        error: new Error('late failure from a lost worker')
    });

    const after = registryRow(db, event);
    assert.equal(after.processing_status, 'completed');
    assert.equal(after.processing_error, null);
    assert.deepEqual(await engine.getEventFailureCounts(), { failed: 0, dead: 0 });
});

test('a repeated failure write cannot mutate a lease after its first terminal transition', async () => {
    const event = makeEvent(1);
    const { engine, db } = await createEngine({
        events: [event],
        failures: { [`${event.transactionHash}:0`]: 1 }
    });

    await assert.rejects(
        engine.syncHistoricalEvents(101, 105, { currentBlock: 200 }),
        error => error.code === 'INDEXER_RANGE_INCOMPLETE'
    );
    const first = { ...registryRow(db, event) };
    const lease = {
        eventHash: first.event_hash,
        chainId: first.chain_id,
        transactionHash: first.transaction_hash,
        logIndex: first.log_index,
        workerId: first.owner_worker_id,
        processingStartedAt: first.processing_started_at
    };
    await engine._recordEventFailure({
        lease,
        status: 'dead',
        error: new Error('late duplicate failure')
    });
    const second = registryRow(db, event);

    assert.equal(db.registry.size, 1);
    assert.equal(second.processing_status, first.processing_status);
    assert.equal(second.retry_count, first.retry_count);
    assert.equal(second.processing_error, first.processing_error);
});

test('unresolved event failures are chain scoped', async () => {
    const event = makeEvent(1);
    const { engine, db } = await createEngine({
        events: [event],
        failures: { [`${event.transactionHash}:0`]: 1 }
    });

    await assert.rejects(
        engine.syncHistoricalEvents(101, 105, { currentBlock: 200 }),
        error => error.code === 'INDEXER_RANGE_INCOMPLETE'
    );

    // A failure recorded for a different chain must not appear for this one.
    db.registry.set(registryKey(OTHER_CHAIN_ID, '0xother', 0), {
        event_hash: '0xother-hash',
        chain_id: OTHER_CHAIN_ID,
        transaction_hash: '0xother',
        log_index: 0,
        event_name: 'AuctionCreated',
        block_number: 10,
        processing_status: 'dead',
        processing_error: 'other chain',
        retry_count: 5
    });

    // Only the active chain's failure is counted.
    assert.deepEqual(await engine.getEventFailureCounts(), { failed: 1, dead: 0 });
});

test('the active indexer contains no failed_events runtime path', () => {
    const runtimeFiles = [
        'src/indexer/sync-engine.js',
        'src/indexer/production-runner.js',
        'src/indexer/postgresql-database.js',
        'src/indexer/metrics.js'
    ];

    for (const file of runtimeFiles) {
        const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
        const executable = source
            .split('\n')
            .filter(line => !line.trim().startsWith('//'))
            .join('\n');
        assert.doesNotMatch(
            executable,
            /failed_events/,
            `${file} must not reference the removed failed_events table`
        );
        assert.doesNotMatch(executable, /failedEventsTableAvailable|failedEventsMetricsAvailable/, file);
        assert.doesNotMatch(executable, /_storeFailedEvent|_isMissingFailedEventsTable/, file);
    }

    const syncEngine = fs.readFileSync(path.join(ROOT, 'src/indexer/sync-engine.js'), 'utf8');
    // The dead non-transactional raw-event writer and its error logger are gone.
    assert.doesNotMatch(syncEngine, /_storeRawEvent|_logError/);
    // The sync engine's own failed-events retry is gone; the registry is the
    // retry mechanism now.
    assert.doesNotMatch(syncEngine, /async retryFailedEvents/);

    const runner = fs.readFileSync(path.join(ROOT, 'src/indexer/production-runner.js'), 'utf8');
    assert.doesNotMatch(runner, /_startFailedEventsRetry|retryTimer/);
    assert.match(runner, /_refreshEventFailureMetric/);

    const metrics = fs.readFileSync(path.join(ROOT, 'src/indexer/metrics.js'), 'utf8');
    assert.doesNotMatch(metrics, /indexer_failed_events_queue_size/);
    assert.match(metrics, /indexer_unresolved_event_failures/);
    assert.match(metrics, /updateEventFailures/);
});

test('the transactional outbox retry path is untouched', async () => {
    const source = fs.readFileSync(path.join(ROOT, 'src/indexer/outbox-processor.js'), 'utf8');
    assert.match(source, /async retryFailedEvents\(\)/);
    assert.match(source, /UPDATE outbox_events/);
    assert.match(source, /processing_status = 'failed'/);

    const { default: OutboxProcessor } = await import(moduleUrl('src/indexer/outbox-processor.js'));
    const seen = [];
    const processor = new OutboxProcessor({
        async query(sql) {
            seen.push(sql);
            return [{ id: 1, event_type: 'AuctionCreated', aggregate_type: 'auction', aggregate_id: '1' }];
        }
    });

    const reset = await processor.retryFailedEvents();
    assert.equal(reset, 1);
    assert.match(seen[0], /UPDATE outbox_events/);
    // It must operate on outbox_events, never on the removed failed_events.
    assert.doesNotMatch(seen[0], /failed_events/);
});
