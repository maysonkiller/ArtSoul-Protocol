// A-15: /health must tell the truth about unapplied events.
//
// Before the fix unresolvedErrors read only indexer_errors, whose sole writer
// was unreachable dead code, so an indexer that had permanently skipped an
// event still reported unresolvedErrors: 0 and status healthy. It now also
// counts failed/dead rows in event_processing_registry for the ACTIVE chain.
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const CHAIN_ID = 84532;

function moduleUrl(relativePath) {
    return pathToFileURL(path.join(ROOT, relativePath)).href;
}

// Drives the real getHealth() with stubbed collaborators. Only the data
// sources are faked; the status/aggregation logic under test is the shipped
// implementation.
const healthCalls = [];

async function getHealth({ eventFailures = { failed: 0, dead: 0 }, indexerErrors = [], isRunning = true } = {}) {
    const { default: ProductionIndexer } = await import(moduleUrl('src/indexer/production-runner.js'));
    const indexer = Object.create(ProductionIndexer.prototype);

    indexer.config = { chainId: CHAIN_ID };
    indexer.isRunning = isRunning;
    indexer.confirmationDepth = 3;
    indexer.healthMaxBlocksBehind = 50;
    indexer.confirmationDepthSyncError = null;
    indexer.metrics = {
        rpcLatencyMs: 1,
        blocksPerSecond: 1,
        eventsPerSecond: 1,
        rpcErrorsLastMinute: 0,
        lastErrorTime: 0
    };
    indexer.db = { async healthCheck() { return { status: 'ok' }; } };
    indexer.eventListener = { async getCurrentBlock() { return 1000; } };
    indexer.syncEngine = {
        async getIndexerState() {
            return {
                contract_address: '0xcore',
                chain_id: String(CHAIN_ID),
                last_indexed_block: 999,
                last_confirmed_block: 996,
                total_events_indexed: 42,
                version: '2.0',
                started_at: new Date().toISOString()
            };
        },
        async getUnresolvedErrors() { return indexerErrors; },
        // Chain scoping is enforced by the SQL in the sync engine and covered
        // by indexer-event-failure-integrity.test.cjs; here the stub returns
        // only active-chain aggregate counts, as that query does.
        async getEventFailureCounts() {
            healthCalls.push('getEventFailureCounts');
            return eventFailures;
        }
    };

    return await indexer.getHealth();
}

test('a clean indexer reports healthy with zero unresolved errors', async () => {
    const health = await getHealth();
    assert.equal(health.status, 'healthy');
    assert.equal(health.indexer.unresolvedErrors, 0);
    assert.deepEqual(health.indexer.eventFailures, { failed: 0, dead: 0 });
});

test('a failed registry row makes unresolvedErrors non-zero and health degraded', async () => {
    const health = await getHealth({ eventFailures: { failed: 1, dead: 0 } });

    assert.equal(health.indexer.unresolvedErrors, 1);
    assert.equal(health.status, 'degraded');
    assert.deepEqual(health.indexer.eventFailures, { failed: 1, dead: 0 });
});

test('dead rows also degrade health and are reported separately', async () => {
    const health = await getHealth({ eventFailures: { failed: 1, dead: 2 } });

    assert.equal(health.indexer.unresolvedErrors, 3);
    assert.equal(health.status, 'degraded');
    assert.deepEqual(health.indexer.eventFailures, { failed: 1, dead: 2 });
});

test('legacy indexer_errors rows still count toward unresolvedErrors', async () => {
    const health = await getHealth({
        indexerErrors: [{ id: 1 }],
        eventFailures: { failed: 1, dead: 0 }
    });

    assert.equal(health.indexer.unresolvedErrors, 2);
    assert.equal(health.status, 'degraded');
});

test('the public health shape stays backward compatible', async () => {
    const health = await getHealth();

    for (const field of [
        'contractAddress', 'chainId', 'lastIndexedBlock', 'lastConfirmedBlock',
        'currentBlock', 'blocksBehind', 'isSynced', 'syncThresholdBlocks',
        'confirmationDepth', 'confirmationDepthSyncError', 'totalEventsIndexed',
        'unresolvedErrors'
    ]) {
        assert.ok(field in health.indexer, `health.indexer.${field} must remain present`);
    }
    for (const field of ['status', 'timestamp', 'database', 'indexer', 'metrics', 'uptime', 'version']) {
        assert.ok(field in health, `health.${field} must remain present`);
    }
    assert.equal(typeof health.indexer.unresolvedErrors, 'number');
});

test('a stopped indexer still reports stopped rather than degraded', async () => {
    const health = await getHealth({
        isRunning: false,
        eventFailures: { failed: 0, dead: 1 }
    });

    assert.equal(health.status, 'stopped');
    assert.equal(health.indexer.unresolvedErrors, 1);
});
