import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const WALLET = `0x${'1'.repeat(40)}`, SUPPORT = `0x${'2'.repeat(40)}`;
const TX = `0x${'a'.repeat(64)}`, REPORT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VERSION = '2026-09-30T12:00:00.000Z';
const env = { NODE_ENV: 'test', SESSION_SECRET: 'local-donation-report-only', SUPABASE_URL: 'https://local-donation.example.test',
  SUPABASE_SERVICE_ROLE_KEY: 'local-not-a-key', ARTSOUL_REPORTING_ENABLED: 'true', ARTSOUL_REPORT_DAILY_LIMIT: '5',
  ARTSOUL_DONATIONS_ENABLED: 'true', ARTSOUL_DONATIONS_ADDRESS_BASE_SEPOLIA: SUPPORT,
  ARTSOUL_PROTOCOL_ADMIN_ENABLED: 'true', ARTSOUL_MODERATION_PASSKEY_ENABLED: 'true',
  ARTSOUL_WEBAUTHN_RP_ID: 'example.test', ARTSOUL_WEBAUTHN_ALLOWED_ORIGIN: 'https://example.test',
  ARTSOUL_WEBAUTHN_RP_NAME: 'ArtSoul', ARTSOUL_MODERATION_SESSION_SECRET: 'local-step-up-only' };
Object.assign(process.env, env);
const [{default: intake}, {default: review}, {default: queue}, {default: notifications}, backend, passkeys] = await Promise.all([
  import('../src/api/routes/moderation/reports.js'), import('../src/api/routes/moderation/review-action.js'),
  import('../src/api/routes/moderation/review-queue.js'), import('../src/api/routes/moderation/notifications.js'),
  import('../src/api/backend.js'), import('../src/api/moderation-passkey.js')
]);
function response() { return {headers: {}, statusCode: 200, setHeader(k,v) { this.headers[k] = v; },
  status(s) { this.statusCode = s; return this; }, json(body) { this.body = body; return this; }, end() {} }; }
function cookie(stepUp = false) {
  const res = response(); backend.setWalletSession(res, WALLET);
  let result = res.headers['Set-Cookie'].split(';')[0];
  if (stepUp) { const elevated = response(); passkeys.setModerationSession(elevated, WALLET, 'local-credential');
    result += `; ${elevated.headers['Set-Cookie'].split(';')[0]}`; }
  return result;
}
const complaint = {target_type: 'donation_message', chain_id: 84532, artwork_id: '28', donation_transaction_hash: TX,
  donation_log_index: 3, category: 'spam', details: 'Evidence for review.', good_faith_confirmed: true};
const decision = {report_id: REPORT, target_type: 'donation_message', expected_updated_at: VERSION, action: 'hide', reason: 'Verified evidence.'};
const context = {report_id: REPORT, message: '<script>untrusted indexed text</script>', available: true, hidden: true};
async function call(handler, body, session = cookie(), method = 'POST') {
  const res = response(); await handler({method, headers: {cookie: session}, body, query: {}}, res); return res;
}
function authResponse(input) {
  if (String(input).includes('/artsoul_staff_roles?')) return Response.json([{role: 'moderator'}]);
  if (String(input).includes('/artsoul_staff_passkeys?')) return Response.json([{credential_id: 'local-credential'}]);
  return null;
}

