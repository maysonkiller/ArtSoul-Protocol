import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
    checkIndexerHealth,
    evaluateIndexerHealth,
    loadMonitorConfig,
    reviewHealthWindow
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

test('replays the two recorded Base Sepolia observations offline', async () => {
    const config = loadMonitorConfig({
        ARTSOUL_MONITOR_EXPECTED_CORE_ADDRESS:'0x43368f7E2d5f11f4B7E11928D66d3f4A5a4E4ceF',
        ARTSOUL_MONITOR_MAX_BLOCKS_BEHIND:'50'
    });
    const journal = await readFile(new URL('./fixtures/base-sepolia-health-window-2026-11-27.ndjson', import.meta.url), 'utf8');
    const report = await reviewHealthWindow(journal.trim().split(/\r?\n/), config,
        '2026-11-27T00:26:15Z', '2026-11-27T00:31:15Z', 330, Date.parse('2026-11-27T00:32:00Z'));
    assert.equal(report.ok, true);
    assert.deepEqual([report.samples,report.maxGapMs,report.firstConfirmedBlock,report.lastConfirmedBlock],
        [2,311940,64086499,64088060]);
});

test('a sampled window brackets both endpoints and rechecks each observation against the reviewed policy', async () => {
    const core = '0x' + 'ab'.repeat(20);
    const pinned = loadMonitorConfig({ARTSOUL_MONITOR_EXPECTED_CORE_ADDRESS: core});
    const time = seconds => new Date(NOW + seconds * 1000).toISOString();
    function sample(seconds, block) {
        const payload = healthyPayload({timestamp: time(seconds), indexer: {
            contractAddress: core, lastConfirmedBlock: block, lastIndexedBlock: block + 3, currentBlock: block + 7
        }});
        return {checkedAt: time(seconds), ...evaluateIndexerHealth(payload, pinned, NOW + seconds * 1000)};
    }
    const rows = [sample(0, 100), sample(300, 150), sample(600, 200)];
    const review = (records, settings = pinned, from = time(1), to = time(599), gap = 300) =>
        reviewHealthWindow(records.map(row => JSON.stringify(row)), settings, from, to, gap, NOW + 600000);
    const result = await review(rows);
    assert.deepEqual([result.coverage, result.samples, result.maxGapMs, result.firstConfirmedBlock, result.lastConfirmedBlock],
        ['sampled_worker_health', 3, 300000, 100, 200]);
    assert.equal((await review(rows, pinned, time(0), time(600))).ok, true);
    for (const shortened of [rows.slice(1), rows.slice(0, 2), [], rows.slice(0, 1)]) {
        await assert.rejects(review(shortened), /bracket/);
    }
    await assert.rejects(review([rows[0], rows[2]]), /gap exceeds/);
    await assert.rejects(review([rows[0], rows[1], rows[1], rows[2]]), /strictly increasing/);
    await assert.rejects(review([rows[0], {...rows[1], ok:false}, rows[2]]), /Unhealthy/);
    await assert.rejects(review([sample(0, 100), sample(300, 90), rows[2]]), /BLOCK_CURSORS/);
    await assert.rejects(review([sample(0, 100), sample(300, 100), sample(600, 100)]), /forward progress/);
    const altered = fields => [rows[0], {...rows[1], observed:{...rows[1].observed,...fields}}, rows[2]];
    await assert.rejects(review(altered({databaseHealthy:false})), /DATABASE/);
    await assert.rejects(review(altered({depthSynchronized:undefined})), /incomplete/);
    await assert.rejects(review(altered({coreAddress:'0x'+'cd'.repeat(20)})), /CORE_ADDRESS/);
    await assert.rejects(review(altered({chainId:8453})), /CHAIN_ID/);
    await assert.rejects(review(altered({timestamp:time(0)})), /STALE_RESPONSE/);
    await assert.rejects(review(altered({timestamp:time(0)}), {...pinned,maxResponseAgeMs:600000}), /timestamp did not advance/);
    await assert.rejects(review(rows, {...pinned,maxBlocksBehind:3}), /BLOCK_LAG/);
    await assert.rejects(review(rows, config), /Pin a Base Core/);
    await assert.rejects(review(rows, pinned, time(1), time(601)), /elapsed UTC/);
    await assert.rejects(review(rows, pinned, '2026-02-30T12:00:00Z', time(599)), /elapsed UTC/);
    await assert.rejects(reviewHealthWindow(['{broken'],pinned,time(1),time(599),300,NOW+600000), /Invalid JSON/);
});

test('accepts a fresh healthy Base Sepolia indexer response', () => {
    const result = evaluateIndexerHealth(healthyPayload(), config, NOW);
    assert.equal(result.ok, true);
    assert.deepEqual(result.failures, []);
});

test('reports malformed counters instead of treating them as a healthy zero', async () => {
    for (const value of [null, undefined, false, '', ' ', [], [0], -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
        const payload = healthyPayload({
            indexer: { unresolvedErrors: value, blocksBehind: value },
            metrics: { rpcErrorsLastMinute: value }
        });
        const result = await checkIndexerHealth(config, {
            fetchImpl: async () => Response.json(payload),
            now: NOW
        });
        assert.equal(result.ok, false);
        assert.deepEqual(result.failures.map(failure => failure.code), ['UNRESOLVED_ERRORS', 'BLOCK_LAG', 'RPC_ERRORS']);
    }
    for (const zero of [0, '0']) {
        assert.equal(evaluateIndexerHealth(healthyPayload({
            indexer: { unresolvedErrors: zero, blocksBehind: zero },
            metrics: { rpcErrorsLastMinute: zero }
        }), config, NOW).ok, true);
    }
});

test('fails closed on wrong chain, confirmation drift, lag and unresolved errors', () => {
    const result = evaluateIndexerHealth(healthyPayload({
        indexer: {
            chainId: 8453,
            confirmationDepth: 12,
            confirmationDepthSyncError: 'database update failed',
            blocksBehind: 20,
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

test('accepts a synced observation below the configured block-lag boundary', () => {
    const result = evaluateIndexerHealth(healthyPayload({
        indexer: { blocksBehind: 11, isSynced: true }
    }), config, NOW);

    assert.equal(config.maxBlocksBehind, 20);
    assert.equal(result.ok, true);
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
    for (const value of ['0xinvalid', '0x'+'00'.repeat(20)]) {
        assert.throws(() => loadMonitorConfig({ARTSOUL_MONITOR_EXPECTED_CORE_ADDRESS: value}), /nonzero Core address/);
    }
});

test('a monitor pinned to a Core reads the configured endpoint without following redirects', async () => {
    const core = '0x'+'ab'.repeat(20);
    const pinned = loadMonitorConfig({ARTSOUL_MONITOR_EXPECTED_CORE_ADDRESS: core});
    const result = await checkIndexerHealth(pinned, {now: NOW, fetchImpl: async (url, init) => {
        assert.equal(url, pinned.healthUrl);
        assert.equal(init.redirect, 'error');
        return Response.json(healthyPayload({indexer: {contractAddress: core, lastConfirmedBlock: 100, lastIndexedBlock: 103, currentBlock: 107}}));
    }});
    assert.equal(result.ok, true);
    assert.equal(result.observed.rpcHead, 107);
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
