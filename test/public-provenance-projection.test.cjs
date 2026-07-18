// Phase A6 provenance regression coverage for the public projection API.
// Every NFT surface derives Creator / First Collector / Owner from this
// payload, so the canon invariants are asserted here behaviorally:
//   * auction_winner_address (First Collector source) exists ONLY after a
//     COMPLETED settlement — a settlement_pending winner must never leak;
//   * current_owner_address is indexer-backed (settlement -> resale history ->
//     active listing) and never fabricated for unminted or partially indexed
//     artworks;
//   * (chain_id, artwork_id) / (chain_id, token_id) identities stay chain
//     scoped — legacy Ethereum Sepolia rows never merge with Base Sepolia rows
//     that share a protocol id;
//   * hidden works stay out of public list responses;
//   * missing metadata degrades to a placeholder card without inventing
//     provenance.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const FUTURE_ISO = '2099-01-01T00:00:00.000Z';
const ETH = '000000000000000000'; // 1 ETH in wei = '1' + ETH

const CREATOR = '0xCafe000000000000000000000000000000000001';
const BIDDER = '0xBead000000000000000000000000000000000002';
const PENDING_WINNER = '0xFace000000000000000000000000000000000003';
const FIRST_COLLECTOR = '0xF00d000000000000000000000000000000000004';
const DEFAULTED_WINNER = '0xDead000000000000000000000000000000000005';
const RESALE_BUYER_1 = '0xBb01000000000000000000000000000000000006';
const RESALE_BUYER_2 = '0xBb02000000000000000000000000000000000007';
const LEGACY_COLLECTOR = '0x1e9a000000000000000000000000000000000008';

function artworkRow(overrides = {}) {
  return {
    chain_id: 84532,
    creator: CREATOR,
    metadata_uri: 'https://example.test/meta.json',
    minted: false,
    token_id: '',
    canonical_floor: '0',
    active_auction_id: '',
    block_number: 100,
    transaction_hash: '0xregister',
    indexed_at: FUTURE_ISO,
    last_updated_at: FUTURE_ISO,
    ...overrides
  };
}

