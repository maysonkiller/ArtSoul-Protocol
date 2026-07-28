const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION_PATH = path.join(
  ROOT,
  'src',
  'indexer',
  'migrations',
  '015_public_metrics_projection.sql'
);

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('migration 015 maintains a precomputed, chain-scoped and reorg-safe aggregate', () => {
  const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');

  for (const table of [
    'v41_public_metric_participants',
    'v41_public_metric_events',
    'v41_public_metrics'
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} FORCE ROW LEVEL SECURITY;`));
    assert.match(sql, new RegExp(`REVOKE ALL ON public\\.${table} FROM PUBLIC, anon, authenticated;`));
    assert.match(sql, new RegExp(`GRANT ALL ON public\\.${table} TO service_role;`));
  }

  assert.match(sql, /PRIMARY KEY \(chain_id, transaction_hash, log_index\)/);
  assert.match(sql, /REFERENCES public\.contract_events \(chain_id, transaction_hash, log_index\)[\s\S]*ON DELETE CASCADE/);
  assert.match(sql, /ON CONFLICT \(chain_id, transaction_hash, log_index\) DO NOTHING/);
  assert.match(sql, /CREATE TRIGGER v41_public_metric_event_insert/);
  assert.match(sql, /CREATE TRIGGER v41_public_metric_event_delete/);
  assert.doesNotMatch(sql, /\bLOOP\b|\bWHILE\b/i, 'metric maintenance uses no unbounded loops');
});

test('the indexer maps only canonical completed lifecycle events into public metrics', async () => {
  const { default: IndexerSyncEngine } = await import(pathToFileURL(
    path.join(ROOT, 'src', 'indexer', 'sync-engine.js')
  ).href);
  const engine = new IndexerSyncEngine({}, { chainId: 84532 }, null);
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ inserted: true }] };
    }
  };
  const base = {
    transactionHash: `0x${'1'.repeat(64)}`,
    logIndex: 2,
    blockNumber: 100,
    timestamp: 1700000000000
  };

  const fixtures = [
    {
      eventName: 'ArtworkRegistered',
      eventData: { creator: '0x1111111111111111111111111111111111111111' },
      expected: ['artist', '0x1111111111111111111111111111111111111111', 0, '0']
    },
    {
      eventName: 'AuctionEnded',
      eventData: { winner: '0x0000000000000000000000000000000000000000' },
      expected: [null, null, 1, '0']
    },
    {
      eventName: 'SettlementCompleted',
      eventData: {
        winner: '0x2222222222222222222222222222222222222222',
        finalPrice: 123n
      },
      expected: ['collector', '0x2222222222222222222222222222222222222222', 1, '123']
    },
    {
      eventName: 'SettlementDefaulted',
      eventData: {},
      expected: [null, null, 1, '0']
    },
    {
      eventName: 'ResaleCompleted',
      eventData: {
        buyer: '0x3333333333333333333333333333333333333333',
        price: 456n
      },
      expected: ['collector', '0x3333333333333333333333333333333333333333', 0, '456']
    }
  ];

  for (const fixture of fixtures) {
    calls.length = 0;
    assert.equal(await engine._recordPublicMetricEventTx({ ...base, ...fixture }, client), true);
    assert.equal(calls.length, 1);
    const params = calls[0].params;
    assert.deepEqual(
      [params[4], params[5], params[6], params[7]],
      fixture.expected
    );
    assert.equal(params[0], '84532');
    assert.equal(params[3], fixture.eventName);
  }

  calls.length = 0;
  assert.equal(await engine._recordPublicMetricEventTx({
    ...base,
    eventName: 'AuctionEnded',
    eventData: { winner: '0x4444444444444444444444444444444444444444' }
  }, client), false);
  assert.equal(calls.length, 0, 'winner-bearing AuctionEnded waits for settlement outcome');

  assert.equal(await engine._recordPublicMetricEventTx({
    ...base,
    eventName: 'BidPlaced',
    eventData: {}
  }, client), false);
  assert.equal(calls.length, 0, 'bids do not inflate headline public metrics');
});

test('homepage communicates the A11 promise, exactly three steps and four cached metrics', () => {
  const html = read('index.html');
  const homepage = read('src/entries/index.js');
  const api = read('src/api/routes/public/artworks.js');
  const client = read('supabase-client.js');

  assert.match(html, /Collector demand comes before minting\./);
  assert.match(html, /Collector-Led Curation/);
  assert.match(html, /not minting volume/);

  const howStrip = html.match(/<ol class="home-how-strip">([\s\S]*?)<\/ol>/)?.[1] || '';
  assert.equal((howStrip.match(/<li>/g) || []).length, 3);
  assert.match(howStrip, /Publish[\s\S]*Build Collector Demand[\s\S]*Settle and Mint/);

  for (const metric of [
    'artists_onboarded',
    'auctions_completed',
    'unique_collectors',
    'settled_volume_eth'
  ]) {
    assert.match(html, new RegExp(`data-public-metric="${metric}"`));
  }

  assert.match(api, /v41_public_metrics/);
  assert.match(api, /chain_id=eq\.84532&limit=1/);
  assert.match(api, /public_metrics: isDirectArtworkLookup \? null : publicMetrics/);
  assert.match(client, /rows\.public_metrics = result\.public_metrics \|\| null/);
  assert.match(homepage, /renderHomepageMetrics\(artworks\?\.public_metrics\)/);
  assert.doesNotMatch(homepage, /fetch\([^)]*public.metrics/i);
});
