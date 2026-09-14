// B-11: an expired settlement had no way out, and still asked to be paid.
//
// Found 2026-09-14 checking the settlement step of the B-02 journey. Four
// auctions on the public testnet sat in settlement_pending with their 24h
// window long past - artwork 30's closed on 5 September. The contract settles
// that state one way: claimSettlementDefault, callable by anyone. Nothing on the
// site called it. So each work stayed stuck with an active auction id the creator
// could not replace, the creator's share of the locked deposit was never
// credited, and the page said "Awaiting payment" - while still offering the
// winner a Complete Settlement button that settleAuction would revert with
// SettlementExpired, after the winner had paid gas for it.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'src', 'entries', 'artwork.jsx'), 'utf8');
const card = fs.readFileSync(path.join(root, 'src', 'ui', 'components', 'artwork-card.js'), 'utf8');
const contracts = fs.readFileSync(path.join(root, 'contracts-integration.js'), 'utf8');
const core = fs.readFileSync(path.join(root, 'contracts', 'ArtSoulCore.sol'), 'utf8');
const webmcp = fs.readFileSync(path.join(root, 'webmcp-tools.js'), 'utf8');

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
  return source.slice(start, index + 1);
}

const MINUTE = 60 * 1000;
const DEADLINE = Date.parse('2026-09-05T21:54:36Z');

const pageSandbox = vm.createContext({ exported: {}, Number, Date });
vm.runInContext([
  'const SETTLEMENT_CLOCK_MARGIN_MS = 60 * 1000;',
  extractFunction(page, 'isSettlementWindowClosed'),
  'exported.closed = isSettlementWindowClosed;'
].join('\n'), pageSandbox, { filename: 'artwork.jsx (extracted)' });
const closed = pageSandbox.exported.closed;

test('a window is closed only once the chain would agree', () => {
  // block.timestamp and the visitor's clock can differ by seconds. Offering a
  // default the contract still rejects as SettlementStillActive wastes gas the
  // same way the old pay button did.
  assert.equal(closed(DEADLINE, DEADLINE - MINUTE), false, 'before the deadline');
  assert.equal(closed(DEADLINE, DEADLINE + 30 * 1000), false, 'inside the clock margin');
  assert.equal(closed(DEADLINE, DEADLINE + MINUTE + 1), true, 'past the margin');
  assert.equal(closed(DEADLINE, DEADLINE + 9 * 24 * 60 * MINUTE), true, 'artwork 30, nine days on');
});

test('a missing or unusable deadline never reads as closed', () => {
  for (const value of [0, null, undefined, NaN, 'soon']) {
    assert.equal(closed(value, Date.now()), false, String(value));
  }
});

test('the winner is no longer offered a payment the contract refuses', () => {
  // settleAuction: if (block.timestamp > auction.settlementDeadline) revert SettlementExpired();
  assert.match(core, /if \(block\.timestamp > auction\.settlementDeadline\) \{\s*revert SettlementExpired\(\);/);
  assert.match(page, /awaitingPayment && !settlementExpired && isSameAddress\(connectedWalletAddress, winnerAddress\)/);
});

test('anyone can close the expired settlement, as the contract allows', () => {
  // claimSettlementDefault has no sender check, like endAuction. The page mirrors
  // End Expired Auction rather than restricting it to the creator, because a
  // creator who has left must not keep the work stuck for everyone else.
  const claim = core.slice(core.indexOf('function claimSettlementDefault('));
  assert.doesNotMatch(claim.slice(0, 700), /msg\.sender/, 'the contract function is permissionless');

  assert.match(page, /\{artworkWriteEnabled && settlementExpired && \(/);
  assert.match(page, /'Close Expired Settlement'/);
  assert.match(page, /window\.ArtSoulContracts\.claimSettlementDefault\(auctionActionId, \{ idType: 'auction' \}\)/);
  assert.match(contracts, /async claimSettlementDefault\(id, options = \{\}\) \{\s*await this\.ensureBaseSepoliaWrite\(\);/,
    'the write guard still runs first');
});

test('the confirmation explains the outcome without restating frozen figures', () => {
  // Canon 3 fixes the default split. The split lives in the contract; copy that
  // repeats the numbers is copy that can drift from them.
  const handler = extractFunction(page, 'claimSettlementDefaultOnce');
  assert.match(handler, /split between the artist and the platform/);
  assert.match(handler, /the artwork stays unminted/);
  assert.match(handler, /the creator can auction it again/);
  assert.doesNotMatch(handler, /\b80\b|\b20\b|%/, 'no split percentages in the copy');
  assert.match(page, /beginTransactionAction\('settlement-default'\)/, 'a double click sends one transaction');
});

test('the status says the window is closed on the page and on every card', () => {
  assert.match(page, /settlementExpired\s*\n?\s*\? \{ key: 'settlement_expired', label: 'Payment window closed' \}/);

  const cardSandbox = vm.createContext({ exported: {}, Number, Date, Boolean, String });
  const toTimestamp = extractFunction(card, 'toTimestamp');
  vm.runInContext([
    'const SETTLEMENT_CLOCK_MARGIN_MS = 60 * 1000;',
    'const RECENT_PENDING_MS = 0;',
    "function normalize(value) { return String(value || '').toLowerCase(); }",
    'function hasWinnerOrBid() { return true; }',
    'function isMinted() { return false; }',
    'function isListedForSale() { return false; }',
    'function activeAuctionId() { return 1; }',
    toTimestamp,
    extractFunction(card, 'statusInfo'),
    'exported.statusInfo = statusInfo;'
  ].join('\n'), cardSandbox, { filename: 'artwork-card.js (extracted)' });
  const statusInfo = cardSandbox.exported.statusInfo;

  const past = Math.floor((Date.now() - 2 * 24 * 60 * MINUTE) / 1000);
  const future = Math.floor((Date.now() + 2 * 60 * MINUTE) / 1000);

  // Unix seconds as a number - what /api/public/artworks returns today.
  assert.equal(statusInfo({ status: 'settlement_pending', settlement_deadline: past }).key, 'settlement_expired');
  // As a numeric string, and as an ISO date.
  assert.equal(statusInfo({ status: 'settlement_pending', settlement_deadline: String(past) }).key, 'settlement_expired');
  assert.equal(statusInfo({ status: 'settlement_pending', settlement_deadline: new Date(past * 1000).toISOString() }).key, 'settlement_expired');
  // Still open, and no deadline at all, keep the old answer.
  assert.equal(statusInfo({ status: 'settlement_pending', settlement_deadline: future }).label, 'Awaiting payment');
  assert.equal(statusInfo({ status: 'settlement_pending' }).label, 'Awaiting payment');
});

test('the page and the cards wait out the same margin', () => {
  const margin = (source) => (source.match(/const SETTLEMENT_CLOCK_MARGIN_MS = ([^;]+);/) || [])[1];
  assert.ok(margin(page), 'the page defines the margin');
  assert.equal(margin(card), margin(page), 'a card must not call a window closed that the page would still offer to pay');
});

test('the agent layer did not gain a write', () => {
  // webmcp-tools.js pins which tools may reach the chain. Closing a settlement
  // from an agent is a separate decision, not a side effect of this row.
  assert.doesNotMatch(webmcp, /claimSettlementDefault/);
});
