// A-73 / A-70: a route list only helps if no route can hold the caller.
//
// base-network.js exists because one public endpoint stopped answering and the
// account menu, which had a single address, showed a bare ellipsis where the
// balance goes. The list repaired that for a node that answers badly. It did
// not repair it for a node that accepts the socket and then says nothing: with
// no timeout on the fetch, the first route holds the loop forever and the two
// behind it are never dialled at all.
//
// These tests run the real module against a fake fetch, including a route that
// never resolves, because that is the case the list was built for.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'base-network.js'), 'utf8');

// Loads base-network.js with a fetch of the test's choosing and hands back the
// frozen ArtSoulBaseSepolia it publishes.
function load(fetchImpl) {
  const window = {};
  const context = vm.createContext({
    window,
    fetch: fetchImpl,
    setTimeout,
    clearTimeout,
    AbortController,
    Date,
    Math,
    JSON,
    Error
  });
  vm.runInContext(source, context, { filename: 'base-network.js' });
  return window.ArtSoulBaseSepolia;
}

const answer = (result) => ({
  ok: true,
  json: async () => ({ jsonrpc: '2.0', id: 1, result })
});

test('a route that never answers does not stop the next one', async () => {
  // The whole point. Before this, the first URL's fetch had no signal, so a
  // hung socket meant the balance never arrived and never failed either.
  const dialled = [];
  const api = load((url, init) => {
    dialled.push(url);
    if (dialled.length === 1) {
      // Never resolves on its own; only the abort signal can end it.
      return new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }
    return Promise.resolve(answer('0x2a'));
  });

  assert.equal(await api.rpc('eth_getBalance', []), '0x2a');
  assert.equal(dialled.length, 2, 'the second route must be dialled');
  assert.equal(dialled[0], api.rpcUrls[0]);
  assert.equal(dialled[1], api.rpcUrls[1]);
});

test('every attempt carries an abort signal', async () => {
  const signals = [];
  const api = load((url, init) => {
    signals.push(init.signal);
    return Promise.resolve(answer('0x1'));
  });

  await api.rpc('eth_blockNumber', []);
  assert.equal(signals.length, 1);
  assert.ok(signals[0] instanceof AbortSignal, 'the fetch must be abortable');
  assert.equal(signals[0].aborted, false, 'a route that answers must not be aborted');
});

test('the whole call is bounded, not just each attempt', async () => {
  // Three routes at three seconds each is nine seconds of ellipsis in an open
  // menu. The loop stops at the shared deadline instead.
  const attemptMs = Number((source.match(/ATTEMPT_TIMEOUT_MS = (\d+)/) || [])[1]);
  const totalMs = Number((source.match(/TOTAL_TIMEOUT_MS = (\d+)/) || [])[1]);

  assert.ok(Number.isFinite(attemptMs) && attemptMs > 0, 'a per-attempt bound must exist');
  assert.ok(Number.isFinite(totalMs) && totalMs > attemptMs, 'a total bound must exist and exceed one attempt');
  assert.ok(
    totalMs < attemptMs * 3,
    'the total must be shorter than dialling every route at full length, or it bounds nothing'
  );
  assert.match(source, /Math\.min\(ATTEMPT_TIMEOUT_MS, remaining\)/, 'the last attempt must not outlive the deadline');
});

test('a dead list still reports the last real failure', async () => {
  // A caller that learns nothing came back can say so. A caller that waits
  // forever cannot.
  const api = load(() => Promise.reject(new Error('getaddrinfo ENOTFOUND')));
  await assert.rejects(api.rpc('eth_blockNumber', []), /ENOTFOUND/);
});

test('an RPC error on one route is not the end of the list', async () => {
  let call = 0;
  const api = load(() => {
    call += 1;
    if (call === 1) {
      return Promise.resolve({ ok: true, json: async () => ({ error: { message: 'no backend is currently healthy to serve traffic' } }) });
    }
    return Promise.resolve(answer('0x7'));
  });

  assert.equal(await api.rpc('eth_call', []), '0x7');
  assert.equal(call, 2);
});

test('the list is still Base Sepolia only', () => {
  // Canon 13. These are additional routes to 84532, never another network.
  const api = load(() => Promise.resolve(answer('0x0')));
  assert.equal(api.chainId, 84532);
  assert.ok(api.rpcUrls.length >= 3);
  for (const url of api.rpcUrls) {
    assert.match(url, /sepolia/i, url);
    assert.match(url, /^https:\/\//, url);
  }
});
