const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/features/auction/auction-service.js', 'utf8')
  .replace(/^import[^\n]*\n/gm, '')
  .replace(/^export default AuctionService;\s*$/m, '');

function harness({ readError } = {}) {
  const window = {};
  vm.runInNewContext(source, { window, console: { log() {}, warn() {} }, DEBUG_CONFIG: {} });
  const service = Object.create(window.AuctionService.prototype);
  const listeners = new Map(), removed = [];
  service.contracts = {
    getAuctionStruct: async auctionId => {
      assert.equal(String(auctionId), '63');
      if (readError) throw readError;
      return { artworkId: 28n };
    },
    marketplaceContract: {
      on: (name, handler) => { listeners.set(name, handler); return Promise.resolve({}); },
      off: (name, handler) => { removed.push([name, handler]); }
    }
  };
  service.eventListeners = { auctionCreated: null, bidPlaced: null, auctionEnded: null, settlementCompleted: null, settlementDefaulted: null };
  service.cache = new Map([['auction_28', { data: 'stale' }], ['auction_63', { data: 'unrelated' }]]);
  service.lastInvalidations = new Map();
  service.setupEventListeners();
  return { service, listeners, removed };
}

for (const event of ['BidPlaced', 'AuctionEnded', 'SettlementDefaulted']) {
  test(`${event} invalidates the containing artwork, not an artwork with the same number`, async () => {
    const h = harness();
    await h.listeners.get(event)(63n);
    assert.equal(h.service.cache.has('auction_28'), false);
    assert.equal(h.service.cache.has('auction_63'), true);
    assert.equal(h.service.lastInvalidations.has('auction_28'), true);
  });
}

test('unavailable event identity drops cached eligibility instead of guessing an artwork', async () => {
  const h = harness({ readError: new Error('RPC unavailable') });
  await h.listeners.get('AuctionEnded')(63n);
  assert.equal(h.service.cache.size, 0);
});

test('listener removal uses the callbacks, never the promises returned by ethers.on', () => {
  const h = harness();
  h.service.removeEventListeners();
  assert.equal(h.removed.length, 5);
  for (const [name, handler] of h.removed) assert.equal(handler, h.listeners.get(name));
});

test('duplicate setup does not register a second set of callbacks', () => {
  const h = harness();
  const first = h.listeners.get('AuctionEnded');
  h.service.setupEventListeners();
  assert.equal(h.listeners.get('AuctionEnded'), first);
});