const FIXTURES = {
  v41_artworks: [
    // 1: registered, never auctioned
    artworkRow({ artwork_id: '1' }),
    // 2: live auction with bids
    artworkRow({ artwork_id: '2', active_auction_id: '20' }),
    // 3: auction ended, settlement window open (winner known, NOT settled)
    artworkRow({ artwork_id: '3', active_auction_id: '30' }),
    // 4: settled + minted primary sale
    artworkRow({ artwork_id: '4', minted: true, token_id: '400', canonical_floor: `2${ETH}` }),
    // 5: minted, actively listed for resale by its First Collector
    artworkRow({ artwork_id: '5', minted: true, token_id: '500', canonical_floor: `1${ETH}` }),
    // 6: minted, two completed resales, not currently listed
    artworkRow({ artwork_id: '6', minted: true, token_id: '600', canonical_floor: `1${ETH}` }),
    // 7: minted but settlement/resale rows not indexed yet
    artworkRow({ artwork_id: '7', minted: true, token_id: '700' }),
    // 8: metadata unreachable
    artworkRow({ artwork_id: '8', metadata_uri: 'https://example.test/missing.json' }),
    // 9: hidden by moderation
    artworkRow({ artwork_id: '9' }),
    // Legacy Ethereum Sepolia record sharing protocol id 4 with the Base row
    artworkRow({ chain_id: 11155111, artwork_id: '4', minted: true, token_id: '400' })
  ],
  v41_auctions: [
    {
      chain_id: 84532, auction_id: '20', artwork_id: '2', status: 'active',
      start_price: `1${ETH}`, end_time: FUTURE_ISO, current_bid: `1500000000000000000`,
      current_bidder: BIDDER, winner: null, winning_bid: '0',
      settlement_deadline: null, final_price: '0', token_id: ''
    },
    {
      chain_id: 84532, auction_id: '30', artwork_id: '3', status: 'settlement_pending',
      start_price: `1${ETH}`, end_time: '2020-01-01T00:00:00.000Z',
      current_bid: `2${ETH}`, current_bidder: PENDING_WINNER, winner: PENDING_WINNER,
      winning_bid: `2${ETH}`, settlement_deadline: FUTURE_ISO, final_price: '0', token_id: ''
    },
    {
      chain_id: 84532, auction_id: '39', artwork_id: '4', status: 'defaulted',
      start_price: `1${ETH}`, end_time: '2020-01-01T00:00:00.000Z',
      current_bid: `2${ETH}`, current_bidder: DEFAULTED_WINNER, winner: DEFAULTED_WINNER,
      winning_bid: `2${ETH}`, settlement_deadline: '2020-01-02T00:00:00.000Z',
      final_price: '0', token_id: ''
    },
    {
      chain_id: 84532, auction_id: '40', artwork_id: '4', status: 'settled',
      start_price: `1${ETH}`, end_time: '2020-01-03T00:00:00.000Z',
      current_bid: `2${ETH}`, current_bidder: FIRST_COLLECTOR, winner: FIRST_COLLECTOR,
      winning_bid: `2${ETH}`, settlement_deadline: null, final_price: `2${ETH}`, token_id: '400'
    }
  ],
  v41_bids: [
    {
      chain_id: 84532, auction_id: '20', artwork_id: '2', bidder: BIDDER,
      bid_amount: `1500000000000000000`, block_number: 120, log_index: 2,
      transaction_hash: '0xbid', indexed_at: FUTURE_ISO
    }
  ],
  v41_settlements: [
    // Settlement window is open for artwork 3: row exists but is NOT completed.
    {
      chain_id: 84532, auction_id: '30', artwork_id: '3', settlement_status: 'pending',
      winner: PENDING_WINNER, token_id: '', block_number: 130, log_index: 1, indexed_at: FUTURE_ISO
    },
    // Artwork 4 once defaulted before the successful settlement.
    {
      chain_id: 84532, auction_id: '39', artwork_id: '4', settlement_status: 'defaulted',
      winner: DEFAULTED_WINNER, token_id: '', block_number: 140, log_index: 1, indexed_at: FUTURE_ISO
    },
    {
      chain_id: 84532, auction_id: '40', artwork_id: '4', settlement_status: 'completed',
      winner: FIRST_COLLECTOR, token_id: '400', block_number: 150, log_index: 1, indexed_at: FUTURE_ISO
    },
    {
      chain_id: 84532, auction_id: '50', artwork_id: '5', settlement_status: 'completed',
      winner: FIRST_COLLECTOR, token_id: '500', block_number: 151, log_index: 1, indexed_at: FUTURE_ISO
    },
    {
      chain_id: 84532, auction_id: '60', artwork_id: '6', settlement_status: 'completed',
      winner: FIRST_COLLECTOR, token_id: '600', block_number: 152, log_index: 1, indexed_at: FUTURE_ISO
    },
    // Legacy chain settlement for the SAME protocol artwork id 4.
    {
      chain_id: 11155111, auction_id: '40', artwork_id: '4', settlement_status: 'completed',
      winner: LEGACY_COLLECTOR, token_id: '400', block_number: 90, log_index: 1, indexed_at: FUTURE_ISO
    }
  ],
  v41_resale_listings: [
    { chain_id: 84532, token_id: '500', active: true, price: `3${ETH}`, seller: FIRST_COLLECTOR },
    { chain_id: 84532, token_id: '600', active: false, price: `3${ETH}`, seller: FIRST_COLLECTOR }
  ],
  v41_resale_history: [
    {
      chain_id: 84532, token_id: '600', buyer: RESALE_BUYER_1, seller: FIRST_COLLECTOR,
      block_number: 200, log_index: 1, indexed_at: FUTURE_ISO
    },
    // Later resale: Owner moves on, First Collector must not.
    {
      chain_id: 84532, token_id: '600', buyer: RESALE_BUYER_2, seller: RESALE_BUYER_1,
      block_number: 210, log_index: 1, indexed_at: FUTURE_ISO
    }
  ],
  v41_floor_history: [],
  v41_trust_signals: [],
  artwork_social_signals: [],
  artwork_moderation_visibility: [
    { chain_id: 84532, artwork_id: '9', hidden: true }
  ]
};

function loadHandler() {
  const supabaseRest = async (path) => FIXTURES[String(path).split('?')[0]] || [];

  const source = fs
    .readFileSync('src/api/routes/public/artworks.js', 'utf8')
    .replace(/^import[^\n]*\n/gm, '') // drop backend.js + moderation-access imports; inject mocks
    .replace('export default async function handler', 'this.handler = async function handler');

  const context = vm.createContext({
    allowMethods: () => true,
    sendError: (res, error) => res.status(500).json({ error: String((error && error.message) || error) }),
    supabaseRest,
    validateArtworkId: (value) => { const s = String(value ?? '').trim(); return s || null; },
    getModerationAccess: async () => ({ canModerate: false }),
    fetch: async (url) => String(url).includes('missing')
      ? { ok: false, json: async () => ({}) }
      : { ok: true, json: async () => ({ name: 'Fixture Art', image: 'https://img.test/a.png' }) },
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
    setTimeout: () => 0,
    clearTimeout: () => {},
    Buffer,
    console: { warn() {}, error() {}, log() {} },
    process: { env: {} }
  });
  vm.runInContext(source, context);
  return context.handler;
}

function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

async function projectCards(query = {}) {
  const handler = loadHandler();
  const res = fakeRes();
  await handler({ query }, res);
  assert.equal(res.statusCode, 200);
  return res.body;
}

