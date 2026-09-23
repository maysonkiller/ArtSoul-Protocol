const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const { parseEther } = require('ethers');

const CHAIN = 84532;
const CREATOR = `0x${'ab'.repeat(20)}`;
const COLLECTOR = `0x${'cd'.repeat(20)}`;
const TIMESTAMP = '2026-09-21T12:00:00.000Z';

// Exercise both public endpoints with the integer strings returned by the
// indexer. Presentation rounding must not alter the API's monetary values.
function endpoint(name, amount, bidAmounts = [amount]) {
  const rows = {
    v41_artworks: [{ chain_id: CHAIN, artwork_id: '28', creator: CREATOR,
      metadata_uri: 'https://metadata.example/28.json', minted: true, token_id: '400',
      canonical_floor: amount, active_auction_id: '', block_number: 100,
      transaction_hash: '0xregistration', indexed_at: TIMESTAMP, last_updated_at: TIMESTAMP }],
    v41_auctions: [{ chain_id: CHAIN, auction_id: '63', artwork_id: '28', status: 'settled',
      start_price: amount, end_time: TIMESTAMP, current_bid: amount, current_bidder: COLLECTOR,
      winner: COLLECTOR, winning_bid: amount, settlement_deadline: TIMESTAMP,
      final_price: amount, token_id: '400' }],
    v41_bids: bidAmounts.map((value, index) => ({ chain_id: CHAIN, auction_id: '63', artwork_id: '28',
      bidder: COLLECTOR, bid_amount: value, block_number: 90 + index, log_index: 0,
      transaction_hash: `0xbid${index}`, indexed_at: TIMESTAMP })),
    v41_settlements: [{ chain_id: CHAIN, artwork_id: '28', settlement_status: 'completed',
      winner: COLLECTOR, token_id: '400', block_number: 100, log_index: 0, indexed_at: TIMESTAMP }],
    v41_floor_history: [{ chain_id: CHAIN, artwork_id: '28', floor_price: amount, block_number: 100 }],
    v41_resale_listings: [{ chain_id: CHAIN, token_id: '400', active: true, price: amount, seller: COLLECTOR }],
    v41_public_metrics: [{ chain_id: CHAIN, artists_onboarded: '1', auctions_completed: '1',
      unique_collectors: '1', settled_volume_wei: amount, last_updated_block: '100', updated_at: TIMESTAMP }]
  };
  const source = fs.readFileSync(`src/api/routes/public/${name}.js`, 'utf8')
    .replace(/^import[^\n]*\n/gm, '')
    .replace('export default async function handler', 'this.handler = async function handler');
  const context = vm.createContext({
    process: { env: {} }, console: { warn() {}, error() {}, log() {} },
    allowMethods: () => true,
    sendError: (res, error) => res.status(500).json({ error: error.message }),
    supabaseRest: async path => rows[path.split('?')[0]] || [],
    validateArtworkId: value => String(value || '').trim() || null,
    getModerationAccess: async () => ({ canModerate: false }),
    readArtworkMetadata: async () => ({ name: 'Exact amount fixture', image: 'https://images.example/28.png' })
  });
  const valuation = fs.readFileSync('src/features/artwork/ai-valuation-values.js', 'utf8').replace(/^export /gm, '');
  vm.runInContext(`${valuation}\n${source}`, context);
  return async query => {
    const response = { statusCode: 200,
      setHeader() {}, status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; } };
    await context.handler({ method: 'GET', query }, response);
    assert.equal(response.statusCode, 200, response.body?.error);
    return response.body;
  };
}

const amounts = [
  ['0', '0'],
  ['1', '0.000000000000000001'],
  ['999999999999', '0.000000999999999999'],
  ['123456789012345678', '0.123456789012345678'],
  ['1000000000000000001', '1.000000000000000001'],
  ['123456789012345678901234567890', '123456789012.34567890123456789']
];

for (const [wei, eth] of amounts) {
  test(`public auction amounts preserve ${wei} wei through exact decimal serialization`, async () => {
    const live = await endpoint('auction-live', wei)({ chain_id: String(CHAIN), auction_id: '63' });
    for (const key of ['start_price', 'current_bid', 'highest_bid']) {
      assert.equal(live.auction[key], eth, `live ${key}`);
      assert.equal(parseEther(live.auction[key]), BigInt(wei));
    }
    assert.equal(live.bids[0].bid_amount, eth);
    assert.equal(live.bids[0].bid_amount_wei, wei);

    const artworks = endpoint('artworks', wei);
    const list = await artworks({ chain_id: String(CHAIN) });
    assert.equal(list.public_metrics.settled_volume_eth, eth);
    const direct = await artworks({ chain_id: String(CHAIN), artwork_id: '28' });
    for (const card of [list.data[0], direct.data[0]]) {
      for (const key of ['start_price', 'creator_value', 'current_bid', 'highest_bid', 'canonical_floor', 'floor_price', 'sale_price']) {
        assert.equal(card[key], eth, `artwork ${key}`);
        assert.equal(parseEther(card[key]), BigInt(wei));
      }
    }
    assert.equal(direct.data[0].bids[0].bid_amount, eth);
    assert.equal(direct.data[0].bids[0].bid_amount_wei, wei);
  });
}

test('public bid history preserves the exact absolute and ceiling-rounded percentage increment', async () => {
  // Golden values from the existing rule max(0.01 ETH, ceil(2.5%)). The
  // percentage case crosses a one-wei rounding boundary at 0.4 ETH + 1 wei.
  for (const [previous, next, increment] of [
    ['123456789012345678', '133456789012345678', 10000000000000000n],
    ['400000000000000001', '410000000000000002', 10000000000000001n]
  ]) {
    for (const name of ['auction-live', 'artworks']) {
      const response = await endpoint(name, next, [previous, next])({ chain_id: String(CHAIN), artwork_id: '28', auction_id: '63' });
      const bids = name === 'auction-live' ? response.bids : response.data[0].bids;
      const exact = new Map(bids.map(bid => [bid.bid_amount_wei, parseEther(bid.bid_amount)]));
      assert.equal(exact.get(previous), BigInt(previous));
      assert.equal(exact.get(next), BigInt(next));
      assert.equal(exact.get(next) - exact.get(previous), increment);
    }
  }
});
