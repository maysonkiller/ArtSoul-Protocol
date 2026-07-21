import assert from 'node:assert/strict';
import test from 'node:test';

import {
    checkIndexerHealth,
    evaluateIndexerHealth,
    loadMonitorConfig
} from '../scripts/check-indexer-health.mjs';

const NOW = Date.parse('2026-07-21T12:00:00.000Z');

function healthyPayload(overrides = {}) {
    return {
        status: 'healthy',
        timestamp: '2026-07-21T11:59:30.000Z',
        database: { healthy: true },
        indexer: {
            chainId: '84532',
            confirmationDepth: 3,
            confirmationDepthSyncError: null,
            blocksBehind: 4,
            isSynced: true,
            unresolvedErrors: 0,
            ...overrides.indexer
        },
        metrics: {
            rpcErrorsLastMinute: 0,
            ...overrides.metrics
        },
        ...Object.fromEntries(Object.entries(overrides).filter(([key]) => !['indexer', 'metrics'].includes(key)))
    };
}

const config = loadMonitorConfig({});

test('accepts a fresh healthy Base Sepolia indexer response', () => {
    const result = evaluateIndexerHealth(healthyPayload(), config, NOW);
    assert.equal(result.ok, true);
    assert.deepEqual(result.failures, []);
});

test('fails closed on wrong chain, confirmation drift, lag and unresolved errors', () => {
    const result = evaluateIndexerHealth(healthyPayload({
        indexer: {
            chainId: 8453,
            confirmationDepth: 12,
            confirmationDepthSyncError: 'database update failed',
            blocksBehind: 10,
            isSynced: false,
            unresolvedErrors: 2
        }
    }), config, NOW);

    assert.equal(result.ok, false);
    assert.deepEqual(
        result.failures.map(({ code }) => code),
        ['CHAIN_ID', 'CONFIRMATION_DEPTH', 'CONFIRMATION_DEPTH_SYNC', 'UNRESOLVED_ERRORS', 'BLOCK_LAG', 'SYNC_STATE']
    );
});

test('rejects excessive RPC errors and stale responses', () => {
    const result = evaluateIndexerHealth(healthyPayload({
        timestamp: '2026-07-21T11:55:00.000Z',
        metrics: { rpcErrorsLastMinute: 6 }
    }), config, NOW);

    assert.equal(result.ok, false);
    assert.deepEqual(result.failures.map(({ code }) => code), ['RPC_ERRORS', 'STALE_RESPONSE']);
});

test('supports explicit environment thresholds and rejects invalid values', () => {
    const custom = loadMonitorConfig({
        ARTSOUL_INDEXER_HEALTH_URL: 'http://localhost:9999/health',
        ARTSOUL_MONITOR_MAX_BLOCKS_BEHIND: '20',
        ARTSOUL_MONITOR_MAX_RPC_ERRORS_PER_MINUTE: '10'
    });

    assert.equal(custom.healthUrl, 'http://localhost:9999/health');
    assert.equal(custom.maxBlocksBehind, 20);
    assert.equal(custom.maxRpcErrorsPerMinute, 10);
    assert.throws(
        () => loadMonitorConfig({ ARTSOUL_MONITOR_MAX_BLOCKS_BEHIND: '-1' }),
        /must be a non-negative number/
    );
});

test('reports a non-2xx health response without exposing the configured URL', async () => {
    const result = await checkIndexerHealth(config, {
        fetchImpl: async () => ({ ok: false, status: 503 }),
        now: NOW
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.failures, [{ code: 'HTTP_STATUS', detail: 'health endpoint returned HTTP 503' }]);
    assert.equal(JSON.stringify(result).includes(config.healthUrl), false);
});

test('reports transport failures without throwing', async () => {
    const result = await checkIndexerHealth(config, {
        fetchImpl: async () => {
            throw new Error(`connection refused at ${config.healthUrl}`);
        },
        now: NOW
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.failures, [{ code: 'REQUEST_FAILED', detail: 'connection refused at [health endpoint]' }]);
    assert.equal(JSON.stringify(result).includes(config.healthUrl), false);
});

test('parses and evaluates a successful endpoint response', async () => {
    const payload = healthyPayload();
    const result = await checkIndexerHealth(config, {
        fetchImpl: async () => ({
            ok: true,
            status: 200,
            json: async () => payload
        }),
        now: NOW
    });

    assert.equal(result.ok, true);
    assert.equal(result.observed.chainId, '84532');
    assert.equal(result.observed.blocksBehind, 4);
});
