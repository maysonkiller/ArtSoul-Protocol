// Smoke test for the cached /api/public/artworks projection restored with the
// egress fix (PR #66). Insurance for the three list/detail behaviors that keep
// egress low without breaking the UI:
//   * list responses are CDN-cacheable (s-maxage) and non-empty on a cold cache;
//   * a direct id/artwork lookup is private+no-store and carries fresh bids;
//   * the moderation table is read with a narrow column select, never select=*.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const FUTURE_ISO = '2099-01-01T00:00:00.000Z';

function tableOf(path) {
  return String(path).split('?')[0];
}

function loadHandler() {
  const calls = [];
  const supabaseRest = async (path) => {
    calls.push(path);
    switch (tableOf(path)) {
      case 'v41_artworks':
        return [{
          chain_id: 84532, artwork_id: '7', creator: '0xCreator',
          metadata_uri: 'https://example.test/meta.json', minted: false, token_id: '',
          canonical_floor: '0', active_auction_id: '42', block_number: 100,
          transaction_hash: '0xhash', indexed_at: FUTURE_ISO, last_updated_at: FUTURE_ISO
        }];
      case 'v41_auctions':
        return [{
          chain_id: 84532, auction_id: '42', artwork_id: '7', status: 'active',
          start_price: '1000000000000000000', end_time: FUTURE_ISO,
          current_bid: '1500000000000000000', current_bidder: '0xBidder', winner: null,
          winning_bid: '0', settlement_deadline: null, final_price: '0', token_id: ''
        }];
      case 'v41_bids':
        return [{
          chain_id: 84532, auction_id: '42', artwork_id: '7', bidder: '0xBidder',
          bid_amount: '1500000000000000000', block_number: 120, log_index: 2,
          transaction_hash: '0xbidtx', indexed_at: FUTURE_ISO
        }];
      case 'artwork_moderation_visibility':
        return [{ chain_id: 84532, artwork_id: '7', hidden: false }];
      default:
        return [];
    }
  };

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
    fetch: async () => ({ ok: true, json: async () => ({ name: 'Smoke Art', image: 'https://img.test/a.png' }) }),
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
    setTimeout: () => 0,
    clearTimeout: () => {},
    console: { warn() {}, error() {}, log() {} },
    process: { env: {} }
  });
  vm.runInContext(source, context);
  return { handler: context.handler, calls };
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

test('cold-cache list response is CDN-cacheable and non-empty', async () => {
  const { handler, calls } = loadHandler();
  const res = fakeRes();
  await handler({ query: {} }, res);

  assert.equal(res.statusCode, 200);
  assert.ok(res.body.count >= 1, 'list returns at least one card on a cold cache');
  assert.equal(res.body.data[0].id, 'v41:84532:7');
  assert.match(res.headers['cache-control'], /^public, s-maxage=\d+/, 'list is CDN-cacheable');

  const modCall = calls.find(p => tableOf(p) === 'artwork_moderation_visibility');
  assert.ok(modCall, 'moderation visibility table is queried');
  assert.ok(modCall.includes('select=chain_id,artwork_id,hidden'), 'narrow moderation select');
  assert.ok(!calls.some(p => p.includes('select=*')), 'no select=* anywhere in the projection build');
});

test('direct artwork lookup is private+no-store and carries fresh bids', async () => {
  const { handler } = loadHandler();
  const res = fakeRes();
  await handler({ query: { artwork_id: '7' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.count, 1);
  const card = res.body.data[0];
  assert.equal(card.artwork_id, '7');
  assert.ok(Array.isArray(card.bids) && card.bids.length === 1, 'direct lookup attaches bids');
  assert.equal(card.bids[0].bidder, '0xBidder');
  assert.equal(card.bids[0].bid_amount, '1.5'); // wei -> eth
  assert.equal(res.headers['cache-control'], 'private, no-store');
});
