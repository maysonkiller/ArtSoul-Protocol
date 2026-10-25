import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuctionNotifications } from '../src/features/moderation/auction-notifications-state.js';

const A = '0x' + 'a'.repeat(40), B = '0x' + 'b'.repeat(40), CORE = '0x' + 'c'.repeat(40);
const prefs = {auction_created: true, outbid: true};
const row = (id, extra = {}) => ({id, type: 'auction_created', chain_id: '84532', core_address: CORE,
  artwork_id: '34', auction_id: '66', transaction_hash: '0x' + 'd'.repeat(64),
  created_at: '2026-10-25T10:00:00.000Z', message: 'Auction created.', read: false, artworkAvailable: true, ...extra});
const body = (items = [], extra = {}) => ({wallet: A, items, nextCursor: null, preferences: {...prefs},
  preferencesRevision: 0, chainRevision: '0', ...extra});
const reply = (items, extra) => Response.json(body(items, extra));
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};};
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(fetchPage, options = {}) {
  let wallet = A, state;
  const model = createAuctionNotifications({wallet: A, getWallet: () => wallet,
    onChange: value => {state = value;}, fetchPage, ...options});
  model.configure({enabled: true, chainId: 84532, coreAddress: CORE});
  return {model, get state() {return state;}, switchWallet() {wallet = B; model.invalidate('auth');}};
}

test('private pages retain exact large IDs, source identity and a bounded cursor', async () => {
  const top = '9007199254741000', next = '9007199254740999', calls = [];
  const m = fixture(async (url, options) => {
    calls.push(url);
    assert.equal(options.credentials, 'same-origin'); assert.equal(options.cache, 'no-store');
    assert.equal(options.headers['X-ArtSoul-Wallet'], A); assert.equal(options.method, 'GET');
    return calls.length === 1 ? reply([row(top)], {nextCursor: top}) : reply([row(next)]);
  });
  await m.model.load(); await m.model.load(m.state.nextCursor);
  assert.deepEqual(calls, ['/api/notifications', `/api/notifications?before=${top}`]);
  assert.deepEqual(m.state.items.map(item => item.id), [top, next]);
  assert.equal(m.state.chainRevision, '0'); assert.equal(m.state.status, 'ready');
});

test('read and unread writes are explicit, server-acknowledged and survive reload', async () => {
  let saved = false; const writes = [];
  const m = fixture(async (_url, options) => {
    if (options.method === 'GET') return reply([row('3', {read: saved})]);
    const request = JSON.parse(options.body); writes.push(request); saved = request.read;
    return Response.json({wallet: A, updated: request.ids, read: saved});
  });
  await m.model.load(); await m.model.markRead(['3'], true); await m.model.load();
  assert.equal(m.state.items[0].read, true);
  await m.model.markRead(['3'], false);
  assert.equal(m.state.items[0].read, false);
  assert.deepEqual(writes, [{action: 'read', ids: ['3'], read: true}, {action: 'read', ids: ['3'], read: false}]);
});

test('a late older-page response cannot undo a completed read write', async () => {
  const delayed = deferred(); let gets = 0;
  const m = fixture(async (_url, options) => options.method === 'PUT'
    ? Response.json({wallet: A, updated: ['3'], read: true})
    : ++gets === 1 ? reply([row('3')], {nextCursor: '3'}) : {ok: true, status: 200, json: () => delayed.promise});
  await m.model.load(); const pending = m.model.load('3'); await tick();
  await m.model.markRead(['3'], true); delayed.resolve(body([row('2')])); await pending;
  assert.deepEqual(m.state.items.map(item => [item.id, item.read]), [['3', true]]);
});

