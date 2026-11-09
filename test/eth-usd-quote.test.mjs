import assert from 'node:assert/strict';
import test from 'node:test';

let serial = 0;
const fresh = async () => (await import(`../src/api/eth-usd-quote.js?test=${++serial}`)).readEthUsdQuote;
const payload = (data = {}) => ({ data: { base: 'ETH', currency: 'USD', amount: '2345.6700', ...data } });
function setup(t) {
  const originalFetch = globalThis.fetch, originalNow = Date.now;
  let now = Date.UTC(2026, 10, 2, 12);
  Date.now = () => now;
  globalThis.fetch = () => { throw new Error('Unexpected network call'); };
  t.after(() => { globalThis.fetch = originalFetch; Date.now = originalNow; });
  return { advance: ms => { now += ms; }, now: () => now };
}

test('ETH quote uses only the fixed public endpoint and shares a five-minute cache across callers', async t => {
  const clock = setup(t), read = await fresh();
  let calls = 0, release;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.coinbase.com/v2/prices/ETH-USD/spot');
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    assert.deepEqual(options.headers, { Accept: 'application/json' });
    assert.ok(options.signal instanceof AbortSignal);
    if (calls === 1) await new Promise(resolve => { release = resolve; });
    return Response.json(payload());
  };
  const first = read(), concurrent = read();
  assert.equal(calls, 1); release();
  const [a, b] = await Promise.all([first, concurrent]);
  assert.deepEqual(a, { symbol: 'ETH', currency: 'USD', amount: '2345.6700', source: 'Coinbase', fetchedAt: new Date(clock.now()).toISOString() });
  assert.deepEqual(b, a); a.amount = '1';
  clock.advance(299_999);
  assert.equal((await read()).amount, '2345.6700'); assert.equal(calls, 1);
  clock.advance(1);
  assert.equal((await read()).fetchedAt, new Date(clock.now()).toISOString()); assert.equal(calls, 2);
});

test('unavailable quotes back off for one minute and do not return an expired success', async t => {
  const clock = setup(t), read = await fresh(); let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1 || calls === 3) return Response.json(payload());
    throw new Error('Synthetic upstream outage');
  };
  assert.ok(await read()); clock.advance(300_000);
  assert.equal(await read(), null); assert.equal(calls, 2);
  clock.advance(59_999);
  assert.deepEqual(await Promise.all([read(), read()]), [null, null]); assert.equal(calls, 2);
  clock.advance(1); assert.ok(await read()); assert.equal(calls, 3);
});

test('ETH quote rejects malformed money, wrong currency and provider failures without leaking payloads', async t => {
  setup(t);
  const invalid = [null, {}, { data: null }, { data: [] }, payload({ amount: 123 }), payload({ amount: '0' }),
    payload({ amount: '0.0000' }), payload({ amount: '-1' }), payload({ amount: '1e3' }), payload({ amount: ' 1' }),
    payload({ amount: '01.00' }), payload({ amount: '1.1234567890123456789' }), payload({ amount: '9'.repeat(17) }),
    payload({ amount: 'NaN' }), payload({ currency: 'EUR' }), payload({ base: 'BTC' })];
  for (const data of invalid) {
    const read = await fresh(); globalThis.fetch = async () => Response.json(data);
    assert.equal(await read(), null, JSON.stringify(data));
  }
  for (const response of [Response.json(payload(), { status: 429 }), Response.json(payload(), { status: 500 }),
    new Response('not json', { headers: { 'content-type': 'application/json' } }),
    new Response(JSON.stringify(payload()), { headers: { 'content-type': 'text/html' } }),
    new Response(Uint8Array.of(0xff), { headers: { 'content-type': 'application/json' } }),
    new Response(null, { headers: { 'content-type': 'application/json' } })]) {
    const read = await fresh(); globalThis.fetch = async () => response;
    assert.equal(await read(), null);
  }
  const read = await fresh(); globalThis.fetch = async () => Response.json(payload({ base: undefined }));
  assert.ok(await read(), 'the public response need not include the optional base field');
});

test('ETH quote limits declared and streamed JSON bodies to eight KiB', async t => {
  setup(t);
  for (const declared of [true, false]) {
    const read = await fresh(); let cancelled = false;
    globalThis.fetch = async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(8193)); },
      cancel() { cancelled = true; }
    }), { headers: { 'content-type': 'application/json', ...(declared ? { 'content-length': '8193' } : {}) } });
    assert.equal(await read(), null); assert.equal(cancelled, true);
  }
  const body = JSON.stringify(payload());
  for (const bytes of [8192, 8193]) {
    const read = await fresh(); globalThis.fetch = async () => new Response(body.padEnd(bytes, ' '), { headers: { 'content-type': 'application/json' } });
    assert.equal(Boolean(await read()), bytes === 8192);
  }
});

test('ETH quote deadline covers a stalled fetch and a stalled response body without automatic retries', async t => {
  const clock = setup(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const phase of ['fetch', 'body']) {
    const read = await fresh(); let calls = 0, signal, cancelled = false;
    globalThis.fetch = (url, options) => {
      calls++; signal = options.signal;
      if (phase === 'fetch') return new Promise(() => {});
      return Promise.resolve(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/json' } }));
    };
    const pending = read(); await Promise.resolve(); await Promise.resolve();
    t.mock.timers.tick(2000);
    assert.equal(await pending, null); assert.equal(signal.aborted, true);
    if (phase === 'body') assert.equal(cancelled, true);
    assert.equal(await read(), null); assert.equal(calls, 1);
    clock.advance(60_000);
  }
});
