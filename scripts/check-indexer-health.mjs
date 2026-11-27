import { pathToFileURL } from 'node:url';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { DEFAULT_HEALTH_MAX_BLOCKS_BEHIND, isIndexerWithinHealthLag, parseHealthCount } from '../src/indexer/health-policy.js';

const DEFAULTS = Object.freeze({
    healthUrl: 'http://127.0.0.1:3001/health',
    expectedChainId: 84532,
    expectedConfirmationDepth: 3,
    maxBlocksBehind: DEFAULT_HEALTH_MAX_BLOCKS_BEHIND,
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
    const expectedCoreAddress = env.ARTSOUL_MONITOR_EXPECTED_CORE_ADDRESS;
    if (expectedCoreAddress && (!/^0x[0-9a-f]{40}$/i.test(expectedCoreAddress) || /^0x0{40}$/i.test(expectedCoreAddress))) {
        throw new Error('ARTSOUL_MONITOR_EXPECTED_CORE_ADDRESS must be a nonzero Core address');
    }
    return {
        healthUrl: env.ARTSOUL_INDEXER_HEALTH_URL || DEFAULTS.healthUrl,
        expectedCoreAddress,
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
    addFailure(failures, parseHealthCount(indexer?.chainId) === config.expectedChainId, 'CHAIN_ID', `expected ${config.expectedChainId}, received ${indexer?.chainId ?? 'missing'}`);
    if (config.expectedCoreAddress) {
        addFailure(failures, typeof indexer?.contractAddress === 'string' &&
            indexer.contractAddress.toLowerCase() === config.expectedCoreAddress.toLowerCase(),
            'CORE_ADDRESS', 'worker does not report the reviewed Core');
        const confirmed = parseHealthCount(indexer?.lastConfirmedBlock);
        const indexed = parseHealthCount(indexer?.lastIndexedBlock);
        const head = parseHealthCount(indexer?.currentBlock);
        addFailure(failures, confirmed >= (config.minConfirmedBlock ?? 0) && indexed >= (config.minIndexedBlock ?? 0) && confirmed <= indexed &&
            head - indexed === parseHealthCount(indexer?.blocksBehind),
            'BLOCK_CURSORS', 'confirmed, indexed and RPC head blocks must agree with the expected watermark and lag');
    }
    addFailure(
        failures,
        parseHealthCount(indexer?.confirmationDepth) === config.expectedConfirmationDepth,
        'CONFIRMATION_DEPTH',
        `expected ${config.expectedConfirmationDepth}, received ${indexer?.confirmationDepth ?? 'missing'}`
    );
    addFailure(
        failures,
        indexer?.confirmationDepthSyncError == null,
        'CONFIRMATION_DEPTH_SYNC',
        String(indexer?.confirmationDepthSyncError || 'unknown synchronization error')
    );
    addFailure(failures, parseHealthCount(indexer?.unresolvedErrors) === 0, 'UNRESOLVED_ERRORS', `received ${indexer?.unresolvedErrors ?? 'missing'}`);
    addFailure(
        failures,
        isIndexerWithinHealthLag(indexer?.blocksBehind, config.maxBlocksBehind),
        'BLOCK_LAG',
        `expected less than ${config.maxBlocksBehind}, received ${indexer?.blocksBehind ?? 'missing'}`
    );
    addFailure(failures, indexer?.isSynced === true, 'SYNC_STATE', 'indexer is not synchronized');
    addFailure(
        failures,
        parseHealthCount(metrics?.rpcErrorsLastMinute) <= config.maxRpcErrorsPerMinute,
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
            ...(config.expectedCoreAddress && {
                coreAddress: typeof indexer?.contractAddress === 'string' && /^0x[0-9a-f]{40}$/i.test(indexer.contractAddress) ? indexer.contractAddress : null,
                status: payload?.status ?? null,
                databaseHealthy: payload?.database?.healthy === true,
                depthSynchronized: indexer?.confirmationDepthSyncError == null,
                confirmedBlock: parseHealthCount(indexer?.lastConfirmedBlock),
                indexedBlock: parseHealthCount(indexer?.lastIndexedBlock),
                rpcHead: parseHealthCount(indexer?.currentBlock)
            }),
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
            ...(config.expectedCoreAddress && {redirect: 'error'}),
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

function utc(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) return NaN;
    const ms = Date.parse(value);
    const canonical = value.includes('.') ? value : value.slice(0, -1) + '.000Z';
    return Number.isFinite(ms) && new Date(ms).toISOString() === canonical ? ms : NaN;
}

// Check both bracketing observations and every intervening sample in constant memory.
export async function reviewHealthWindow(lines, config, from, to, maxGapSeconds, now = Date.now()) {
    const start = utc(from), end = utc(to), gapLimit = Number(maxGapSeconds) * 1000;
    if (!config.expectedCoreAddress || ![8453, 84532].includes(config.expectedChainId) ||
        !Number.isFinite(start) || !Number.isFinite(end) || !(start < end && end <= now) ||
        !/^[1-9]\d*$/.test(String(maxGapSeconds)) || !Number.isSafeInteger(gapLimit)) {
        throw new Error('Pin a Base Core, specify an elapsed UTC interval and a positive maximum gap in seconds.');
    }

    let previous, first, last, samples = 0, maxGapMs = 0;
    function include(sample) {
        const { observed, ok, failures, checkedAt } = sample.row;
        if (ok !== true || !Array.isArray(failures) || failures.length || observed?.depthSynchronized !== true) {
            throw new Error('Unhealthy or incomplete worker observation at ' + checkedAt);
        }
        const result = evaluateIndexerHealth({
            timestamp: observed.timestamp, status: observed.status,
            database: { healthy: observed.databaseHealthy },
            metrics: { rpcErrorsLastMinute: observed.rpcErrorsLastMinute },
            indexer: {
                ...observed, contractAddress: observed.coreAddress, lastConfirmedBlock: observed.confirmedBlock,
                lastIndexedBlock: observed.indexedBlock, currentBlock: observed.rpcHead
            }
        }, {...config, minConfirmedBlock: last?.observed.confirmedBlock, minIndexedBlock: last?.observed.indexedBlock}, sample.time);
        if (!result.ok) throw new Error('Worker observation at ' + checkedAt + ' failed ' + result.failures.map(x => x.code).join(', '));
        if (last && Date.parse(observed.timestamp) <= Date.parse(last.observed.timestamp)) {
            throw new Error('The worker response timestamp did not advance at ' + checkedAt);
        }
        last = {checkedAt, observed: result.observed};
        first ??= last;
        ++samples;
    }
    for await (const line of lines) {
        if (!line.trim()) continue;
        let row;
        try { row = JSON.parse(line.trim()); } catch { throw new Error('Invalid JSON in the health journal.'); }
        const time = utc(row?.checkedAt);
        if (!Number.isFinite(time) || time > now || (previous && time <= previous.time)) {
            throw new Error('Health journal times must be valid, elapsed and strictly increasing.');
        }
        const current = {row, time};
        if (previous && previous.time < end && time > start) {
            if (!first) include(previous);
            const gap = time - previous.time;
            maxGapMs = Math.max(maxGapMs, gap);
            if (gap > gapLimit) throw new Error('Observation gap exceeds the reviewed limit at ' + row.checkedAt);
            include(current);
        }
        previous = current;
    }
    if (!first || utc(first.checkedAt) > start || utc(last.checkedAt) < end) throw new Error('Observations must bracket the entire window.');
    if (last.observed.confirmedBlock <= first.observed.confirmedBlock || last.observed.indexedBlock <= first.observed.indexedBlock) {
        throw new Error('The window lacks forward progress on both worker cursors.');
    }
    return { ok: true, coverage: 'sampled_worker_health', chainId: config.expectedChainId,
        coreAddress: config.expectedCoreAddress, from, to, samples, maxGapMs, firstObservation: first.checkedAt,
        lastObservation: last.checkedAt, firstConfirmedBlock: first.observed.confirmedBlock, lastConfirmedBlock: last.observed.confirmedBlock };
}

// The operator supplies the incident register covering this deployment, including
// incidents opened before the first observation that continued into the period.
export async function reviewCoreStability(lines, config, from, to, maxGap, register, now = Date.now()) {
    const start = utc(from), end = utc(to);
    if (config.expectedChainId !== 8453 || !Number.isFinite(end - start) || end - start < 7 * 86400000) {
        throw new Error('Core stability requires at least seven consecutive elapsed days on Base mainnet.');
    }
    const recordedStart = utc(register?.coverageFrom), recordedEnd = utc(register?.coverageThrough);
    if (register?.chainId !== 8453 || !config.expectedCoreAddress ||
        typeof register?.coreAddress !== 'string' || register.coreAddress.toLowerCase() !== config.expectedCoreAddress.toLowerCase() ||
        !(recordedStart <= start && recordedEnd >= end && recordedEnd <= now) || !Array.isArray(register.criticalIncidents)) {
        throw new Error('The incident register must cover this Core and the entire observation period.');
    }
    for (const incident of register.criticalIncidents) {
        const opened = utc(incident?.openedAt);
        const resolved = incident?.resolvedAt === null ? Infinity : utc(incident?.resolvedAt);
        if (!Number.isFinite(opened) || opened > recordedEnd || !(resolved >= opened) ||
            (resolved !== Infinity && resolved > recordedEnd)) throw new Error('Invalid critical incident interval.');
        if (opened <= end && resolved >= start) throw new Error('A recorded critical incident overlaps the observation period.');
    }
    const health = await reviewHealthWindow(lines, config, from, to, maxGap, now);
    return {...health, coverage: 'sampled_worker_health_and_reported_critical_incidents', criticalIncidentsInWindow: 0};
}

async function main() {
    try {
        const config = loadMonitorConfig();
        const args = process.argv.slice(2);
        if (args.length) {
            const stability = args[0] === '--core-stability' && args.length === 6;
            if (!stability && (args.length !== 5 || args[0] !== '--window')) {
                throw new Error('Usage: --window JOURNAL START_UTC END_UTC MAX_GAP_SECONDS or --core-stability JOURNAL START_UTC END_UTC MAX_GAP_SECONDS INCIDENT_REGISTER.json');
            }
            const register = stability && JSON.parse(await readFile(args[5], 'utf8'));
            const input = createReadStream(args[1], 'utf8');
            const lines = createInterface({input, crlfDelay: Infinity});
            try {
                const window = args.slice(2, 5);
                const result = stability ? await reviewCoreStability(lines, config, ...window, register)
                    : await reviewHealthWindow(lines, config, ...window);
                console.log(JSON.stringify(result));
            }
            finally { lines.close(); input.destroy(); }
            return;
        }
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
            failures: [{ code: ['--window','--core-stability'].includes(process.argv[2]) ? 'HEALTH_WINDOW' : 'CONFIGURATION',
                detail: error instanceof SyntaxError ? 'Invalid incident register JSON.' : String(error?.message || error) }],
            observed: null
        }));
        process.exitCode = 1;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
