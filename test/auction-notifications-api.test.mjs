import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import handler from '../src/api/routes/notifications.js';
import dispatch from '../api/[...route].js';
import publicConfigHandler from '../src/api/routes/public/config.js';
import { setWalletSession } from '../src/api/backend.js';
import { readAuctionNotificationConfig } from '../src/api/auction-notification-config.js';

const A = `0x${'a'.repeat(40)}`, B = `0x${'b'.repeat(40)}`, CORE = `0x${'c'.repeat(40)}`;
const ORIGIN = 'https://artsoulprotocol.com';
const PREFERENCES = {auction_created: true, outbid: true};
const UNAVAILABLE = {error: 'NOTIFICATIONS_UNAVAILABLE', message: 'Notifications are temporarily unavailable. Please try again later.'};
const env = {
  SESSION_SECRET: 'local-auction-inbox-test-only', SUPABASE_URL: 'https://auction-inbox.example.test',
  NEXT_PUBLIC_SUPABASE_URL: 'https://auction-inbox.example.test', SUPABASE_SERVICE_ROLE_KEY: 'local-service-fixture',
  SUPABASE_ANON_KEY: 'local-anon-fixture', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-anon-fixture',
  ARTSOUL_AUCTION_NOTIFICATIONS_ENABLED: 'true', ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA: CORE,
  ARTSOUL_PUBLIC_ORIGIN: ORIGIN, API_ALLOWED_ORIGINS: '', ARTSOUL_AUCTION_LIFECYCLE_ENABLED: ''
};
function response() {
  return {headers: {}, statusCode: 200, body: null,
    setHeader(key, value) {this.headers[key] = value;}, status(value) {this.statusCode = value; return this;},
    json(value) {this.body = value; return this;}, end() {}};
}
const row = (id = '2', changes = {}) => ({id, type: 'auction_created', created_at: '2026-10-25T10:00:00.000Z',
  artwork_id: '7', auction_id: '9', transaction_hash: `0x${'d'.repeat(64)}`, read: false, artworkAvailable: true, ...changes});
const page = (items = [row()], changes = {}) => ({items, preferences: {...PREFERENCES}, preferencesRevision: 0, chainRevision: '0', ...changes});

