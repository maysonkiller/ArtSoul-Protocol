#!/usr/bin/env node
// Before the first mainnet smoke registration, check what an anonymous site visitor can see.
// node scripts/verify-mainnet-catalog.mjs <site-origin> <reviewed-core-address> <deployment-block> [--database <reviewed-pair.json>] [--worker-health]
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { readReviewedOrdinaryPair } from './read-reviewed-ordinary-pair.mjs';
import { checkIndexerHealth, loadMonitorConfig } from './check-indexer-health.mjs';

const mainnet = 8453;
const catalogTables = ['v41_artworks', 'v41_auctions', 'v41_bids', 'v41_settlements',
    'v41_resale_listings', 'v41_resale_history', 'v41_floor_history', 'v41_trust_signals',
    'artwork_social_signals', 'artwork_moderation_visibility'];

// The public projection can omit retired chains, hidden works or private evidence.
// Check the indexer's actual product tables before the first mainnet publication.
const emptyIndexerTables = [
    'public.indexed_auctions', 'public.indexed_bids', 'public.indexed_withdrawals',
    'public.v41_artworks', 'public.v41_auctions', 'public.v41_bids', 'public.v41_settlements',
    'public.v41_bid_withdrawals', 'public.v41_auction_extensions', 'public.v41_auction_endings',
    'public.v41_resale_listings', 'public.v41_resale_history', 'public.v41_floor_history',
    'public.v41_genesis_holders', 'public.v41_project_eligibility', 'public.v41_trust_signals',
    'public.artwork_social_signals', 'public.v41_public_metric_participants', 'public.v41_public_metric_events',
    'artsoul_private.ordinary_settlements', 'artsoul_private.ordinary_runner_up_observations',
    'artsoul_private.ordinary_resale_purchases'
];

export async function verifyMainnetProjectionRows(client, pair, deploymentBlock) {
    assert.equal(pair.chainId, mainnet, 'Supply a reviewed Base mainnet pair for the database check');
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
        // A role subject to a row policy must fail rather than certify an apparently empty table.
        await client.query('SET LOCAL row_security = off');
        await client.query("SET LOCAL statement_timeout = '10s'");
        const {rows: [state]} = await client.query(`
            SELECT count(*) = 1 AND count(*) FILTER (WHERE chain_id = 8453 AND lower(contract_address) = lower($1)
                AND last_confirmed_block >= $2 AND last_indexed_block >= last_confirmed_block) = 1 AS valid
            FROM public.indexer_state`, [pair.coreAddress, deploymentBlock]);
        assert.equal(state.valid, true, 'The database cursor must identify the same reviewed Base mainnet deployment');
        const conditions = emptyIndexerTables.map(table => [table, 'true']);
        conditions.push(['public.contract_events', `chain_id IS DISTINCT FROM 8453 OR block_number < $1
                OR contract_address IS NULL OR contract_address NOT IN (lower($2), lower($3))
                OR artwork_id IS NOT NULL OR event_data ?| ARRAY['artworkId', 'auctionId', 'tokenId']`],
            // These workers claim by status across all chains. A retry must not replay earlier product work.
            ['public.outbox_events', "processing_status IN ('pending', 'processing', 'failed')"],
            ['public.event_queue_spillover', "status IN ('pending', 'processing')"],
            ['public.v41_public_metrics', 'chain_id IS DISTINCT FROM 8453 OR artists_onboarded <> 0 OR auctions_completed <> 0 OR unique_collectors <> 0 OR settled_volume_wei <> 0'],
            ['artsoul_private.ordinary_issuers', `chain_id IS DISTINCT FROM 8453 OR core_address IS DISTINCT FROM lower($2)
                OR nft_address IS DISTINCT FROM lower($3) OR core_code_hash IS DISTINCT FROM lower($4)
                OR nft_code_hash IS DISTINCT FROM lower($5)`]);
        // Identifiers and predicates above are fixed here. Addresses and blocks are bound values.
        const sql = conditions.map(([table, where]) =>
            `SELECT '${table}' AS relation WHERE EXISTS (SELECT 1 FROM ${table} WHERE ${where})`).join(' UNION ALL ');
        const {rows} = await client.query(sql, [deploymentBlock, pair.coreAddress, pair.nftAddress,
            pair.expectedCoreCodeHash, pair.expectedNftCodeHash]);
        assert.equal(rows.length, 0, 'Residual indexer data in ' + rows.map(row => row.relation).join(', '));
        return conditions.length;
    } finally {
        await client.query('ROLLBACK');
    }
}

