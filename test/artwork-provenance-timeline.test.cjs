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

function jsonResponse(body, status = 200, contentRange = null) {
  return {
    ok: status < 400,
    status,
    headers: new Headers(contentRange === null ? {} : { 'Content-Range': contentRange }),
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
  contract_events: [{
    chain_id: 84532, event_name: 'ResaleListed',
    event_data: { tokenId: '900', seller: CURRENT_OWNER, price: '4000000000000000000' },
    block_number: 60, transaction_hash: TX, log_index: 6,
    indexed_at: '2026-07-19T15:00:00.000Z'
  }],
  v41_bids: [],
  v41_floor_history: [],
  v41_trust_signals: [],
  artwork_social_signals: []
};

async function withSupabaseFixtures(fixtures, callback, { maxRows = Infinity, sendCount = true } = {}) {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    const { parsed, table } = tableFromUrl(url);
    requests.push({ table, search: parsed.search, prefer: options.headers.Prefer });
    const fixture = fixtures[table];
    const matches = typeof fixture === 'function' ? fixture(parsed.searchParams) : fixture || [];
    const offset = Number(parsed.searchParams.get('offset') || '0');
    const limit = Math.min(maxRows, Number(parsed.searchParams.get('limit') || Infinity));
    const rows = matches.slice(offset, offset + limit);
    const total = sendCount && options.headers.Prefer === 'count=estimated' ? matches.length : '*';
    return jsonResponse(rows, 200, rows.length ? `${offset}-${offset + rows.length - 1}/${total}` : `*/${total}`);
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
    assert.equal(requests.filter(row => row.table === 'v41_settlements').length, 1);
    assert.equal(requests.filter(row => row.table === 'v41_resale_history').length, 1);

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

test('successful primary and resale history preserve exact wei precision in ETH amounts', async () => {
  const { default: handler } = await import('../src/api/routes/public/artwork-provenance.js');
  for (const [wei, eth] of [
    ['1', '0.000000000000000001'],
    ['123456789012', '0.000000123456789012'],
    ['1000000000000000001', '1.000000000000000001'],
    ['1000001000000000000', '1.000001'],
    ['0', '0']
  ]) {
    const fixtures = structuredClone(visibleFixtures);
    fixtures.v41_settlements[0].final_price = wei;
    fixtures.v41_resale_history[0].price = wei;
    await withSupabaseFixtures(fixtures, async requests => {
      const res = apiResponse();
      await handler({ method: 'GET', query: { chain_id: '84532', artwork_id: '77' }, headers: {} }, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.events.find(event => event.type === 'settlement_completed').final_price, eth);
      assert.equal(res.body.events.find(event => event.type === 'resale_completed').price, eth);
      for (const [table, column] of [
        ['v41_auctions', 'start_price'], ['v41_auction_endings', 'winning_bid'],
        ['v41_settlements', 'final_price'], ['v41_resale_history', 'price'], ['v41_resale_listings', 'price']
      ]) {
        const query = new URLSearchParams(requests.find(request => request.table === table).search);
        assert.ok(query.get('select').split(',').includes(`${column}::text`), `${table} preserves NUMERIC over JSON transport`);
      }
    });
  }
});

test('missing or invalid historical sale amounts remain unknown instead of becoming zero', async () => {
  const { default: handler } = await import('../src/api/routes/public/artwork-provenance.js');
  for (const invalid of [undefined, null, '', 'invalid', '-1', '1.5', '1e18', '0x1',
    true, {}, [1], Number.MAX_SAFE_INTEGER + 1, (2n ** 256n).toString()]) {
    const fixtures = structuredClone(visibleFixtures);
    fixtures.v41_settlements[0].final_price = invalid;
    fixtures.v41_resale_history[0].price = invalid;
    await withSupabaseFixtures(fixtures, async () => {
      const res = apiResponse();
      await handler({ method: 'GET', query: { chain_id: '84532', artwork_id: '77' }, headers: {} }, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.events.find(event => event.type === 'settlement_completed').final_price, null);
      assert.equal(res.body.events.find(event => event.type === 'resale_completed').price, null);
      assert.equal(res.body.events.find(event => event.type === 'resale_listed').price, '4');
      assert.equal(res.body.roles.current_owner_address, CURRENT_OWNER);
    });
  }
});

test('repricing and cancellation preserve each original listing price, date and transaction', async () => {
  const { default: handler } = await import('../src/api/routes/public/artwork-provenance.js');
  const secondHash = `0x${'cd'.repeat(32)}`;
  const second = { ...visibleFixtures.contract_events[0], block_number: 70,
    transaction_hash: secondHash, indexed_at: '2026-07-20T15:00:00.000Z',
    event_data: { tokenId: '900', seller: CURRENT_OWNER, price: '5000000000000000000' } };
  for (const active of [true, false]) {
    const fixtures = { ...visibleFixtures,
      contract_events: [...visibleFixtures.contract_events, second],
      // The projection retains original event metadata while its price changes.
      v41_resale_listings: active ? [{ ...visibleFixtures.v41_resale_listings[0], price: second.event_data.price }] : []
    };
    await withSupabaseFixtures(fixtures, async requests => {
      const res = apiResponse();
      await handler({ method: 'GET', query: { chain_id: '84532', artwork_id: '77' }, headers: {} }, res);
      assert.equal(res.statusCode, 200);
      const events = res.body.events.filter(event => event.type === 'resale_listed');
      assert.deepEqual(events.map(e => [e.price,e.transaction_hash,e.block_number,e.recorded_at]), [
        ['4',TX,60,'2026-07-19T15:00:00.000Z'],
        ['5',secondHash,70,'2026-07-20T15:00:00.000Z']
      ]);
      assert.equal(res.body.events.some(e => e.type === 'resale_cancelled'), false, 'eventless cancellation is not invented');
      const q = new URLSearchParams(requests.find(r => r.table === 'contract_events').search);
      assert.equal(q.get('event_name'), 'eq.ResaleListed');
      assert.equal(q.get('event_data->>tokenId'), 'eq.900');
      assert.equal(q.get('chain_id'), 'eq.84532');
      assert.equal(q.get('limit'), '201');
      assert.equal(q.get('order'), 'block_number.asc,log_index.asc');
      assert.equal(res.body.events.some(e => Object.hasOwn(e,'event_data')), false);
    });
  }
});

test('missing listing logs never turn mutable state into a historical event', async () => {
  const { default: handler } = await import('../src/api/routes/public/artwork-provenance.js');
  await withSupabaseFixtures({ ...visibleFixtures, contract_events: [] }, async () => {
    const res = apiResponse();
    await handler({ method: 'GET', query: { chain_id: '84532', artwork_id: '77' }, headers: {} }, res);
    assert.equal(res.statusCode,200);
    assert.equal(res.body.events.some(e => e.type === 'resale_listed'),false);
  });
});

test('history remains accurate under server row caps and when a proxy omits the count', async () => {
  const { default: handler } = await import('../src/api/routes/public/artwork-provenance.js');
  for (const [count, maxRows, sendCount] of [
    [199, 200, true], [200, 200, true], [201, 200, true], [201, 250, true],
    [7, 7, true], [8, 7, true], [200, 200, false], [201, 200, false], [8, 7, false]
  ]) {
    const listings = Array.from({length: count}, (_, i) => ({ ...visibleFixtures.contract_events[0], block_number: 60 + i }));
    await withSupabaseFixtures({ ...visibleFixtures, contract_events: listings }, async requests => {
      const res = apiResponse();
      await handler({ method: 'GET', query: { chain_id: '84532', artwork_id: '77' }, headers: {} }, res);
      const visible = Math.min(200, maxRows, count);
      assert.equal(res.body.complete, visible === count);
      assert.deepEqual(res.body.truncated_sources, visible < count ? ['listings'] : []);
      const retained = res.body.events.filter(event => event.type === 'resale_listed');
      assert.equal(retained.length, visible);
      assert.equal(retained.at(-1).block_number, 59 + visible);
      const reads = requests.filter(row => row.table === 'contract_events');
      assert.equal(reads.length, sendCount ? 1 : 2);
      assert.equal(reads[0].prefer, 'count=estimated');
      if (!sendCount) assert.equal(new URLSearchParams(reads[1].search).get('offset'), String(visible));
    }, { maxRows, sendCount });
  }
});

test('a capped timeline retains early events and resolves roles from the exact chain, work and token', async () => {
  const { default: handler } = await import('../src/api/routes/public/artwork-provenance.js');
  for (const chain of ['84532', '11155111']) {
    const fixture = { ...visibleFixtures, v41_artworks: [{ ...visibleFixtures.v41_artworks[0], chain_id: Number(chain) }] };
    const sales = Array.from({length: 203}, (_, i) => ({
      ...visibleFixtures.v41_resale_history[0], buyer: i === 202 ? CURRENT_OWNER : CREATOR,
      block_number: 50 + Math.floor(i / 2), log_index: i % 2
    }));
    const attempts = Array.from({length: 203}, (_, i) => ({
      ...visibleFixtures.v41_settlements[0], auction_id: String(500 + i), block_number: 40 + i,
      settlement_status: i === 202 ? 'completed' : 'defaulted', winner: i === 202 ? FIRST_COLLECTOR : CREATOR
    }));
    fixture.v41_settlements = query => {
      assert.equal(query.get('chain_id'), 'eq.' + chain);
      assert.equal(query.get('artwork_id'), 'eq.77');
      assert.equal(query.get('order'), 'block_number.asc,log_index.asc');
      if (query.get('select') === 'winner') {
        assert.equal(query.get('limit'), '1');
        assert.equal(query.get('settlement_status'), 'eq.completed');
        return attempts.filter(row => row.settlement_status === 'completed').slice(0, 1);
      }
      return attempts;
    };
    fixture.v41_resale_history = query => {
      assert.equal(query.get('chain_id'), 'eq.' + chain);
      assert.equal(query.get('token_id'), 'eq.900');
      if (query.get('select') === 'buyer') {
        assert.equal(query.get('limit'), '1');
        assert.equal(query.get('order'), 'block_number.desc,log_index.desc');
        return sales.slice(-1);
      }
      assert.equal(query.get('order'), 'block_number.asc,log_index.asc');
      return sales;
    };
    await withSupabaseFixtures(fixture, async requests => {
      const res = apiResponse();
      await handler({ method: 'GET', query: { chain_id: chain, artwork_id: '77' }, headers: {} }, res);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body.roles, {
        creator_address: CREATOR, first_collector_address: FIRST_COLLECTOR, current_owner_address: CURRENT_OWNER
      });
      assert.deepEqual(res.body.truncated_sources, ['settlements', 'resales']);
      assert.equal(res.body.events.filter(event => event.type === 'settlement_defaulted').length, 200);
      assert.equal(res.body.events.some(event => event.type === 'settlement_completed'), false);
      assert.equal(res.body.events.filter(event => event.type === 'resale_completed').length, 200);
      assert.equal(requests.filter(row => row.table === 'v41_settlements').length, 2);
      assert.equal(requests.filter(row => row.table === 'v41_resale_history').length, 2);
    }, { maxRows: 200 });
  }
});

test('a disappearing resale read does not publish an older owner from an incomplete timeline', async () => {
  const { default: handler } = await import('../src/api/routes/public/artwork-provenance.js');
  const fixture = { ...visibleFixtures, v41_resale_history: query => query.get('limit') === '1' ? []
    : Array.from({length: 201}, (_, i) => ({ ...visibleFixtures.v41_resale_history[0], block_number: 60 + i })) };
  await withSupabaseFixtures(fixture, async () => {
    const res = apiResponse();
    await handler({ method: 'GET', query: { chain_id: '84532', artwork_id: '77' }, headers: {} }, res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.error, 'NFT_OWNERSHIP_UNAVAILABLE');
    assert.equal(res.headers['cache-control'], 'private, no-store');
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

test('auction endings start before a slow resale read completes without publishing partial history', async () => {
  const {default: handler} = await import('../src/api/routes/public/artwork-provenance.js');
  const originalFetch = global.fetch, requests = [];
  let release;
  const slow = new Promise(resolve => {release = resolve;});
  global.fetch = async url => {
    const {table} = tableFromUrl(url); requests.push(table);
    if (table === 'v41_resale_history') await slow;
    return jsonResponse(visibleFixtures[table] || []);
  };
  try {
    const res = apiResponse();
    const work = handler({method:'GET',query:{chain_id:'84532',artwork_id:'77'},headers:{}},res);
    await new Promise(resolve => setImmediate(resolve));
    const earlyEndings = requests.includes('v41_auction_endings');
    assert.equal(res.body, null);
    release(); await work;
    assert.equal(earlyEndings, true);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.events.filter(event => event.type === 'auction_ended').length, 1);
  } finally {release(); global.fetch = originalFetch;}
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