test('auction notification API keeps private history and changes bound to the signed wallet', async t => {
  const originalFetch = globalThis.fetch;
  const prior = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  function headersFor(wallet) {
    const session = response(); setWalletSession(session, wallet);
    return {cookie: session.headers['Set-Cookie'].split(';')[0], 'x-artsoul-wallet': wallet,
      'content-type': 'application/json', origin: ORIGIN};
  }
  const headers = headersFor(A);
  let requests = [];
  function storage(reply) {
    requests = [];
    globalThis.fetch = async (input, options) => {
      const request = {url: new URL(input), options, body: JSON.parse(options.body)};
      requests.push(request);
      return typeof reply === 'function' ? reply(request) : Response.json(reply);
    };
  }
  function noStorage() {storage(() => {throw new Error('Unexpected database request');});}
  async function call({method = 'GET', query = {}, body, h = headers, routed = false, url, chunks} = {}) {
    const req = {method, query, body, headers: h, url};
    if (chunks) req[Symbol.asyncIterator] = async function* () {for (const chunk of chunks) yield chunk;};
    const result = response();
    await (routed ? dispatch : handler)(req, result);
    assert.equal(result.headers['Cache-Control'], 'private, no-store');
    return result;
  }
  async function rejected(options, status, code) {
    noStorage();
    const result = await call(options);
    assert.equal(result.statusCode, status, JSON.stringify(options));
    if (code) assert.equal(result.body.error, code);
    assert.equal(requests.length, 0, 'rejected input must not reach storage');
  }
  const readBody = {action: 'read', ids: ['2'], read: true};
  const preferencesBody = {action: 'preferences', expected_revision: 3, preferences: {auction_created: false, outbid: true}};

  await t.test('guests, tampered cookies and missing or foreign intended wallets fail before storage', async () => {
    for (const h of [{}, {...headers, cookie: `${headers.cookie}tampered`}, {...headers, 'x-artsoul-wallet': undefined},
      {...headers, 'x-artsoul-wallet': B}, {...headers, 'x-artsoul-wallet': [A]}]) {
      await rejected({h}, 401);
      await rejected({method: 'PUT', body: readBody, h}, 401);
    }
    await rejected({method: 'POST'}, 405);
    await rejected({method: 'DELETE'}, 405);
    await rejected({method: 'OPTIONS'}, 204);
  });

  await t.test('feature requires an explicit flag and valid nonzero Base Sepolia Core', async () => {
    for (const value of [undefined, 'false', 'TRUE', '1', '']) {
      if (value === undefined) delete process.env.ARTSOUL_AUCTION_NOTIFICATIONS_ENABLED;
      else process.env.ARTSOUL_AUCTION_NOTIFICATIONS_ENABLED = value;
      assert.equal(readAuctionNotificationConfig().enabled, false);
      await rejected({}, 503, 'AUCTION_NOTIFICATIONS_DISABLED');
    }
    process.env.ARTSOUL_AUCTION_NOTIFICATIONS_ENABLED = 'true';
    for (const core of ['', 'invalid', `0x${'0'.repeat(40)}`, `${CORE}x`]) {
      process.env.ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA = core;
      assert.deepEqual(readAuctionNotificationConfig(), {enabled: false, chainId: 84532, coreAddress: null});
      await rejected({method: 'PUT', body: readBody}, 503, 'AUCTION_NOTIFICATIONS_DISABLED');
    }
    process.env.ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA = `0x${'C'.repeat(40)}`;
    assert.deepEqual(readAuctionNotificationConfig(), {enabled: true, chainId: 84532, coreAddress: CORE});
    process.env.ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA = CORE;
  });

  await t.test('real router reaches the private endpoint and public config exposes only its capability', async () => {
    for (const route of [{url: '/api/notifications'}, {query: {route: ['notifications']}}, {query: {route: 'notifications'}}]) {
      storage(page([]));
      const result = await call({...route, routed: true});
      assert.equal(result.statusCode, 200);
      assert.deepEqual(result.body, {wallet: A, items: [], nextCursor: null, preferences: PREFERENCES, preferencesRevision: 0, chainRevision: '0'});
      assert.equal(requests[0].url.pathname, '/rest/v1/rpc/read_auction_notifications');
      assert.equal(result.headers['X-Content-Type-Options'], 'nosniff');
    }
    noStorage();
    const config = response(); publicConfigHandler({method: 'GET'}, config);
    assert.equal(config.statusCode, 200);
    assert.deepEqual(config.body.auctionNotifications, {enabled: true, chainId: 84532, coreAddress: CORE});
    assert.ok(config.body.saved && config.body.profileLayout, 'existing capabilities remain additive');
    assert.doesNotMatch(JSON.stringify(config.body), /local-service-fixture|local-auction-inbox-test-only/);
    assert.equal(requests.length, 0);
    process.env.ARTSOUL_AUCTION_NOTIFICATIONS_ENABLED = 'false';
    const disabled = response(); publicConfigHandler({method: 'GET'}, disabled);
    assert.equal(disabled.body.auctionNotifications.enabled, false);
    process.env.ARTSOUL_AUCTION_NOTIFICATIONS_ENABLED = 'true';
  });

  await t.test('GET scopes one RPC to the session and strips storage-only fields from both categories', async () => {
    for (const wallet of [A, B]) {
      storage(page([row('2', {recipient_wallet: B, payload: {private: 'private-payload'}, message: 'private-message'}),
        row('1', {type: 'outbid', artworkAvailable: false})], {chainRevision: '9007199254740993'}));
      const result = await call({h: {...headersFor(wallet), 'x-artsoul-wallet': wallet.toUpperCase()}});
      assert.equal(result.statusCode, 200);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].options.method, 'POST');
      assert.deepEqual(requests[0].body, {p_wallet: wallet, p_core: CORE, p_before: null});
      assert.equal(result.body.wallet, wallet);
      assert.equal(result.body.chainRevision, '9007199254740993');
      assert.equal(result.body.items[0].message, 'You created auction #9 for artwork #7.');
      assert.equal(result.body.items[1].message, 'Your bid was surpassed in auction #9 for artwork #7.');
      assert.equal(result.body.items[1].artworkAvailable, false);
      assert.deepEqual(Object.keys(result.body.items[0]).sort(), ['id', 'type', 'created_at', 'chain_id', 'core_address',
        'artwork_id', 'auction_id', 'transaction_hash', 'read', 'artworkAvailable', 'message'].sort());
      assert.doesNotMatch(JSON.stringify(result.body), /recipient_wallet|private-payload|private-message/);
    }
    storage(page([row('2', {transaction_hash: `0x${'D'.repeat(64)}`})]));
    assert.equal((await call()).body.items[0].transaction_hash, `0x${'d'.repeat(64)}`);
  });

  await t.test('hosted notification URL explicitly rewrites to the validated private route with its cursor intact', async () => {
    const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
    const rewrites = config.rewrites.filter(rule => rule.source === '/api/notifications');
    assert.equal(rewrites.length, 1, 'implicit catch-all routing adds query fields rejected by the private API');
    assert.equal(rewrites[0].destination, '/api/[...route]?route=notifications');
    const destination = new URL(rewrites[0].destination, ORIGIN);
    for (const before of [undefined, '9007199254740993']) {
      const query = Object.fromEntries(destination.searchParams);
      if (before !== undefined) query.before = before;
      storage(page([]));
      const result = await call({url: destination.pathname, query, routed: true});
      assert.equal(result.statusCode, 200);
      assert.deepEqual(requests[0].body, {p_wallet: A, p_core: CORE, p_before: before ?? null});
    }
    await rejected({url: destination.pathname, query: {route: 'notifications', wallet: B}, routed: true},
      400, 'INVALID_NOTIFICATION_CURSOR');
  });

  await t.test('GET preserves BIGINT cursors and returns at most twenty rows plus a next-page cursor', async () => {
    const before = 9007199254741050n;
    for (const length of [0, 20, 21]) {
      storage(page(Array.from({length}, (_, index) => row(String(before - 1n - BigInt(index))))));
      const result = await call({query: {before: String(before)}});
      assert.equal(result.statusCode, 200);
      assert.equal(requests[0].body.p_before, String(before));
      assert.equal(result.body.items.length, Math.min(length, 20));
      assert.equal(result.body.nextCursor, length === 21 ? String(before - 20n) : null);
    }
  });

  await t.test('lifecycle capability is explicit and old clients keep their original page shape', async () => {
    await rejected({query: {v: '2'}}, 503);
    for (const v of ['1', '3', 2, ['2'], '']) await rejected({query: {v}}, 400);
    process.env.ARTSOUL_AUCTION_LIFECYCLE_ENABLED = 'true';
    try {
      assert.equal(readAuctionNotificationConfig().lifecycleEnabled, true);
      storage(page([row()]));
      const old = await call();
      assert.equal(old.statusCode, 200);
      assert.equal(requests[0].url.pathname, '/rest/v1/rpc/read_auction_notifications');
      assert.deepEqual(old.body.preferences, PREFERENCES);
      assert.equal(Object.hasOwn(old.body.items[0], 'token_id'), false);
    } finally {process.env.ARTSOUL_AUCTION_LIFECYCLE_ENABLED = '';}
  });

  await t.test('lifecycle pages distinguish an auction win from a completed purchase and a resale', async () => {
    process.env.ARTSOUL_AUCTION_LIFECYCLE_ENABLED = 'true';
    const preferences = {...PREFERENCES, lifecycle: true};
    const detail = {token_id: null, amount_wei: null, settlement_deadline: null};
    const kinds = ['auction_created', 'outbid', 'bid_received', 'auction_won', 'auction_ended',
      'purchase_completed', 'sale_completed', 'payment_missed', 'sale_unpaid', 'resale_purchased', 'resale_sold'];
    try {
      for (const type of kinds) {
        const item = row('2', {...detail, type,
          ...(['bid_received','auction_won'].includes(type) ? {amount_wei: '20000000000000000'} : {}),
          ...(type === 'auction_won' ? {settlement_deadline: '1800000000'} : {}),
          ...(['purchase_completed','sale_completed','resale_purchased','resale_sold'].includes(type)
            ? {token_id: '9007199254740993', amount_wei: '20000000000000000'} : {}),
          ...(type.startsWith('resale_') ? {auction_id: null} : {})});
        storage(page([item], {preferences}));
        const result = await call({query: {v: '2'}});
        assert.equal(result.statusCode, 200, type);
        assert.equal(requests[0].url.pathname, '/rest/v1/rpc/read_auction_notifications_v2');
        assert.equal(result.body.items[0].token_id, item.token_id);
        assert.equal(result.body.items[0].auction_id, item.auction_id);
        assert.equal(result.body.items[0].amount_wei, item.amount_wei);
        if (type === 'auction_won') assert.match(result.body.items[0].message, /requires payment before an NFT is minted/);
        if (type === 'purchase_completed') assert.match(result.body.items[0].message, /was minted to you/);
        if (type.startsWith('resale_')) assert.doesNotMatch(result.body.items[0].message, /auction #null/);
      }
      for (const change of [{token_id: undefined}, {amount_wei: 2}, {settlement_deadline: '-1'},
        {type: 'auction_won'}, {type: 'resale_sold', auction_id: '3'}, {type: 'sale_completed'}]) {
        storage(page([row('2', {...detail, ...change})], {preferences}));
        assert.equal((await call({query: {v: '2'}})).statusCode, 503);
      }
    } finally {process.env.ARTSOUL_AUCTION_LIFECYCLE_ENABLED = '';}
  });

  await t.test('v2 writes retain session scope and exact three-category compare-and-swap', async () => {
    process.env.ARTSOUL_AUCTION_LIFECYCLE_ENABLED = 'true';
    try {
      storage({updated: true, ids: ['2'], read: true});
      assert.equal((await call({query: {v: '2'}, method: 'PUT', body: readBody})).statusCode, 200);
      assert.equal(requests[0].url.pathname, '/rest/v1/rpc/mark_auction_notifications_v2');
      assert.equal(requests[0].body.p_wallet, A);
      const preferences = {...PREFERENCES, lifecycle: false};
      storage({saved: true, preferences, preferencesRevision: 4});
      assert.equal((await call({query: {v: '2'}, method: 'PUT', body: {...preferencesBody, preferences}})).statusCode, 200);
      assert.equal(requests[0].url.pathname, '/rest/v1/rpc/save_auction_notification_preferences_v2');
      assert.deepEqual(requests[0].body, {p_wallet: A, p_core: CORE, p_revision: 3, p_created: true, p_outbid: true, p_lifecycle: false});
      await rejected({query: {v: '2'}, method: 'PUT', body: preferencesBody}, 400);
      await rejected({method: 'PUT', body: {...preferencesBody, preferences}}, 400);
      await rejected({query: {v: '2', wallet: B}, method: 'PUT', body: readBody}, 400);
    } finally {process.env.ARTSOUL_AUCTION_LIFECYCLE_ENABLED = '';}
  });

  await t.test('malformed cursors and query-selected identity or deployment cannot reach storage', async () => {
    for (const before of ['', 1, '0', '-1', '01', '9223372036854775808', ['1', '2'], '1&wallet=other']) {
      await rejected({query: {before}}, 400, 'INVALID_NOTIFICATION_CURSOR');
    }
    for (const query of [{wallet: B}, {recipient_wallet: B}, {core_address: B}, {chain_id: '11155111'}, {limit: '1000'}]) {
      await rejected({query}, 400, 'INVALID_NOTIFICATION_CURSOR');
    }
  });

  await t.test('invalid projections fail closed including order, bounds, preferences and chain revision', async () => {
    const invalid = [null, {}, page(null), page(Array.from({length: 22}, (_, index) => row(String(30 - index)))),
      page([row(), row()]), page([row('1'), row('2')]), page([null]),
      page([], {preferences: {auction_created: true}}), page([], {preferences: {...PREFERENCES, email: true}}),
      page([], {preferencesRevision: -1}), page([], {preferencesRevision: '0'}), page([], {preferencesRevision: 2147483648}),
      page([row()], {preferences: {auction_created: false, outbid: true}})];
    for (const chainRevision of [undefined, null, 0, '-1', '00', '01', '1.5', '1'.repeat(79)]) {
      invalid.push(page([], {chainRevision}));
    }
    for (const change of [{id: 2}, {id: '0'}, {id: '9223372036854775808'}, {type: 'settlement'}, {artwork_id: '0'},
      {artwork_id: String(2n ** 256n)}, {auction_id: 9}, {transaction_hash: 'not-a-hash'}, {created_at: 'not-a-date'},
      {read: 'false'}, {artworkAvailable: null}]) invalid.push(page([row('2', change)]));
    for (const value of invalid) {
      storage(value);
      const result = await call();
      assert.equal(result.statusCode, 503, JSON.stringify(value));
      assert.deepEqual(result.body, UNAVAILABLE);
    }
    storage(page([row('2')]));
    assert.equal((await call({query: {before: '2'}})).statusCode, 503, 'a page cannot repeat its boundary');
  });

  await t.test('PUT requires allowed origin and bounded JSON before any mutation', async () => {
    await rejected({method: 'PUT', body: readBody, h: {...headers, origin: 'https://other.example.test'}}, 401, 'INVALID_ORIGIN');
    for (const type of [undefined, 'text/plain', 'application/jsonp']) {
      await rejected({method: 'PUT', body: readBody, h: {...headers, 'content-type': type}}, 415, 'JSON_REQUIRED');
    }
    await rejected({method: 'PUT', body: readBody, h: {...headers, 'content-length': '4097'}}, 413, 'BODY_TOO_LARGE');
    await rejected({method: 'PUT', body: 'x'.repeat(4097)}, 413, 'BODY_TOO_LARGE');
    await rejected({method: 'PUT', chunks: ['x'.repeat(2048), 'x'.repeat(2049)]}, 413, 'BODY_TOO_LARGE');
    for (const body of ['{', 'null', '[]', 'true', '"read"']) {
      await rejected({method: 'PUT', body}, 400, 'INVALID_JSON');
    }
  });

  await t.test('read updates bind the session, preserve exact IDs and allow reversible changes', async () => {
    const ids = ['9007199254740993', '2'];
    process.env.API_ALLOWED_ORIGINS = 'https://preview.example.test';
    for (const [wallet, read, origin] of [[A, true, ORIGIN], [B, false, 'https://preview.example.test'], [A, false, undefined]]) {
      storage({updated: true, ids: [...ids].reverse(), read});
      const result = await call({method: 'PUT', h: {...headersFor(wallet), origin, 'content-type': 'application/json; charset=utf-8'},
        body: {action: 'read', ids, read}});
      assert.equal(result.statusCode, 200);
      assert.equal(requests[0].url.pathname, '/rest/v1/rpc/mark_auction_notifications');
      assert.deepEqual(requests[0].body, {p_wallet: wallet, p_core: CORE, p_ids: ids, p_read: read});
      assert.deepEqual(result.body, {wallet, updated: [...ids].reverse(), read});
    }
    process.env.API_ALLOWED_ORIGINS = '';
  });

  await t.test('invalid read IDs, unsupported actions and injected recipient fields are rejected', async () => {
    const invalid = [{}, {...readBody, action: 'delete'}, {...readBody, wallet: B}, {...readBody, core_address: B},
      {...readBody, ids: []}, {...readBody, ids: ['2', '2']}, {...readBody, ids: [2]}, {...readBody, ids: ['0']},
      {...readBody, ids: ['9223372036854775808']}, {...readBody, ids: Array.from({length: 21}, (_, i) => String(i + 1))},
      {...readBody, read: 'true'}, {action: 'read', ids: ['2']}];
    for (const body of invalid) await rejected({method: 'PUT', body}, 400, 'INVALID_NOTIFICATION_UPDATE');
  });

  await t.test('preferences use one session-scoped compare-and-swap RPC and acknowledge exactly the requested values', async () => {
    storage({saved: true, preferences: preferencesBody.preferences, preferencesRevision: 4});
    const result = await call({method: 'PUT', body: preferencesBody});
    assert.equal(result.statusCode, 200);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url.pathname, '/rest/v1/rpc/save_auction_notification_preferences');
    assert.deepEqual(requests[0].body, {p_wallet: A, p_core: CORE, p_revision: 3, p_created: false, p_outbid: true});
    assert.deepEqual(result.body, {wallet: A, preferences: preferencesBody.preferences, preferencesRevision: 4});
    for (const body of [{...preferencesBody, wallet: B}, {...preferencesBody, expected_revision: '3'},
      {...preferencesBody, expected_revision: -1}, {...preferencesBody, expected_revision: 1.5},
      {...preferencesBody, expected_revision: 2147483647}, {...preferencesBody, preferences: {outbid: true}},
      {...preferencesBody, preferences: {...PREFERENCES, email: true}},
      {...preferencesBody, preferences: {auction_created: 'false', outbid: true}}]) {
      await rejected({method: 'PUT', body}, 400, 'INVALID_NOTIFICATION_UPDATE');
    }
  });

  await t.test('missing notification and stale preference revisions are recoverable conflicts', async () => {
    storage({updated: false});
    const missing = await call({method: 'PUT', body: readBody});
    assert.equal(missing.statusCode, 409); assert.equal(missing.body.error, 'NOTIFICATION_UNAVAILABLE');
    storage({saved: false});
    const conflict = await call({method: 'PUT', body: preferencesBody});
    assert.equal(conflict.statusCode, 409); assert.equal(conflict.body.error, 'NOTIFICATION_PREFERENCES_CONFLICT');
  });

  await t.test('false mutation acknowledgements never become successful read or preference state', async () => {
    for (const value of [null, {}, {updated: true, ids: ['3'], read: true}, {updated: true, ids: [2], read: true},
      {updated: true, ids: ['2', '2'], read: true}, {updated: true, ids: ['2'], read: false}, {updated: 'true', ids: ['2'], read: true}]) {
      storage(value);
      const result = await call({method: 'PUT', body: readBody});
      assert.equal(result.statusCode, 503, JSON.stringify(value)); assert.deepEqual(result.body, UNAVAILABLE);
    }
    for (const value of [null, {}, {saved: true, preferences: preferencesBody.preferences, preferencesRevision: 3},
      {saved: true, preferences: PREFERENCES, preferencesRevision: 4},
      {saved: true, preferences: {...preferencesBody.preferences, email: true}, preferencesRevision: 4}]) {
      storage(value);
      const result = await call({method: 'PUT', body: preferencesBody});
      assert.equal(result.statusCode, 503, JSON.stringify(value)); assert.deepEqual(result.body, UNAVAILABLE);
    }
  });

  await t.test('database, transport and server-configuration failures expose only a stable unavailable response', async () => {
    const failures = [() => {throw new Error('private-diagnostic network credential');},
      () => new Response('private-diagnostic invalid response', {status: 200}),
      ...[400, 401, 403, 404, 500].map(status => () => Response.json({code: '42P01', message: 'private-diagnostic schema credential'}, {status}))];
    for (const failure of failures) for (const options of [{}, {method: 'PUT', body: readBody}, {method: 'PUT', body: preferencesBody}]) {
      storage(failure);
      const result = await call(options);
      assert.equal(result.statusCode, 503); assert.deepEqual(result.body, UNAVAILABLE);
    }
    process.env.ARTSOUL_PUBLIC_ORIGIN = 'https://private-diagnostic.invalid/path';
    noStorage();
    const result = await call({method: 'PUT', body: readBody});
    assert.equal(result.statusCode, 503); assert.deepEqual(result.body, UNAVAILABLE); assert.equal(requests.length, 0);
    process.env.ARTSOUL_PUBLIC_ORIGIN = ORIGIN;
  });
});
