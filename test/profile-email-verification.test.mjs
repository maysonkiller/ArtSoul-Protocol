import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import handler from '../src/api/routes/profile-email.js';
import publicConfigHandler from '../src/api/routes/public/config.js';
import dispatch from '../api/[...route].js';
import {setWalletSession} from '../src/api/backend.js';
import {digest} from '../src/api/launch-services.js';

const WALLET = `0x${'1'.repeat(40)}`, OTHER = `0x${'2'.repeat(40)}`;
const EMAIL = 'artist@gmail.com';
const response = () => ({statusCode: 200, headers: {}, body: null,
  setHeader(key, value) {this.headers[key] = value;}, status(code) {this.statusCode = code; return this;},
  json(body) {this.body = body; return this;}, end() {}});

function harness(t) {
  const env = {SESSION_SECRET: 'local-profile-email-only', SUPABASE_URL: 'https://database.example',
    SUPABASE_SERVICE_ROLE_KEY: 'local-role-only', ARTSOUL_PROFILE_EMAIL_ENABLED: 'true',
    ARTSOUL_EMAIL_API_KEY: 'local-mail-only', ARTSOUL_EMAIL_FROM: 'ArtSoul <verify@example.test>',
    ARTSOUL_PUBLIC_ORIGIN: 'https://artsoul.example', API_ALLOWED_ORIGINS: ''};
  const saved = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, env);
  t.after(() => {globalThis.fetch = originalFetch; for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : process.env[key] = value;});
  const state = {rows: new Map(), calls: [], mails: [], quota: null, beforePatch: null, failDatabase: false, mailStatus: 200};
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input), method = init.method || 'GET', body = init.body && JSON.parse(init.body);
    state.calls.push({path: url.pathname, method, body});
    if (url.hostname === 'api.resend.com') {
      state.mails.push(body);
      return Response.json({id: 'captured-local-mail'}, {status: state.mailStatus});
    }
    assert.equal(url.hostname, 'database.example', 'all network requests are local fixtures');
    if (state.failDatabase) return Response.json({message: 'private database failure'}, {status: 503});
    if (url.pathname.endsWith('/rpc/consume_launch_service_quota')) return Response.json(state.quota ? await state.quota(body) : true);
    if (url.pathname.endsWith('/rpc/confirm_profile_email')) {
      const row = state.rows.get(body.p_wallet_address);
      if (!row || row.pending_token_hash !== body.p_token_hash || Date.parse(row.pending_expires_at) <= Date.now()) return Response.json([]);
      row.verified_email = row.pending_email; row.verified_at = new Date().toISOString();
      row.pending_email = row.pending_token_hash = row.pending_expires_at = null;
      row.revision = crypto.randomUUID();
      return Response.json([{wallet_address: body.p_wallet_address, verified_email: row.verified_email, verified_at: row.verified_at}]);
    }
    assert.equal(url.pathname, '/rest/v1/profile_email_connections');
    if (method === 'POST') {
      const inputRow = body[0], previous = state.rows.get(inputRow.wallet_address);
      if (previous && init.headers.Prefer.includes('ignore-duplicates')) return Response.json([]);
      const row = {...previous, ...inputRow}; state.rows.set(inputRow.wallet_address, row);
      return Response.json([row]);
    }
    const wallet = url.searchParams.get('wallet_address')?.slice(3), row = state.rows.get(wallet);
    if (method === 'GET') return Response.json(row ? [{...row}] : []);
    assert.equal(method, 'PATCH');
    if (state.beforePatch) await state.beforePatch(body);
    if (!row || row.revision !== url.searchParams.get('revision')?.slice(3)) return Response.json([]);
    Object.assign(row, body);
    return Response.json([{...row}]);
  };
  state.call = async (body, {wallet = WALLET, expected = wallet, headers = {}, method = body ? 'POST' : 'GET', auth = true, dispatched = false} = {}) => {
    const session = response(); setWalletSession(session, wallet);
    const res = response();
    await (dispatched ? dispatch : handler)({url: '/api/profile/email', method, body, headers: {'content-type': 'application/json', origin: 'https://artsoul.example',
      'x-artsoul-wallet': expected, ...(auth ? {cookie: session.headers['Set-Cookie'].split(';')[0]} : {}), ...headers}}, res);
    return res;
  };
  state.request = () => state.call({action: 'request', email: EMAIL});
  state.token = () => state.mails.at(-1)?.text.match(/#verify_email=([0-9a-f]{64})/)[1];
  return state;
}

