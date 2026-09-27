import assert from 'node:assert/strict';
import test from 'node:test';
import handler from '../src/api/routes/newsletter.js';
import {digest} from '../src/api/launch-services.js';

const email = 'artist@example.test';
const originalToken = 'a'.repeat(64);
const originalRow = (status = 'subscribed') => ({
  email, status, unsubscribe_hash: digest(originalToken),
  consent_version: 'product-updates-v1', consent_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z'
});

function response() {
  return {statusCode: 200, body: null, headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }, end() {}};
}

function harness(t, initial) {
  const settings = {
    ARTSOUL_NEWSLETTER_ENABLED: 'true', ARTSOUL_EMAIL_API_KEY: 'test-only-key',
    ARTSOUL_EMAIL_FROM: 'ArtSoul <updates@example.test>',
    ARTSOUL_PUBLIC_ORIGIN: 'https://artsoul.example', SESSION_SECRET: 'test-only-secret',
    SUPABASE_URL: 'https://database.example', SUPABASE_SERVICE_ROLE_KEY: 'test-only-role'
  };
  const saved = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, settings);
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const state = {row: initial && structuredClone(initial), calls: [], sent: [],
    afterRead: null, beforeWrite: null, quota: null, provider: null};
  const matches = params => state.row && [...params].every(([key, value]) => {
    if (['select', 'limit', 'on_conflict'].includes(key)) return true;
    assert.ok(value.startsWith('eq.'), `unsupported test filter ${key}`);
    const raw = value.slice(3);
    return String(state.row[key]) === (raw.startsWith('"') ? JSON.parse(raw) : raw);
  });
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method || 'GET';
    const body = init.body && JSON.parse(init.body);
    state.calls.push({host: url.hostname, path: url.pathname, method, body});
    if (url.hostname === 'api.resend.com') {
      state.sent.push({body, headers: init.headers});
      return state.provider ? state.provider(body, init) : Response.json({id: 'provider-accepted'});
    }
    assert.equal(url.hostname, 'database.example', 'no real network requests are permitted');
    if (url.pathname.endsWith('/rpc/consume_launch_service_quota')) {
      return Response.json(state.quota ? await state.quota(body) : true);
    }
    assert.equal(url.pathname, '/rest/v1/email_subscriptions');
    if (method === 'GET') {
      const snapshot = matches(url.searchParams) ? [structuredClone(state.row)] : [];
      if (state.afterRead) await state.afterRead(snapshot);
      return Response.json(snapshot);
    }
    if (state.beforeWrite) {
      const result = await state.beforeWrite({url, method, body});
      if (result) return result;
    }
    if (method === 'POST') {
      assert.equal(url.searchParams.get('on_conflict'), 'email');
      if (state.row && init.headers.Prefer.includes('resolution=ignore-duplicates')) return Response.json([]);
      state.row = structuredClone(body[0]);
      return Response.json([state.row]);
    }
    assert.equal(method, 'PATCH');
    if (!matches(url.searchParams)) return Response.json([]);
    state.row = {...state.row, ...body};
    return Response.json([state.row]);
  };
  state.request = async (body = {email, consent: true}) => {
    const result = response();
    await handler({method: 'POST', headers: {}, body}, result);
    return result;
  };
  state.unsubscribe = token => state.request({action: 'unsubscribe', token});
  state.subscriptionWrites = () => state.calls.filter(call => call.path.endsWith('/email_subscriptions') && call.method !== 'GET');
  return state;
}

test('newsletter does not send when durable enrollment fails', async t => {
  const state = harness(t);
  state.beforeWrite = () => Response.json({message: 'database unavailable'}, {status: 503});
  const result = await state.request();
  assert.equal(result.statusCode, 503);
  assert.equal(state.sent.length, 0);
  assert.equal(state.row, undefined);
});

test('an uncertain database commit cannot trigger a duplicate welcome on retry', async t => {
  const state = harness(t);
  state.beforeWrite = ({method, body}) => {
    if (method !== 'POST') return;
    state.row = structuredClone(body[0]);
    return Response.json({message: 'response lost after commit'}, {status: 503});
  };
  const first = await state.request();
  assert.equal(first.statusCode, 503);
  assert.equal(state.row.status, 'subscribed');
  assert.equal(state.sent.length, 0);
  const saved = structuredClone(state.row);
  state.beforeWrite = null;
  const retry = await state.request();
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.body.welcome_email, 'not_requested');
  assert.deepEqual(state.row, saved);
  assert.equal(state.sent.length, 0);
});

test('an unconfirmed database commit never sends and a repeat does not invent delivery', async t => {
  const state = harness(t);
  state.beforeWrite = ({body}) => {
    state.row = structuredClone(body[0]);
    return Response.json({message: 'commit response lost'}, {status: 503});
  };
  const first = await state.request();
  assert.equal(first.statusCode, 503);
  assert.equal(state.row.status, 'subscribed');
  state.beforeWrite = null;
  const repeat = await state.request();
  assert.equal(repeat.body.welcome_email, 'not_requested');
  assert.equal(state.sent.length, 0);
});