function cardById(body, id) {
  const card = body.data.find(item => item.id === id);
  assert.ok(card, `card ${id} present in public payload`);
  return card;
}

test('registered artwork exposes Creator only — no owner, no First Collector', async () => {
  const body = await projectCards();
  const card = cardById(body, 'v41:84532:1');
  assert.equal(card.status, 'registered');
  assert.equal(card.creator, CREATOR);
  assert.equal(card.auction_winner_address, null);
  assert.equal(card.current_owner_address, null);
  assert.equal(card.minted, false);
});

test('active auction with bids never exposes a First Collector or Owner', async () => {
  const body = await projectCards();
  const card = cardById(body, 'v41:84532:2');
  assert.equal(card.status, 'auction');
  assert.equal(card.current_bidder, BIDDER);
  assert.equal(card.auction_winner_address, null);
  assert.equal(card.current_owner_address, null);
});

test('settlement window winner is NOT promoted to First Collector before completion', async () => {
  const body = await projectCards();
  const card = cardById(body, 'v41:84532:3');
  assert.equal(card.status, 'settlement_pending');
  // v41_auctions.winner and a non-completed settlement row both exist, yet the
  // provenance fields consumed by every surface must stay empty.
  assert.equal(card.auction_winner_address, null);
  assert.equal(card.current_owner_address, null);
  assert.equal(card.minted, false);
});

test('completed settlement establishes First Collector = Owner, ignoring the defaulted attempt', async () => {
  const body = await projectCards();
  const card = cardById(body, 'v41:84532:4');
  assert.equal(card.status, 'sold');
  assert.equal(card.minted, true);
  assert.equal(card.token_id, '400');
  assert.equal(card.auction_winner_address, FIRST_COLLECTOR);
  assert.notEqual(card.auction_winner_address, DEFAULTED_WINNER);
  assert.equal(card.current_owner_address, FIRST_COLLECTOR);
});

test('active resale listing keeps Owner = seller and First Collector stable', async () => {
  const body = await projectCards();
  const card = cardById(body, 'v41:84532:5');
  assert.equal(card.status, 'for_sale');
  assert.equal(card.sale_price, '3');
  assert.equal(card.auction_winner_address, FIRST_COLLECTOR);
  assert.equal(card.current_owner_address, FIRST_COLLECTOR);
});

test('completed resales move Owner to the latest buyer while First Collector never changes', async () => {
  const body = await projectCards();
  const card = cardById(body, 'v41:84532:6');
  assert.equal(card.status, 'sold');
  assert.equal(card.auction_winner_address, FIRST_COLLECTOR);
  assert.equal(card.current_owner_address, RESALE_BUYER_2);
});

test('owner filter matches indexer-backed ownership, not creators or sellers', async () => {
  const body = await projectCards({ owner: RESALE_BUYER_2 });
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].id, 'v41:84532:6');
});

test('minted artwork with missing settlement projection degrades to no owner instead of fabricating one', async () => {
  const body = await projectCards();
  const card = cardById(body, 'v41:84532:7');
  assert.equal(card.status, 'sold');
  assert.equal(card.auction_winner_address, null);
  assert.equal(card.current_owner_address, null);
});

test('legacy Ethereum Sepolia record stays chain-scoped and never merges by protocol id', async () => {
  const body = await projectCards();
  const baseCard = cardById(body, 'v41:84532:4');
  const legacyCard = cardById(body, 'v41:11155111:4');
  assert.equal(legacyCard.network, 'sepolia');
  assert.equal(baseCard.network, 'baseSepolia');
  assert.equal(legacyCard.auction_winner_address, LEGACY_COLLECTOR);
  assert.equal(legacyCard.current_owner_address, LEGACY_COLLECTOR);
  // The Base-chain card must be untouched by the legacy settlement.
  assert.equal(baseCard.auction_winner_address, FIRST_COLLECTOR);
});

test('missing metadata yields a placeholder card without invented provenance', async () => {
  const body = await projectCards();
  const card = cardById(body, 'v41:84532:8');
  assert.equal(card.title, 'Artwork #8');
  assert.equal(card.media_type, 'unknown');
  assert.equal(card.media_url, '');
  assert.equal(card.auction_winner_address, null);
  assert.equal(card.current_owner_address, null);
});

test('hidden artwork is excluded from the public list and reported as suppressed', async () => {
  const body = await projectCards();
  assert.ok(!body.data.some(card => card.id === 'v41:84532:9'), 'hidden card absent');
  assert.ok(body.suppressed_artwork_ids.includes('v41:84532:9'));
});

test('hidden artwork direct lookup stays suppressed for non-staff viewers', async () => {
  const body = await projectCards({ artwork_id: '9' });
  assert.equal(body.data.length, 0);
  assert.ok(body.suppressed_artwork_ids.includes('v41:84532:9'));
});
