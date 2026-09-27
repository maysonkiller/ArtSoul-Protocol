const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

// Profile navigation and the shared form are exercised behaviorally in
// auction-creation-flow.test.mjs; these checks retain the adapter receipt gate.
const adapterSource = fs.readFileSync('contracts-integration.js', 'utf8');
const adapterWindow = {};
vm.runInNewContext(adapterSource.replace(/^import .*;\r?\n/gm, ''), {
  window: adapterWindow, ethers: {}, console: { log() {}, warn() {} }
});
const createAuction = adapterWindow.ArtSoulContracts.createAuction;

test('the real auction adapter guards the chain and waits for the receipt before reporting success', async () => {
  let confirm;
  const receipt = new Promise(resolve => { confirm = resolve; });
  const calls = [];
  const adapter = {
    assertExpectedWallet: async () => {},
    waitForConfirmedTransaction: adapterWindow.ArtSoulContracts.waitForConfirmedTransaction,
    publishAuctionReceipt: async () => {},
    ensureBaseSepoliaWrite: async () => { calls.push('guard'); },
    ensureCore: () => { calls.push('core'); },
    parseEth: value => value,
    normalizeDuration: value => value * 3600,
    coreContract: { createAuction: async (...args) => {
      calls.push(['send', ...args]);
      return { hash: '0xconfirmed', wait: () => receipt };
    } }
  };
  let settled = false;
  const pending = createAuction.call(adapter, '7', '0.01', 24).then(hash => { settled = true; return hash; });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['guard', 'core', ['send', '7', '0.01', 86400]]);
  assert.equal(settled, false, 'sending a transaction is not confirmation');
  confirm({ status: 1 });
  assert.equal(await pending, '0xconfirmed');
});

test('the real auction adapter never sends when the shared chain guard rejects', async () => {
  const guardError = new Error('Base Sepolia is required');
  let sent = false;
  const adapter = {
    ensureBaseSepoliaWrite: async () => { throw guardError; },
    coreContract: { createAuction: async () => { sent = true; } }
  };
  await assert.rejects(createAuction.call(adapter, '7', '0.01', 24), error => error === guardError);
  assert.equal(sent, false);
});
