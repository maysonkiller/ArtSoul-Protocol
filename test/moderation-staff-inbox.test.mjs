import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotificationInbox} from '../src/features/moderation/notification-inbox-state.js';
import {createNotificationReadQueue} from '../src/features/moderation/notification-read-queue.js';

const OWNER = '0x' + '11'.repeat(20), OTHER = '0x' + '22'.repeat(20);
const access = fields => ({authenticated: true, eligible: true, enabled: true, access: {stepUpActive: true}, ...fields});
const report = {id: '11111111-1111-1111-1111-111111111111', created_at: '2026-10-03T10:00:00.000Z', details: 'private complaint', reporter_wallet: OTHER, reference_url: 'https://private.example.test/evidence'};
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};};
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(fields = {}) {
  let wallet = OWNER, state;
  const calls = [];
  const h = {calls, response: access(fields), queue: {data: {reports: [report]}},
    get state() {return state;}, setWallet: value => {wallet = value;},
    fetchPage: async (path, options) => {
      calls.push({path, options});
      assert.equal(options.headers['X-ArtSoul-Wallet'], OWNER);
      assert.equal(options.credentials, 'same-origin'); assert.equal(options.cache, 'no-store');
      assert.equal(options.method, undefined, 'inbox must only read existing endpoints');
      if (path.startsWith('/api/moderation/notifications')) return Response.json({wallet: OWNER, items: [{id: '1', message: 'Safe recipient update'}], nextCursor: '1'});
      if (path.startsWith('/api/moderation/access?')) return h.accessFetch ? h.accessFetch() : Response.json(h.response);
      if (path.startsWith('/api/moderation/review-queue?')) return h.queueFetch ? h.queueFetch() : Response.json(h.queue);
      throw new Error('Unexpected endpoint');
    }};
  h.inbox = createNotificationInbox({wallet: OWNER, getWallet: () => wallet, onChange: value => {state = value;}, fetchPage: h.fetchPage});
  return h;
}

test('staff discovery happens only on explicit load with the expected connected wallet', async () => {
  const h = harness(); assert.deepEqual(h.calls, []); await h.inbox.load();
  assert.equal(h.calls[1].path, '/api/moderation/access?expectedWallet=' + OWNER);
  assert.equal(h.calls[2].path, '/api/moderation/review-queue?status=pending_review');
  assert.equal(h.state.staffReview.count, 1);
});

test('server authentication, eligibility, queue flag and passkey step-up independently gate queue reads', async () => {
  for (const fields of [{authenticated: false}, {eligible: false}, {enabled: false}, {access: {stepUpActive: false}}]) {
    const h = harness(fields); await h.inbox.load();
    assert.equal(h.calls.some(call => call.path.includes('review-queue')), false);
    assert.equal(h.state.staffReview?.status || null, fields.enabled === false ? 'disabled' : fields.access ? 'verify' : null);
    assert.equal(h.state.items.length, 1);
  }
});

test('staff notice state contains only bounded reference/time rows and no complaint content', async () => {
  const h = harness(); h.queue = {data: {reports: Array.from({length: 200}, (_, i) => ({...report, id: i.toString(16).padStart(8, '0') + report.id.slice(8)}))}};
  await h.inbox.load(); const staff = h.state.staffReview;
  assert.equal(staff.count, 200); assert.equal(staff.capped, true); assert.equal(staff.reports.length, 5);
  assert.deepEqual(Object.keys(staff.reports[0]).sort(), ['createdAt', 'reference']);
  assert.doesNotMatch(JSON.stringify(h.state), /private complaint|private\.example|reporter_wallet|reference_url|details/);
});

test('late access cannot issue a queue read after logout, wallet A-B-A, close or unmount invalidation', async () => {
  for (const boundary of ['auth', 'wallet', 'close', 'unmount']) {
    const h = harness(), pending = deferred(); h.accessFetch = () => pending.promise;
    const loading = h.inbox.load(); await tick();
    if (boundary === 'wallet') h.setWallet(OTHER);
    h.inbox.invalidate(boundary === 'auth' ? 'auth' : 'idle'); h.setWallet(OWNER);
    pending.resolve(Response.json(access())); await loading;
    assert.equal(h.calls.some(call => call.path.includes('review-queue')), false, boundary);
    assert.equal(h.state.staffReview, null); assert.deepEqual(h.state.items, []);
  }
});

