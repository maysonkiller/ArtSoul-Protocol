import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotificationInbox} from '../src/features/moderation/notification-inbox-state.js';

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

test('initial pagination stays unavailable until staff discovery finishes', async () => {
  const h = harness(), pending = deferred(); h.accessFetch = () => pending.promise;
  const loading = h.inbox.load(); await tick();
  assert.equal(h.state.items.length, 1); assert.equal(h.state.nextCursor, '1');
  assert.equal(h.state.status, 'loading', 'the UI only offers older pages after ready');
  pending.resolve(Response.json(access())); await loading;
  assert.equal(h.state.status, 'ready'); assert.equal(h.state.staffReview.count, 1);
});
