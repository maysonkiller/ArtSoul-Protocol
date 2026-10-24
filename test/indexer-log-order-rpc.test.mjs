// Real scheduler, event leases, projection transactions and outbox in a disposable
// PostgreSQL database. Delays represent ordinary query/connection latency.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import pg from 'pg';
import { listIndexerMigrations } from '../scripts/apply-migrations.js';

const docker = (...args) => execFileSync('docker', args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000
}).trim();
let available = false;
try { available = docker('version', '--format', '{{.Server.Os}}') === 'linux'; } catch {}
const CREATOR = `0x${'1'.repeat(40)}`, FIRST = `0x${'2'.repeat(40)}`, SECOND = `0x${'3'.repeat(40)}`;
const CORE = `0x${'4'.repeat(40)}`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function event(name, block, data, logIndex = 0) {
    return { eventName: name, blockNumber: block, logIndex, eventData: data,
        transactionHash: `0x${block.toString(16).padStart(62, '0')}${logIndex.toString(16).padStart(2, '0')}`,
        timestamp: 1700000000000 + block };
}
const register = (id, block) => event('ArtworkRegistered', block,
    { artworkId: String(id), creator: CREATOR, metadataURI: JSON.stringify({ name: `Ordered artwork ${id}` }) });
const auction = (id, artworkId, block) => event('AuctionCreated', block,
    { auctionId: String(id), artworkId: String(artworkId), creator: CREATOR,
        startPrice: '1000', duration: '86400', endTime: '2000000000', chainId: '84532' });