test('late queue response and JSON parsing cannot restore notices after session invalidation', async () => {
  for (const phase of ['response', 'json']) {
    const h = harness(), pending = deferred();
    h.queueFetch = () => phase === 'response' ? pending.promise : Promise.resolve({ok: true, status: 200, json: () => pending.promise});
    const loading = h.inbox.load(); await tick(); h.inbox.invalidate('auth');
    pending.resolve(phase === 'response' ? Response.json(h.queue) : h.queue); await loading;
    assert.equal(h.state.staffReview, null); assert.equal(h.state.status, 'auth'); assert.deepEqual(h.state.items, []);
  }
});

test('queue revocation and flag changes show only the appropriate recheck state', async () => {
  for (const [error, expected] of [['STEP_UP_REQUIRED', 'verify'], ['STEP_UP_WALLET_MISMATCH', 'verify'], ['CREDENTIAL_REVOKED', 'verify'], ['ADMIN_REQUIRED', null], ['PROTOCOL_ADMIN_DISABLED', 'disabled']]) {
    const h = harness(); h.queueFetch = async () => Response.json({error, details: 'private diagnostic'}, {status: 403});
    await h.inbox.load(); assert.equal(h.state.staffReview?.status || null, expected);
    assert.doesNotMatch(JSON.stringify(h.state), /private diagnostic/);
  }
  const h = harness(); h.queueFetch = async () => Response.json({}, {status: 401});
  await h.inbox.load(); assert.equal(h.state.status, 'auth'); assert.equal(h.state.staffReview, null); assert.deepEqual(h.state.items, []);
});

test('unconfirmed staff lookup failure stays hidden and confirmed queue errors preserve recipient updates', async () => {
  const unknown = harness(); unknown.accessFetch = async () => {throw new Error('offline');};
  await unknown.inbox.load(); assert.equal(unknown.state.staffReview, null); assert.equal(unknown.state.items.length, 1);
  const h = harness(); h.queueFetch = async () => Response.json({data: {reports: [{...report, created_at: 'invalid'}]}});
  await h.inbox.load(); assert.equal(h.state.staffReview.status, 'unavailable'); assert.equal(h.state.items.length, 1);
});

test('older recipient pages preserve staff notices without refetching the full queue', async () => {
  const h = harness(); await h.inbox.load(); const notices = h.state.staffReview;
  await h.inbox.load('1'); assert.equal(h.state.staffReview, notices);
  assert.equal(h.calls.filter(call => call.path.includes('review-queue')).length, 1);
  h.inbox.invalidate('auth'); assert.equal(h.state.staffReview, null);
});

test('a retained outcome can be marked read after an older page fails without losing its retry state', async () => {
  const writes = [];
  let state;
  const inbox = createNotificationInbox({wallet: OWNER, getWallet: () => OWNER, onChange: value => {state = value;},
    fetchPage: async (path, options) => {
      assert.equal(options.headers['X-ArtSoul-Wallet'], OWNER);
      assert.equal(options.credentials, 'same-origin');
      assert.equal(options.cache, 'no-store');
      if (options.method === 'PUT') {
        assert.equal(path, '/api/moderation/notifications?v=2');
        assert.equal(options.headers['Content-Type'], 'application/json');
        const body = JSON.parse(options.body);
        writes.push(body);
        return Response.json({wallet: OWNER, updated: body.ids, read: body.read});
      }
      if (path.startsWith('/api/moderation/access?')) return Response.json({authenticated: true, eligible: false});
      if (path === '/api/moderation/notifications?v=2&before=42') return Response.json({error: 'UNAVAILABLE'}, {status: 500});
      assert.equal(path, '/api/moderation/notifications?v=2');
      return Response.json({wallet: OWNER, items: [{id: '42', message: 'Your report was resolved.', read: false}], nextCursor: '42'});
    }});
  inbox.configure({summaryEnabled: true});
  await inbox.load();
  assert.equal(state.status, 'ready');
  await inbox.load('42');
  assert.equal(state.status, 'error');
  assert.equal(state.retryCursor, '42');
  assert.equal(state.items[0].read, false);
  const retryState = {status: state.status, retryCursor: state.retryCursor, nextCursor: state.nextCursor};

  await inbox.markRead('42', true);
  assert.deepEqual(writes, [{action: 'read', ids: ['42'], read: true}]);
  assert.equal(state.items.length, 1);
  assert.equal(state.items[0].read, true);
  assert.equal(state.pendingId, null);
  assert.deepEqual({status: state.status, retryCursor: state.retryCursor, nextCursor: state.nextCursor}, retryState);
});

