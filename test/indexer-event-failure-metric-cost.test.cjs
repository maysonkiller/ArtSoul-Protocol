// A-15 cost control: the event-failure gauge must be event driven, never polled.
//
// The first A-15 implementation refreshed the gauge from the unconditional
// 5-second metrics loop, which would have added ~17,280 PostgreSQL/Supabase
// queries per idle day (~518,400 per 30 days) against the A9 cost budget.
// Failure counts change only when a range is processed, so the refresh now
// happens at startup and after a range that did work or failed - and an idle
// indexer performs zero recurring failure-registry queries.
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

// Builds a ProductionIndexer without running its constructor (which would
// start real timers and open a real pool), then wires the collaborators the
// paths under test touch. Counts every failure-registry aggregate query.
async function createIndexer({ counts = { failed: 0, dead: 0 }, syncResult = 0 } = {}) {
    const { default: ProductionIndexer } = await import(moduleUrl('src/indexer/production-runner.js'));
    const indexer = Object.create(ProductionIndexer.prototype);

    const calls = { failureCounts: 0, gaugeWrites: [], sync: [] };
    let currentCounts = counts;

    indexer.config = { chainId: CHAIN_ID };
    indexer.confirmationDepth = 3;
    indexer.pollInterval = 15000;
    indexer.catchUpInProgress = false;
    indexer.lastObservedBlock = null;
    indexer.isRunning = true;
    indexer.metricsUpdating = false;
    indexer.metrics = {
        updateDbPoolMetrics() {},
        updateRpcHealthScore() {},
        updateBlockLag() {},
        updateBackpressure() {},
        updateEventFailures(value) { calls.gaugeWrites.push(value); }
    };
    indexer.db = {
        getPoolMetrics() { return { totalCount: 1, idleCount: 1, waitingCount: 0 }; },
        isBackpressure() { return false; },
        async query() {
            throw new Error('getHealth/metrics must not query the database directly here');
        }
    };
    indexer.eventListener = {
        getRpcHealth() { return []; },
        async getCurrentBlock() { return 1000; }
    };
    indexer.syncEngine = {
        async getIndexerState() {
            return { chain_id: String(CHAIN_ID), last_indexed_block: 100, last_confirmed_block: 100 };
        },
        async getEventFailureCounts() {
            calls.failureCounts += 1;
            return currentCounts;
        },
        async syncHistoricalEvents(fromBlock, toBlock) {
            calls.sync.push({ fromBlock, toBlock });
            if (typeof syncResult === 'function') return syncResult(fromBlock, toBlock);
            return syncResult;
        }
    };

    return {
        indexer,
        calls,
        setCounts(next) { currentCounts = next; }
    };
}

// Runs the body of the real 5-second metrics loop without waiting on timers.
async function runMetricsTick(indexer) {
    const poolMetrics = indexer.db.getPoolMetrics();
    indexer.metrics.updateDbPoolMetrics(
        poolMetrics.totalCount, poolMetrics.idleCount, poolMetrics.waitingCount
    );
    for (const rpc of indexer.eventListener.getRpcHealth()) {
        indexer.metrics.updateRpcHealthScore(rpc.url, rpc.healthScore);
    }
    const state = await indexer.syncEngine.getIndexerState();
    if (state && Number.isFinite(indexer.lastObservedBlock)) {
        indexer.metrics.updateBlockLag(indexer.lastObservedBlock - state.last_indexed_block);
    }
    indexer.metrics.updateBackpressure(indexer.db.isBackpressure());
}

test('the 5-second metrics loop issues no failure-registry query', async () => {
    const { indexer, calls } = await createIndexer({ counts: { failed: 3, dead: 1 } });

    // Twelve ticks is one minute of idle operation.
    for (let tick = 0; tick < 12; tick++) {
        await runMetricsTick(indexer);
    }

    assert.equal(calls.failureCounts, 0, 'idle metrics ticks must not poll the failure registry');
    assert.equal(calls.gaugeWrites.length, 0);
});

