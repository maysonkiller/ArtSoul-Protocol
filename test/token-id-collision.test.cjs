const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync('contracts-integration.js', 'utf8').replace(/^import .*;\r?\n/gm, '');
function adapter() {
  const window = {};
  vm.runInNewContext(source, { window, console: { log() {} }, ethers: {} });
  const api = window.ArtSoulContracts;
  const calls = [];
  api.coreContract = {
    artworks: async id => ({ minted: String(id) !== '9', tokenId: 8n }),
    getAddress: async () => '0xcore',
    listResale: async id => { calls.push(['list', String(id)]); return { hash: '0xlist', wait: async () => {} }; },
    buyResale: async id => { calls.push(['buy', String(id)]); return { hash: '0xbuy', wait: async () => {} }; },
    resaleListings: async id => ({ seller: '0xowner', price: id, active: true })
  };
  api.nftContract = {
    ownerOf: async () => '0xowner',
    getApproved: async () => '0xcore',
    isApprovedForAll: async () => true
  };
  api.signer = { getAddress: async () => '0xowner' };
  api.ensureBaseSepoliaWrite = async () => {};
  api.parseEth = value => BigInt(value);
  api.formatEth = value => String(value);
  return { api, calls };
}

test('a token id does not become the minted token of a different artwork at the same number', async () => {
  const { api } = adapter();
  assert.equal(await api.resolveTokenId(4), 4n);
  assert.equal(await api.resolveTokenId(4, { idType: 'artwork' }), 8n);
});

test('an unminted artwork cannot fall through to a token with the same number', async () => {
  const { api } = adapter();
  await assert.rejects(() => api.resolveTokenId(9, { idType: 'artwork' }), /not minted/);
});

test('profile listing uses a token id while detail listing and purchase explicitly use an artwork id', async () => {
  const { api, calls } = adapter();
  await api.listResale(4, '1');
  await api.listResale(4, '1', undefined, { idType: 'artwork' });
  await api.buyResale(4, '1', { idType: 'artwork' });
  await api.buyResale(4, '1');
  assert.deepEqual(calls, [['list', '4'], ['list', '8'], ['buy', '8'], ['buy', '4']]);
  assert.equal((await api.getResaleListing(4)).tokenId, '4');
  assert.equal((await api.getResaleListing(4, { idType: 'artwork' })).tokenId, '8');
});

test('token resolution preserves RPC failure without trying another namespace', async () => {
  const { api } = adapter();
  const failure = new Error('node unavailable');
  api.nftContract.ownerOf = async () => { throw failure; };
  await assert.rejects(() => api.resolveTokenId(4), error => error === failure);
});