test('personal history and pagination become ready before optional staff discovery finishes', async () => {
  const h = harness(), pending = deferred(); h.accessFetch = () => pending.promise;
  const loading = h.inbox.load(); await tick();
  assert.equal(h.state.items.length, 1); assert.equal(h.state.nextCursor, '1');
  assert.equal(h.state.status, 'ready', 'optional staff discovery cannot block personal history');
  pending.resolve(Response.json(access())); await loading;
  assert.equal(h.state.status, 'ready'); assert.equal(h.state.staffReview.count, 1);
});

for (const stage of ['access', 'queue']) test(`pagination can retire a slow staff ${stage} without refetching or accepting its late authority`, async () => {
  const h = harness(), pending = deferred();
  if (stage === 'access') h.accessFetch = () => pending.promise;
  else h.queueFetch = () => pending.promise;
  const initial = h.inbox.load(); await tick();
  assert.equal(h.state.status, 'ready');
  await h.inbox.load('1');
  pending.resolve(Response.json(stage === 'access' ? access() : h.queue)); await initial;
  assert.equal(h.state.status, 'ready'); assert.equal(h.state.staffReview?.status || null, stage === 'access' ? null : 'unavailable');
  assert.equal(h.calls.filter(call => call.path.includes('/access?')).length, 1);
  assert.equal(h.calls.filter(call => call.path.includes('review-queue')).length, stage === 'access' ? 0 : 1);
});

for (const stage of ['access', 'queue']) test(`a late ${stage} 401 clears already usable personal history`, async () => {
  const h = harness(), pending = deferred();
  if (stage === 'access') h.accessFetch = () => pending.promise;
  else h.queueFetch = () => pending.promise;
  const initial = h.inbox.load(); await tick();
  assert.equal(h.state.status, 'ready'); assert.equal(h.state.items.length, 1);
  pending.resolve(Response.json({}, {status: 401})); await initial;
  assert.equal(h.state.status, 'auth'); assert.equal(h.state.staffReview, null); assert.deepEqual(h.state.items, []);
});

function clock(t) {
  let id = 0;
  const pending = new Map();
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => {pending.set(++id, {callback, delay}); return id;});
  t.mock.method(globalThis, 'clearTimeout', timer => pending.delete(timer));
  return {pending, expire() {for (const [timer, entry] of [...pending]) {pending.delete(timer); entry.callback();}}};
}

test('read deadlines bound optional staff loading without removing personal history', async t => {
  const time = clock(t), h = harness(), pending = deferred(); h.queueFetch = () => pending.promise;
  const initial = h.inbox.load(); await tick();
  assert.equal(h.state.status, 'ready'); assert.equal(h.state.staffReview.status, 'loading');
  assert.equal(time.pending.size, 1, 'the completed personal read releases its deadline');
  assert.equal([...time.pending.values()][0].delay, 15000);
  time.expire(); assert.equal(h.calls.at(-1).options.signal.aborted, true);
  pending.resolve(Response.json(h.queue)); await initial;
  assert.equal(h.state.status, 'ready'); assert.equal(h.state.staffReview.status, 'unavailable');
  assert.equal(h.state.items.length, 1); assert.equal(time.pending.size, 0); assert.equal(h.calls.length, 3);
});

test('a personal read deadline rejects a late parsed payload and remains explicitly retryable', async t => {
  const time = clock(t), data = deferred(); let state, reads = 0;
  const inbox = createNotificationInbox({wallet: OWNER, getWallet: () => OWNER, onChange: value => {state = value;}, fetchPage: async path => {
    if (path.includes('/access?')) return Response.json({authenticated: true, eligible: false});
    reads++; return reads === 1 ? {ok: true, status: 200, json: () => data.promise}
      : Response.json({wallet: OWNER, items: [{id: '1'}], nextCursor: null});
  }});
  const loading = inbox.load(); await tick();
  assert.equal(time.pending.size, 1); time.expire();
  data.resolve({wallet: OWNER, items: [{id: '999'}], nextCursor: null}); await loading;
  assert.equal(state.status, 'error'); assert.deepEqual(state.items, []); assert.equal(reads, 1);
  await inbox.load(); assert.equal(state.status, 'ready'); assert.equal(state.items[0].id, '1');
  assert.equal(time.pending.size, 0);
});