test('the deployed email URL reaches the private handler through the hosting rewrite', async t => {
  const state = harness(t);
  const config = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const rewrite = config.rewrites.find(row => row.source === '/api/profile/email');
  assert.ok(rewrite, 'the dispatcher alone does not publish a nested profile endpoint');
  const destination = new URL(rewrite.destination, 'https://artsoul.example');
  assert.equal(destination.pathname, '/api/[...route]');
  const res = response();
  await dispatch({method: 'GET', headers: {}, query: Object.fromEntries(destination.searchParams)}, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'UNAUTHENTICATED');
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
  assert.deepEqual(state.calls, []);
});

test('email linking requires the signed current wallet before any private read or send', async t => {
  const state = harness(t);
  for (const options of [{auth: false}, {expected: OTHER}]) {
    assert.equal((await state.call({action: 'request', email: EMAIL}, options)).statusCode, 401);
  }
  assert.deepEqual(state.calls, []);
});

test('public configuration advertises email only for an explicitly enabled deployment without private mail settings', t => {
  const state = harness(t);
  const key = 'NEXT_PUBLIC_SUPABASE_ANON_KEY', previous = process.env[key];
  process.env[key] = 'public-local-only';
  t.after(() => previous === undefined ? delete process.env[key] : process.env[key] = previous);
  for (const enabled of [undefined, 'false', 'TRUE', 'true']) {
    if (enabled === undefined) delete process.env.ARTSOUL_PROFILE_EMAIL_ENABLED;
    else process.env.ARTSOUL_PROFILE_EMAIL_ENABLED = enabled;
    const res = response(); publicConfigHandler({method: 'GET'}, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.emailVerificationEnabled, enabled === 'true');
    assert.ok(!JSON.stringify(res.body).includes('local-mail-only'));
    assert.ok(!JSON.stringify(res.body).includes('verify@example.test'));
  }
  assert.deepEqual(state.calls, []);
});

test('requests persist only a bounded hashed token and never claim verification or disclose email', async t => {
  const state = harness(t);
  const result = await state.call({action: 'request', email: ' ARTIST@gmail.com ', email_verified: true, wallet_address: OTHER});
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.status, 'verification_requested');
  assert.ok(!('email' in result.body) && !('token' in result.body) && !('verified' in result.body));
  const row = state.rows.get(WALLET), token = state.token();
  assert.equal(row.pending_email, EMAIL);
  assert.equal(row.pending_token_hash, digest(token));
  assert.ok(!JSON.stringify(state.calls.filter(call => call.path.startsWith('/rest/v1'))).includes(token));
  assert.ok(Date.parse(row.pending_expires_at) > Date.now() && Date.parse(row.pending_expires_at) <= Date.now() + 900000);
  assert.equal((await state.call()).body.verified, false);
  assert.ok(!state.calls.some(call => call.path.includes('email_subscriptions')));
});

test('confirmation is wallet-bound, consumes the token once and only an authenticated owner can read the email', async t => {
  const state = harness(t); await state.request(); const token = state.token();
  assert.equal((await state.call({action: 'confirm', token}, {wallet: OTHER})).statusCode, 400);
  const confirmed = await state.call({action: 'confirm', token});
  assert.deepEqual(confirmed.body, {success: true, wallet: WALLET, verified: true});
  assert.equal((await state.call({action: 'confirm', token})).statusCode, 400);
  assert.equal(state.rows.get(WALLET).pending_token_hash, null);
  assert.equal((await state.call()).body.email, EMAIL);
  assert.equal((await state.call(undefined, {wallet: OTHER})).body.email, null);
});

