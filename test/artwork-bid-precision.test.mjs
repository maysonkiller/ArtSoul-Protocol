import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { parseUserEthAmount } from '../src/features/auction/eth-amount.js';

const source = fs.readFileSync('src/entries/artwork.jsx', 'utf8');
function extract(name) {
  const start = new RegExp(`^([ \\t]*)(?:async )?function ${name}\\(`, 'm').exec(source);
  assert.ok(start, `Shipped function ${name} exists`);
  const tail = source.slice(start.index);
  const end = new RegExp(`^${start[1]}}`, 'm').exec(tail);
  assert.ok(end, `Shipped function ${name} closes at its outer indentation`);
  return tail.slice(0, end.index + end[0].length);
}

function page() {
  const helperCalls = [];
  const scope = {
    parseUserEthAmount, console: { warn() {} },
    getAuctionHelper(name) {
      return () => {
        helperCalls.push(name);
        return name === 'validateBidAmount' ? { valid: true } : 0.41;
      };
    }
  };
  const constants = ['WEI_PER_ETH', 'MIN_ABSOLUTE_BID_INCREMENT_WEI', 'BID_INCREMENT_BPS', 'BPS_DENOMINATOR']
    .map(name => source.match(new RegExp(`const ${name} = [^;]+;`))?.[0]);
  assert.ok(constants.every(Boolean), 'the shipped fixed protocol constants are present');
  const functions = ['firstDefined', 'parseEthToWei', 'formatWeiToEth',
    'getAuctionHighestBidWei', 'getAuctionStartingBidWei', 'calculateMinimumBidDetails',
    'friendlyMinimumBidMessage', 'validateBidAmountSafe'].map(extract);
  vm.runInNewContext([...constants, ...functions].join('\n'), scope);
  return { scope, helperCalls };
}

test('one-wei starting price remains a positive exact minimum and valid prefill', () => {
  const { scope, helperCalls } = page();
  const minimum = scope.calculateMinimumBidDetails({ highestBid: '0', startingPrice: '0.000000000000000001' });
  assert.equal(minimum.wei, 1n);
  assert.equal(minimum.eth, '0.000000000000000001');
  assert.equal(scope.validateBidAmountSafe(minimum.eth, minimum).valid, true);
  assert.equal(helperCalls.length, 0, 'floating helpers cannot change the exact monetary result');
});

test('contract-quoted minimum and current bid formatting preserve all eighteen decimal places', () => {
  const { scope } = page();
  const eth = '0.410000000000000002';
  const minimum = scope.calculateMinimumBidDetails({ minimumBid: eth, highestBid: '0.4' });
  assert.equal(minimum.wei, 410000000000000002n);
  assert.equal(minimum.eth, eth);
  assert.equal(scope.formatWeiToEth(1000000000000000001n), '1.000000000000000001');
  assert.equal(scope.formatWeiToEth(1n), '0.000000000000000001');
});

test('minimum fallback matches the existing absolute increment and upward percentage rounding at one-wei boundaries', () => {
  const { scope, helperCalls } = page();
  // Existing contract minimumBid: highest + max(0.01 ETH, ceil(highest * 250 / 10000)).
  const cases = [
    ['0.000000000000000001', '0.010000000000000001'],
    ['0.123456789012345678', '0.133456789012345678'],
    ['0.4', '0.41'],
    ['0.400000000000000001', '0.410000000000000002'],
    ['1.000000000000000001', '1.025000000000000002']
  ];
  for (const [highestBid, expected] of cases) {
    const minimum = scope.calculateMinimumBidDetails({ highestBid, startingPrice: '0.00001' });
    assert.equal(minimum.eth, expected, highestBid);
    assert.equal(minimum.wei, parseUserEthAmount(expected).wei, highestBid);
  }
  assert.equal(helperCalls.length, 0);
});

test('one wei below the minimum is rejected even when the legacy helper would accept it', () => {
  const { scope, helperCalls } = page();
  const minimum = { wei: 410000000000000002n, eth: '0.410000000000000002' };
  const below = scope.validateBidAmountSafe('0.410000000000000001', minimum);
  assert.equal(below.valid, false);
  assert.match(below.error, /0\.410000000000000002 ETH/);
  assert.equal(scope.validateBidAmountSafe(minimum.eth, minimum).valid, true);
  assert.equal(scope.validateBidAmountSafe('0.410000000000000003', minimum).valid, true);
  assert.equal(helperCalls.length, 0);
});

test('bid validation uses the exact user-amount parser including comma and whitespace normalization', () => {
  const { scope } = page();
  const minimum = { wei: 1000000000000001n, eth: '0.001000000000000001' };
  assert.equal(scope.validateBidAmountSafe(' 0,001000000000000001 ', minimum).valid, true);
  assert.equal(scope.validateBidAmountSafe('0,001', minimum).valid, false);
  for (const input of ['', ' ', '0', '-1', '+1', 'NaN', 'Infinity', '1e-3', '0x10',
    '0.001,2', '0,001.2', '0.0000000000000000001', 0.001, null, undefined]) {
    const result = scope.validateBidAmountSafe(input, minimum);
    assert.equal(result.valid, false, `Reject ${JSON.stringify(input)}`);
    assert.ok(result.error, 'invalid values have an actionable error');
  }
});

test('long integer user input is interpreted as ETH and never silently treated as raw wei', () => {
  const { scope } = page();
  const minimum = { wei: 2000000000000000n, eth: '0.002' };
  assert.equal(scope.validateBidAmountSafe('1000000000000000', minimum).valid, true);
});
