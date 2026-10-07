import assert from 'node:assert/strict';
import test from 'node:test';
import handler from '../src/api/routes/moderation/notifications.js';
import { setWalletSession } from '../src/api/backend.js';
import { createNotificationInbox } from '../src/features/moderation/notification-inbox-state.js';

const A = `0x${'a'.repeat(40)}`, B = `0x${'b'.repeat(40)}`;
function response() {
  return { headers: {}, statusCode: 200,
    setHeader(k, v) { this.headers[k] = v; }, status(s) { this.statusCode = s; return this; },
    json(body) { this.body = body; return this; }, end() {} };
}
const REPORT = '11111111-1111-1111-1111-111111111111';
const notification = (id = '1') => ({ id, report_id: REPORT, notification_type: 'REPORT_RESOLVED', created_at: '2026-09-29T10:00:00.000Z' });
const artwork = {id: REPORT, chain_id: '84532', artwork_id: '101'};

test('recipient notifications authenticate, scope, paginate and project safely', async t => {
  const env = { SESSION_SECRET: 'local-inbox-only-secret', SUPABASE_URL: 'https://inbox.example.test', SUPABASE_SERVICE_ROLE_KEY: 'local-not-a-key' };
  const prior = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, env);
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [k, v] of Object.entries(prior)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });
  const cookie = response(); setWalletSession(cookie, A);
  const headers = { cookie: cookie.headers['Set-Cookie'].split(';')[0] };
  async function call(query = {}, h = headers, method = 'GET') {
    const res = response(); await handler({method, headers: h, query}, res); return res;
  }
  await t.test('guest and invalid signature never query storage; no state-changing method exists', async () => {
    globalThis.fetch = () => { throw new Error('unexpected database access'); };
    assert.equal((await call({}, {})).statusCode, 401);
    assert.equal((await call({}, {cookie: `${headers.cookie}tampered`})).statusCode, 401);
    assert.equal((await call({}, headers, 'POST')).statusCode, 405);
    assert.equal((await call({}, headers, 'OPTIONS')).statusCode, 204);
    assert.equal((await call({}, {})).headers['Cache-Control'], 'private, no-store');
  });
  await t.test('query-selected recipient, staff role and private row fields cannot escape the session scope', async () => {
    let url;
    globalThis.fetch = async input => {
      if (String(input).includes('/artwork_reports?')) {
        const reference = new URL(input);
        assert.equal(reference.searchParams.get('id'), `in.(${REPORT})`);
        assert.equal(reference.searchParams.get('select'), 'id,chain_id::text,artwork_id::text');
        assert.equal(reference.searchParams.get('limit'), '20');
        return Response.json([artwork]);
      }
      url = new URL(input);
      return Response.json([{...notification(), recipient_wallet: A,
        details: 'private complaint', decision_reason: 'private staff note', reference_url: 'private evidence'}]);
    };
    const result = await call({wallet: B, recipient_wallet: B, limit: '1000000', role: 'admin'});
    assert.equal(result.statusCode, 200);
    assert.equal(url.searchParams.get('recipient_wallet'), `eq.${A}`);
    assert.equal(url.searchParams.get('select'), 'id::text,report_id,notification_type,created_at');
    assert.equal(url.searchParams.get('limit'), '21');
    assert.deepEqual(Object.keys(result.body.items[0]).sort(), ['artwork_id', 'chain_id', 'created_at', 'id', 'message', 'type']);
    assert.equal(result.body.items[0].artwork_id, '101');
    assert.equal(result.body.wallet, A);
    assert.doesNotMatch(JSON.stringify(result.body), /private|recipient_wallet|report_id/);
  });
  await t.test('connected wallet mismatch rejects before storage and cannot choose another recipient', async () => {
    globalThis.fetch = () => { throw new Error('unexpected database access'); };
    const result = await call({}, {...headers, 'x-artsoul-wallet': B});
    assert.equal(result.statusCode, 401); assert.equal(result.body.error, 'SESSION_WALLET_MISMATCH');
  });
  await t.test('BIGINT cursor retains exact precision and 20 plus sentinel rows remain bounded', async () => {
    const top = 9007199254741050n;
    globalThis.fetch = async input => {
      if (String(input).includes('/artwork_reports?')) return Response.json([artwork]);
      const url = new URL(input);
      assert.equal(url.searchParams.get('id'), `lt.${top}`);
      assert.equal(url.searchParams.get('order'), 'id.desc');
      return Response.json(Array.from({length: 21}, (_, i) => notification(String(top - 1n - BigInt(i)))));
    };
    const result = await call({before: String(top)});
    assert.equal(result.body.items.length, 20);
    assert.equal(result.body.nextCursor, String(top - 20n));
  });
  await t.test('reference lookup is limited to scoped rows and preserves two distinct artworks', async () => {
    const otherReport = '22222222-2222-2222-2222-222222222222';
    globalThis.fetch = async input => {
      const url = new URL(input);
      if (url.pathname.endsWith('/artwork_report_notifications')) return Response.json([notification('2'), {...notification('1'), report_id: otherReport}]);
      assert.equal(url.searchParams.get('id'), `in.(${REPORT},${otherReport})`);
      return Response.json([artwork, {id: otherReport, chain_id: '11155111', artwork_id: '202'}]);
    };
    const result = await call({report_id: 'attacker-selected-report'});
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body.items.map(row => [row.chain_id, row.artwork_id]), [['84532', '101'], ['11155111', '202']]);
    assert.doesNotMatch(JSON.stringify(result.body), new RegExp(`${REPORT}|${otherReport}`));
    globalThis.fetch = async input => String(input).includes('/artwork_report_notifications?')
      ? Response.json([notification()]) : Response.json([{...artwork, id: otherReport}]);
    assert.equal((await call()).statusCode, 503, 'unexpected reference rows fail closed');
  });
  await t.test('malformed, duplicate, negative and out-of-range cursors fail before storage', async () => {
    globalThis.fetch = () => { throw new Error('unexpected database access'); };
    for (const before of ['', '0', '-1', '1&recipient_wallet=eq.other', ['1', '2'], '9223372036854775808', '1'.repeat(1000)]) {
      const result = await call({before}); assert.equal(result.statusCode, 400, String(before));
    }
  });
  await t.test('unknown kinds and missing/failed storage never disclose database diagnostics', async () => {
    for (const fetcher of [
      async () => Response.json({code: '42P01', message: 'private schema credential'}, {status: 404}),
      async () => { throw new Error('private network host'); },
      async () => Response.json([{...notification(), notification_type: 'PRIVATE_STAFF_NOTE'}]),
      async () => Response.json(null)
    ]) {
      globalThis.fetch = fetcher;
      const result = await call(); assert.equal(result.statusCode, 503);
      assert.deepEqual(result.body, {error: 'NOTIFICATIONS_UNAVAILABLE', message: 'Notifications are temporarily unavailable. Please try again later.'});
    }
  });
});

