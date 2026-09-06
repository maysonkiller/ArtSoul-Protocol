const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync('src/entries/profile.jsx', 'utf8');
const handler = source.slice(source.indexOf('async function handleCreateAuction('), source.indexOf('async function handleDeleteArtwork('));

for (const [name, input] of [
  ['unsupported duration', { startingPrice: '0.01', durationHours: 12 }],
  ['empty price', { startingPrice: '', durationHours: 24 }],
  ['non-positive price', { startingPrice: '0', durationHours: 24 }]
]) {
  test(`validation of ${name} releases the profile action without requesting the wallet`, async () => {
    const busy = new Set();
    const notices = [];
    let walletCalls = 0;
    const scope = {
      beginTransactionAction: key => { busy.add(key); return key; },
      finishTransactionAction: key => busy.delete(key),
      alert: message => notices.push(message),
      window: { web3Modal: { getWalletProvider: () => { walletCalls++; return null; } } }
    };
    vm.runInNewContext(handler + '\nthis.run = handleCreateAuction;', scope);
    await scope.run({ id: 'v41:84532:7' }, input);
    assert.equal(notices.length, 1);
    assert.equal(walletCalls, 0);
    assert.equal(busy.size, 0, 'validation must not leave Processing locked');
  });
}