for (const operation of ['read', 'write']) for (const boundary of ['wallet', 'close', 'dispose']) {
  test(`${boundary} retires delayed JSON from a private ${operation}`, async () => {
    const delayed = deferred(); let delay = false;
    const m = fixture(async () => delay ? {ok: true, status: 200, json: () => delayed.promise} : reply([row('3')]));
    await m.model.load(); delay = true;
    const pending = operation === 'read' ? m.model.load() : m.model.markRead(['3'], true); await tick();
    if (boundary === 'wallet') m.switchWallet();
    else if (boundary === 'close') m.model.invalidate();
    else {m.model.invalidate(); m.model.dispose();}
    const cleared = m.state;
    delayed.resolve(operation === 'read' ? body([row('2')]) : {wallet: A, updated: ['3'], read: true});
    await pending;
    assert.equal(m.state, cleared); assert.deepEqual(m.state.items, []); assert.deepEqual(m.state.pendingIds, []);
  });
}

test('pagination after a chain rewind clears previously rendered events and reloads current history', async () => {
  const reload = deferred(); const urls = [];
  const m = fixture(async url => {
    urls.push(url);
    if (urls.length === 1) return reply([row('3')], {nextCursor: '3'});
    if (urls.length === 2) return reply([row('2')], {chainRevision: '9007199254740993'});
    return {ok: true, status: 200, json: () => reload.promise};
  });
  await m.model.load(); const pending = m.model.load('3'); await tick();
  assert.deepEqual(m.state.items, [], 'invalidated events disappear before the replacement page arrives');
  reload.resolve(body([row('4')], {chainRevision: '9007199254740993'})); await pending;
  assert.deepEqual(urls, ['/api/notifications', '/api/notifications?before=3', '/api/notifications']);
  assert.deepEqual(m.state.items.map(item => item.id), ['4']);
});

test('changed preferences during pagination replace the accumulated feed', async () => {
  let gets = 0;
  const m = fixture(async () => ++gets === 1 ? reply([row('3')], {nextCursor: '3'})
    : reply([row('2', {type: 'outbid'})], {preferences: {auction_created: false, outbid: true}, preferencesRevision: 1}));
  await m.model.load(); await m.model.load('3');
  assert.equal(gets, 3); assert.deepEqual(m.state.items.map(item => item.id), ['2']);
  assert.equal(m.state.preferences.auction_created, false);
});

test('preference writes use CAS and refresh rather than overwrite another tab', async () => {
  let preferencesRevision = 0, current = {...prefs}, puts = 0;
  const m = fixture(async (_url, options) => {
    if (options.method === 'GET') return reply(current.auction_created ? [row('3')] : [], {preferences: current, preferencesRevision});
    const value = JSON.parse(options.body); assert.equal(value.expected_revision, preferencesRevision);
    if (++puts === 1) {preferencesRevision = 1; current = {auction_created: true, outbid: false};
      return Response.json({error: 'NOTIFICATION_PREFERENCES_CONFLICT', message: 'Changed elsewhere.'}, {status: 409});}
    current = value.preferences; preferencesRevision++;
    return Response.json({wallet: A, preferences: current, preferencesRevision});
  });
  await m.model.load(); await m.model.setPreference('auction_created', false);
  assert.deepEqual(m.state.preferences, {auction_created: true, outbid: false});
  assert.equal(m.state.preferencesPending, false);
  await m.model.setPreference('auction_created', false);
  assert.deepEqual(m.state.preferences, {auction_created: false, outbid: false});
  assert.deepEqual(m.state.items, []); assert.equal(m.state.preferencesRevision, 2);
});

test('false write acknowledgements never report optimistic success', async () => {
  for (const operation of ['read', 'preferences']) {
    const m = fixture(async (_url, options) => options.method === 'GET' ? reply([row('3')])
      : Response.json(operation === 'read' ? {wallet: A, updated: ['9'], read: true}
        : {wallet: A, preferences: {...prefs}, preferencesRevision: 1}));
    await m.model.load();
    if (operation === 'read') await m.model.markRead(['3'], true);
    else await m.model.setPreference('auction_created', false);
    assert.equal(m.state.items[0].read, false); assert.equal(m.state.preferences.auction_created, true);
    assert.ok(m.state.error); assert.deepEqual(m.state.pendingIds, []); assert.equal(m.state.preferencesPending, false);
  }
});