test('production polling uses the same range cursor path for new and historical events', () => {
    const runner = fs.readFileSync('src/indexer/production-runner.js', 'utf8');
    const listener = fs.readFileSync('src/indexer/event-listener.js', 'utf8');
    assert.match(runner, /await this\._catchUpToSafeBlock\('leader_start'\)/);
    assert.match(runner, /await this\._catchUpToSafeBlock\('poll'\)/);
    assert.match(runner, /if \(this\.catchUpInProgress\)[\s\S]*return;/);
    assert.match(runner, /syncHistoricalEvents\(\s*lastIndexedBlock \+ 1, safeBlock/);
    assert.doesNotMatch(runner, /\.processEvent\(|\._processEvent\(|\.startListening\(/);
    const start = listener.slice(listener.indexOf('async startListening()'), listener.indexOf('async stopListening()'));
    assert.doesNotMatch(start, /setInterval|setTimeout|\.on\(/);
});

test('canonical log order preserves dependent projections and stops at the first failed event', {
    skip: available ? false : 'Disposable PostgreSQL requires Docker', timeout: 60000
}, async t => {
    const container = `artsoul-log-order-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    let created = false, pool;
    const priorRedis = process.env.REDIS_URL;
    process.env.REDIS_URL = ''; // No external queues/cache in this database fixture.
    t.after(async () => {
        if (pool) await pool.end();
        if (created) docker('rm', '-f', container);
        if (priorRedis === undefined) delete process.env.REDIS_URL;
        else process.env.REDIS_URL = priorRedis;
    });
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'warn', () => {});
    t.mock.method(console, 'error', () => {});
    const { default: Engine } = await import('../src/indexer/sync-engine.js');
    docker('run', '-d', '--name', container, '-e', 'POSTGRES_PASSWORD=local-order-fixture',
        '-e', 'POSTGRES_DB=artsoul', '-p', '127.0.0.1::5432', 'postgres:17');
    created = true;
    const endpoint = docker('port', container, '5432/tcp');
    assert.match(endpoint, /^127\.0\.0\.1:\d+$/);
    pool = new pg.Pool({ host: '127.0.0.1', port: Number(endpoint.split(':')[1]),
        database: 'artsoul', user: 'postgres', password: 'local-order-fixture', connectionTimeoutMillis: 1000 });
    for (let attempt = 0; ; attempt++) {
        try { await pool.query('SELECT 1'); await delay(100); await pool.query('SELECT 1'); break; }
        catch (error) { if (attempt >= 60) throw error; await delay(250); }
    }
    await pool.query('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;');
    for (const migration of listIndexerMigrations()) await pool.query(migration.sql);
    // Migration 001 creates the legacy table before 012's CREATE IF NOT EXISTS,
    // so fresh installs lack this documented runtime column. Keep the fixture
    // representative of the runtime schema without changing migrations here.
    await pool.query("ALTER TABLE indexer_state ADD COLUMN IF NOT EXISTS state_hash VARCHAR(66) NOT NULL DEFAULT '0x0'");
    await pool.query(`INSERT INTO indexer_state(chain_id,contract_address,last_indexed_block,last_confirmed_block,
        confirmation_depth,last_indexed_at,started_at) VALUES(84532,$1,100,100,3,now(),now())`, [CORE]);
    const db = { pool, query: async (sql, params) => (await pool.query(sql, params)).rows, isBackpressure: () => false };
    let supplied = [];
    const metrics = { recordBlockProcessed() {}, recordEventProcessed() {}, updateBackpressure() {}, updateConcurrency(value) { this.concurrency = value; } };
    const engine = new Engine(db, { chainId: 84532, queryAllHistoricalEvents: async () => supplied }, metrics);
    // Block fetching is unrelated to event order and cannot access live RPCs.
    engine._shouldSkipEmptyBlockHashBackfill = () => true;
    engine._storeBlockHashesForBlocks = async () => {};
    async function run(events) {
        supplied = events;
        const from = Math.min(...events.map(item => item.blockNumber));
        const to = Math.max(...events.map(item => item.blockNumber));
        return engine.syncHistoricalEvents(from, to, { currentBlock: to + 3 });
    }
    const rows = async (sql, params) => (await pool.query(sql, params)).rows;

    await t.test('slow registration commits before its auction and leaves the current mapping intact', async () => {
        const original = engine._handleArtworkRegisteredTx;
        engine._handleArtworkRegisteredTx = async function (...args) { await delay(60); return original.apply(this, args); };
        try { assert.equal(await run([register(36, 101), auction(70, 36, 102)]), 2); }
        finally { engine._handleArtworkRegisteredTx = original; }
        assert.deepEqual(await rows('SELECT active_auction_id::TEXT,last_updated_block::INT FROM v41_artworks WHERE artwork_id=36'),
            [{ active_auction_id: '70', last_updated_block: 102 }]);
        assert.equal(metrics.concurrency, 1);
        assert.equal((await rows("SELECT count(*)::INT AS n FROM event_processing_registry WHERE processing_status='completed'"))[0].n, 2);
    });

    await t.test('same-block bids follow log index and notify the actual previous bidder', async () => {
        const earlier = event('BidPlaced', 103, { auctionId: '70', bidder: FIRST, bidAmount: '2000', depositAmount: '100' }, 1);
        const later = event('BidPlaced', 103, { auctionId: '70', bidder: SECOND, bidAmount: '3000', depositAmount: '100' }, 2);
        const original = engine._handleBidPlacedTx;
        engine._handleBidPlacedTx = async function (item, client) { if (item.logIndex === 1) await delay(60); return original.call(this, item, client); };
        try { await run([later, earlier]); } finally { engine._handleBidPlacedTx = original; }
        assert.deepEqual(await rows('SELECT current_bid::TEXT,current_bidder FROM v41_auctions WHERE auction_id=70'),
            [{ current_bid: '3000', current_bidder: SECOND }]);
        assert.deepEqual(await rows("SELECT payload->>'recipient' AS recipient,payload->>'newBidder' AS bidder FROM outbox_events WHERE payload->>'type'='outbid'"),
            [{ recipient: FIRST, bidder: SECOND }]);
        assert.deepEqual(await rows('SELECT DISTINCT artwork_id::TEXT FROM v41_bids WHERE auction_id=70'), [{ artwork_id: '36' }]);
    });

    await t.test('an ending cannot overwrite settlement and lazy mint when its handler is slower', async () => {
        const ending = event('AuctionEnded', 104, { auctionId: '70', winner: SECOND, winningBid: '3000', settlementDeadline: '2000000100' });
        const settled = event('SettlementCompleted', 105, { auctionId: '70', artworkId: '36', winner: SECOND, finalPrice: '3000', tokenId: '7' });
        const original = engine._handleAuctionEndedTx;
        engine._handleAuctionEndedTx = async function (...args) { await delay(60); return original.apply(this, args); };
        try { await run([ending, settled]); } finally { engine._handleAuctionEndedTx = original; }
        assert.deepEqual(await rows('SELECT status,token_id::TEXT FROM v41_auctions WHERE auction_id=70'), [{ status: 'settled', token_id: '7' }]);
        assert.deepEqual(await rows('SELECT minted,token_id::TEXT,canonical_floor::TEXT,active_auction_id FROM v41_artworks WHERE artwork_id=36'),
            [{ minted: true, token_id: '7', canonical_floor: '3000', active_auction_id: null }]);
    });

    await t.test('a slow listing cannot reactivate a completed resale', async () => {
        const listed = event('ResaleListed', 106, { tokenId: '7', seller: SECOND, price: '4000' });
        const sold = event('ResaleCompleted', 107, { tokenId: '7', seller: SECOND, buyer: FIRST, price: '4000', royaltyAmount: '220', platformFee: '40' });
        const original = engine._handleResaleListedTx;
        engine._handleResaleListedTx = async function (...args) { await delay(60); return original.apply(this, args); };
        try { await run([listed, sold]); } finally { engine._handleResaleListedTx = original; }
        assert.deepEqual(await rows('SELECT active,last_updated_block::INT FROM v41_resale_listings WHERE token_id=7'), [{ active: false, last_updated_block: 107 }]);
        assert.deepEqual(await rows('SELECT buyer FROM v41_resale_history WHERE token_id=7'), [{ buyer: FIRST }]);
    });

    await t.test('failure on the last event of a batch leaves every later event unclaimed and retry applies the prefix once', async () => {
        const prefix = Array.from({ length: 49 }, (_, n) => register(1000 + n, 200 + n));
        const failing = register(2000, 249);
        const suffix = [auction(700, 2000, 250), event('BidPlaced', 251,
            { auctionId: '700', bidder: FIRST, bidAmount: '2000', depositAmount: '100' })];
        const events = [...prefix, failing, ...suffix];
        const before = await engine.getIndexerState();
        const original = engine._handleArtworkRegisteredTx;
        let failOnce = true;
        engine._handleArtworkRegisteredTx = async function (item, client) {
            if (item.eventData.artworkId === '2000' && failOnce) { failOnce = false; throw new Error('Fixture registration failure'); }
            return original.call(this, item, client);
        };
        try {
            await assert.rejects(run(events), error => error.code === 'INDEXER_RANGE_INCOMPLETE' && error.processedCount === 49 && error.failedCount === 1);
            const after = await engine.getIndexerState();
            for (const key of ['last_indexed_block', 'last_confirmed_block', 'state_hash', 'total_events_indexed']) assert.equal(after[key], before[key]);
            assert.deepEqual(await rows('SELECT processing_status FROM event_processing_registry WHERE block_number=249'), [{ processing_status: 'failed' }]);
            assert.equal((await rows('SELECT count(*)::INT AS n FROM event_processing_registry WHERE block_number>=250'))[0].n, 0);
            assert.equal((await rows('SELECT count(*)::INT AS n FROM v41_auctions WHERE auction_id=700'))[0].n, 0);
            assert.equal(await run(events), 52);
        } finally { engine._handleArtworkRegisteredTx = original; }
        assert.deepEqual(await rows('SELECT active_auction_id::TEXT FROM v41_artworks WHERE artwork_id=2000'), [{ active_auction_id: '700' }]);
        assert.deepEqual(await rows('SELECT current_bid::TEXT FROM v41_auctions WHERE auction_id=700'), [{ current_bid: '2000' }]);
        for (const table of ['contract_events', 'event_processing_registry']) {
            assert.equal((await rows(`SELECT count(*)::INT AS n FROM ${table} WHERE block_number BETWEEN 200 AND 251`))[0].n, 52);
        }
        assert.equal((await rows("SELECT count(*)::INT AS n FROM outbox_events WHERE aggregate_type='artwork' AND aggregate_id::NUMERIC BETWEEN 1000 AND 2000"))[0].n, 50);
        assert.equal((await rows('SELECT count(*)::INT AS n FROM v41_public_metric_events WHERE block_number BETWEEN 200 AND 251'))[0].n, 50);
        assert.equal((await engine.getIndexerState()).last_indexed_block, 251);
    });

    await t.test('a 250-event ordered catch-up keeps every projection without duplicate outbox writes', async () => {
        const events = Array.from({ length: 250 }, (_, n) => register(5000 + n, 300 + n));
        const started = performance.now();
        assert.equal(await run(events), 250);
        t.diagnostic(`250 real PostgreSQL events, claims and outbox writes: ${Math.round(performance.now() - started)} ms (local fixture, not production SLA).`);
        assert.equal((await rows('SELECT count(*)::INT AS n FROM v41_artworks WHERE artwork_id BETWEEN 5000 AND 5249'))[0].n, 250);
        assert.equal((await rows("SELECT count(*)::INT AS n FROM outbox_events WHERE aggregate_type='artwork' AND aggregate_id::NUMERIC BETWEEN 5000 AND 5249"))[0].n, 250);
        assert.equal((await engine.getIndexerState()).last_confirmed_block, 549);
    });
});
