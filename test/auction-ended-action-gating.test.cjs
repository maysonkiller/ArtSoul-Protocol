const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const serviceSource = fs.readFileSync(
  path.join(root, 'src', 'features', 'auction', 'auction-service.js'),
  'utf8'
);
const artworkSource = fs.readFileSync(
  path.join(root, 'src', 'entries', 'artwork.jsx'),
  'utf8'
);

function loadAuctionService() {
  const runnable = serviceSource
    .replace(/^import[^\n]*\n/gm, '')
    .replace(/^export default AuctionService;\s*$/m, '');
  const sandbox = vm.createContext({
    window: {},
    console,
    DEBUG_CONFIG: { ENABLED: false, LOG_RPC: false },
    RPC_CLIENT_CONFIG: { ENABLED: false }
  });
  vm.runInContext(runnable, sandbox, {
    filename: 'src/features/auction/auction-service.js (stripped imports)'
  });
  return sandbox.window.AuctionService;
}

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Missing function ${name}`);
  let depth = 0;
  let index = source.indexOf('{', source.indexOf(')', start));
  for (; index < source.length; index++) {
    if (source[index] === '{') depth++;
    else if (source[index] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  const prefix = source.slice(Math.max(0, start - 6), start) === 'async ' ? 'async ' : '';
  return prefix + source.slice(start, index + 1);
}

const AuctionService = loadAuctionService();

test('auction timing accepts numeric and ISO timestamps consistently', () => {
  const service = Object.create(AuctionService.prototype);
  const iso = '2026-08-23T01:57:52+02:00';

  assert.equal(service._normalizeTimestamp(iso), Date.parse(iso));
  assert.equal(service._normalizeTimestamp('1787443072'), 1787443072000);
  assert.equal(service._normalizeTimestamp(1787443072000), 1787443072000);
  assert.equal(service._normalizeTimestamp('not-a-time'), 0);
});

test('an expired contract-active auction is endable and not bid-eligible', async () => {
  const service = Object.create(AuctionService.prototype);
  const expired = {
    state: 'AUCTION',
    status: 'active',
    endTime: '2000-01-01T00:00:00Z'
  };

  assert.equal(service.shouldEndAuction(expired), true);
  assert.equal(service.formatTimeRemaining(expired.endTime), 'Ended');

  service.getAuctionState = async () => expired;
  assert.deepEqual(
    { ...(await service.canPlaceBid('31', '0x2222', '0x1111')) },
    { canBid: false, reason: 'Auction is not active' }
  );
});

test('a future active auction remains bid-eligible', async () => {
  const service = Object.create(AuctionService.prototype);
  const active = {
    state: 'AUCTION',
    status: 'active',
    endTime: '2099-01-01T00:00:00Z'
  };

  assert.equal(service.shouldEndAuction(active), false);
  service.getAuctionState = async () => active;
  assert.deepEqual(
    { ...(await service.canPlaceBid('31', '0x2222', '0x1111')) },
    { canBid: true }
  );
});

test('the bid handler rejects an expired auction before requesting a wallet', () => {
  const placeBid = extractFunction(artworkSource, 'placeBidOnce');
  const expiryGuard = placeBid.indexOf('if (isAuctionClosedForBidding(auction))');
  const walletRequest = placeBid.indexOf('await window.ensureWalletConnected?.()');

  assert.notEqual(expiryGuard, -1, 'placeBidOnce must enforce the expired-auction guard');
  assert.notEqual(walletRequest, -1, 'placeBidOnce must retain wallet connection behavior');
  assert.ok(expiryGuard < walletRequest, 'expiry must be checked before opening the wallet');
  assert.match(placeBid, /This auction has ended\./);
});

test('detail presentation derives all bidding surfaces from the same closed predicate', () => {
  assert.match(
    artworkSource,
    /const auctionEnded = auction \? isAuctionClosedForBidding\(auction\) : false;/
  );
  assert.match(
    artworkSource,
    /const liveAuction = Boolean\(auction && !auctionEnded && !awaitingPayment && !mintedArtwork\);/
  );
  assert.match(artworkSource, /\{liveAuction && artworkWriteEnabled && \(/);
  assert.match(artworkSource, /\{canEndAuction && \(/);
});
