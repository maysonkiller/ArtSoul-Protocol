import { pathToFileURL } from 'node:url';

const DEFAULTS = Object.freeze({
    healthUrl: 'http://127.0.0.1:3001/health',
    expectedChainId: 84532,
    expectedConfirmationDepth: 3,
    maxBlocksBehind: 10,
    maxRpcErrorsPerMinute: 5,
    maxResponseAgeMs: 120_000,
    requestTimeoutMs: 10_000
});

function readNonNegativeNumber(value, fallback, name) {
    if (value === undefined || value === '') {
        return fallback;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`${name} must be a non-negative number`);
    }

    return parsed;
}

export function loadMonitorConfig(env = process.env) {
    return {
        healthUrl: env.ARTSOUL_INDEXER_HEALTH_URL || DEFAULTS.healthUrl,
        expectedChainId: readNonNegativeNumber(
            env.ARTSOUL_MONITOR_EXPECTED_CHAIN_ID,
            DEFAULTS.expectedChainId,
            'ARTSOUL_MONITOR_EXPECTED_CHAIN_ID'
        ),
        expectedConfirmationDepth: readNonNegativeNumber(
            env.ARTSOUL_MONITOR_EXPECTED_CONFIRMATION_DEPTH,
            DEFAULTS.expectedConfirmationDepth,
            'ARTSOUL_MONITOR_EXPECTED_CONFIRMATION_DEPTH'
        ),
        maxBlocksBehind: readNonNegativeNumber(
            env.ARTSOUL_MONITOR_MAX_BLOCKS_BEHIND,
            DEFAULTS.maxBlocksBehind,
            'ARTSOUL_MONITOR_MAX_BLOCKS_BEHIND'
        ),
        maxRpcErrorsPerMinute: readNonNegativeNumber(
            env.ARTSOUL_MONITOR_MAX_RPC_ERRORS_PER_MINUTE,
            DEFAULTS.maxRpcErrorsPerMinute,
            'ARTSOUL_MONITOR_MAX_RPC_ERRORS_PER_MINUTE'
        ),
        maxResponseAgeMs: readNonNegativeNumber(
            env.ARTSOUL_MONITOR_MAX_RESPONSE_AGE_MS,
            DEFAULTS.maxResponseAgeMs,
            'ARTSOUL_MONITOR_MAX_RESPONSE_AGE_MS'
        ),
        requestTimeoutMs: readNonNegativeNumber(
            env.ARTSOUL_MONITOR_REQUEST_TIMEOUT_MS,
            DEFAULTS.requestTimeoutMs,
            'ARTSOUL_MONITOR_REQUEST_TIMEOUT_MS'
        )
    };
}

function addFailure(failures, condition, code, detail) {
    if (!condition) {
        failures.push({ code, detail });
    }
}

export function evaluateIndexerHealth(payload, config, now = Date.now()) {
    const failures = [];
    const indexer = payload?.indexer;
    const metrics = payload?.metrics;
    const timestampMs = Date.parse(payload?.timestamp || '');

    addFailure(failures, payload?.status === 'healthy', 'STATUS', `expected healthy, received ${payload?.status ?? 'missing'}`);
    addFailure(failures, payload?.database?.healthy === true, 'DATABASE', 'database health is not true');
    addFailure(failures, Number(indexer?.chainId) === config.expectedChainId, 'CHAIN_ID', `expected ${config.expectedChainId}, received ${indexer?.chainId ?? 'missing'}`);
    addFailure(
        failures,
        Number(indexer?.confirmationDepth) === config.expectedConfirmationDepth,
        'CONFIRMATION_DEPTH',
        `expected ${config.expectedConfirmationDepth}, received ${indexer?.confirmationDepth ?? 'missing'}`
    );
    addFailure(
        failures,
        indexer?.confirmationDepthSyncError == null,
        'CONFIRMATION_DEPTH_SYNC',
        String(indexer?.confirmationDepthSyncError || 'unknown synchronization error')
    );
    addFailure(failures, Number(indexer?.unresolvedErrors) === 0, 'UNRESOLVED_ERRORS', `received ${indexer?.unresolvedErrors ?? 'missing'}`);
    addFailure(
        failures,
        Number.isFinite(Number(indexer?.blocksBehind)) && Number(indexer.blocksBehind) < config.maxBlocksBehind,
        'BLOCK_LAG',
        `expected less than ${config.maxBlocksBehind}, received ${indexer?.blocksBehind ?? 'missing'}`
    );
    addFailure(failures, indexer?.isSynced === true, 'SYNC_STATE', 'indexer is not synchronized');
    addFailure(
        failures,
        Number.isFinite(Number(metrics?.rpcErrorsLastMinute)) && Number(metrics.rpcErrorsLastMinute) <= config.maxRpcErrorsPerMinute,
        'RPC_ERRORS',
        `expected at most ${config.maxRpcErrorsPerMinute}, received ${metrics?.rpcErrorsLastMinute ?? 'missing'}`
    );
    addFailure(failures, Number.isFinite(timestampMs), 'TIMESTAMP', 'health timestamp is missing or invalid');

    if (Number.isFinite(timestampMs)) {
        const ageMs = now - timestampMs;
        addFailure(
            failures,
            ageMs >= -30_000 && ageMs <= config.maxResponseAgeMs,
            'STALE_RESPONSE',
            `health response age ${ageMs}ms is outside the allowed range`
        );
    }

    return {
        ok: failures.length === 0,
        failures,
        observed: {
            timestamp: payload?.timestamp ?? null,
            chainId: indexer?.chainId ?? null,
            confirmationDepth: indexer?.confirmationDepth ?? null,
            blocksBehind: indexer?.blocksBehind ?? null,
            isSynced: indexer?.isSynced ?? null,
            unresolvedErrors: indexer?.unresolvedErrors ?? null,
            rpcErrorsLastMinute: metrics?.rpcErrorsLastMinute ?? null
        }
    };
}

export async function checkIndexerHealth(config, { fetchImpl = fetch, now = Date.now() } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

    try {
        const response = await fetchImpl(config.healthUrl, {
            headers: { accept: 'application/json' },
            signal: controller.signal
        });

        if (!response.ok) {
            return {
                ok: false,
                failures: [{ code: 'HTTP_STATUS', detail: `health endpoint returned HTTP ${response.status}` }],
                observed: null
            };
        }

        return evaluateIndexerHealth(await response.json(), config, now);
    } catch (error) {
        const rawDetail = error?.name === 'AbortError'
            ? `health request exceeded ${config.requestTimeoutMs}ms`
            : String(error?.message || error);
        const detail = rawDetail.replaceAll(config.healthUrl, '[health endpoint]');
        return {
            ok: false,
            failures: [{ code: 'REQUEST_FAILED', detail }],
            observed: null
        };
    } finally {
        clearTimeout(timeout);
    }
}

async function main() {
    try {
        const config = loadMonitorConfig();
        const result = await checkIndexerHealth(config);
        const output = {
            ok: result.ok,
            checkedAt: new Date().toISOString(),
            failures: result.failures,
            observed: result.observed
        };

        console.log(JSON.stringify(output));
        process.exitCode = result.ok ? 0 : 1;
    } catch (error) {
        console.error(JSON.stringify({
            ok: false,
            checkedAt: new Date().toISOString(),
            failures: [{ code: 'CONFIGURATION', detail: String(error?.message || error) }],
            observed: null
        }));
        process.exitCode = 1;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
