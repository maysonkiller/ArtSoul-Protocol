import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { verifyMainnetCatalog } from '../scripts/verify-mainnet-catalog.mjs';
import { loadMonitorConfig } from '../scripts/check-indexer-health.mjs';
import { buildChainStatus } from '../src/api/routes/public/indexer-status.js';

const core = '0x' + 'ab'.repeat(20);
const deployed = 160;
const tables = ['v41_artworks', 'v41_auctions', 'v41_bids', 'v41_settlements',
    'v41_resale_listings', 'v41_resale_history', 'v41_floor_history', 'v41_trust_signals',
    'artwork_social_signals', 'artwork_moderation_visibility'];

function fixture() {
    const rows = Object.fromEntries(tables.map(name => [name, 0]));
    return {
        status: { success: true, warnings: [], chains: [{
            chain_id: 8453, contract_address: core, status: 'running', liveness: 'healthy',
            last_indexed_at: new Date().toISOString(), stale_projection: false,
            last_confirmed_block: 171, last_indexed_block: 173, confirmation_depth: 3, rows
        }] },
        catalog: { success: true, warnings: [], data: [], count: 0, suppressed_artwork_ids: [],
            diagnostics: Object.fromEntries(tables.map(name => [name, {sampledRows: 0, rowsByChain: {}}])),
            public_metrics: { chain_id: 8453, artists_onboarded: 0, auctions_completed: 0,
                unique_collectors: 0, settled_volume_eth: '0.0000' } }
    };
}

test('pre-smoke check reads the ordinary public catalog after verifying its mainnet indexer', async t => {
    let current = fixture();
    let catalogStatus = 200;
    let worker;
    const calls = [];
    const server = createServer((req, res) => {
        calls.push([req.method, req.url]);
        if (req.url === '/api/public/indexer-status') {
            res.writeHead(200, {'content-type': 'application/json'});
            return res.end(JSON.stringify(current.status));
        }
        if (req.url === '/api/public/artworks') {
            res.writeHead(catalogStatus, {'content-type': 'application/json'});
            return res.end(JSON.stringify(current.catalog));
        }
        if (req.url === '/health') {
            res.writeHead(200, {'content-type': 'application/json'});
            return res.end(JSON.stringify(worker));
        }
        res.writeHead(404).end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const verify = () => verifyMainnetCatalog(origin, core, deployed);

    assert.deepEqual(await verify(), {chainId: 8453, core, confirmedBlock: 171, indexedBlock: 173});
    assert.deepEqual(calls.splice(0), [['GET', '/api/public/indexer-status'], ['GET', '/api/public/artworks']]);

    await t.test('the cutover CLI reads fresh worker health for the reviewed Core and public checkpoint', async () => {
        worker = {status: 'healthy', timestamp: new Date().toISOString(), database: {healthy: true},
            indexer: {chainId: '8453', contractAddress: core.toUpperCase().replace('0X','0x'), confirmationDepth: 3,
                lastConfirmedBlock: '172', lastIndexedBlock: '175', currentBlock: 178, blocksBehind: 3,
                isSynced: true, unresolvedErrors: 0}, metrics: {rpcErrorsLastMinute: 0}};
        const env = {...process.env, ARTSOUL_INDEXER_HEALTH_URL: origin+'/health', ARTSOUL_MONITOR_EXPECTED_CHAIN_ID: '8453',
            ARTSOUL_MONITOR_EXPECTED_CONFIRMATION_DEPTH: '3', ARTSOUL_MONITOR_EXPECTED_CORE_ADDRESS: core};
        const command = ['scripts/verify-mainnet-catalog.mjs', origin, core, String(deployed), '--worker-health'];
        const {stdout} = await promisify(execFile)(process.execPath, command, {env, windowsHide: true});
        assert.match(stdout, /rpcHead: 178/);
        assert.deepEqual(calls.splice(0), [['GET','/api/public/indexer-status'],['GET','/api/public/artworks'],['GET','/health']]);
        const workerMonitor = loadMonitorConfig(env);
        const initial = {...worker.indexer};
        for (const [invalid, failure] of [
            [{chainId: 84532}, /CHAIN_ID/],
            [{contractAddress: '0x'+'cd'.repeat(20)}, /CORE_ADDRESS/],
            [{lastConfirmedBlock: 170}, /BLOCK_CURSORS/],
            [{lastConfirmedBlock: 171, lastIndexedBlock: 172, currentBlock: 175}, /BLOCK_CURSORS/],
            [{lastIndexedBlock: 170}, /BLOCK_CURSORS/],
            [{currentBlock: 190}, /BLOCK_CURSORS/],
            [{currentBlock: null}, /BLOCK_CURSORS/],
            [{confirmationDepth: 2}, /CONFIRMATION_DEPTH/],
            [{unresolvedErrors: 1}, /UNRESOLVED_ERRORS/]
        ]) {
            worker.indexer = {...initial, ...invalid};
            await assert.rejects(verifyMainnetCatalog(origin, core, deployed, {workerMonitor}), failure);
        }
        worker.indexer = initial;
        current.status.chains[0].confirmation_depth = 2;
        await assert.rejects(verifyMainnetCatalog(origin, core, deployed, {workerMonitor}), /reviewed worker confirmation depth/);
        current = fixture();
        calls.length = 0;
    });

    await t.test('the real public indexer formatter cannot establish mainnet readiness without a running deployment', async () => {
        current = fixture();
        current.status.chains = buildChainStatus([], {});
        await assert.rejects(verify(), /sole product chain|Unexpected indexer Core|projection is unavailable/);
        assert.deepEqual(calls.splice(0), [['GET', '/api/public/indexer-status']]);
    });

    for (const [name, change, reason] of [
        ['unexpected deployment', f => { f.status.chains[0].contract_address = '0x' + 'cd'.repeat(20); }, /Unexpected indexer Core/],
        ['pre-deployment watermark', f => { f.status.chains[0].last_confirmed_block = 159; }, /deployment block/],
        ['stale timestamp', f => { f.status.chains[0].last_indexed_at = '2000-01-01T00:00:00Z'; }, /timestamp/],
        ['outstanding bids', f => { f.status.chains[0].rows.v41_bids = 1; }, /indexed v41_bids/],
        ['testnet gallery card', f => { f.catalog.data.push({chain_id: 84532, artwork_id: '7'}); f.catalog.count = 1; }, /public catalog contains artwork/],
        ['hidden card', f => { f.catalog.suppressed_artwork_ids.push('v41:84532:7'); }, /hidden artwork/],
        ['legacy floor', f => { f.catalog.diagnostics.v41_floor_history = {sampledRows: 1, rowsByChain: {84532: 1}}; }, /v41_floor_history/],
        ['missing projection read', f => { delete f.catalog.diagnostics.v41_trust_signals; }, /v41_trust_signals/],
        ['legacy metrics', f => { f.catalog.public_metrics.chain_id = 84532; }, /mainnet scope/],
        ['missing mainnet evidence', f => { f.catalog.public_metrics = null; }, /mainnet scope/],
        ['nonzero activity', f => { f.catalog.public_metrics.settled_volume_eth = '0.000000000000000001'; }, /settled volume/],
        ['partial projection', f => { f.catalog.warnings.push({table: 'v41_artworks'}); }, /complete successful projection/]
    ]) {
        await t.test(name, async () => {
            current = fixture();
            change(current);
            await assert.rejects(verify(), reason);
        });
    }

    current = fixture();
    catalogStatus = 503;
    await assert.rejects(verify(), /HTTP 503/);
});