test('an event removed before marking read triggers a fresh feed', async () => {
  let gets = 0;
  const m = fixture(async (_url, options) => options.method === 'GET' ? reply(++gets === 1 ? [row('3')] : [])
    : Response.json({error: 'NOTIFICATION_UNAVAILABLE', message: 'No longer available.'}, {status: 409}));
  await m.model.load(); await m.model.markRead(['3'], true);
  assert.deepEqual(m.state.items, []); assert.equal(m.state.status, 'ready'); assert.equal(gets, 2);
});

test('refresh applies current moderation availability without disclosing private artwork content', async () => {
  let available = true;
  const m = fixture(async () => reply([row('3', {artworkAvailable: available})]));
  await m.model.load(); available = false; await m.model.load();
  assert.equal(m.state.items[0].artworkAvailable, false);
});

test('disabled configuration never requests private data and retiring the configuration clears it', async () => {
  let calls = 0;
  const m = fixture(async () => {calls++; return reply([row('3')]);});
  await m.model.load(); m.model.configure({enabled: false}); await m.model.load();
  assert.equal(calls, 1); assert.equal(m.state.status, 'disabled'); assert.deepEqual(m.state.items, []);
});

test('malformed pages and a different authenticated wallet cannot enter the inbox', async () => {
  for (const extra of [{chainRevision: 0}, {chainRevision: '01'}, {chainRevision: '-1'},
    {items: [row('0')]}, {items: [row('3'), row('3')]}, {items: [row('3', {core_address: B})]},
    {nextCursor: '2'}, {preferences: {auction_created: false, outbid: true}}, {wallet: B}]) {
    const m = fixture(async () => reply([row('3')], extra)); await m.model.load();
    assert.equal(m.state.status, extra.wallet ? 'auth' : 'error'); assert.deepEqual(m.state.items, []);
  }
});

test('authentication, unavailable, transport errors and empty history remain distinct', async () => {
  for (const [status, expected] of [[401, 'auth'], [404, 'unavailable'], [503, 'unavailable'], [500, 'error'], [200, 'ready']]) {
    const m = fixture(async () => status === 200 ? reply([]) : Response.json({message: 'Unavailable'}, {status}));
    await m.model.load(); assert.equal(m.state.status, expected); assert.deepEqual(m.state.items, []);
  }
});

test('older-page transport failure preserves a retry cursor without duplicating items', async () => {
  let calls = 0;
  const m = fixture(async () => {if (++calls === 1) return reply([row('3')], {nextCursor: '3'});
    if (calls === 2) throw new Error('offline'); return reply([row('2')]);});
  await m.model.load(); await m.model.load('3');
  assert.equal(m.state.retryCursor, '3'); assert.equal(m.state.status, 'error');
  await m.model.load(m.state.retryCursor);
  assert.deepEqual(m.state.items.map(item => item.id), ['3', '2']);
});

test('a timed-out delayed JSON body cannot appear as successful data', async () => {
  const delayed = deferred(); let signal;
  const m = fixture(async (_url, options) => {signal = options.signal; return {ok: true, status: 200, json: () => delayed.promise};}, {requestTimeoutMs: 5});
  const pending = m.model.load(); await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(signal.aborted, true); delayed.resolve(body([row('3')])); await pending;
  assert.equal(m.state.status, 'error'); assert.deepEqual(m.state.items, []); assert.match(m.state.error, /timed out/);
});

test('a pending write prevents duplicate writes and pagination until it is acknowledged', async () => {
  const delayed = deferred(); let puts = 0, gets = 0;
  const m = fixture(async (_url, options) => {if (options.method === 'GET') {gets++; return reply([row('3')]);}
    puts++; return {ok: true, status: 200, json: () => delayed.promise};});
  await m.model.load(); const pending = m.model.markRead(['3'], true); await tick();
  await m.model.markRead(['3'], true); await m.model.setPreference('outbid', false); await m.model.load('3');
  assert.equal(puts, 1); assert.equal(gets, 1);
  delayed.resolve({wallet: A, updated: ['3'], read: true}); await pending;
  assert.equal(m.state.items[0].read, true); assert.deepEqual(m.state.pendingIds, []);
});
