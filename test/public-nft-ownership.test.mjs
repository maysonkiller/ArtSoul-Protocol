import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import artworks, { readVisibleArtworkCard, readVisibleArtworkCards } from '../src/api/routes/public/artworks.js';
import provenance from '../src/api/routes/public/artwork-provenance.js';

const address = n => `0x${String(n).repeat(40)}`;
const CORE = address('a'), NFT = address('b'), CREATOR = address('1'), FIRST = address('2'), BUYER = address('3'), OWNER = address('4');
const hash = n => `0x${n.toString(16).padStart(64, '0')}`;
const env = { SUPABASE_URL: 'https://cards.example.test', SUPABASE_SERVICE_ROLE_KEY: 'offline-card-fixture',
  ARTSOUL_NFT_OWNERSHIP_ENABLED: 'true', ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA: CORE,
  ARTSOUL_NFT_ADDRESS_BASE_SEPOLIA: NFT, ARTSOUL_NFT_OWNERSHIP_CORE_CODE_HASH: hash(1),
  ARTSOUL_NFT_OWNERSHIP_NFT_CODE_HASH: hash(2) };
const boundary = () => ({ indexed_through: 120, confirmed_through: 115, covered_hash: hash(120), state_revision: '1234' });
const transfer = () => ({ block_number: 110, log_index: 9, transaction_hash: hash(110),
  recorded_at: '2026-11-01T00:00:00+00:00', from_address: BUYER, to_address: OWNER });
const proof = () => ({ artwork_id: '77', token_id: '7', verified: true, first_collector_address: FIRST,
  current_owner_address: OWNER, latest_transfer: transfer(), active_listing: null, ...boundary() });
const lifecycle = () => [
  ['ArtworkRegistered', 10, { artworkId: '77', creator: CREATOR, metadataURI: 'ipfs://fixture' }],
  ['AuctionCreated', 11, { artworkId: '77', auctionId: '9', creator: CREATOR, startPrice: '1000000000000000000', duration: '86400' }],
  ['AuctionEnded', 19, { auctionId: '9', winner: FIRST, winningBid: '2000000000000000000', settlementDeadline: '1793563200' }],
  ['SettlementCompleted', 20, { artworkId: '77', auctionId: '9', tokenId: '7', winner: FIRST, finalPrice: '2000000000000000000' }],
  ['ResaleCompleted', 30, { tokenId: '7', seller: FIRST, buyer: BUYER, price: '3000000000000000000' }]
].map(([event_name, block_number, event_data]) => ({ chain_id: 84532, contract_address: CORE,
  event_name, event_data, block_number, log_index: 5, transaction_hash: hash(block_number), indexed_at: '2026-10-01T00:00:00Z' }));
const fixture = () => ({
  v41_artworks: [{ chain_id: 84532, artwork_id: '77', token_id: '7', creator: CREATOR, minted: true,
    canonical_floor: '2000000000000000000', active_auction_id: '', metadata_uri: 'data:application/json,%7B%22name%22%3A%22Test%22%7D',
    block_number: 10, last_updated_block: 20, transaction_hash: hash(10), indexed_at: '2026-10-01T00:00:00Z' }],
  v41_auctions: [], v41_bids: [], v41_floor_history: [], v41_trust_signals: [], artwork_social_signals: [],
  artwork_moderation_visibility: [], v41_public_metrics: [], v41_auction_endings: [], contract_events: [],
  profiles: [CREATOR, FIRST, BUYER, OWNER].map((wallet_address, i) => ({ wallet_address, username: `artist${i}`, avatar_url: null })),
  v41_settlements: [{ chain_id: 84532, artwork_id: '77', auction_id: '9', token_id: '7', settlement_status: 'completed',
    winner: FIRST, final_price: '2000000000000000000', block_number: 20, log_index: 4, transaction_hash: hash(20) }],
  v41_resale_history: [{ chain_id: 84532, token_id: '7', seller: FIRST, buyer: BUYER,
    price: '3000000000000000000', block_number: 30, log_index: 5, transaction_hash: hash(30) }],
  v41_resale_listings: [{ chain_id: 84532, token_id: '7', seller: BUYER, active: true, price: '4000000000000000000', last_updated_block: 40 }]
});

