const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync('contracts-integration.js', 'utf8').replace(/^import .*;\r?\n/gm, '');
const ACTIVE = 1;
const SETTLEMENT_PENDING = 2;
const DEFAULTED = 4;
const row = (artworkId, status = ACTIVE) => ({
  artworkId: BigInt(artworkId), status, highestBid: 10n, depositLocked: 1n,
  originalEndTime: 100n, duration: 24n, endTime: 100n, startPrice: 1n,
  settlementDeadline: 200n, totalExtension: 0n, highestBidder: 'bidder'
});

// Execute the shipped adapter, not a copied resolver. Chain calls and wallet
// writes are local stubs; no network or signing happens in these tests.
function adapter({ auctions = {}, artworks = {}, auctionError } = {}) {
  const window = {};
  vm.runInNewContext(source, { window, console: { log() {} }, ethers: {} });
  const api = window.ArtSoulContracts;
  const calls = [];
  const writes = [];
  api.coreContract = {
    auctions: async id => {
      calls.push(['auction', String(id)]);
      if (auctionError) throw auctionError;
      return auctions[String(id)] || row(0, 0);
    },
    artworks: async id => {
      calls.push(['artwork', String(id)]);
      return artworks[String(id)] || { activeAuctionId: 0n };
    },
    requiredDepositForBid: async () => 1n,
    minimumBid: async () => 2n
  };
  for (const method of ['placeBid', 'endAuction', 'settleAuction', 'claimSettlementDefault']) {
    api.coreContract[method] = async (...args) => {
      writes.push([method, String(args[0])]);
      return { hash: '0xtest', wait: async () => {} };
    };
  }
  api.ensureBaseSepoliaWrite = async () => {};
  api.parseEth = value => BigInt(value);
  api.formatEth = value => String(value);
  return { api, calls, writes };
}

const collision = {
  auctions: { 31: row(31, DEFAULTED), 37: row(31), 45: row(37) },
  artworks: { 31: { activeAuctionId: 37n }, 37: { activeAuctionId: 45n } }
};

test('an explicit artwork id never selects another artwork active auction at the same number', async () => {
  const { api } = adapter(collision);
  assert.equal(await api.resolveAuctionId(37, { idType: 'artwork' }), 45n);
  assert.equal(await api.resolveAuctionId(31, { idType: 'artwork' }), 37n);
});

test('auction ids keep their meaning for active, pending and historical auctions', async () => {
  for (const status of [ACTIVE, SETTLEMENT_PENDING, DEFAULTED]) {
    const { api, calls } = adapter({ ...collision, auctions: { ...collision.auctions, 37: row(31, status) } });
    assert.equal(await api.resolveAuctionId(37), 37n);
    assert.equal(calls.some(([kind]) => kind === 'artwork'), false);
  }
});

test('a missing explicit auction does not fall through to an unrelated artwork', async () => {
  const { api } = adapter({ artworks: { 5: { activeAuctionId: 45n } }, auctions: { 45: row(5) } });
  await assert.rejects(() => api.resolveAuctionId(5), /Auction not found/);
  assert.equal(await api.resolveAuctionId(5, { idType: 'artwork' }), 45n);
});

test('artwork resolution fails closed when there is no active pointer or it points at another artwork', async () => {
  const { api } = adapter({ auctions: { 37: row(31), 45: row(99) }, artworks: { 37: { activeAuctionId: 0n }, 38: { activeAuctionId: 45n } } });
  await assert.rejects(() => api.resolveAuctionId(37, { idType: 'artwork' }), /No active auction/);
  await assert.rejects(() => api.resolveAuctionId(38, { idType: 'artwork' }), /does not belong/);
});

test('RPC failure is preserved instead of causing a second interpretation of the id', async () => {
  const failure = new Error('RPC unavailable');
  const { api, calls } = adapter({ ...collision, auctionError: failure });
  await assert.rejects(() => api.resolveAuctionId(37), error => error === failure);
  assert.deepEqual(calls, [['auction', '37']]);
});

test('invalid ids and input kinds are rejected before chain reads', async () => {
  const { api, calls } = adapter(collision);
  for (const id of [0, -1, 'not-an-id']) await assert.rejects(() => api.resolveAuctionId(id));
  await assert.rejects(() => api.resolveAuctionId(37, { idType: 'guess' }), /id type/);
  assert.deepEqual(calls, []);
});

test('bid and end adapters carry the artwork namespace through to the contract target', async () => {
  const { api, writes } = adapter(collision);
  await api.placeBid(37, '1', { idType: 'artwork' });
  await api.endAuction(37, { idType: 'artwork' });
  await api.placeBid(37, '1');
  assert.deepEqual(writes, [['placeBid', '45'], ['endAuction', '45'], ['placeBid', '37']]);
});

test('settlement and default target the requested historical auction, never an artwork pointer', async () => {
  const { api, writes } = adapter({ ...collision, auctions: { ...collision.auctions, 37: row(31, SETTLEMENT_PENDING) } });
  await api.completeSettlement(37);
  await api.claimSettlementDefault(37);
  assert.deepEqual(writes, [['settleAuction', '37'], ['claimSettlementDefault', '37']]);
});

test('auction reads and bid reads use the same explicit namespace as writes', async () => {
  const { api } = adapter(collision);
  assert.equal((await api.getAuction(37)).artworkId, '31');
  assert.equal((await api.getAuction(37, { idType: 'artwork' })).artworkId, '37');
  assert.equal((await api.getAuctionBids(37, { idType: 'artwork' })).length, 1);
});
