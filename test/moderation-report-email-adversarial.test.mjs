import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {deliverReportEmail, deliverPendingReportEmails} from '../src/api/moderation-report-email.js';

const REPORT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const TOKEN = '33333333-3333-4333-8333-333333333333';

// HTTP boundaries are local fixtures; these tests never contact a database or
// email provider. Database concurrency and expiry require the real SQL suite.
function harness(t) {
  const env = {SUPABASE_URL: 'https://report-email.example', SUPABASE_SERVICE_ROLE_KEY: 'local-test-role',
    ARTSOUL_MODERATION_EMAIL_ENABLED: 'true', ARTSOUL_MODERATION_ALERT_EMAIL: 'review@example.test',
    ARTSOUL_EMAIL_FROM: 'ArtSoul <reports@example.test>', ARTSOUL_EMAIL_API_KEY: 'local-test-mail',
    ARTSOUL_PUBLIC_ORIGIN: 'https://artsoul.example'};
  const saved = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, env);
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : process.env[key] = value;
  });
  const state = {calls: [], mails: [], finish: true, batch: [], mailStatus: 200, failMail: false};
  state.claim = body => [{report_id: body.p_report_id, payload_hash: body.p_payload_hash, state: 'pending', attempt_token: TOKEN,
    first_attempt_at: new Date(Date.now() - 1000).toISOString(), lease_until: new Date(Date.now() + 120000).toISOString()}];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input), body = init.body && JSON.parse(init.body);
    if (url.hostname === 'api.resend.com') {
      assert.equal(url.href, 'https://api.resend.com/emails');
      assert.equal(init.method, 'POST');
      assert.equal(init.redirect, 'error');
      assert.ok(init.signal);
      state.mails.push({body, key: init.headers['Idempotency-Key']});
      if (state.failMail) throw new Error('private-provider-error-not-for-output');
      return Response.json({id: 'local-only'}, {status: state.mailStatus});
    }
    assert.equal(url.origin, 'https://report-email.example', 'all requests are intercepted');
    assert.equal(init.method, 'POST');
    assert.ok(init.signal instanceof AbortSignal, 'every delivery RPC forwards its bounded abort signal');
    assert.equal(init.signal.aborted, false);
    state.calls.push({path: url.pathname, body});
    if (url.pathname.endsWith('/claim_moderation_report_email')) return Response.json(await state.claim(body));
    if (url.pathname.endsWith('/finish_moderation_report_email')) {
      if (state.failFinish) throw new Error('private-database-error-not-for-output');
      return Response.json(state.finish);
    }
    if (url.pathname.endsWith('/pending_moderation_report_emails')) return Response.json(state.batch);
    throw new Error('Unexpected fixture route');
  };
  return state;
}

test('report email fails closed before any claim or send when disabled or configuration is invalid', async t => {
  const state = harness(t);
  process.env.ARTSOUL_MODERATION_EMAIL_ENABLED = 'TRUE';
  assert.deepEqual(await deliverReportEmail(REPORT), {status: 'disabled'});
  assert.deepEqual(await deliverPendingReportEmails(), {status: 'disabled', attempted: 0});
  process.env.ARTSOUL_MODERATION_EMAIL_ENABLED = 'true';
  await assert.rejects(deliverReportEmail('not-a-report'), /INVALID_REPORT_REFERENCE/);
  process.env.ARTSOUL_MODERATION_ALERT_EMAIL = 'review@example.test\r\nBcc: other@example.test';
  await assert.rejects(deliverReportEmail(REPORT));
  process.env.ARTSOUL_MODERATION_ALERT_EMAIL = 'review@example.test';
  process.env.ARTSOUL_EMAIL_FROM += '\r\n';
  await assert.rejects(deliverReportEmail(REPORT), /EMAIL_CONFIGURATION_REQUIRED/);
  assert.deepEqual(state.calls, []);
  assert.deepEqual(state.mails, []);
});

test('missing or malformed delivery claims never send or finish another attempt', async t => {
  const state = harness(t);
  state.claim = () => [];
  assert.deepEqual(await deliverReportEmail(REPORT), {status: 'not_claimed'});
  for (const patch of [{report_id: OTHER}, {payload_hash: '0'.repeat(64)}, {state: 'accepted'}, {attempt_token: 'bad-token'}]) {
    state.claim = body => [{report_id: REPORT, payload_hash: body.p_payload_hash, state: 'pending', attempt_token: TOKEN, ...patch}];
    await assert.rejects(deliverReportEmail(REPORT), /INVALID_DELIVERY_CLAIM/);
  }
  state.claim = () => [{} , {}];
  await assert.rejects(deliverReportEmail(REPORT), /INVALID_DELIVERY_CLAIM/);
  assert.deepEqual(state.mails, []);
  assert.ok(state.calls.every(call => call.path.endsWith('/claim_moderation_report_email')));
});