test('wallet invalidation cancels all read deadlines and rejects late privileged replies', async t => {
  const time = clock(t), h = harness(), pending = deferred(); h.accessFetch = () => pending.promise;
  const loading = h.inbox.load(); await tick(); assert.equal(time.pending.size, 1);
  h.setWallet(OTHER); h.inbox.invalidate('auth');
  assert.equal(time.pending.size, 0); assert.equal(h.calls[1].options.signal.aborted, true);
  pending.resolve(Response.json(access())); await loading;
  assert.equal(h.state.status, 'auth'); assert.deepEqual(h.state.items, []);
  assert.equal(h.calls.some(call => call.path.includes('review-queue')), false);
});

test('opening a personal message saves its read state while the staff queue is stalled', async t => {
  const time = clock(t), pending = deferred(), calls = []; let state;
  const inbox = createNotificationInbox({wallet: OWNER, getWallet: () => OWNER, onChange: value => {state = value;}, fetchPage: async (path, options) => {
    calls.push({path, options});
    if (options.method === 'PUT') return Response.json({wallet: OWNER, updated: ['1'], read: true});
    if (path.includes('/access?')) return Response.json(access());
    if (path.includes('review-queue')) return pending.promise;
    return Response.json({wallet: OWNER, items: [{id: '1', read: false}], nextCursor: '1'});
  }});
  inbox.configure({summaryEnabled: true});
  const initial = inbox.load(); await tick();
  const queue = createNotificationReadQueue({canRun: () => !['loading', 'idle'].includes(state.status) && !state.pendingId});
  await queue.add('personal:1', () => inbox.markRead('1', true));
  assert.equal(calls.filter(call => call.options.method === 'PUT').length, 1);
  assert.equal(state.items[0].read, true); assert.equal(queue.hasWork(), false);
  assert.equal(calls.find(call => call.path.includes('review-queue')).options.signal.aborted, true);
  assert.equal(time.pending.size, 0); assert.equal(state.staffReview.status, 'unavailable');
  pending.resolve(Response.json({data: {reports: [report]}})); await initial;
  assert.equal(state.items[0].read, true); assert.equal(state.staffReview.status, 'unavailable');
});

test('staff eligibility appears while both the recipient page and review queue are still pending', async () => {
  const page = deferred(), queue = deferred(), calls = [];
  let state;
  const inbox = createNotificationInbox({wallet: OWNER, getWallet: () => OWNER, onChange: value => {state = value;}, fetchPage: async path => {
    calls.push(path);
    if (path.startsWith('/api/moderation/notifications')) return page.promise;
    if (path.startsWith('/api/moderation/access?')) return Response.json(access());
    return queue.promise;
  }});
  const loading = inbox.load(); await tick();
  assert.equal(calls.length, 3); assert.equal(state.staffReview.status, 'loading'); assert.equal(state.status, 'loading');
  queue.resolve(Response.json({data: {reports: [report]}})); await tick();
  assert.equal(state.staffReview.status, 'ready'); assert.equal(state.staffReview.count, 1); assert.equal(state.status, 'loading');
  page.resolve(Response.json({wallet: OWNER, items: [], nextCursor: null})); await loading;
  assert.equal(state.status, 'ready'); assert.equal(state.staffReview.count, 1);
});

test('parallel personal authorization failure clears an already resolved staff queue', async () => {
  const page = deferred(); let state;
  const inbox = createNotificationInbox({wallet: OWNER, getWallet: () => OWNER, onChange: value => {state = value;}, fetchPage: async path => {
    if (path.startsWith('/api/moderation/notifications')) return page.promise;
    if (path.startsWith('/api/moderation/access?')) return Response.json(access());
    return Response.json({data: {reports: [report]}});
  }});
  const loading = inbox.load(); await tick(); assert.equal(state.staffReview.status, 'ready');
  page.resolve(Response.json({}, {status: 401})); await loading;
  assert.equal(state.status, 'auth'); assert.equal(state.staffReview, null); assert.deepEqual(state.items, []);
});
