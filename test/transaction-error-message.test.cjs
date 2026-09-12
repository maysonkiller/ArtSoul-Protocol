const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync('contracts-integration.js', 'utf8').replace(/^import .*;\r?\n/gm, '');
const window = {};
vm.runInNewContext(source, { window, console: { log() {} }, ethers: {} });
const message = window.ArtSoulTransactionErrors.message;
const diagnostic = 'Transaction creation failed.\nURL: https://sepolia.base.org\nRequest body: {"method":"eth_estimateGas","params":[{"data":"0x' + 'abcd'.repeat(200) + '"}]}\nDetails: EVM error: OutOfFunds\nVersion: viem@2.47.6';

test('the recorded OutOfFunds estimate failure has a useful balance message, not calldata', () => {
  const result = message({ message: diagnostic });
  assert.equal(result, 'Not enough testnet ETH to cover the transaction and gas.');
  assert.doesNotMatch(result, /https?:|Request body|eth_estimateGas|viem|abcd/);
});

test('nested wallet errors remain precise and circular causes are bounded', () => {
  const error = { shortMessage: 'Transaction failed', cause: { details: 'OutOfFunds' } };
  error.cause.cause = error;
  assert.match(message(error), /Not enough testnet ETH/);
  assert.equal(message({ cause: { code: 4001 } }), 'Transaction was rejected in your wallet.');
  assert.equal(message({ cause: { cause: { cause: { cause: { code: 4001 } } } } }), 'Transaction was rejected in your wallet.');
});

test('generic RPC diagnostics are removed while an explicit contract reason is preserved', () => {
  const generic = diagnostic.replace('OutOfFunds', 'unknown backend failure');
  assert.equal(message({ message: generic }), 'Transaction creation failed.');
  assert.equal(message({ shortMessage: 'Transaction creation failed.', reason: 'AuctionPaused' }), 'AuctionPaused');
  assert.doesNotMatch(message({ message: generic }), /nothing.*sent|contract rejected/i);
  assert.equal(message({ message: 'Internal JSON-RPC error.', error: { message: 'execution reverted: AuctionPaused' } }), 'Transaction reverted: AuctionPaused');
  assert.equal(message({ message: 'Transaction creation failed.', cause: { reason: 'AuctionPaused' } }), 'AuctionPaused');
});

test('unknown reasons are bounded and internal error codes do not become the public explanation', () => {
  assert.ok(message({ message: 'Unexpected response '.repeat(100) }).length <= 240);
  assert.equal(message({ shortMessage: 'CALL_EXCEPTION', message: 'missing revert data' }, 'Could not confirm the result.'), 'Could not confirm the result.');
});
