// A live auction wins an id collision.
//
// Auction ids and artwork ids are separate counters over the same small
// integers, so they collide constantly - artwork 31's first auction was auction
// 31. That collision is harmless until the artwork is re-auctioned: the artwork
// moves to a new auction while the finished one keeps sitting at its number.
//
// Reproduced on production on 2 September 2026. Artworks 29, 30 and 31 each had
// a live auction (38, 39, 37) and a Defaulted auction at their own number.
// Bidding by artwork id resolved to the dead auction, the contract answered
// AuctionNotActive, and the interface reported "This auction has ended" on an
// auction with two days left.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'contracts-integration.js'), 'utf8');

const NONE = 0;
const ACTIVE = 1;
const SETTLEMENT_PENDING = 2;
const DEFAULTED = 4;

// The real method, lifted out and run against a stub of the two chain reads it
// makes. Extracting it keeps the test on the shipped logic rather than a copy.
function resolverFrom({ auctions = {}, artworks = {} }) {
  const start = source.indexOf('    async resolveAuctionId(id) {');
  assert.notEqual(start, -1, 'resolveAuctionId must be findable');
  let depth = 0;
  let index = source.indexOf('{', source.indexOf(')', start));
  for (; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const body = source.slice(start, index + 1).replace('async resolveAuctionId(id) {', 'async function resolveAuctionId(id) {');

  const context = vm.createContext({
    AUCTION_STATUS_NONE: NONE,
    AUCTION_STATUS_ACTIVE: ACTIVE,
    exported: {}
  });
  vm.runInContext(`${body}\nexported.resolve = resolveAuctionId;`, context);

  const self = {
    ensureCore() {},
    async getAuctionStruct(id) {
      const row = auctions[String(id)];
      if (!row) throw new Error('no auction');
      return row;
    },
    async getArtworkStruct(id) {
      const row = artworks[String(id)];
      if (!row) throw new Error('no artwork');
      return row;
    }
  };
  return (id) => context.exported.resolve.call(self, id);
}

test('a re-auctioned artwork resolves to its live auction, not the dead one at its number', async () => {
  // Production shape: auction 31 is the Defaulted first auction of artwork 31,
  // and auction 37 is the live one.
  const resolve = resolverFrom({
    auctions: { 31: { status: DEFAULTED }, 37: { status: ACTIVE } },
    artworks: { 31: { activeAuctionId: 37n } }
  });

  assert.equal(await resolve(31), 37n, 'bidding by artwork id must reach the live auction');
});

test('a live auction passed by its own id is returned untouched', async () => {
  // The artwork page passes a real auction id. It must not be reinterpreted as
  // an artwork number, which is the mirror image of the defect above.
  const resolve = resolverFrom({
    auctions: { 37: { status: ACTIVE } },
    artworks: { 37: { activeAuctionId: 99n } }
  });

  assert.equal(await resolve(37), 37n);
});

test('an expired but unfinalized auction is still reachable by artwork id', async () => {
  // end_expired_auction passes an artwork id. On chain the auction is still
  // Active until someone ends it, so the first branch answers.
  const resolve = resolverFrom({
    auctions: { 27: { status: ACTIVE } },
    artworks: { 27: { activeAuctionId: 27n } }
  });

  assert.equal(await resolve(27), 27n);
});

test('a settlement still resolves while the winner has not paid', async () => {
  const resolve = resolverFrom({
    auctions: { 12: { status: SETTLEMENT_PENDING } },
    artworks: { 12: { activeAuctionId: 12n } }
  });

  assert.equal(await resolve(12), 12n);
});

test('a finished auction with no live auction anywhere is still returned', async () => {
  // Nothing is live, so the finished auction at this number is the only
  // sensible target - this is the path that ends or defaults a past auction.
  const resolve = resolverFrom({
    auctions: { 22: { status: DEFAULTED } },
    artworks: { 22: { activeAuctionId: 0n } }
  });

  assert.equal(await resolve(22), 22n);
});

test('an artwork that never had an auction is refused rather than guessed', async () => {
  const resolve = resolverFrom({
    auctions: {},
    artworks: { 45: { activeAuctionId: 0n } }
  });

  await assert.rejects(() => resolve(45), /No active auction/);
});

test('an artwork whose number matches no auction at all resolves through the artwork', async () => {
  const resolve = resolverFrom({
    auctions: { 41: { status: ACTIVE } },
    artworks: { 5: { activeAuctionId: 41n } }
  });

  assert.equal(await resolve(5), 41n);
});