test('expired, malformed and nearly exhausted claims never reach the email provider', async t => {
  const state = harness(t), now = Date.now();
  const validClaim = state.claim;
  for (const patch of [
    {first_attempt_at: null}, {lease_until: 'not-a-date'},
    {first_attempt_at: new Date(now + 60000).toISOString()},
    {first_attempt_at: new Date(now - 23 * 60 * 60 * 1000).toISOString()},
    {first_attempt_at: new Date(now - 23 * 60 * 60 * 1000 + 10000).toISOString()},
    {lease_until: new Date(now - 1).toISOString()},
    {lease_until: new Date(now + 10000).toISOString()}
  ]) {
    state.claim = body => [{...validClaim(body)[0], ...patch}];
    await assert.rejects(deliverReportEmail(REPORT), /DELIVERY_CLAIM_EXPIRED/);
  }
  assert.deepEqual(state.mails, []);
  assert.ok(state.calls.every(call => call.path.endsWith('/claim_moderation_report_email')));
});

test('a worker resuming after a valid database lease expired checks time again before sending', async t => {
  const state = harness(t), actualNow = Date.now, now = Date.now();
  t.after(() => {Date.now = actualNow;});
  state.claim = body => {
    const row = {report_id: REPORT, payload_hash: body.p_payload_hash, state: 'pending', attempt_token: TOKEN,
      first_attempt_at: new Date(now - 1000).toISOString(), lease_until: new Date(now + 120000).toISOString()};
    Date.now = () => now + 180000;
    return [row];
  };
  await assert.rejects(deliverReportEmail(REPORT), /DELIVERY_CLAIM_EXPIRED/);
  assert.deepEqual(state.mails, []);
  assert.equal(state.calls.length, 1);
});

test('ambiguous provider failure retries the identical key and payload and records only sanitized status', async t => {
  const state = harness(t);
  state.failMail = true;
  assert.deepEqual(await deliverReportEmail(REPORT), {status: 'pending'});
  state.failMail = false;
  assert.deepEqual(await deliverReportEmail(REPORT), {status: 'accepted'});
  assert.equal(state.mails.length, 2);
  assert.deepEqual(state.mails[0], state.mails[1]);
  const mail = state.mails[0];
  assert.equal(mail.key, `artsoul-report-${REPORT}`);
  assert.deepEqual(mail.body.to, ['review@example.test']);
  assert.deepEqual(Object.keys(mail.body).sort(), ['from', 'subject', 'text', 'to']);
  assert.match(mail.body.text, /https:\/\/artsoul\.example\/admin/);
  assert.doesNotMatch(mail.body.text, /0x[0-9a-f]{40}|evidence|private-provider/);
  const hashed = JSON.stringify({...mail.body, to: mail.body.to[0]});
  const claims = state.calls.filter(call => call.path.endsWith('/claim_moderation_report_email'));
  assert.equal(claims[0].body.p_payload_hash, crypto.createHash('sha256').update(hashed).digest('hex'));
  const finishes = state.calls.filter(call => call.path.endsWith('/finish_moderation_report_email'));
  assert.deepEqual(finishes.map(call => call.body), [
    {p_report_id: REPORT, p_attempt_token: TOKEN, p_accepted: false, p_error_code: 'DELIVERY_UNCONFIRMED'},
    {p_report_id: REPORT, p_attempt_token: TOKEN, p_accepted: true, p_error_code: null}
  ]);
});

test('accepted provider response without durable finish cannot be reported as accepted', async t => {
  const state = harness(t);
  state.finish = false;
  await assert.rejects(deliverReportEmail(REPORT), /DELIVERY_RESULT_NOT_RECORDED/);
  assert.equal(state.mails.length, 1);
  state.failFinish = true;
  state.batch = [{report_id: REPORT}];
  assert.deepEqual(await deliverPendingReportEmails(), {status: 'complete', attempted: 1, accepted: 0, pending: 0, skipped: 0, failed: 1});
});

test('destination and origin changes participate in the guarded payload hash before a retry', async t => {
  const state = harness(t);
  const hashes = [];
  state.claim = body => {hashes.push(body.p_payload_hash); return [];};
  await deliverReportEmail(REPORT);
  process.env.ARTSOUL_MODERATION_ALERT_EMAIL = 'changed@example.test';
  await deliverReportEmail(REPORT);
  process.env.ARTSOUL_EMAIL_FROM = 'ArtSoul <changed@example.test>';
  await deliverReportEmail(REPORT);
  process.env.ARTSOUL_PUBLIC_ORIGIN = 'https://changed.example';
  await deliverReportEmail(REPORT);
  assert.equal(new Set(hashes).size, 4);
  assert.deepEqual(state.mails, []);
});

test('a worker refuses oversized and malformed batches and hides per-report failure details', async t => {
  const state = harness(t);
  state.batch = Array.from({length: 4}, () => ({report_id: REPORT}));
  await assert.rejects(deliverPendingReportEmails(), /INVALID_DELIVERY_BATCH/);
  state.batch = [{report_id: 'malformed'}];
  await assert.rejects(deliverPendingReportEmails(), /INVALID_DELIVERY_BATCH/);
  assert.deepEqual(state.mails, []);
  state.batch = [{report_id: REPORT}, {report_id: OTHER}];
  state.claim = body => body.p_report_id === REPORT ? [] : [{report_id: OTHER, payload_hash: 'not-a-payload', state: 'pending', attempt_token: TOKEN}];
  assert.deepEqual(await deliverPendingReportEmails(), {status: 'complete', attempted: 2, accepted: 0, pending: 0, skipped: 1, failed: 1});
  assert.deepEqual(state.mails, []);
});
