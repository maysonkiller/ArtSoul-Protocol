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

function auctionHarness({ postConfirmationNetworkError, postConfirmationChainId = 84532, createError, syncError } = {}) {
  const busy = new Set();
  const notices = [];
  const calls = { create: 0, refresh: 0, sync: 0, confirmed: false };
  const scope = {
    console: { log() {}, warn() {}, error() {} },
    beginTransactionAction: key => { busy.add(key); return key; },
    finishTransactionAction: key => busy.delete(key),
    canCreateNewAuction: () => true,
    alert: message => notices.push(message),
    loadMyArtworks: () => { calls.refresh++; },
    getTransactionErrorMessage: error => error.message,
    window: {
      web3Modal: { getWalletProvider: async () => ({}) },
      getCurrentWalletAddress: () => '0x1111111111111111111111111111111111111111',
      ArtSoulDB: { updateArtwork: async () => { calls.sync++; if (syncError) throw syncError; } },
      ArtSoulContracts: {
        init: async () => {},
        getArtwork: async () => ({ status: 0 }),
        provider: {
          getNetwork: async () => {
            if (calls.confirmed && postConfirmationNetworkError) throw postConfirmationNetworkError;
            return { chainId: calls.confirmed ? postConfirmationChainId : 84532 };
          }
        },
        createAuction: async () => {
          calls.create++;
          if (createError) throw createError;
          // The real adapter resolves only after tx.wait() has confirmed.
          calls.confirmed = true;
          return '0x' + 'a'.repeat(64);
        }
      }
    }
  };
  vm.runInNewContext(handler + '\nthis.run = handleCreateAuction;', scope);
  return { ...scope, busy, notices, calls };
}

const validAuction = { startingPrice: '0.01', durationHours: 24 };
const artwork = { id: 'v41:84532:7', blockchain_id: '7' };

test('a confirmed auction stays successful when a later network read fails', async () => {
  const h = auctionHarness({ postConfirmationNetworkError: Object.assign(new Error('RPC connection closed'), { code: 'NETWORK_ERROR' }) });
  await h.run(artwork, validAuction);
  assert.equal(h.calls.confirmed, true);
  assert.match(h.notices.join(' '), /Auction created successfully/);
  assert.doesNotMatch(h.notices.join(' '), /could not be created|try again/i);
  assert.equal(h.calls.refresh, 1);
  assert.equal(h.busy.size, 0);
});

test('switching networks after confirmation cannot undo the confirmed auction', async () => {
  const h = auctionHarness({ postConfirmationChainId: 1 });
  await h.run(artwork, validAuction);
  assert.equal(h.calls.confirmed, true);
  assert.match(h.notices.join(' '), /Auction created successfully/);
  assert.doesNotMatch(h.notices.join(' '), /could not be created|try again/i);
  assert.equal(h.calls.create, 1);
  assert.equal(h.busy.size, 0);
});

test('a transport error before confirmation is not relabelled as a wallet network switch', async () => {
  const h = auctionHarness({ createError: Object.assign(new Error('RPC connection closed'), { code: 'NETWORK_ERROR' }) });
  await h.run(artwork, validAuction);
  assert.equal(h.calls.confirmed, false);
  assert.match(h.notices.join(' '), /RPC connection closed/);
  assert.doesNotMatch(h.notices.join(' '), /Network was changed|created successfully/);
  assert.equal(h.calls.refresh, 0);
  assert.equal(h.busy.size, 0);
});

test('a failed legacy write does not turn a confirmed auction into a failure', async () => {
  const h = auctionHarness({ syncError: new Error('Legacy writes are disabled') });
  await h.run(artwork, validAuction);
  assert.equal(h.calls.confirmed, true);
  assert.match(h.notices.join(' '), /Auction created successfully/);
  assert.equal(h.calls.refresh, 1);
  assert.equal(h.busy.size, 0);
});

const adapterSource = fs.readFileSync('contracts-integration.js', 'utf8');
const createMethod = adapterSource.slice(adapterSource.indexOf('    async createAuction('), adapterSource.indexOf('    async placeBid('))
  .replace('async createAuction(', 'async function createAuction(');
const createAuction = vm.runInNewContext(createMethod + '\ncreateAuction;', { console: { log() {}, warn() {} } });

test('the real auction adapter guards the chain and waits for the receipt before reporting success', async () => {
  let confirm;
  const receipt = new Promise(resolve => { confirm = resolve; });
  const calls = [];
  const adapter = {
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