test('welcome acceptance follows a durable consent record and a working unsubscribe hash', async t => {
  const state = harness(t);
  let token;
  state.provider = body => {
    token = body.text.match(/\/join\?unsubscribe=([0-9a-f]{64})/)[1];
    assert.equal(state.row?.status, 'subscribed');
    assert.equal(state.row?.unsubscribe_hash, digest(token));
    assert.equal(state.row?.consent_version, 'product-updates-v1');
    return Response.json({id: 'accepted-not-delivered'});
  };
  const result = await state.request({email: ' ARTIST@example.test ', consent: true});
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.status, 'consent_recorded');
  assert.equal(result.body.welcome_email, 'accepted');
  assert.doesNotMatch(JSON.stringify(result.body), /delivered|[0-9a-f]{64}/);
  assert.equal(state.sent[0].headers['Idempotency-Key'], `welcome-${digest(token)}`);
  assert.equal(state.subscriptionWrites().length, 1);
  await state.unsubscribe(token);
  assert.equal(state.row.status, 'unsubscribed');
});

for (const failure of ['rejection', 'uncertain timeout']) {
  test(`welcome ${failure} preserves consent and never claims delivery`, async t => {
    const state = harness(t);
    state.provider = () => {
      if (failure === 'uncertain timeout') throw new DOMException('secret provider payload', 'AbortError');
      return Response.json({message: 'secret provider payload'}, {status: 503});
    };
    const result = await state.request();
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.status, 'consent_recorded');
    assert.equal(result.body.welcome_email, 'unconfirmed');
    assert.doesNotMatch(JSON.stringify(result.body), /secret|delivered|will retry|retry automatically/i);
    assert.equal(state.row.status, 'subscribed');
    assert.equal(state.subscriptionWrites().length, 1);
    const token = state.sent[0].body.text.match(/unsubscribe=([0-9a-f]{64})/)[1];
    await state.unsubscribe(token);
    assert.equal(state.row.status, 'unsubscribed');
  });
}

test('repeated subscription preserves the active token and does not send another welcome', async t => {
  const row = originalRow();
  const state = harness(t, row);
  const result = await state.request();
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.status, 'subscribed');
  assert.equal(result.body.welcome_email, 'not_requested');
  assert.deepEqual(state.row, row);
  assert.equal(state.subscriptionWrites().length, 0);
  assert.equal(state.sent.length, 0);
  await state.unsubscribe(originalToken);
  assert.equal(state.row.status, 'unsubscribed');
});

test('concurrent first enrollments have one database winner and one welcome', async t => {
  const state = harness(t);
  let release;
  const bothRead = new Promise(resolve => { release = resolve; });
  let reads = 0;
  state.afterRead = async () => { if (++reads === 2) release(); await bothRead; };
  const results = await Promise.all([state.request(), state.request()]);
  assert.deepEqual(results.map(result => result.statusCode).sort(), [200, 409]);
  assert.equal(state.sent.length, 1);
  const token = state.sent[0].body.text.match(/unsubscribe=([0-9a-f]{64})/)[1];
  assert.equal(state.row.unsubscribe_hash, digest(token));
});

test('a conflicting first insert never overwrites an opt-out created after the lookup', async t => {
  const state = harness(t);
  const optedOut = originalRow('unsubscribed');
  state.beforeWrite = ({method}) => { if (method === 'POST') state.row = {...optedOut}; };
  const result = await state.request();
  assert.equal(result.statusCode, 409);
  assert.deepEqual(state.row, optedOut);
  assert.equal(state.sent.length, 0);
});

test('ordinary subscribe does not reactivate an observed opt-out', async t => {
  const row = originalRow('unsubscribed');
  const state = harness(t, row);
  const result = await state.request();
  assert.equal(result.statusCode, 409);
  assert.equal(result.body.error, 'RESUBSCRIBE_REQUIRED');
  assert.deepEqual(state.row, row);
  assert.equal(state.sent.length, 0);
});

test('explicit resubscription conditionally saves fresh consent before sending', async t => {
  const state = harness(t, originalRow('unsubscribed'));
  const result = await state.request({action: 'resubscribe', email, consent: true});
  assert.equal(result.statusCode, 200);
  assert.equal(state.row.status, 'subscribed');
  assert.notEqual(state.row.unsubscribe_hash, digest(originalToken));
  assert.equal(state.sent.length, 1);
  assert.equal(state.subscriptionWrites()[0].method, 'PATCH');
});

