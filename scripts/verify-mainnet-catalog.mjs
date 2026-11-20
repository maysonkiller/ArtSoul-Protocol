#!/usr/bin/env node
// Before the first mainnet smoke registration, check what an anonymous site visitor can see.
// node scripts/verify-mainnet-catalog.mjs <site-origin> <reviewed-core-address> <deployment-block>
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const mainnet = 8453;
const catalogTables = ['v41_artworks', 'v41_auctions', 'v41_bids', 'v41_settlements',
    'v41_resale_listings', 'v41_resale_history', 'v41_floor_history', 'v41_trust_signals',
    'artwork_social_signals', 'artwork_moderation_visibility'];

export async function verifyMainnetCatalog(site, expectedCore, deploymentBlock) {
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
    return {chainId: mainnet, core: expectedCore, confirmedBlock: chain.last_confirmed_block};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const [site, core, block, ...extra] = process.argv.slice(2);
        assert.ok(site && core && /^[1-9]\d*$/.test(block) && !extra.length,
            'Usage: verify-mainnet-catalog.mjs <site-origin> <reviewed-core-address> <deployment-block>');
        const checked = await verifyMainnetCatalog(site, core, Number(block));
        console.log('Verified empty pre-smoke public catalog', checked);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