function model(fetchPage) {
  let wallet = A, state;
  const inbox = createNotificationInbox({wallet: A, getWallet: () => wallet, onChange: value => { state = value; },
    fetchPage: (url, options) => url.startsWith('/api/moderation/access?') ? Response.json({authenticated: true, eligible: false}) : fetchPage(url, options)});
  return {inbox, get state() {return state;}, switchWallet(value) {wallet = value; inbox.invalidate('auth');}};
}
const payload = (wallet = A, items = [{id: '2', message: 'Safe update'}], nextCursor = null) => Response.json({wallet, items, nextCursor});
test('inbox clears immediately and discards a late old-wallet response', async () => {
  let finish;
  const m = model(() => new Promise(resolve => { finish = resolve; }));
  const pending = m.inbox.load(); assert.equal(m.state.status, 'loading');
  m.switchWallet(B); assert.deepEqual(m.state.items, []); assert.equal(m.state.status, 'auth');
  finish(payload()); await pending;
  assert.deepEqual(m.state.items, []); assert.equal(m.state.status, 'auth');
});
test('sign-out clears painted history and invalidates a pending older page even with unchanged wallet', async () => {
  let finish, calls = 0;
  const m = model(() => ++calls === 1 ? payload(A, [{id: '2'}], '2') : new Promise(resolve => { finish = resolve; }));
  await m.inbox.load(); assert.equal(m.state.items.length, 1);
  const pending = m.inbox.load('2');
  m.inbox.invalidate('auth'); assert.deepEqual(m.state.items, []);
  finish(payload(A, [{id: '1'}])); await pending;
  assert.deepEqual(m.state.items, []); assert.equal(m.state.status, 'auth');
});
test('inbox rejects foreign SIWE response and never fetches while disconnected', async () => {
  let calls = 0;
  const m = model(() => { calls++; return payload(B); });
  await m.inbox.load(); assert.equal(m.state.status, 'auth'); assert.deepEqual(m.state.items, []);
  m.switchWallet(''); await m.inbox.load(); assert.equal(calls, 1);
});
test('inbox checks identity again after asynchronous JSON parsing', async () => {
  let finish;
  const m = model(async () => ({ok: true, status: 200, json: () => new Promise(resolve => {finish = resolve;})}));
  const pending = m.inbox.load(); await Promise.resolve();
  m.switchWallet(B); finish({wallet: A, items: [{id: '1'}]}); await pending;
  assert.equal(m.state.status, 'auth'); assert.deepEqual(m.state.items, []);
});
test('inbox distinguishes authentication, unavailable, error and honest empty states', async () => {
  for (const [status, expected] of [[401, 'auth'], [404, 'unavailable'], [503, 'unavailable'], [500, 'error']]) {
    const m = model(async () => Response.json({}, {status})); await m.inbox.load(); assert.equal(m.state.status, expected);
  }
  const m = model(() => payload(A, [])); await m.inbox.load();
  assert.equal(m.state.status, 'ready'); assert.deepEqual(m.state.items, []);
});
test('older-page retry preserves cursor and appends once with cookie and wallet binding', async () => {
  let calls = 0;
  const m = model(async (url, options) => {
    assert.equal(options.headers['X-ArtSoul-Wallet'], A); assert.equal(options.cache, 'no-store');
    assert.equal(options.credentials, 'same-origin');
    if (++calls === 1) return payload(A, [{id: '3'}, {id: '2'}], '2');
    assert.equal(url, '/api/moderation/notifications?before=2');
    if (calls === 2) throw new Error('offline');
    return payload(A, [{id: '2'}, {id: '1'}]);
  });
  await m.inbox.load(); await m.inbox.load(m.state.nextCursor);
  assert.equal(m.state.status, 'error'); assert.equal(m.state.retryCursor, '2');
  await m.inbox.load(m.state.retryCursor);
  assert.deepEqual(m.state.items.map(i => i.id), ['3', '2', '1']); assert.equal(m.state.nextCursor, null);
});