test('typed donation complaints preserve intake identity and existing authorization boundaries', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  await t.test('donation intake pins deployment and derives reporter from SIWE despite spoofed identity fields', async () => {
    let rpc;
    globalThis.fetch = async (input, options) => {
      assert.match(String(input), /\/rpc\/submit_moderation_report$/);
      rpc = JSON.parse(options.body);
      return Response.json([{report_id: REPORT, report_status: 'pending_review', report_created_at: VERSION, already_submitted: false}]);
    };
    const res = await call(intake, {...complaint, donation_contract_address: `0x${'9'.repeat(40)}`, donor: `0x${'8'.repeat(40)}`, reporter_wallet: `0x${'7'.repeat(40)}`});
    assert.equal(res.statusCode, 201);
    assert.equal(rpc.p_donation_contract_address, SUPPORT); assert.equal(rpc.p_reporter_wallet, WALLET);
    assert.equal(rpc.p_donation_transaction_hash, TX); assert.equal(rpc.p_donation_log_index, 3);
    assert.equal(rpc.p_target_type, 'donation_message'); assert.equal(rpc.p_daily_limit, 5);
    assert.equal(Object.keys(rpc).some(k => /donor|author/.test(k)), false);
    assert.doesNotMatch(JSON.stringify(res.body), /donor|author|contract_address|transaction_hash|reporter_wallet/);
  });
  await t.test('guest, dormant configuration, invalid event identity and mixed targets never reach storage', async () => {
    globalThis.fetch = () => { throw new Error('unexpected storage access'); };
    assert.equal((await call(intake, complaint, '')).statusCode, 401);
    for (const patch of [{target_type: 'invented'}, {target_type: 'artwork'}, {chain_id: 11155111},
      {donation_transaction_hash: 'bad'}, {donation_log_index: '3'}, {donation_log_index: -1},
      {donation_log_index: 2147483648}, {donation_log_index: 1.5}, {donation_log_index: null}]) {
      const res = await call(intake, {...complaint, ...patch}); assert.equal(res.statusCode, 400); assert.equal(res.body.error, 'INVALID_REPORT_TARGET');
    }
    process.env.ARTSOUL_DONATIONS_ENABLED = 'false';
    assert.equal((await call(intake, complaint)).body.error, 'DONATION_REPORTING_DISABLED');
    process.env.ARTSOUL_DONATIONS_ENABLED = 'true';
  });
  await t.test('missing indexed text and the shared rolling cap have bounded public errors', async () => {
    for (const [message, status] of [['DONATION_MESSAGE_NOT_FOUND',404], ['REPORT_DAILY_LIMIT_REACHED',429]]) {
      globalThis.fetch = async () => Response.json({message}, {status: 400});
      const res = await call(intake, complaint); assert.equal(res.statusCode, status); assert.equal(res.body.error, message);
    }
  });
  await t.test('donation review remains unavailable without the existing passkey step-up', async () => {
    const calls = [];
    globalThis.fetch = async input => { calls.push(String(input)); return authResponse(input) || Response.json([]); };
    const res = await call(review, decision); assert.equal(res.statusCode, 403); assert.equal(res.body.error, 'STEP_UP_REQUIRED');
    assert.equal(calls.some(path => path.includes('/rpc/')), false);
  });
  await t.test('typed review sends only report/version/action intent and returns message visibility', async () => {
    let rpc;
    globalThis.fetch = async (input, options) => {
      const auth = authResponse(input); if (auth) return auth;
      assert.match(String(input), /\/rpc\/review_moderation_report$/); rpc = JSON.parse(options.body);
      return Response.json([{report_id: REPORT, report_status: 'actioned', report_updated_at: VERSION,
        target_type: 'donation_message', target_hidden: true}]);
    };
    const res = await call(review, {...decision, actor_wallet: SUPPORT, artwork_id: '999', donation_transaction_hash: `0x${'f'.repeat(64)}`}, cookie(true));
    assert.equal(res.statusCode, 200); assert.equal(res.body.report.message_hidden, true);
    assert.equal(Object.hasOwn(res.body.report, 'artwork_hidden'), false);
    assert.deepEqual(rpc, {p_report_id: REPORT, p_expected_updated_at: VERSION, p_action: 'hide', p_reason: 'Verified evidence.',
      p_actor_wallet: WALLET, p_expected_target_type: 'donation_message'});
  });
  await t.test('a stored-target mismatch rejects instead of routing an action to caller-selected content', async () => {
    globalThis.fetch = async input => authResponse(input) || Response.json({message: 'REPORT_TARGET_MISMATCH'}, {status: 400});
    const res = await call(review, decision, cookie(true)); assert.equal(res.statusCode, 409); assert.equal(res.body.error, 'REPORT_TARGET_MISMATCH');
  });
  await t.test('only elevated staff can read typed queue identifiers', async () => {
    let queueQuery;
    globalThis.fetch = async input => {
      const auth = authResponse(input); if (auth) return auth;
      if (String(input).includes('/artwork_reports?')) { queueQuery = new URL(input); return Response.json([{id: REPORT, ...complaint}]); }
      if (String(input).endsWith('/rpc/read_donation_report_messages')) return Response.json([context]);
      return Response.json([]);
    };
    const guest = await call(queue, undefined, '', 'GET'); assert.equal(guest.statusCode, 401);
    assert.equal((await call(queue, undefined, cookie(), 'GET')).statusCode, 403);
    const res = await call(queue, undefined, cookie(true), 'GET'); assert.equal(res.statusCode, 200);
    assert.match(queueQuery.searchParams.get('select'), /target_type,donation_contract_address,donation_transaction_hash,donation_log_index/);
    assert.equal(res.body.data.reports[0].target_type, 'donation_message');
  });
  await t.test('default-off old-schema queue retries only a missing new target column and keeps migrated history typed', async () => {
    process.env.ARTSOUL_DONATIONS_ENABLED = 'false';
    try {
      for (const code of ['42703', 'PGRST204']) {
        let reads = 0;
        globalThis.fetch = async input => {
          const auth = authResponse(input); if (auth) return auth;
          if (String(input).includes('/artwork_reports?')) {
            reads++;
            if (new URL(input).searchParams.get('select').includes('target_type')) return Response.json({code, message: 'column artwork_reports.target_type does not exist'}, {status: 400});
            return Response.json([{id: REPORT, chain_id: 84532, artwork_id: '28'}]);
          }
          return Response.json([]);
        };
        const res = await call(queue, undefined, cookie(true), 'GET'); assert.equal(res.statusCode, 200); assert.equal(reads, 2);
      }
      let reads = 0;
      globalThis.fetch = async input => {
        const auth = authResponse(input); if (auth) return auth;
        if (String(input).includes('/artwork_reports?')) { reads++; return Response.json([{id: REPORT, ...complaint}]); }
        if (String(input).endsWith('/rpc/read_donation_report_messages')) return Response.json([context]);
        return Response.json([]);
      };
      const retained = await call(queue, undefined, cookie(true), 'GET'); assert.equal(retained.body.data.reports[0].target_type, 'donation_message'); assert.equal(reads, 1);
      for (const [code,message] of [['42703','column artwork_reports.details does not exist'], ['42501','permission denied'], ['42P01','artwork_reports missing']]) {
        let attempts = 0;
        globalThis.fetch = async input => {
          const auth = authResponse(input); if (auth) return auth;
          if (String(input).includes('/artwork_reports?')) { attempts++; return Response.json({code,message}, {status: 400}); }
          return Response.json([]);
        };
        assert.notEqual((await call(queue, undefined, cookie(true), 'GET')).statusCode, 200); assert.equal(attempts, 1);
      }
    } finally { process.env.ARTSOUL_DONATIONS_ENABLED = 'true'; }
  });
  await t.test('staff review reads exact hidden message context in one batch and fails closed on missing or foreign context', async () => {
    const reports = Array.from({length: 200},(_,i) => ({id: `${(i+1).toString(16).padStart(8,'0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, ...complaint}));
    let batchCalls = 0;
    globalThis.fetch = async (input,options) => {
      const auth = authResponse(input); if (auth) return auth;
      if (String(input).includes('/artwork_reports?')) return Response.json(reports);
      if (String(input).endsWith('/rpc/read_donation_report_messages')) {
        batchCalls++; assert.deepEqual(JSON.parse(options.body),{p_report_ids:reports.map(row=>row.id)});
        return Response.json(reports.map((report,i) => ({...context,report_id:report.id,
          ...(i===199 ? {message:null,available:false} : {})})));
      }
      return Response.json([]);
    };
    const res = await call(queue,undefined,cookie(true),'GET'); assert.equal(res.statusCode,200); assert.equal(batchCalls,1);
    assert.equal(res.body.data.reports[0].donation_message,context.message); assert.equal(res.body.data.reports[0].donation_message_hidden,true);
    assert.equal(res.body.data.reports[199].donation_message_available,false);
    assert.equal(Object.hasOwn(res.body.data.reports[0],'donor'),false);
    for (const failure of [[], [{...context,report_id:'foreign'}], [{...context,available:'yes'}], null]) {
      globalThis.fetch = async input => {
        const auth = authResponse(input); if (auth) return auth;
        if (String(input).includes('/artwork_reports?')) return Response.json([{id:REPORT,...complaint}]);
        if (String(input).endsWith('/rpc/read_donation_report_messages')) return Response.json(failure);
        return Response.json([]);
      };
      assert.notEqual((await call(queue,undefined,cookie(true),'GET')).statusCode,200);
    }
  });
  await t.test('author message notices retain private recipient scoping and disclose no complaint or donor identity', async () => {
    globalThis.fetch = async input => {
      const url = new URL(input);
      if (url.pathname.endsWith('/artwork_report_notifications')) {
        assert.equal(url.searchParams.get('recipient_wallet'), `eq.${WALLET}`);
        return Response.json(['DONATION_MESSAGE_HIDDEN','DONATION_MESSAGE_RESTORED'].map((kind,i) => ({id: String(i+1), report_id: REPORT,
          notification_type: kind, created_at: VERSION, recipient_wallet: WALLET, details: 'private evidence'})));
      }
      return Response.json([{id: REPORT, chain_id: '84532', artwork_id: '28'}]);
    };
    const res = await call(notifications, undefined, cookie(), 'GET'); assert.equal(res.statusCode, 200);
    assert.equal(res.body.items.length, 2); assert.match(res.body.items[0].message, /donation remains recorded/);
    assert.doesNotMatch(JSON.stringify(res.body.items), /private evidence|report_id|recipient_wallet|donor|transaction_hash/);
  });
  await t.test('admin differentiates message actions and renders complaint data as plain text', () => {
    const source = fs.readFileSync(new URL('../src/entries/admin.jsx', import.meta.url), 'utf8');
    assert.match(source, /Hide message pending review/); assert.match(source, /Resolve and restore message if clear/);
    assert.match(source, /target_type: decision\.report\.target_type \|\| 'artwork'/);
    assert.match(source, /\{report\.details\}/); assert.doesNotMatch(source, /dangerouslySetInnerHTML/);
  });
});