test('public handlers send nothing before the whole-read retry guard completes', async () => {
  for (const file of ['artworks.js','artwork-provenance.js']) {
    const source = readFileSync(new URL(`../src/api/routes/public/${file}`, import.meta.url), 'utf8');
    const scope = {
      allowMethods: () => true, PUBLIC_CHAIN_IDS: new Set([84532]), CANONICAL_PUBLIC_CHAIN_ID: 84532,
      PROJECTION_CACHE_MS: 30000, parseDirectLookup: () => null, protocolId: () => '', validateArtworkId: () => null,
      getProjectionSnapshot: async () => ({ cards: [], bids: new Map(), diagnostics: {}, warnings: [], publicMetrics: null, ownership: null }),
      filterCards: cards => cards, recheckNftOwnership: async () => null,
      readWithNftOwnershipRetry: async operation => {
        await operation();
        throw Object.assign(new Error('Configuration changed after the retry completed'), { statusCode: 503, code: 'NFT_OWNERSHIP_UNAVAILABLE' });
      },
      sendError: (res, error) => res.status(error.statusCode).json({ error: error.code })
    };
    vm.runInNewContext(source.slice(source.indexOf('export default async function handler'))
      .replace('export default async function handler', 'this.handler = async function handler'), scope);
    const res = response(), sent = [];
    res.json = function(body) { sent.push({ status: this.statusCode, body }); return this; };
    await scope.handler(request(), res);
    assert.equal(sent.length, 1, file);
    assert.equal(sent[0].status, 503, file); assert.equal(sent[0].body.error, 'NFT_OWNERSHIP_UNAVAILABLE');
    assert.equal(res.headers['cache-control'], 'private, no-store');
  }
});
const response = () => ({ statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; },
  setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, json(body) { this.body = body; return this; }, end() {} });
const request = (query = {}) => ({ method: 'GET', headers: {}, query });