export async function verifyMainnetCatalog(site, expectedCore, deploymentBlock, { workerMonitor } = {}) {
    const origin = new URL(site);
    assert.ok(['https:', 'http:'].includes(origin.protocol) && !origin.username && !origin.password &&
        origin.pathname === '/' && !origin.search && !origin.hash, 'Expected an HTTP(S) site origin');
    assert.ok(/^0x[0-9a-f]{40}$/i.test(expectedCore) && !/^0x0{40}$/i.test(expectedCore),
        'Supply the reviewed Base mainnet Core address');
    assert.ok(Number.isSafeInteger(deploymentBlock) && deploymentBlock > 0, 'Supply its deployment block');

    async function read(route) {
        const response = await fetch(new URL(route, origin), {
            redirect: 'error', headers: { accept: 'application/json', 'cache-control': 'no-cache' },
            signal: AbortSignal.timeout(10000)
        });
        assert.ok(response.ok, `${route} returned HTTP ${response.status}`);
        const body = await response.json();
        assert.ok(body?.success === true && Array.isArray(body.warnings) && body.warnings.length === 0,
            `${route} did not return a complete successful projection`);
        return body;
    }

    const status = await read('/api/public/indexer-status');
    assert.ok(status.chains?.length === 1 && status.chains[0]?.chain_id === mainnet,
        'The public indexer must identify Base mainnet as its sole product chain');
    const chain = status.chains[0];
    assert.equal(chain.contract_address?.toLowerCase(), expectedCore.toLowerCase(), 'Unexpected indexer Core');
    assert.ok(chain.status === 'running' && chain.liveness === 'healthy' && chain.stale_projection === false,
        'Mainnet projection is unavailable or behind its observed data');
    const age = Date.now() - Date.parse(chain.last_indexed_at);
    assert.ok(Number.isFinite(age) && age >= -30000 && age <= 120000, 'Mainnet indexer timestamp is missing or stale');
    assert.ok(Number.isSafeInteger(chain.last_confirmed_block) && chain.last_confirmed_block >= deploymentBlock &&
        Number.isSafeInteger(chain.last_indexed_block) && chain.last_indexed_block >= chain.last_confirmed_block,
        'Mainnet indexer has not confirmed the expected deployment block');
    for (const name of ['v41_artworks', 'v41_auctions', 'v41_bids', 'v41_settlements', 'v41_resale_listings']) {
        assert.equal(chain.rows?.[name], 0, `Expected zero indexed ${name}`);
    }

    // A chain filter can hide all testnet cards even while the default feed serves them.
    const catalog = await read('/api/public/artworks');
    assert.ok(catalog.count === 0 && Array.isArray(catalog.data) && catalog.data.length === 0,
        'The default public catalog contains artwork or lacks its count');
    assert.deepEqual(catalog.suppressed_artwork_ids, [], 'Moderation-hidden artwork remains in the catalog');
    for (const name of catalogTables) {
        assert.equal(catalog.diagnostics?.[name]?.sampledRows, 0, `Expected zero catalog rows for ${name}`);
        assert.deepEqual(catalog.diagnostics[name].rowsByChain, {}, `Unexpected catalog chain rows for ${name}`);
    }
    const metrics = catalog.public_metrics;
    assert.equal(metrics?.chain_id, mainnet, 'Missing positive Base mainnet scope on the catalog activity counters');
    for (const name of ['artists_onboarded', 'auctions_completed', 'unique_collectors']) {
        assert.equal(metrics[name], 0, `Expected zero ${name}`);
    }
    assert.match(String(metrics.settled_volume_eth), /^0(?:\.0+)?$/, 'Expected zero settled volume');
    const result = {chainId: mainnet, core: expectedCore, confirmedBlock: chain.last_confirmed_block};
    if (workerMonitor) {
        assert.equal(workerMonitor.expectedChainId, mainnet, 'The worker monitor must expect Base mainnet');
        assert.ok(!workerMonitor.expectedCoreAddress || workerMonitor.expectedCoreAddress.toLowerCase() === expectedCore.toLowerCase(),
            'The worker monitor must expect the reviewed Base mainnet Core');
        assert.equal(chain.confirmation_depth, workerMonitor.expectedConfirmationDepth,
            'The public indexer must report the reviewed worker confirmation depth');
        const worker = await checkIndexerHealth({
            ...workerMonitor, expectedCoreAddress: expectedCore,
            minConfirmedBlock: chain.last_confirmed_block, minIndexedBlock: chain.last_indexed_block
        });
        assert.ok(worker.ok, 'Worker readiness failed: ' + worker.failures.map(failure => failure.code).join(', '));
        result.worker = worker.observed;
    }
    return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const [site, core, block, ...extra] = process.argv.slice(2);
        const usage = 'Usage: verify-mainnet-catalog.mjs <site-origin> <reviewed-core-address> <deployment-block> [--database <reviewed-pair.json>] [--worker-health]';
        let flags;
        try {
            flags = parseArgs({args: extra, options: {database: {type: 'string', multiple: true}, 'worker-health': {type: 'boolean'}}}).values;
        } catch {
            throw new Error(usage);
        }
        const pairFile = flags.database?.[0];
        assert.ok(site && core && /^[1-9]\d*$/.test(block) && (!flags.database || (pairFile && flags.database.length === 1)), usage);
        let pair;
        if (pairFile) {
            try {
                pair = await readReviewedOrdinaryPair(pairFile);
            } catch {
                throw new Error('Could not read the reviewed pair. Check its path, addresses and runtime hashes.');
            }
            assert.ok(pair.chainId === mainnet && pair.coreAddress.toLowerCase() === core.toLowerCase(),
                'The reviewed pair must identify the supplied Base mainnet Core');
            assert.ok(process.env.ARTSOUL_CUTOVER_DATABASE_URL, 'Supply ARTSOUL_CUTOVER_DATABASE_URL for --database');
        }
        let workerMonitor;
        if (flags['worker-health']) {
            assert.ok(/^[1-9]\d*$/.test(process.env.ARTSOUL_MONITOR_EXPECTED_CONFIRMATION_DEPTH || ''),
                'Supply the reviewed ARTSOUL_MONITOR_EXPECTED_CONFIRMATION_DEPTH for --worker-health');
            workerMonitor = loadMonitorConfig({...process.env, ARTSOUL_MONITOR_EXPECTED_CHAIN_ID:
                process.env.ARTSOUL_MONITOR_EXPECTED_CHAIN_ID || String(mainnet)});
        }
        const checked = await verifyMainnetCatalog(site, core, Number(block), { workerMonitor });
        if (pairFile) {
            const {Client} = (await import('pg')).default;
            const client = new Client({connectionString: process.env.ARTSOUL_CUTOVER_DATABASE_URL, connectionTimeoutMillis: 10000});
            try {
                await client.connect();
                checked.databaseRelationsChecked = await verifyMainnetProjectionRows(client, pair, Number(block));
            } catch (error) {
                if (error instanceof assert.AssertionError) throw error;
                throw new Error('Could not verify the cutover database. Check access, schema, and unfiltered read permissions.');
            } finally {
                await client.end();
            }
        }
        console.log('Verified empty pre-smoke public catalog', checked);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
