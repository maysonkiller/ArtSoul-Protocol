import test from 'node:test';
import assert from 'node:assert/strict';
import { createSavedStore, savedKey } from '../src/features/saved/saved-state.js';

const A = '0x' + 'a'.repeat(40), B = '0x' + 'b'.repeat(40), core = '0x' + 'c'.repeat(40);
const item = { chain_id: 84532, core_address: core, artwork_id: '34' };
const row = { ...item, artwork: { title: 'Artwork' }, created_at: '2026-10-24T00:00:00Z' };
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => ({chainId:84532,coreAddress:core,...data}) });
function harness() {
  let wallet = A;
  const calls = [];
  const store = createSavedStore({ getWallet: () => wallet, request: (url, options) => new Promise(resolve => calls.push({ url, options, resolve })) });
  return { store, calls, switchWallet(value) { wallet = value; store.invalidate(); } };
}
test('Saved identity distinguishes deployment and chain but not auction or token', () => {
  assert.equal(savedKey({ ...item, auction_id: 99, token_id: 8 }), savedKey(item));
  assert.notEqual(savedKey({ ...item, core_address: B }), savedKey(item));
  assert.notEqual(savedKey({ ...item, chain_id: 8453 }), savedKey(item));
  for (const artwork_id of ['0', '01', '-1', '1,2', (2n ** 256n).toString()]) assert.equal(savedKey({ ...item, artwork_id }), '');
});
test('private requests use no-store, session cookies and expected wallet', async () => {
  const { store, calls } = harness();
  const pending = store.lookup([item, item]);
  assert.equal(calls[0].url, `/api/saved?artwork_ids=34&chain_id=84532&core_address=${core}`);
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[0].options.headers['X-ArtSoul-Wallet'], A);
  calls[0].resolve(response({ wallet: A, artworkIds: ['34'] })); await pending;
  assert.equal(store.getState().saved.get(savedKey(item)), true);
});
test('switching wallets clears immediately and rejects an old response even if transport ignores abort', async () => {
  const { store, calls, switchWallet } = harness();
  const pending = store.load();
  switchWallet(B);
  assert.equal(calls[0].options.signal.aborted, true);
  calls[0].resolve(response({ wallet: A, items: [row], nextCursor: '123' })); await pending;
  assert.equal(store.getState().owner, B);
  assert.deepEqual(store.getState().items, []);
  assert.equal(store.getState().saved.size, 0);
});
test('a server session belonging to another wallet never paints its list', async () => {
  const { store, calls } = harness();
  const pending = store.load();
  calls[0].resolve(response({ wallet: B, items: [row] })); await pending;
  assert.equal(store.getState().status, 'auth');
  assert.deepEqual(store.getState().items, []);
});
test('expired session clears previously visible saves', async () => {
  const { store, calls } = harness();
  const initial = store.load(); calls[0].resolve(response({ wallet: A, items: [row] })); await initial;
  const expired = store.lookup([item]); calls[1].resolve(response({}, 401)); await expired;
  assert.equal(store.getState().status, 'auth');
  assert.equal(store.getState().saved.size, 0);
  assert.deepEqual(store.getState().items, []);
});
test('failed save never displays optimistic success and a retry sends the same idempotent value', async () => {
  const { store, calls } = harness();
  const save = store.set(item, true);
  assert.equal(store.getState().saved.has(savedKey(item)), false);
  assert.equal(await store.set(item, false), false);
  calls[0].resolve(response({}, 500)); assert.equal(await save, false);
  assert.equal(store.getState().saved.has(savedKey(item)), false);
  assert.equal(store.getState().pending.size, 0);
  const retry = store.set(item, true);
  assert.equal(calls[0].options.body, calls[1].options.body);
  assert.deepEqual(JSON.parse(calls[1].options.body), { ...item, saved: true });
  calls[1].resolve(response({ wallet: A, saved: true })); await retry;
  assert.equal(store.getState().saved.get(savedKey(item)), true);
});
test('late lookup cannot undo a confirmed save, including reads started during the write', async () => {
  const { store, calls } = harness();
  const save = store.set(item, true);
  const read = store.lookup([item]);
  calls[0].resolve(response({ wallet: A, saved: true })); await save;
  calls[1].resolve(response({ wallet: A, artworkIds: [] })); await read;
  assert.equal(store.getState().saved.get(savedKey(item)), true);
});
test('late list cannot restore a removed item', async () => {
  const { store, calls } = harness();
  const removal = store.set(item, false);
  const read = store.load();
  calls[0].resolve(response({ wallet: A, saved: false })); await removal;
  calls[1].resolve(response({ wallet: A, items: [row] })); await read;
  assert.deepEqual(store.getState().items, []);
  assert.equal(store.getState().saved.get(savedKey(item)), false);
});
test('older page requests cannot replace a newer list and pagination deduplicates identities', async () => {
  const { store, calls } = harness();
  const old = store.load(), latest = store.load();
  calls[1].resolve(response({ wallet: A, items: [row], nextCursor: '21' })); await latest;
  calls[0].resolve(response({ wallet: A, items: [] })); await old;
  assert.equal(store.getState().items.length, 1);
  const more = store.load('21');
  calls[2].resolve(response({ wallet: A, items: [row, { ...row, artwork_id: '35', artwork: null }], nextCursor: null })); await more;
  assert.equal(store.getState().items.length, 2);
  assert.equal(store.getState().nextCursor, null);
});
test('logout during a write suppresses acknowledgement and clears pending state', async () => {
  const { store, calls, switchWallet } = harness();
  const pending = store.set(item, true); switchWallet('');
  calls[0].resolve(response({ wallet: A, saved: true })); await pending;
  assert.equal(store.getState().saved.size, 0);
  assert.equal(store.getState().pending.size, 0);
});
test('removing an unavailable old-deployment bookmark keeps the exact original identity', async () => {
  const { store, calls } = harness();
  const old = { ...item, core_address: B };
  const pending = store.set(old, false);
  assert.deepEqual(JSON.parse(calls[0].options.body), { ...old, saved: false });
  calls[0].resolve(response({ wallet: A, saved: false })); await pending;
  assert.equal(store.getState().saved.get(savedKey(old)), false);
});
test('successful writes mark an open Saved list for hydration, including a write during its read', async () => {
  const { store, calls } = harness();
  const initial = store.load();
  const save = store.set(item, true);
  calls[1].resolve(response({ wallet: A, saved: true })); await save;
  calls[0].resolve(response({ wallet: A, items: [] })); await initial;
  assert.notEqual(store.getState().listVersion, store.getState().loadedVersion);
  const refresh = store.load();
  calls[2].resolve(response({ wallet: A, items: [row] })); await refresh;
  assert.equal(store.getState().listVersion, store.getState().loadedVersion);
  assert.equal(store.getState().items.length, 1);
});
test('an old list failure cannot replace a newer successful list with an error', async () => {
  const { store, calls } = harness();
  const old = store.load(), latest = store.load();
  calls[1].resolve(response({ wallet: A, items: [row] })); await latest;
  calls[0].resolve(response({}, 503)); await old;
  assert.equal(store.getState().status, 'ready');
  assert.equal(store.getState().items.length, 1);
});
test('lookup cannot apply a saved ID from a different deployment', async () => {
  const { store, calls } = harness();
  const pending = store.lookup([item]);
  calls[0].resolve(response({ wallet: A, coreAddress: B, artworkIds: ['34'] }));
  assert.equal(await pending, false);
  assert.equal(store.getState().saved.size, 0);
});