test('public NFT consumers use one verified history across cards, filters, saved items and timelines', async t => {
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]])), originalFetch = globalThis.fetch;
  let rows, owners, marker, calls, afterRead, history;
  t.beforeEach(() => {
    Object.assign(process.env, env); rows = fixture(); owners = [proof()]; marker = boundary(); calls = []; afterRead = null;
    history = { transfers: [{ ...transfer(), block_number: 30, log_index: 4, transaction_hash: hash(30), from_address: FIRST, to_address: BUYER }, transfer()], complete: true,
      lifecycle: lifecycle(), lifecycle_available: true, lifecycle_complete: true };
    globalThis.fetch = async (url, options = {}) => {
      const parsed = new URL(url); assert.equal(parsed.origin, env.SUPABASE_URL);
      const name = parsed.pathname.split('/rest/v1/')[1]; calls.push({ name, query: parsed.searchParams, body: options.body && JSON.parse(options.body) });
      const body = calls.at(-1).body;
      let result;
      if (name === 'rpc/read_verified_nft_boundary') result = [{ ...marker }];
      else if (name === 'rpc/read_verified_nft_cards') result = body.p_artwork_ids.map(id => ({ ...owners.find(row => row.artwork_id === id), ...marker }));
      else if (name === 'rpc/read_verified_nft_history') result = { ...history, ownership: { ...owners[0], ...marker } };
      else if (name === 'rpc/read_public_search_cards') result = { artworks: rows.v41_artworks, metadata: [{ name: 'Test' }],
        auctions: rows.v41_auctions, settlements: rows.v41_settlements, listings: rows.v41_resale_listings,
        resales: rows.v41_resale_history, signals: [{ like: 0, would_buy: 0, watching: 0 }] };
      else {
        assert.ok(Object.hasOwn(rows, name), `Unexpected fixture request: ${name}`);
        result = rows[name].filter(row => [...parsed.searchParams].every(([key, value]) => {
          if (value.startsWith('eq.')) return String(row[key]) === value.slice(3);
          if (value.startsWith('in.(')) return value.slice(4, -1).split(',').includes(String(row[key]));
          return true;
        }));
      }
      const encoded = JSON.stringify(result);
      await afterRead?.(name);
      return new Response(encoded, { headers: { 'Content-Type': 'application/json' } });
    };
  });
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const cardRequest = async query => { const res = response(); await artworks(request(query), res); return res; };
  const historyRequest = async () => { const res = response(); await provenance(request({ chain_id: '84532', artwork_id: '77' }), res); return res; };
  const assertOwner = card => {
    assert.equal(card.current_owner_address, OWNER); assert.equal(card.auction_winner_address, FIRST);
    assert.equal(card.ownership_status, 'verified'); assert.equal(card.resale_seller, null);
    assert.notEqual(card.status, 'for_sale'); assert.equal(card.sale_price, '0'); assert.equal(card.canonical_floor, '2');
  };

  for (const size of [1, 20, 200]) await t.test(`a stable ${size}-work feed stays within two ownership proof passes`, async () => {
    rows.v41_artworks = Array.from({ length: size }, (_, i) => ({ ...rows.v41_artworks[0],
      artwork_id: String(i + 1), token_id: String(i + 1) }));
    owners = rows.v41_artworks.map(row => ({ ...proof(), artwork_id: row.artwork_id, token_id: row.token_id }));
    const res = await cardRequest({});
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.count, Math.min(size, 100));
    const batches = calls.filter(call => call.name === 'rpc/read_verified_nft_cards');
    assert.ok(batches.length <= 2 * Math.ceil(size / 20), 'no intermediate full proof before the response guard');
    assert.ok(batches.every(call => call.body.p_artwork_ids.length <= 20));
    assert.equal(calls.filter(call => call.name === 'rpc/read_verified_nft_boundary').length, 1);
  });

  for (const surface of ['direct', 'feed', 'Saved', 'search']) await t.test(`${surface} rejects a changed owner under an unchanged boundary`, async () => {
    afterRead = name => {
      if (name !== 'rpc/read_verified_nft_cards') return;
      afterRead = null;
      owners[0].current_owner_address = CREATOR;
      owners[0].latest_transfer.to_address = CREATOR;
    };
    if (surface === 'Saved' || surface === 'search') {
      await assert.rejects(surface === 'Saved'
        ? readVisibleArtworkCard(84532, '77')
        : readVisibleArtworkCards(84532, ['77'], CORE), error => error.code === 'NFT_OWNERSHIP_UNAVAILABLE');
    } else {
      const res = await cardRequest(surface === 'direct' ? { id: '77' } : {});
      assert.equal(res.statusCode, 503);
      assert.equal(res.body.error, 'NFT_OWNERSHIP_UNAVAILABLE');
      assert.equal(res.headers['cache-control'], 'private, no-store');
    }
    assert.equal(calls.filter(call => call.name === 'rpc/read_verified_nft_boundary').length, 1, 'same-boundary mutation cannot retry');
  });

  await t.test('direct card uses transfer owner, keeps First Collector and suppresses stale listing', async () => {
    const res = await cardRequest({ id: '77' }); assert.equal(res.statusCode, 200); assertOwner(res.body.data[0]);
    assert.equal(res.headers['cache-control'], 'private, no-store');
    assert.deepEqual(Object.keys(res.body.data[0].ownership_profiles).sort(), [CREATOR, FIRST, OWNER].sort());
    assert.equal(calls[0].name, 'rpc/read_verified_nft_boundary');
    for (const call of calls.filter(call => call.name.startsWith('v41_'))) {
      for (const field of (call.query.get('select') || '').split(',')) {
        assert.ok(!['artwork_id', 'token_id', 'auction_id', 'active_auction_id'].includes(field), `Numeric protocol ID: ${field}`);
      }
    }
  });
  await t.test('owner filter includes recipient and removes former resale buyer', async () => {
    const current = await cardRequest({ owner: OWNER }); assert.equal(current.statusCode, 200); assert.equal(current.body.count, 1);
    assertOwner(current.body.data[0]);
    const former = await cardRequest({ owner: BUYER }); assert.equal(former.body.count, 0);
    assert.equal(former.headers['cache-control'], 'private, no-store');
  });
  await t.test('Saved and search hydration share the exact card ownership rule', async () => {
    assertOwner(await readVisibleArtworkCard(84532, '77'));
    assertOwner((await readVisibleArtworkCards(84532, ['77'], CORE))[0]);
  });
  await t.test('warm direct/feed caches never resurrect an owner after a new transfer', async () => {
    await cardRequest({ id: '77' }); await cardRequest({});
    owners[0].current_owner_address = CREATOR; owners[0].latest_transfer.to_address = CREATOR;
    for (const query of [{ id: '77' }, {}]) {
      const res = await cardRequest(query); assert.equal(res.statusCode, 200); assert.equal(res.body.data[0].current_owner_address, CREATOR);
    }
  });
  await t.test('unknown membership does not fall back to settlement, resale or listing addresses', async () => {
    Object.assign(owners[0], { token_id: null, verified: false, current_owner_address: null, first_collector_address: null, latest_transfer: null });
    const res = await cardRequest({ id: '77' }); assert.equal(res.statusCode, 200);
    assert.equal(res.body.data[0].current_owner_address, null); assert.equal(res.body.data[0].auction_winner_address, null);
    assert.equal(res.body.data[0].resale_seller, null); assert.equal(res.body.data[0].ownership_status, 'unavailable');
    const filtered = await cardRequest({ owner: OWNER }); assert.equal(filtered.statusCode, 503);
    assert.equal(filtered.headers['cache-control'], 'private, no-store');
  });
  await t.test('full feed sample cannot claim to be a complete owner collection', async () => {
    rows.v41_artworks = Array.from({ length: 200 }, (_, i) => ({ ...rows.v41_artworks[0], artwork_id: String(i + 1) }));
    owners = rows.v41_artworks.map(row => ({ ...proof(), artwork_id: row.artwork_id }));
    const res = await cardRequest({ owner: OWNER }); assert.equal(res.statusCode, 503);
  });
  await t.test('profile read overlapping recovery fails without a cached success', async () => {
    afterRead = name => { if (name === 'profiles') marker.state_revision = String(Number(marker.state_revision) + 1); };
    const res = await cardRequest({ id: '77' }); assert.equal(res.statusCode, 503);
    assert.equal(res.body.error, 'NFT_OWNERSHIP_UNAVAILABLE'); assert.equal(res.headers['cache-control'], 'private, no-store');
  });
  await t.test('search rechecks ownership after its final visibility query', async () => {
    let visibilityReads = 0;
    afterRead = name => { if (name === 'artwork_moderation_visibility' && ++visibilityReads === 1) marker.state_revision = '1235'; };
    await assert.rejects(readVisibleArtworkCards(84532, ['77'], CORE), error => error.code === 'NFT_OWNERSHIP_UNAVAILABLE');
  });
  await t.test('flag changes during the public projection fail closed', async () => {
    afterRead = name => { if (name === 'profiles') process.env.ARTSOUL_NFT_OWNERSHIP_ENABLED = 'false'; };
    const res = await cardRequest({ id: '77' }); assert.equal(res.statusCode, 503);
  });
  await t.test('oversized protocol identifiers remain exact from REST to proof request', async () => {
    const id = String(2n ** 200n), token = String(2n ** 240n);
    Object.assign(rows.v41_artworks[0], { artwork_id: id, token_id: token }); Object.assign(owners[0], { artwork_id: id, token_id: token });
    const res = await cardRequest({ id }); assert.equal(res.statusCode, 200);
    assert.equal(res.body.data[0].artwork_id, id); assert.equal(res.body.data[0].token_id, token);
    assert.equal(calls.find(call => call.name === 'rpc/read_verified_nft_cards').body.p_artwork_ids[0], id);
  });
  await t.test('timeline includes a neutral movement and preserves actual separate sale economics', async () => {
    const res = await historyRequest(); assert.equal(res.statusCode, 200);
    assert.equal(res.headers['cache-control'], 'private, no-store'); assert.equal(res.body.roles.current_owner_address, OWNER);
    assert.equal(res.body.roles.first_collector_address, FIRST);
    const movement = res.body.events.findLast(event => event.type === 'nft_transferred');
    assert.equal(movement.from_address, BUYER); assert.equal(movement.to_address, OWNER);
    assert.equal(movement.price, undefined); assert.equal(movement.final_price, undefined);
    assert.equal(res.body.events.find(event => event.type === 'resale_completed').price, '3');
    assert.equal(res.body.events.find(event => event.type === 'settlement_completed').final_price, '2');
    assert.equal(res.body.complete, true);
  });
  await t.test('unverified association prevents token-only timeline reads', async () => {
    Object.assign(owners[0], { token_id: null, verified: false, current_owner_address: null, first_collector_address: null, latest_transfer: null });
    history = { transfers: [], complete: false, lifecycle: [], lifecycle_available: false, lifecycle_complete: false };
    const res = await historyRequest(); assert.equal(res.statusCode, 503);
    assert.equal(calls.some(call => call.name === 'v41_resale_history'), false);
  });
  await t.test('hidden work returns no history without staff access', async () => {
    rows.artwork_moderation_visibility = [{ chain_id: 84532, artwork_id: '77', hidden: true }];
    const res = await historyRequest(); assert.equal(res.statusCode, 404);
    assert.equal(calls.some(call => call.name === 'rpc/read_verified_nft_history'), false);
  });
  await t.test('history rejects a source revision changing during lifecycle reads', async () => {
    afterRead = name => { if (name === 'rpc/read_verified_nft_history') marker.state_revision = '1235'; };
    const res = await historyRequest(); assert.equal(res.statusCode, 503); assert.equal(res.headers['cache-control'], 'private, no-store');
  });
  await t.test('unminted work keeps its lifecycle without inventing a collector or transfer', async () => {
    Object.assign(rows.v41_artworks[0], { minted: false, token_id: null }); rows.v41_settlements = [];
    Object.assign(owners[0], { token_id: null, verified: false, current_owner_address: null, first_collector_address: null, latest_transfer: null });
    history = { transfers: [], complete: false, lifecycle: lifecycle().slice(0, 1), lifecycle_available: true, lifecycle_complete: true };
    const res = await historyRequest(); assert.equal(res.statusCode, 200); assert.equal(res.body.complete, true);
    assert.equal(res.body.roles.current_owner_address, null); assert.deepEqual(res.body.events.map(e => e.type), ['artwork_registered']);
  });
  await t.test('mutable projections newer than the captured boundary cannot mix with old ownership', async () => {
    rows.v41_artworks[0].last_updated_block = 121;
    for (const query of [{ id: '77' }, {}]) {
      const res = await cardRequest(query); assert.equal(res.statusCode, 503);
    }
    await assert.rejects(readVisibleArtworkCards(84532, ['77'], CORE), error => error.code === 'NFT_OWNERSHIP_UNAVAILABLE');
  });
  await t.test('a bounded listing from the verified Core is the only active sale shown', async () => {
    rows.v41_resale_listings[0].seller = OWNER;
    let res = await cardRequest({ id: '77' }); assert.equal(res.statusCode, 200); assertOwner(res.body.data[0]);
    owners[0].active_listing = { token_id: '7', seller: OWNER, price: '5000000000000000000', last_updated_block: 112 };
    res = await cardRequest({ id: '77' }); assert.equal(res.statusCode, 200);
    assert.equal(res.body.data[0].status, 'for_sale'); assert.equal(res.body.data[0].sale_price, '5');
    assert.equal(res.body.data[0].resale_updated_block, 112);
  });
  await t.test('qualified history never fetches token-only or mutable lifecycle tables', async () => {
    rows.v41_resale_history[0].price = '9000000000000000000';
    rows.v41_resale_history[0].block_number = 121;
    const res = await historyRequest(); assert.equal(res.statusCode, 200);
    assert.equal(res.body.events.find(e => e.type === 'resale_completed').price, '3');
    assert.equal(calls.some(call => ['v41_auctions', 'v41_settlements', 'v41_resale_history', 'v41_resale_listings', 'contract_events'].includes(call.name)), false);
  });
  await t.test('unknown registration cannot invent an unminted timeline', async () => {
    Object.assign(rows.v41_artworks[0], { minted: false, token_id: null });
    Object.assign(owners[0], { token_id: null, verified: false, current_owner_address: null, first_collector_address: null, latest_transfer: null });
    history = { transfers: [], complete: false, lifecycle: [], lifecycle_available: false, lifecycle_complete: false };
    const res = await historyRequest(); assert.equal(res.statusCode, 503);
  });
  await t.test('legacy read-only detail is independent of unavailable Base proof', async () => {
    for (const table of Object.values(rows)) for (const row of table) if (row.chain_id === 84532) row.chain_id = 11155111;
    marker = null;
    const res = await cardRequest({ id: 'v41:11155111:77' }); assert.equal(res.statusCode, 200);
    assert.equal(res.body.data[0].chain_id, 11155111);
    assert.equal(calls.some(call => call.name.startsWith('rpc/read_verified_nft_')), false);
  });

  function publishNextBoundary() {
    const height = Number(marker.indexed_through) + 1;
    marker = { indexed_through: height, confirmed_through: height, covered_hash: hash(height),
      state_revision: String(Number(marker.state_revision) + 1) };
    const moved = { ...transfer(), block_number: height, transaction_hash: hash(height),
      from_address: owners[0].current_owner_address, to_address: CREATOR };
    Object.assign(owners[0], { current_owner_address: CREATOR, latest_transfer: moved });
    history.transfers.push(moved);
  }
  const entrypoints = {
    direct: async () => { const res = await cardRequest({ id: '77' }); assert.equal(res.statusCode, 200); return res.body.data[0]; },
    feed: async () => { const res = await cardRequest({ owner: CREATOR }); assert.equal(res.statusCode, 200); assert.equal(res.body.count, 1); return res.body.data[0]; },
    Saved: () => readVisibleArtworkCard(84532, '77'),
    search: async () => (await readVisibleArtworkCards(84532, ['77'], CORE))[0],
    provenance: async () => { const res = await historyRequest(); assert.equal(res.statusCode, 200); return res.body.roles; }
  };
  for (const [name, run] of Object.entries(entrypoints)) await t.test(`${name} restarts its entire read once after a forward publication`, async () => {
    afterRead = request => {
      if (request === 'rpc/read_verified_nft_boundary') { afterRead = null; publishNextBoundary(); }
    };
    assert.equal((await run()).current_owner_address, CREATOR);
    assert.equal(calls.filter(call => call.name === 'rpc/read_verified_nft_boundary').length, 2);
    const lifecycleRequest = name === 'search' ? 'rpc/read_public_search_cards' : 'v41_artworks';
    assert.equal(calls.filter(call => call.name === lifecycleRequest).length, 2, 'lifecycle inputs must be read again');
  });
  for (const [name, trigger] of [['direct','profiles'], ['search','artwork_moderation_visibility'], ['provenance','rpc/read_verified_nft_history']]) {
    await t.test(`${name} discards hydrated results when its final proof sees a new publication`, async () => {
      afterRead = request => { if (request === trigger) { afterRead = null; publishNextBoundary(); } };
      assert.equal((await entrypoints[name]()).current_owner_address, CREATOR);
      assert.equal(calls.filter(call => call.name === 'rpc/read_verified_nft_boundary').length, 2);
      assert.equal(calls.filter(call => call.name === (name === 'search' ? 'rpc/read_public_search_cards' : 'v41_artworks')).length, 2);
    });
  }
  await t.test('a mutable projection from a valid newer checkpoint restarts before serialization', async () => {
    afterRead = request => {
      if (request === 'rpc/read_verified_nft_boundary') {
        afterRead = null; publishNextBoundary(); rows.v41_artworks[0].last_updated_block = marker.indexed_through;
      }
    };
    const res = await cardRequest({ id: '77' }); assert.equal(res.statusCode, 200);
    assert.equal(res.body.data[0].current_owner_address, CREATOR);
    assert.equal(calls.filter(call => call.name === 'v41_artworks').length, 2);
  });
  for (const surface of ['direct','provenance']) await t.test(`${surface} returns unavailable after a second publication instead of nesting retries`, async () => {
    afterRead = request => { if (request === 'rpc/read_verified_nft_boundary') publishNextBoundary(); };
    const res = surface === 'direct' ? await cardRequest({ id: '77' }) : await historyRequest();
    assert.equal(res.statusCode, 503); assert.equal(res.body.error, 'NFT_OWNERSHIP_UNAVAILABLE');
    assert.equal(res.headers['cache-control'], 'private, no-store');
    assert.equal(calls.filter(call => call.name === 'rpc/read_verified_nft_boundary').length, 2);
    assert.equal(calls.filter(call => call.name === 'v41_artworks').length, 2);
  });
  for (const key of ['ARTSOUL_NFT_OWNERSHIP_ENABLED','ARTSOUL_NFT_ADDRESS_BASE_SEPOLIA']) await t.test(`retry cannot fall back after ${key} changes`, async () => {
    let boundaryReads = 0;
    afterRead = request => {
      if (request !== 'rpc/read_verified_nft_boundary') return;
      if (++boundaryReads === 1) publishNextBoundary();
      else process.env[key] = key.endsWith('ENABLED') ? 'false' : CREATOR;
    };
    const res = await cardRequest({ id: '77' }); assert.equal(res.statusCode, 503);
    assert.equal(res.body.error, 'NFT_OWNERSHIP_UNAVAILABLE'); assert.equal(boundaryReads, 2);
    assert.equal(calls.filter(call => call.name === 'v41_artworks').length, 1, 'changed configuration stops before replacement lifecycle reads');
  });
  await t.test('a malformed advanced owner proof is not retried', async () => {
    afterRead = request => {
      if (request === 'rpc/read_verified_nft_boundary') { afterRead = null; publishNextBoundary(); owners[0].token_id = '8'; }
    };
    const res = await cardRequest({ id: '77' }); assert.equal(res.statusCode, 503);
    assert.equal(calls.filter(call => call.name === 'rpc/read_verified_nft_boundary').length, 1);
  });
  await t.test('a foreign source in advanced history is not retried', async () => {
    afterRead = request => {
      if (request === 'rpc/read_verified_nft_boundary') { afterRead = null; publishNextBoundary(); history.lifecycle[0].contract_address = NFT; }
    };
    const res = await historyRequest(); assert.equal(res.statusCode, 503);
    assert.equal(calls.filter(call => call.name === 'rpc/read_verified_nft_boundary').length, 1);
  });
});
