const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.SESSION_SECRET = 'test-session-secret';

const CREATOR = '0x1000000000000000000000000000000000000001';
const FIRST_COLLECTOR = '0x2000000000000000000000000000000000000002';
const CURRENT_OWNER = '0x3000000000000000000000000000000000000003';
const TX = `0x${'ab'.repeat(32)}`;

function jsonResponse(body, status = 200) {
  return {
    ok: status < 400,
    status,
    async text() {
      return JSON.stringify(body);
    }
  };
}

function apiResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
    end() {
      return this;
    }
  };
}

function tableFromUrl(url) {
  const parsed = new URL(url);
  return {
    parsed,
    table: (parsed.pathname.split('/rest/v1/')[1] || '').split('?')[0]
  };
}

const visibleFixtures = {
  v41_artworks: [{
    chain_id: 84532,
    artwork_id: '77',
    creator: CREATOR,
    metadata_uri: `data:application/json,${encodeURIComponent(JSON.stringify({
      name: 'Provenance Fixture',
      image: 'https://img.test/fixture.png'
    }))}`,
    minted: true,
    token_id: '900',
    canonical_floor: '2000000000000000000',
    active_auction_id: '',
    block_number: 10,
    transaction_hash: TX,
    log_index: 1,
    indexed_at: '2026-07-19T10:00:00.000Z',
    last_updated_at: '2026-07-19T10:00:00.000Z'
  }],
  artwork_moderation_visibility: [],
  v41_auctions: [{
    chain_id: 84532,
    auction_id: '500',
    artwork_id: '77',
    creator: CREATOR,
    status: 'settled',
    start_price: '1000000000000000000',
    duration: 86400,
    block_number: 20,
    transaction_hash: TX,
    log_index: 2,
    indexed_at: '2026-07-19T11:00:00.000Z'
  }],
  v41_auction_endings: [{
    chain_id: 84532,
    auction_id: '500',
    winner: FIRST_COLLECTOR,
    winning_bid: '2000000000000000000',
    settlement_deadline: '2026-07-20T12:00:00.000Z',
    block_number: 30,
    transaction_hash: TX,
    log_index: 3,
    indexed_at: '2026-07-19T12:00:00.000Z'
  }],
  v41_settlements: [{
    chain_id: 84532,
    auction_id: '500',
    artwork_id: '77',
    winner: FIRST_COLLECTOR,
    final_price: '2000000000000000000',
    token_id: '900',
    settlement_status: 'completed',
    block_number: 40,
    transaction_hash: TX,
    log_index: 4,
    indexed_at: '2026-07-19T13:00:00.000Z'
  }],
  v41_resale_history: [{
    chain_id: 84532,
    token_id: '900',
    seller: FIRST_COLLECTOR,
    buyer: CURRENT_OWNER,
    price: '3000000000000000000',
    block_number: 50,
    transaction_hash: TX,
    log_index: 5,
    indexed_at: '2026-07-19T14:00:00.000Z'
  }],
  v41_resale_listings: [{
    chain_id: 84532,
    token_id: '900',
    seller: CURRENT_OWNER,
    price: '4000000000000000000',
    active: true,
    block_number: 60,
    transaction_hash: TX,
    log_index: 6,
    indexed_at: '2026-07-19T15:00:00.000Z'
  }],
  v41_bids: [],
  v41_floor_history: [],
  v41_trust_signals: [],
  artwork_social_signals: []
};

async function withSupabaseFixtures(fixtures, callback) {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async url => {
    const { parsed, table } = tableFromUrl(url);
    requests.push({ table, search: parsed.search });
    return jsonResponse(fixtures[table] || []);
  };

  try {
    return await callback(requests);
  } finally {
    global.fetch = originalFetch;
  }
}

test('provenance endpoint returns a chain-scoped chronological lifecycle and canonical roles', async () => {
  const { default: handler } = await import('../src/api/routes/public/artwork-provenance.js');

  await withSupabaseFixtures(visibleFixtures, async requests => {
    const res = apiResponse();
    await handler({ method: 'GET', query: { chain_id: '84532', artwork_id: '77' }, headers: {} }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.source, 'v41_provenance_projection');
    assert.deepEqual(res.body.roles, {
      creator_address: CREATOR,
      first_collector_address: FIRST_COLLECTOR,
      current_owner_address: CURRENT_OWNER
    });
    assert.deepEqual(
      res.body.events.map(event => event.type),
      [
        'artwork_registered',
        'auction_started',
        'auction_ended',
        'settlement_completed',
        'resale_completed',
        'resale_listed'
      ]
    );
    assert.equal(res.body.complete, true);
    assert.match(res.headers['cache-control'], /^public,/);

    for (const request of requests) {
      assert.match(request.search, /chain_id=eq\.84532/, `${request.table} stays chain-scoped`);
    }
    assert.ok(
      decodeURIComponent(
        requests.find(request => request.table === 'v41_auction_endings')?.search || ''
      ).includes('auction_id=in.(500)'),
      'auction endings are limited to this artwork auction'
    );
  });
});

test('hidden artwork provenance is suppressed before lifecycle queries for public viewers', async () => {
  const { default: handler } = await import('../src/api/routes/public/artwork-provenance.js');
  const fixtures = {
    ...visibleFixtures,
    artwork_moderation_visibility: [{ hidden: true }]
  };

  await withSupabaseFixtures(fixtures, async requests => {
    const res = apiResponse();
    await handler({ method: 'GET', query: { chain_id: '84532', artwork_id: '77' }, headers: {} }, res);

    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, 'ARTWORK_UNAVAILABLE');
    assert.deepEqual(
      requests.map(request => request.table).sort(),
      ['artwork_moderation_visibility', 'v41_artworks'],
      'hidden history is not fetched for a public viewer'
    );
  });
});

test('direct artwork lookup uses exact projection queries instead of the capped public snapshot', async () => {
  const { default: handler } = await import('../src/api/routes/public/artworks.js');

  await withSupabaseFixtures(visibleFixtures, async requests => {
    const res = apiResponse();
    await handler({ method: 'GET', query: { id: 'v41:84532:77', limit: '1' }, headers: {} }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.count, 1);
    assert.equal(res.body.data[0].id, 'v41:84532:77');
    const artworkQuery = requests.find(request => request.table === 'v41_artworks')?.search || '';
    assert.match(artworkQuery, /chain_id=eq\.84532/);
    assert.match(artworkQuery, /artwork_id=eq\.77/);
    assert.doesNotMatch(artworkQuery, /order=last_updated_block\.desc/);
  });
});

test('route, browser client, and artwork UI keep the timeline indexer-backed', () => {
  const router = fs.readFileSync('api/[...route].js', 'utf8');
  const client = fs.readFileSync('supabase-client.js', 'utf8');
  const artwork = fs.readFileSync('src/entries/artwork.jsx', 'utf8');

  assert.match(router, /\['public\/artwork-provenance', publicArtworkProvenanceHandler\]/);
  assert.match(client, /backendRead\(`\/api\/public\/artwork-provenance/);
  assert.match(artwork, /className="provenance-timeline"/);
  assert.match(artwork, /role: 'First Collector'/);
  assert.match(artwork, /role: 'Owner'/);
  assert.doesNotMatch(
    fs.readFileSync('src/api/routes/public/artwork-provenance.js', 'utf8'),
    /getCurrentWalletAddress|artsoul_wallet/,
    'provenance must never fall back to a connected wallet'
  );
});