test('the metrics loop source contains no failure-registry refresh', () => {
    const runner = fs.readFileSync(path.join(ROOT, 'src/indexer/production-runner.js'), 'utf8');
    // Anchor on the method definition, not its constructor call site.
    const loopStart = runner.search(/^\s{4}_startMetricsUpdateLoop\(\)\s*\{/m);
    const loopEnd = runner.indexOf('}, 5000);', loopStart);
    assert.ok(loopStart > -1 && loopEnd > loopStart, 'metrics loop must be locatable');

    const loopBody = runner.slice(loopStart, loopEnd);
    assert.doesNotMatch(loopBody, /_refreshEventFailureMetric/);
    assert.doesNotMatch(loopBody, /getEventFailureCounts/);
    assert.doesNotMatch(loopBody, /event_processing_registry/);

    // No second timer was introduced to work around the removal.
    const timers = runner.match(/setInterval\(/g) || [];
    assert.equal(timers.length, 4, 'expected exactly the pre-existing timers (metrics, confirmation, reaper, leader)');
});

test('startup performs exactly one authoritative failure read', async () => {
    const { indexer, calls } = await createIndexer({ counts: { failed: 2, dead: 1 } });

    const counts = await indexer._refreshEventFailureMetric('startup');

    assert.equal(calls.failureCounts, 1);
    assert.deepEqual(counts, { failed: 2, dead: 1 });
    assert.deepEqual(calls.gaugeWrites, [{ failed: 2, dead: 1 }]);
});

test('a failed range refreshes the gauge exactly once', async () => {
    const { indexer, calls, setCounts } = await createIndexer({
        counts: { failed: 0, dead: 0 },
        syncResult() {
            setCounts({ failed: 1, dead: 0 });
            const error = new Error('range incomplete');
            error.code = 'INDEXER_RANGE_INCOMPLETE';
            throw error;
        }
    });

    const checkpoint = await indexer._catchUpToSafeBlock('poll');

    // The range failed closed, so no checkpoint is returned and confirmation
    // is skipped, but the gauge reflects the new failure immediately.
    assert.equal(checkpoint, undefined);
    assert.equal(calls.failureCounts, 1);
    assert.deepEqual(calls.gaugeWrites, [{ failed: 1, dead: 0 }]);
});

test('a recovered range refreshes the gauge back to zero', async () => {
    const { indexer, calls, setCounts } = await createIndexer({
        counts: { failed: 1, dead: 0 },
        syncResult() {
            setCounts({ failed: 0, dead: 0 });
            return 2; // two events applied, including the recovered one
        }
    });

    const checkpoint = await indexer._catchUpToSafeBlock('poll');

    assert.ok(checkpoint, 'a completed range returns a checkpoint');
    assert.equal(calls.failureCounts, 1);
    assert.deepEqual(calls.gaugeWrites, [{ failed: 0, dead: 0 }]);
});

test('reaping an abandoned lease refreshes the failure gauge immediately', async () => {
    const { indexer, calls, setCounts } = await createIndexer();
    indexer.db.query = async (sql, params) => {
        assert.match(sql, /SET processing_status = 'failed'/);
        assert.doesNotMatch(sql, /retry_count\s*=/);
        assert.deepEqual(params, [String(CHAIN_ID), 120000]);
        setCounts({ failed: 1, dead: 0 });
        return [{
            event_hash: '0xstale',
            event_name: 'BidPlaced',
            retry_count: 0,
            previous_owner: 'worker-before-crash',
            stale_seconds: 125
        }];
    };

    const reaped = await indexer._reapStaleEventProcessingLeases();

    assert.equal(reaped.length, 1);
    assert.equal(calls.failureCounts, 1);
    assert.deepEqual(calls.gaugeWrites, [{ failed: 1, dead: 0 }]);
});

test('an empty range performs no failure-registry query', async () => {
    const { indexer, calls } = await createIndexer({ syncResult: 0 });

    await indexer._catchUpToSafeBlock('poll');

    assert.equal(calls.sync.length, 1, 'the range was scanned');
    assert.equal(calls.failureCounts, 0, 'no events applied means nothing can have changed');
    assert.equal(calls.gaugeWrites.length, 0);
});

test('an idle indexer with nothing new to scan queries nothing', async () => {
    const { indexer, calls } = await createIndexer();
    // safeBlock (1000 - 3) must not exceed last_indexed_block for this path.
    indexer.syncEngine.getIndexerState = async () => ({
        chain_id: String(CHAIN_ID), last_indexed_block: 5000, last_confirmed_block: 5000
    });

    for (let poll = 0; poll < 10; poll++) {
        await indexer._catchUpToSafeBlock('poll');
        await runMetricsTick(indexer);
    }

    assert.equal(calls.sync.length, 0);
    assert.equal(calls.failureCounts, 0);
});

test('a refresh failure never breaks the caller', async () => {
    const { indexer } = await createIndexer();
    indexer.syncEngine.getEventFailureCounts = async () => {
        throw new Error('registry unavailable');
    };

    const counts = await indexer._refreshEventFailureMetric('startup');
    assert.equal(counts, null);
});

test('/health uses the bounded aggregate, never an unbounded row scan', () => {
    const runner = fs.readFileSync(path.join(ROOT, 'src/indexer/production-runner.js'), 'utf8');
    const syncEngine = fs.readFileSync(path.join(ROOT, 'src/indexer/sync-engine.js'), 'utf8');

    const healthStart = runner.indexOf('async getHealth()');
    const healthBody = runner.slice(healthStart, runner.indexOf('\n    }', runner.indexOf('catch (error)', healthStart)));
    assert.match(healthBody, /getEventFailureCounts\(\)/);
    assert.doesNotMatch(healthBody, /getUnresolvedEventFailures/);
    assert.doesNotMatch(healthBody, /\.filter\(/, 'health must not scan failure rows in memory');

    // The only registry failure query is a chain-scoped aggregate.
    assert.match(syncEngine, /async getEventFailureCounts\(\)/);
    assert.match(syncEngine, /SELECT processing_status, COUNT\(\*\)::BIGINT AS count/);
    assert.match(syncEngine, /GROUP BY processing_status/);
    assert.doesNotMatch(syncEngine, /async getUnresolvedEventFailures/);
    assert.doesNotMatch(
        syncEngine,
        /SELECT event_hash, transaction_hash[\s\S]{0,400}processing_status IN \('failed', 'dead'\)/,
        'no unbounded failed/dead row selection may remain'
    );
});

test('the aggregate is chain scoped and ignores other statuses', async () => {
    const { default: IndexerSyncEngine } = await import(moduleUrl('src/indexer/sync-engine.js'));
    const seen = [];
    const engine = new IndexerSyncEngine(
        {
            async query(sql, params) {
                seen.push({ sql, params });
                return [
                    { processing_status: 'failed', count: '4' },
                    { processing_status: 'dead', count: '2' },
                    // A status the gauge must ignore even if the row appears.
                    { processing_status: 'processing', count: '9' }
                ];
            }
        },
        { chainId: CHAIN_ID },
        null
    );

    const counts = await engine.getEventFailureCounts();

    assert.deepEqual(counts, { failed: 4, dead: 2 });
    assert.equal(seen.length, 1);
    assert.match(seen[0].sql, /WHERE chain_id = \$1/);
    assert.match(seen[0].sql, /processing_status IN \('failed', 'dead'\)/);
    assert.deepEqual(seen[0].params, [String(CHAIN_ID)]);
});