test('expired and superseded links cannot verify email', async t => {
  const state = harness(t); await state.request(); const oldToken = state.token();
  await state.request(); const token = state.token();
  assert.notEqual(oldToken, token);
  assert.equal((await state.call({action: 'confirm', token: oldToken})).statusCode, 400);
  state.rows.get(WALLET).pending_expires_at = new Date(Date.now() - 1000).toISOString();
  assert.equal((await state.call({action: 'confirm', token})).statusCode, 400);
  assert.equal((await state.call()).body.verified, false);
});

test('disconnect erases private email data and invalidates every outstanding link', async t => {
  const state = harness(t); await state.request(); const token = state.token();
  await state.call({action: 'confirm', token}); await state.request(); const pending = state.token();
  assert.equal((await state.call({action: 'disconnect'})).statusCode, 200);
  assert.equal((await state.call({action: 'disconnect'})).statusCode, 200);
  const row = state.rows.get(WALLET);
  for (const key of ['verified_email', 'verified_at', 'pending_email', 'pending_token_hash', 'pending_expires_at']) assert.equal(row[key], null);
  assert.equal((await state.call({action: 'confirm', token: pending})).statusCode, 400);
});

test('a request paused at the durable quota cannot resurrect a disconnected email challenge', async t => {
  const state = harness(t); await state.request(); const previousMails = state.mails.length;
  let release, reached;
  const started = new Promise(resolve => {reached = resolve;});
  state.quota = async () => {reached(); await new Promise(resolve => {release = resolve;}); return true;};
  const pending = state.request(); await started;
  await state.call({action: 'disconnect'});
  state.quota = null; release();
  const result = await pending;
  assert.equal(result.statusCode, 409);
  assert.equal(state.rows.get(WALLET).pending_token_hash, null);
  assert.equal(state.mails.length, previousMails);
});

test('configuration, validation, origin, quotas and database failure prevent mail sends', async t => {
  const state = harness(t);
  const cases = [
    [{action: 'request', email: 'invalid'}, {}],
    [{action: 'request', email: EMAIL}, {headers: {origin: 'https://evil.example'}}],
    [{action: 'request', email: EMAIL}, {headers: {'content-type': 'application/x-www-form-urlencoded'}}],
    [{action: 'confirm', token: 'bad'}, {}],
    [{action: 'unknown'}, {}]
  ];
  for (const [body, options] of cases) assert.notEqual((await state.call(body, options)).statusCode, 200);
  state.quota = () => false;
  assert.equal((await state.request()).statusCode, 429);
  state.quota = null; state.failDatabase = true;
  assert.equal((await state.request()).statusCode, 503);
  state.failDatabase = false; delete process.env.ARTSOUL_EMAIL_FROM;
  assert.equal((await state.request()).statusCode, 503);
  assert.deepEqual(state.mails, []);
});

test('provider failure never verifies email and errors expose no private addresses or storage details', async t => {
  const state = harness(t); state.mailStatus = 503;
  const result = await state.request();
  assert.equal(result.statusCode, 503);
  assert.ok(!JSON.stringify(result.body).includes(EMAIL));
  assert.equal((await state.call()).body.verified, false);
  state.failDatabase = true;
  assert.ok(!JSON.stringify((await state.call()).body).includes('private database failure'));
});

test('the feature remains unavailable until explicitly activated', async t => {
  const state = harness(t); process.env.ARTSOUL_PROFILE_EMAIL_ENABLED = 'false';
  assert.equal((await state.call()).body.available, false);
  assert.equal((await state.request()).statusCode, 503);
  assert.deepEqual(state.calls, []);
});

test('the existing API dispatcher exposes the private route with no-store and same-origin referrers', async t => {
  const state = harness(t);
  const result = await state.call(undefined, {dispatched: true});
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.wallet, WALLET);
  assert.equal(result.body.email, null);
  assert.equal(result.headers['Cache-Control'], 'private, no-store');
  assert.equal(result.headers['Referrer-Policy'], 'same-origin');
});
