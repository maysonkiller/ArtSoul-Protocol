// Runs the real base-network.js in a vm context with a scripted transport and
// an injected clock, so the route-failover tests observe actual behaviour.
//
// A-70's first pass was asserted entirely with regular expressions over the
// file. Those pass whether or not the loop can fall through, which is exactly
// the property that matters when the first endpoint stops answering.
//
// The clock is injected rather than compressed. An earlier harness shortened
// setTimeout while leaving Date.now real, which made a hanging first route look
// survivable when on a real clock it consumed the entire probe budget and the
// two healthy routes behind it were never dialled. A test that cannot see that
// is worse than no test.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE_PATH = path.join(__dirname, '..', '..', 'base-network.js');
const SOURCE = fs.readFileSync(SOURCE_PATH, 'utf8');

/**
 * @param {(url: string, init: object) => Promise<object>} handler scripted per
 *   route. Return a fake Response, or return a never-settling promise to model
 *   a node that accepts the socket and then says nothing.
 */
function loadBaseNetwork(handler) {
  const calls = [];

  // One virtual clock shared by Date.now and setTimeout. Time advances only
  // when a timer fires, which is the only thing that can move a hung request.
  let now = 0;
  let sequence = 0;
  const timers = new Map();

  const setTimeoutStub = (fn, ms) => {
    const id = ++sequence;
    timers.set(id, { at: now + Math.max(0, Number(ms) || 0), fn });
    return id;
  };
  const clearTimeoutStub = (id) => { timers.delete(id); };

  const fetchStub = (url, init = {}) => {
    const record = { url, init, aborted: false, method: null, at: now };
    try {
      record.method = JSON.parse(init.body).method;
    } catch {
      record.method = null;
    }
    calls.push(record);

    const signal = init.signal;
    const scripted = Promise.resolve().then(() => handler(url, init));
    if (!signal) return scripted;

    return new Promise((resolve, reject) => {
      const onAbort = () => {
        record.aborted = true;
        const error = new Error('The operation was aborted.');
        error.name = 'AbortError';
        reject(error);
      };
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
      scripted.then(
        (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
        (error) => { signal.removeEventListener('abort', onAbort); reject(error); }
      );
    });
  };

  const windowStub = {};
  const context = vm.createContext({
    window: windowStub,
    fetch: fetchStub,
    AbortController,
    setTimeout: setTimeoutStub,
    clearTimeout: clearTimeoutStub,
    Date: { now: () => now },
    console
  });

  vm.runInContext(SOURCE, context, { filename: 'base-network.js' });

  /**
   * Run a promise from the module to completion on the virtual clock and report
   * how much time it actually needed. Everything that can settle without the
   * clock settles first; only then is the earliest pending timer fired.
   */
  async function drive(promise) {
    let done = false;
    let value;
    let failure;
    promise.then(
      (result) => { done = true; value = result; },
      (error) => { done = true; failure = error; }
    );

    for (let guard = 0; guard < 1000 && !done; guard += 1) {
      for (let turn = 0; turn < 4 && !done; turn += 1) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      if (done || timers.size === 0) break;

      let nextId = null;
      let nextAt = Infinity;
      for (const [id, timer] of timers) {
        if (timer.at < nextAt) { nextAt = timer.at; nextId = id; }
      }
      const timer = timers.get(nextId);
      timers.delete(nextId);
      now = Math.max(now, timer.at);
      timer.fn();
    }

    if (!done) throw new Error('the harness ran out of ways to advance this call');
    if (failure) {
      const error = failure;
      error.elapsed = now;
      throw error;
    }
    return { value, elapsed: now };
  }

  return { api: windowStub.ArtSoulBaseSepolia, calls, drive, elapsed: () => now };
}

/** A fake Response good enough for the module's use of it. */
function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function result(value) {
  return jsonResponse({ jsonrpc: '2.0', id: 1, result: value });
}

function rpcError(code, message) {
  return jsonResponse({ jsonrpc: '2.0', id: 1, error: { code, message } });
}

function httpError(status, message = 'no backend is currently healthy to serve traffic') {
  return jsonResponse({ message }, status);
}

/** A node that accepts the request and never answers. */
function hang() {
  return new Promise(() => {});
}

const BASE_SEPOLIA_CHAIN_ID_HEX = '0x14a34';

module.exports = {
  loadBaseNetwork, jsonResponse, result, rpcError, httpError, hang, BASE_SEPOLIA_CHAIN_ID_HEX
};
