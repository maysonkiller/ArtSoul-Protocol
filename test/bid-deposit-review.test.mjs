import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import {parseUserEthAmount} from '../src/features/auction/eth-amount.js';

const source = fs.readFileSync('src/entries/artwork.jsx', 'utf8');
function extract(name) {
  const start = new RegExp(`^([ \\t]*)(?:async )?function ${name}\\(`, 'm').exec(source);
  const tail = source.slice(start.index);
  const end = new RegExp(`^${start[1]}}`, 'm').exec(tail);
  return tail.slice(0, end.index + end[0].length);
}
const creator = '0x1111111111111111111111111111111111111111';
const collector = '0x2222222222222222222222222222222222222222';
function harness({wallet = collector, value = '0,00001', highest = '', approved = false, liveWallet = wallet} = {}) {
  const notices = [], writes = [], reviews = [];
  let quoted;
  const scope = {
    parseUserEthAmount, WEI_PER_ETH: 10n ** 18n, bidAmount: value,
    artwork: {creator_id: creator, blockchain_id: '28'}, auction: {},
    ensureArtworkWriteEnabled: () => true, isAuctionClosedForBidding: () => false,
    calculateMinimumBidDetails: () => ({wei: 10000000000000n, eth: '0.00001'}),
    getAuctionHighestBidder: () => highest, getAuctionActionId: () => '63',
    isSameAddress: (a, b) => Boolean(a && b && a.toLowerCase() === b.toLowerCase()),
    isZeroAddress: a => !a || /^0x0+$/.test(a),
    canPlaceBidSafe: async () => ({canBid: true}), validateBidAmountSafe: () => ({valid: true}),
    getLiveProviderAccount: async () => liveWallet,
    confirmAuctionAction: async message => { reviews.push(message); return approved; },
    refreshLiveBidActivity: async () => {}, alert: message => notices.push(message),
    console: {log() {}, warn() {}, error() {}},
    getTransactionErrorMessage: error => error.message,
    formatBidFailureMessage: error => error.message,
    window: {currentWalletAddress: wallet, web3Modal: {getWalletProvider: async () => ({})},
      ArtSoulContracts: {
        init: async () => {},
        getRequiredBidDeposit: async value => {quoted = value; return 10000000000000000n;},
        placeBid: async (...args) => writes.push(args)
      }}
  };
  vm.runInNewContext(['formatWeiToEth', 'requiredDepositForBidWei', 'placeBidOnce'].map(extract).join('\n'), scope);
  return {scope, notices, writes, reviews, quote: () => quoted};
}

test('deposit preview preserves the minimum and rounds percentage deposits upward by wei', () => {
  const {scope} = harness();
  assert.equal(scope.requiredDepositForBidWei('0,00001'), 10000000000000000n);
  assert.equal(scope.requiredDepositForBidWei('0.1'), 10000000000000000n);
  assert.equal(scope.requiredDepositForBidWei('0.100000000000000001'), 10000000000000001n);
  assert.equal(scope.requiredDepositForBidWei('1'), 100000000000000000n);
  assert.equal(scope.requiredDepositForBidWei('0.0000000000000000001'), 0n);
});

test('the bid review uses the contract deposit quote, exact normalized amount and separate gas', async () => {
  const h = harness({approved: true});
  await h.scope.placeBidOnce();
  assert.equal(h.quote(), '0.00001');
  assert.match(h.reviews[0], /Bid: 0\.00001 ETH\. Pay now: 0\.01 ETH deposit/);
  assert.match(h.reviews[0], /wallet-estimated gas on Base Sepolia/);
  assert.match(h.reviews[0], /remaining settlement payment is 0 ETH within 24 hours/);
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0][0], '63');
  assert.equal(h.writes[0][1], '0.00001');
  assert.equal(h.writes[0][2].expectedWallet, collector);
  assert.equal(h.writes[0][2].expectedChainId, 84532);
});

test('cancelling the review sends no transaction and retains the input', async () => {
  const h = harness();
  await h.scope.placeBidOnce();
  assert.equal(h.reviews.length, 1);
  assert.equal(h.writes.length, 0);
  assert.equal(h.scope.bidAmount, '0,00001');
});

test('creator and self-outbid are rejected by actual addresses before quote or wallet write', async () => {
  for (const options of [{wallet: creator.toUpperCase()}, {highest: collector}]) {
    const h = harness(options);
    await h.scope.placeBidOnce();
    assert.equal(h.writes.length, 0);
    assert.equal(h.reviews.length, 0);
    assert.equal(h.quote(), undefined);
    assert.match(h.notices[0], /Creators cannot bid|already the highest bidder/);
  }
});