test('explicit resubscription can follow its consent clarification within the daily quota', async t => {
  const state = harness(t, originalRow('unsubscribed'));
  const quotaUses = new Map();
  state.quota = ({p_key, p_max}) => {
    assert.equal(typeof p_key, 'string');
    assert.equal(typeof p_max, 'number');
    const used = (quotaUses.get(p_key) || 0) + 1;
    quotaUses.set(p_key, used);
    return used <= p_max;
  };
  const clarification = await state.request();
  assert.equal(clarification.statusCode, 409);
  assert.equal(clarification.body.error, 'RESUBSCRIBE_REQUIRED');
  assert.equal(state.row.status, 'unsubscribed');
  assert.equal(state.sent.length, 0);
  const confirmation = await state.request({action: 'resubscribe', email, consent: true});
  assert.equal(confirmation.statusCode, 200, 'a non-sending consent clarification must not consume the daily enrollment permit');
  assert.equal(confirmation.body.status, 'consent_recorded');
  assert.equal(state.row.status, 'subscribed');
  assert.equal(state.sent.length, 1);
});
test('failed conditional resubscription save preserves the existing opt-out', async t => {
  const row = originalRow('unsubscribed');
  const state = harness(t, row);
  state.beforeWrite = () => Response.json({message: 'database unavailable'}, {status: 503});
  const result = await state.request({action: 'resubscribe', email, consent: true});
  assert.equal(result.statusCode, 503);
  assert.deepEqual(state.row, row);
  assert.equal(state.sent.length, 0);
});

test('quota rejection masks both active and opted-out subscription status', async t => {
  for (const status of ['subscribed', 'unsubscribed']) await t.test(status, async child => {
    const state = harness(child, originalRow(status));
    state.quota = async () => false;
    const result = await state.request();
    assert.equal(result.statusCode, 429);
    assert.equal(result.body.error, 'RATE_LIMITED');
    assert.equal(result.body.status, undefined);
    assert.equal(state.subscriptionWrites().length, 0);
    assert.equal(state.sent.length, 0);
  });
});

test('email punctuation is treated as a single literal database value', async t => {
  const unusualEmail = 'artist+tag,one@example.test';
  const row = {...originalRow(), email: unusualEmail};
  const state = harness(t, row);
  const result = await state.request({email: unusualEmail, consent: true});
  assert.equal(result.statusCode, 200);
  assert.deepEqual(state.row, row);
  assert.equal(state.sent.length, 0);
});

test('an unsubscribe invalidates a resubscription snapshot even when timestamps coincide', async t => {
  const state = harness(t, originalRow('unsubscribed'));
  state.quota = async () => {
    state.quota = null;
    const updatedAt = state.row.updated_at;
    await state.unsubscribe(originalToken);
    state.row.updated_at = updatedAt;
    return true;
  };
  const result = await state.request({action: 'resubscribe', email, consent: true});
  assert.equal(result.statusCode, 409);
  assert.equal(state.row.status, 'unsubscribed');
  assert.equal(state.sent.length, 0);
});

test('unsubscribe during provider wait is never reverted by send completion', async t => {
  const state = harness(t);
  state.provider = async body => {
    const token = body.text.match(/unsubscribe=([0-9a-f]{64})/)[1];
    await state.unsubscribe(token);
    return Response.json({id: 'accepted'});
  };
  const result = await state.request();
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.status, 'consent_recorded');
  assert.equal(state.row.status, 'unsubscribed');
  assert.equal(state.subscriptionWrites().length, 2);
});

test('unsubscribe is idempotent and a consumed token cannot cancel fresh resubscription', async t => {
  const state = harness(t, originalRow());
  await state.unsubscribe(originalToken);
  const optedOut = structuredClone(state.row);
  await state.unsubscribe(originalToken);
  assert.deepEqual(state.row, optedOut);
  await state.request({action: 'resubscribe', email, consent: true});
  const subscribed = structuredClone(state.row);
  await state.unsubscribe(originalToken);
  assert.deepEqual(state.row, subscribed);
});

test('validation, configuration and quota failures do not enroll or email', async t => {
  const cases = [
    {name: 'disabled', env: {ARTSOUL_NEWSLETTER_ENABLED: 'false'}, code: 503},
    {name: 'missing sender', env: {ARTSOUL_EMAIL_FROM: ''}, code: 503},
    {name: 'invalid sender', env: {ARTSOUL_EMAIL_FROM: 'sender\r\nInjected'}, code: 503},
    {name: 'missing provider key', env: {ARTSOUL_EMAIL_API_KEY: ''}, code: 503},
    {name: 'invalid origin', env: {ARTSOUL_PUBLIC_ORIGIN: 'http://unsafe.example'}, code: 503},
    {name: 'invalid email', body: {email: 'not-an-email', consent: true}, code: 400},
    {name: 'no consent', body: {email, consent: false}, code: 400},
    {name: 'unsupported action', body: {action: 'unknown', email, consent: true}, code: 400},
    {name: 'oversized body', body: {email, consent: true, extra: 'x'.repeat(4096)}, code: 413},
    {name: 'quota denial', quota: false, code: 429}
  ];
  for (const item of cases) await t.test(item.name, async child => {
    const state = harness(child);
    Object.assign(process.env, item.env);
    if (item.quota === false) state.quota = async () => false;
    const result = await state.request(item.body);
    assert.equal(result.statusCode, item.code);
    assert.equal(state.subscriptionWrites().length, 0);
    assert.equal(state.sent.length, 0);
  });
});
