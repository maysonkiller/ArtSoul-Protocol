// Smoke test for the light /api/public/auction-live endpoint restored with the
// egress fix (PR #66). Insurance that the cursor-filtered bid feed keeps working:
// it must issue a narrow, cursor-scoped query, stay uncacheable (private,
// no-store), and surface a new bid that arrives after the caller's cursor.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function loadHandler(supabaseRest) {
  const calls = [];
  const wrappedRest = async (path) => {
    calls.push(path);
    return supabaseRest(path);
  };

  const source = fs
    .readFileSync('src/api/routes/public/auction-live.js', 'utf8')
    .replace(/^import[^\n]*\n/, '') // drop the backend.js import; we inject mocks
    .replace('export default async function handler', 'this.handler = async function handler');

  const context = vm.createContext({
    allowMethods: () => true,
    sendError: (res, error) => res.status(500).json({ error: String(error && error.message || error) }),
    supabaseRest: wrappedRest
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

test('auction-live returns a new bid that lands after the caller cursor', async () => {
  const newBid = {
    auction_id: '42',
    artwork_id: '7',
    bidder: '0xabc',
    bid_amount: '1500000000000000000', // 1.5 ETH in wei
    block_number: 120,
    log_index: 2,
    transaction_hash: '0xdeadbeef',
    indexed_at: '2026-07-09T00:00:00.000Z'
  };
  const { handler, calls } = loadHandler(async (path) => {
    if (path.startsWith('v41_auctions')) {
      return [{ auction_id: '42', artwork_id: '7', chain_id: 84532, status: 'active',
        start_price: '1000000000000000000', current_bid: '1500000000000000000',
        current_bidder: '0xabc', end_time: '2026-07-10T00:00:00.000Z' }];
    }
    return [newBid]; // v41_bids
  });

  const res = fakeRes();
  await handler(
    { query: { chain_id: '84532', auction_id: '42', after_block: '119', after_log: '9' } },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.count, 1);
  assert.equal(res.body.bids[0].bidder, '0xabc');
  assert.equal(res.body.bids[0].bid_amount, '1.5'); // wei -> eth conversion
  assert.equal(res.body.auction.status, 'auction'); // active + future end_time
  assert.equal(res.headers['cache-control'], 'private, no-store');

  const bidCall = calls.find(p => p.startsWith('v41_bids'));
  assert.ok(bidCall, 'a v41_bids query is issued');
  assert.ok(bidCall.includes('select=chain_id,auction_id'), 'narrow column select, not select=*');
  assert.ok(bidCall.includes('block_number.gt.119'), 'cursor filters bids after the given block');
});

test('auction-live rejects a malformed lookup without touching the database', async () => {
  const { handler, calls } = loadHandler(async () => {
    throw new Error('supabase should not be reached for an invalid lookup');
  });
  const res = fakeRes();
  await handler({ query: { chain_id: '1', auction_id: 'not-a-number' } }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'INVALID_AUCTION_LOOKUP');
  assert.equal(calls.length, 0);
});
