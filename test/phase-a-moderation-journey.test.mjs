// Local route-to-SQL journey, never a production activation or passkey ceremony.
// Real handlers and migrations run over loopback HTTP and disposable PostgreSQL.
// The transport adapter below covers only the used PostgREST shapes; it is not
// Supabase/PostgREST deployment acceptance. Session setters create TEST credentials.
// Email requests reach a local capture sink, never Resend or a real recipient.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';
import test from 'node:test';
import pg from 'pg';
import reports from '../src/api/routes/moderation/reports.js';
import access from '../src/api/routes/moderation/access.js';
import queue from '../src/api/routes/moderation/review-queue.js';
import review from '../src/api/routes/moderation/review-action.js';
import notifications from '../src/api/routes/moderation/notifications.js';
import newsletter from '../src/api/routes/newsletter.js';
import {setWalletSession} from '../src/api/backend.js';
import {setModerationSession} from '../src/api/moderation-passkey.js';
import {digest} from '../src/api/launch-services.js';
import {deliverReportEmail} from '../src/api/moderation-report-email.js';
import {listIndexerMigrations} from '../scripts/apply-migrations.js';

const STAFF = `0x${'1'.repeat(40)}`;
const REPORTER_A = `0x${'2'.repeat(40)}`;
const REPORTER_B = `0x${'3'.repeat(40)}`;
const CREATOR = `0x${'4'.repeat(40)}`;
const CONTAINER = `artsoul-journey-pg-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
const serviceKey = 'local-journey-service-role-not-a-real-credential';
const emailKey = 'local-capture-only-not-a-provider-key';
const modSecret = 'local-journey-step-up-secret-not-production';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function docker(...args) { return execFileSync('docker', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim(); }
function haveDocker() {
  try { return docker('version', '--format', '{{.Server.Os}}') === 'linux'; } catch { return false; }
}
function identifier(value) {
  assert.match(value, /^[a-z_][a-z_0-9]*$/);
  return `"${value}"`;
}
async function jsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}
function send(res, status, data) {
  res.writeHead(status, {'Content-Type': 'application/json'});
  res.end(JSON.stringify(data));
}
function cookie(wallet, stepUp = false) {
  const parts = [];
  const res = {setHeader(_name, value) { parts.push(String(value).split(';')[0]); }};
  setWalletSession(res, wallet);
  if (stepUp) setModerationSession(res, wallet, 'local-virtual-credential', undefined, 'passkey', {headers:{'user-agent':'local-staff-test'},socket:{remoteAddress:'127.0.0.1'}});
  return parts.join('; ');
}
function expiredStepUp(walletCookie) {
  const payload = Buffer.from(JSON.stringify({wallet: STAFF, credential_id: 'local-virtual-credential', exp: 1})).toString('base64url');
  const signature = crypto.createHmac('sha256', modSecret).update(payload).digest('base64url');
  return `${walletCookie}; artsoul_mod_session=${payload}.${signature}`;
}

test('Phase A local moderation route journey and captured email (virtual credentials, PostgreSQL 17)', {
  skip: haveDocker() ? false : 'Docker is unavailable; this suite requires disposable local PostgreSQL'
}, async t => {
  let created = false, pool, server, origin;
  const originalFetch = globalThis.fetch;
  const env = {
    NODE_ENV: 'test', SESSION_SECRET: 'local-journey-siwe-secret-not-production',
    SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    ARTSOUL_REPORTING_ENABLED: 'true', ARTSOUL_REPORT_DAILY_LIMIT: '5',
    ARTSOUL_PROTOCOL_ADMIN_ENABLED: 'true', ARTSOUL_MODERATION_PASSKEY_ENABLED: 'true',
    ARTSOUL_WEBAUTHN_RP_ID: 'local-test.invalid', ARTSOUL_WEBAUTHN_ALLOWED_ORIGIN: 'https://local-test.invalid',
    ARTSOUL_WEBAUTHN_RP_NAME: 'Local test only', ARTSOUL_MODERATION_SESSION_SECRET: modSecret,
    ARTSOUL_NEWSLETTER_ENABLED: 'true', ARTSOUL_EMAIL_API_KEY: emailKey,
    ARTSOUL_MODERATION_EMAIL_ENABLED: 'true', ARTSOUL_MODERATION_ALERT_EMAIL: 'review@example.test',
    ARTSOUL_EMAIL_FROM: 'ArtSoul test <capture@example.test>', ARTSOUL_PUBLIC_ORIGIN: 'https://local-test.invalid'
  };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  const captured = [];
  const reportEmails = [];
  let captureStatus = 200;
  let reportEmailMode = 'accepted';
  t.after(async () => {
    globalThis.fetch = originalFetch;
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (pool) await pool.end();
    if (created) docker('rm', '-f', CONTAINER);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  docker('run', '-d', '--name', CONTAINER, '-e', 'POSTGRES_PASSWORD=local-disposable-only',
    '-e', 'POSTGRES_DB=artsoul', '-p', '127.0.0.1::5432', 'postgres:17');
  created = true;
  const endpoint = docker('port', CONTAINER, '5432/tcp');
  assert.match(endpoint, /^127\.0\.0\.1:\d+$/);
  // Preserve PostgreSQL microseconds: truncating timestamps to JS milliseconds
  // would make the real expected_updated_at compare-and-swap falsely conflict.
  pool = new pg.Pool({host: '127.0.0.1', port: Number(endpoint.split(':')[1]), database: 'artsoul',
    user: 'postgres', password: 'local-disposable-only', connectionTimeoutMillis: 1000,
    types: {getTypeParser: oid => oid === 1184 ? value => value : pg.types.getTypeParser(oid)}});
  let ready = false;
  for (let n = 0; n < 60; n++) {
    try { await pool.query('SELECT 1'); ready = true; break; } catch { await delay(500); }
  }
  assert.ok(ready, 'disposable PostgreSQL became ready');
  await pool.query(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;`);
  for (const migration of listIndexerMigrations()) await pool.query(migration.sql);
  // Media/search projections are prerequisite fixtures; notification and catalog
  // behavior below is installed from the actual current migrations.
  await pool.query(`CREATE TABLE public.artwork_media_chain_revisions(chain_id NUMERIC PRIMARY KEY,revision NUMERIC(78,0) NOT NULL);
    CREATE TABLE public.artwork_search_metadata(chain_id NUMERIC(78,0),artwork_id NUMERIC(78,0),metadata_uri TEXT,
      source_transaction_hash TEXT,title TEXT,metadata JSONB);
    GRANT SELECT ON public.v41_artworks,public.artwork_search_metadata TO service_role;`);
  for (const name of ['phase18_artwork_moderation_visibility.sql', 'a8a_moderation_passkey_foundation.sql',
    'a8b_artwork_report_intake.sql', 'a8c_protocol_admin_review.sql', 'collection_launch_services.sql',
    'moderation_report_email_delivery.sql', 'artist_support.sql', 'artist_support_moderation.sql',
    'auction_notifications.sql', 'auction_notification_lifecycle.sql', 'auction_notification_reminders.sql',
    'notification_summary.sql', 'notification_inbox_removal.sql', 'admin_artwork_catalog.sql']) {
    await pool.query(fs.readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8'));
  }
  await pool.query(`INSERT INTO v41_artworks(chain_id,artwork_id,creator,metadata_uri,block_number,transaction_hash,log_index,last_updated_block)
    SELECT 84532,n,$1,'ipfs://local-journey-fixture',n,'0x'||lpad(to_hex(n),64,'0'),0,n FROM generate_series(101,112) n`, [CREATOR]);
  await pool.query("INSERT INTO artsoul_staff_roles(wallet_address,role) VALUES($1,'moderator')", [STAFF]);
  await pool.query(`INSERT INTO artsoul_staff_passkeys(wallet_address,credential_id,public_key,enrolled_via)
    VALUES($1,'local-virtual-credential','dGVzdC1vbmx5','bootstrap')`, [STAFF]);

  const tables = new Set(['artsoul_staff_roles', 'artsoul_staff_passkeys', 'artwork_reports', 'artwork_report_events',
    'artwork_moderation_visibility', 'artwork_moderation_log', 'artwork_report_notifications', 'email_subscriptions']);
  const rpcNames = new Set(['submit_artwork_report', 'review_artwork_report', 'consume_launch_service_quota',
    'claim_moderation_report_email', 'finish_moderation_report_email', 'read_admin_artwork_catalog']);
  function filter(params, values) {
    return [...params].filter(([name]) => !['select', 'order', 'limit', 'on_conflict'].includes(name)).map(([name, raw]) => {
      const column = identifier(name);
      if (raw === 'is.null') return `${column} IS NULL`;
      if (raw.startsWith('lt.')) { values.push(raw.slice(3)); return `${column}<$${values.length}`; }
      if (raw.startsWith('in.(') && raw.endsWith(')')) {
        const slots = raw.slice(4, -1).split(',').map(value => { values.push(value); return `$${values.length}`; });
        return `${column} IN (${slots.join(',')})`;
      }
      assert.ok(raw.startsWith('eq.'), `unsupported local transport filter ${raw}`);
      const value = raw.slice(3);
      values.push(value.startsWith('"') ? JSON.parse(value) : value);
      return `${column}=$${values.length}`;
    }).join(' AND ');
  }
  async function rest(req, res, url) {
    assert.equal(req.headers.apikey, serviceKey);
    assert.equal(req.headers.authorization, `Bearer ${serviceKey}`);
    const name = url.pathname.slice('/rest/v1/'.length), values = [];
    let sql, scalar = false;
    if (name.startsWith('rpc/')) {
      assert.equal(req.method, 'POST');
      const fn = name.slice(4); assert.ok(rpcNames.has(fn));
      const body = await jsonBody(req);
      const args = Object.entries(body).map(([key, value]) => { values.push(value); return `${identifier(key)} => $${values.length}`; });
      scalar = ['consume_launch_service_quota', 'finish_moderation_report_email', 'read_admin_artwork_catalog'].includes(fn);
      sql = `SELECT ${scalar ? '' : '* FROM '}public.${identifier(fn)}(${args.join(',')})${scalar ? ' AS value' : ''}`;
    } else {
      assert.ok(tables.has(name), `unexpected local table ${name}`);
      if (req.method === 'GET') {
        const columns = (url.searchParams.get('select') || '*').split(',').map(value => ['id::text', 'chain_id::text', 'artwork_id::text'].includes(value) ? value : identifier(value)).join(',');
        const where = filter(url.searchParams, values);
        sql = `SELECT ${columns} FROM public.${identifier(name)}${where ? ` WHERE ${where}` : ''}`;
        if (url.searchParams.has('order')) {
          const [column, direction] = url.searchParams.get('order').split('.');
          // Order the table column, not a select alias cast to text.
          assert.ok(['asc', 'desc'].includes(direction)); sql += ` ORDER BY ${identifier(name)}.${identifier(column)} ${direction}`;
        }
        if (url.searchParams.has('limit')) { values.push(Number(url.searchParams.get('limit'))); sql += ` LIMIT $${values.length}`; }
      } else {
        assert.equal(name, 'email_subscriptions', 'only the real newsletter handler writes this REST table');
        const body = await jsonBody(req), row = Array.isArray(body) ? body[0] : body;
        const columns = Object.keys(row), slots = columns.map(key => { values.push(row[key]); return `$${values.length}`; });
        if (req.method === 'POST') {
          assert.equal(url.searchParams.get('on_conflict'), 'email');
          assert.match(req.headers.prefer, /resolution=ignore-duplicates/);
          sql = `INSERT INTO email_subscriptions(${columns.map(identifier)}) VALUES(${slots}) ON CONFLICT(email) DO NOTHING RETURNING *`;
        } else {
          assert.equal(req.method, 'PATCH');
          const where = filter(url.searchParams, values); assert.ok(where);
          sql = `UPDATE email_subscriptions SET ${columns.map((key, i) => `${identifier(key)}=${slots[i]}`)} WHERE ${where} RETURNING *`;
        }
      }
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN'); await client.query('SET LOCAL ROLE service_role');
      const result = await client.query(sql, values); await client.query('COMMIT');
      send(res, 200, scalar ? result.rows[0].value : result.rows);
    } catch (error) {
      await client.query('ROLLBACK'); send(res, 400, {code: error.code, message: error.message});
    } finally { client.release(); }
  }
  const routes = {'/reports': reports, '/access': access, '/queue': queue, '/review': review, '/notifications': notifications, '/newsletter': newsletter};
  server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, origin);
      if (url.pathname.startsWith('/rest/v1/')) return await rest(req, res, url);
      if (url.pathname === '/capture') {
        assert.equal(req.headers.authorization, `Bearer ${emailKey}`);
        const body = await jsonBody(req);
        assert.ok(body.to.every(email => email.endsWith('@example.test')));
        if (req.headers['idempotency-key']?.startsWith('artsoul-report-')) {
          assert.deepEqual(body.to, ['review@example.test']);
          const id = req.headers['idempotency-key'].slice('artsoul-report-'.length);
          const report = (await pool.query('SELECT status FROM artwork_reports WHERE id=$1', [id])).rows[0];
          assert.equal(report.status, 'actioned', 'the review decision committed before this worker send');
          reportEmails.push({body, idempotencyKey: req.headers['idempotency-key']});
          if (reportEmailMode === 'lost-response') return res.destroy();
          return send(res, reportEmailMode === 'unavailable' ? 503 : 200, {id: 'local-report-capture'});
        }
        const row = (await pool.query('SELECT * FROM email_subscriptions WHERE email=$1', [body.to[0]])).rows[0];
        assert.equal(row.status, 'subscribed', 'consent is committed before provider request');
        captured.push({body, idempotencyKey: req.headers['idempotency-key']});
        return send(res, captureStatus, {id: 'local-capture-not-delivery'});
      }
      assert.ok(routes[url.pathname], 'only local test routes exist');
      req.query = Object.fromEntries(url.searchParams);
      res.status = status => { res.statusCode = status; return res; };
      res.json = data => send(res, res.statusCode, data);
      await routes[url.pathname](req, res);
    } catch (error) { send(res, 500, {error: 'LOCAL_HARNESS_ERROR', message: error.message}); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
  Object.assign(process.env, env, {SUPABASE_URL: origin});
  globalThis.fetch = async (input, init) => {
    const url = new URL(input);
    if (url.href === 'https://api.resend.com/emails') return originalFetch(`${origin}/capture`, init);
    assert.equal(url.origin, origin, 'test must never contact a real provider or database');
    return originalFetch(input, init);
  };
  async function call(path, {wallet, stepUp, auth, body} = {}) {
    const response = await originalFetch(`${origin}${path}`, {method: body ? 'POST' : 'GET',
      headers: {'Content-Type': 'application/json', 'user-agent':'local-staff-test', cookie: auth ?? (wallet ? cookie(wallet, stepUp) : '')},
      ...(body ? {body: JSON.stringify(body)} : {})});
    return {status: response.status, body: await response.json()};
  }
  const submit = (wallet, artwork = 101) => call('/reports', {wallet, body: {chain_id: 84532, artwork_id: String(artwork),
    category: 'copyright', details: 'Authorized local test fixture, not a real copyright claim.', good_faith_confirmed: true}});
  async function visibleReport(id, status) {
    const result = await call(`/queue?status=${status}`, {wallet: STAFF, stepUp: true});
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body.data.reports.find(row => row.id === id);
  }
  const act = (row, action, options = {}) => call('/review', {wallet: STAFF, stepUp: true, ...options,
    body: {report_id: row.id, expected_updated_at: row.updated_at, action, reason: 'Local fixture review decision.'}});
  let first, second, concurrent;
  const ledger = () => Promise.all(['artwork_reports', 'artwork_report_events', 'artwork_moderation_visibility',
    'artwork_moderation_log', 'artwork_report_notifications'].map(async table =>
    (await pool.query(`SELECT row_to_json(r)::text AS value FROM ${identifier(table)} r ORDER BY row_to_json(r)::text`)).rows));

  await t.test('real intake commits one duplicate record, independent reporters and no automatic hide', async () => {
    assert.equal((await submit(undefined)).status, 401);
    const a = await submit(REPORTER_A); assert.equal(a.status, 201); first = a.body.report.reference;
    const duplicate = await submit(REPORTER_A); assert.equal(duplicate.status, 200);
    assert.equal(duplicate.body.report.reference, first); assert.equal(duplicate.body.alreadySubmitted, true);
    const b = await submit(REPORTER_B); assert.equal(b.status, 201); second = b.body.report.reference;
    assert.notEqual(first, second);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM artwork_report_events')).rows[0].n, 2);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM artwork_moderation_visibility WHERE hidden')).rows[0].n, 0);
  });
  await t.test('quota counts the earlier report, allows five total, rejects six and releases an aged slot', async () => {
    for (let id = 102; id <= 105; id++) assert.equal((await submit(REPORTER_A, id)).status, 201);
    const sixth = await submit(REPORTER_A, 106); assert.equal(sixth.status, 429);
    assert.equal(sixth.body.error, 'REPORT_DAILY_LIMIT_REACHED');
    assert.equal((await submit(REPORTER_A)).status, 200, 'duplicate is still idempotent at quota');
    assert.equal((await submit(REPORTER_B, 106)).status, 201, 'other reporter has independent quota');
    await pool.query("UPDATE artwork_reports SET created_at=now()-interval '25 hours' WHERE id=$1", [first]);
    assert.equal((await submit(REPORTER_A, 106)).status, 201);
  });
  await t.test('actual protected routes require SIWE, active role, live matching credential and unexpired step-up', async () => {
    const row = await visibleReport(first, 'pending_review');
    assert.equal((await call('/queue')).status, 401);
    assert.equal((await call('/queue', {wallet: REPORTER_A})).status, 403);
    assert.equal((await act(row, 'hide', {stepUp: false})).body.error, 'STEP_UP_REQUIRED');
    assert.equal((await act(row, 'hide', {auth: expiredStepUp(cookie(STAFF))})).body.error, 'STEP_UP_REQUIRED');
    await pool.query("INSERT INTO artsoul_staff_roles(wallet_address,role) VALUES($1,'moderator')", [REPORTER_B]);
    const foreignStepUp = cookie(STAFF, true).split('; ').find(part => part.startsWith('artsoul_mod_session='));
    assert.equal((await act(row, 'hide', {auth: `${cookie(REPORTER_B)}; ${foreignStepUp}`})).body.error, 'STEP_UP_WALLET_MISMATCH');
    await pool.query('DELETE FROM artsoul_staff_roles WHERE wallet_address=$1', [REPORTER_B]);
    const retained = cookie(STAFF, true);
    await pool.query('UPDATE artsoul_staff_roles SET active=false WHERE wallet_address=$1', [STAFF]);
    assert.equal((await act(row, 'hide', {auth: retained})).body.error, 'ADMIN_REQUIRED');
    assert.equal((await call('/access', {auth: retained})).body.eligible, false);
    await pool.query('UPDATE artsoul_staff_roles SET active=true WHERE wallet_address=$1', [STAFF]);
    await pool.query('UPDATE artsoul_staff_passkeys SET revoked_at=now()');
    assert.equal((await act(row, 'hide', {auth: retained})).body.error, 'CREDENTIAL_REVOKED');
    await pool.query('UPDATE artsoul_staff_passkeys SET revoked_at=NULL');
    assert.equal((await visibleReport(first, 'pending_review')).status, 'pending_review');
  });
  await t.test('concurrent HTTP decisions execute real SQL once and return one public 409 conflict', async () => {
    const result = await call('/queue', {wallet: STAFF, stepUp: true});
    concurrent = result.body.data.reports.find(row => String(row.artwork_id) === '102');
    const outcomes = await Promise.all([act(concurrent, 'hide'), act(concurrent, 'dismiss')]);
    assert.deepEqual(outcomes.map(r => r.status).sort(), [200, 409]);
    assert.equal(outcomes.find(r => r.status === 409).body.error, 'REPORT_REVIEW_CONFLICT');
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM artwork_report_events WHERE report_id=$1 AND event_type IN ('REPORT_HIDDEN','REPORT_DISMISSED')", [concurrent.id])).rows[0].n, 1);
  });
  await t.test('queue exposes durable notifications and restores only after the final independent actioned report', async () => {
    for (const id of [first, second]) assert.equal((await act(await visibleReport(id, 'pending_review'), 'hide')).status, 200);
    const one = await act(await visibleReport(first, 'actioned'), 'restore');
    assert.equal(one.status, 200); assert.equal(one.body.report.artwork_hidden, true);
    const last = await act(await visibleReport(second, 'actioned'), 'restore');
    assert.equal(last.status, 200); assert.equal(last.body.report.artwork_hidden, false);
    const q = await call('/queue?status=resolved', {wallet: STAFF, stepUp: true});
    assert.equal(q.status, 200); assert.ok(q.body.data.events.some(e => e.event_type === 'REPORT_RESTORED'));
    assert.equal(q.body.data.notifications.filter(n => n.notification_type === 'ARTWORK_RESTORED').length, 1);
    assert.equal(q.body.data.notifications.find(n => n.notification_type === 'ARTWORK_RESTORED').recipient_wallet, CREATOR);
    for (const reporter of [REPORTER_A, REPORTER_B]) assert.ok(q.body.data.notifications.some(n => n.recipient_wallet === reporter && n.notification_type === 'REPORT_RESOLVED'));
    assert.equal(captured.length, 0, 'moderation persists obligations; no email worker is invented');
  });
  await t.test('notification insert failure rolls back the decision and later retry commits one obligation set', async () => {
    const q = await call('/queue', {wallet: STAFF, stepUp: true});
    const row = q.body.data.reports.find(r => String(r.artwork_id) === '103');
    await pool.query(`CREATE FUNCTION local_fail_notification() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'local capture fault'; END $$;
      CREATE TRIGGER local_notification_fault BEFORE INSERT ON artwork_report_notifications FOR EACH ROW EXECUTE FUNCTION local_fail_notification();`);
    const failed = await act(row, 'hide'); assert.equal(failed.status, 500);
    assert.equal((await visibleReport(row.id, 'pending_review')).updated_at, row.updated_at);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM artwork_report_events WHERE report_id=$1 AND event_type <> 'REPORT_SUBMITTED'", [row.id])).rows[0].n, 0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM artwork_moderation_visibility WHERE artwork_id=103 AND hidden')).rows[0].n, 0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM artwork_report_notifications WHERE report_id=$1', [row.id])).rows[0].n, 0);
    await pool.query('DROP TRIGGER local_notification_fault ON artwork_report_notifications');
    assert.equal((await act(row, 'hide')).status, 200);
    assert.ok((await pool.query('SELECT count(*)::int AS n FROM artwork_report_notifications WHERE report_id=$1', [row.id])).rows[0].n > 0);
  });
  await t.test('recipient inbox exposes only the authenticated reporter or creator notifications, without staff access', async () => {
    assert.equal((await call('/notifications')).status, 401);
    for (const wallet of [REPORTER_A, REPORTER_B, CREATOR, STAFF]) {
      const result = await call(`/notifications?recipient_wallet=${CREATOR}&wallet=${CREATOR}`, {wallet});
      assert.equal(result.status, 200, JSON.stringify(result.body));
      const expected = (await pool.query(`SELECT n.id::text,r.chain_id::text,r.artwork_id::text FROM artwork_report_notifications n
        JOIN artwork_reports r ON r.id=n.report_id WHERE n.recipient_wallet=$1 ORDER BY n.id DESC LIMIT 20`, [wallet])).rows;
      assert.deepEqual(result.body.items.map(row => row.id), expected.map(row => row.id));
      assert.equal(result.body.wallet, wallet);
      for (const item of result.body.items) assert.deepEqual(Object.keys(item).sort(), ['artwork_id', 'chain_id', 'created_at', 'id', 'message', 'type']);
      assert.deepEqual(result.body.items.map(row => [row.id, row.chain_id, row.artwork_id]), expected.map(row => [row.id, row.chain_id, row.artwork_id]));
      if (wallet === REPORTER_A) assert.ok(new Set(result.body.items.map(row => row.artwork_id)).size > 1, 'different report subjects remain identifiable');
      assert.doesNotMatch(JSON.stringify(result.body), /report_id|recipient_wallet|decision_reason|reference_url|Local fixture review/);
      if (wallet === STAFF) assert.equal(result.body.items.length, 0, 'staff role grants no access to another recipient inbox');
      else assert.ok(result.body.items.length > 0);
    }
  });
  await t.test('inbox keyset paging handles tied timestamps and BIGINT ids without omissions or cross-recipient rows', async () => {
    await pool.query(`INSERT INTO artwork_report_notifications(id,report_id,recipient_wallet,notification_type,created_at)
      SELECT 9007199254741100::bigint+n,$1,$2,'REPORT_RESOLVED','2026-09-29T12:00:00Z' FROM generate_series(1,25) n`, [first, REPORTER_B]);
    const expected = (await pool.query('SELECT id::text FROM artwork_report_notifications WHERE recipient_wallet=$1 ORDER BY artwork_report_notifications.id DESC', [REPORTER_B])).rows.map(row => row.id);
    const seen = []; let cursor = null, pages = 0;
    do {
      const result = await call(`/notifications${cursor ? `?before=${cursor}` : ''}`, {wallet: REPORTER_B});
      assert.equal(result.status, 200); assert.ok(result.body.items.length <= 20);
      seen.push(...result.body.items.map(row => row.id)); cursor = result.body.nextCursor;
      assert.ok(++pages < 4);
    } while (cursor);
    assert.equal(pages, 2); assert.deepEqual(seen, expected);
  });
  await t.test('newsletter handler commits consent before local email capture and unsubscribe remains durable', async () => {
    const address = 'artist@example.test';
    const result = await call('/newsletter', {body: {email: address, consent: true}});
    assert.equal(result.status, 200); assert.equal(result.body.welcome_email, 'accepted');
    assert.equal(captured.length, 1); assert.match(captured[0].idempotencyKey, /^welcome-[a-f0-9]{64}$/);
    const token = captured[0].body.text.match(/unsubscribe=([a-f0-9]{64})/)[1];
    assert.equal((await pool.query('SELECT unsubscribe_hash FROM email_subscriptions WHERE email=$1', [address])).rows[0].unsubscribe_hash, digest(token));
    assert.equal((await call('/newsletter', {body: {email: address, consent: true}})).body.welcome_email, 'not_requested');
    assert.equal(captured.length, 1);
    assert.equal((await call('/newsletter', {body: {action: 'unsubscribe', token}})).status, 200);
    assert.equal((await pool.query('SELECT status FROM email_subscriptions WHERE email=$1', [address])).rows[0].status, 'unsubscribed');
    assert.equal((await call('/newsletter', {body: {email: address, consent: true}})).body.error, 'RESUBSCRIBE_REQUIRED');
    captureStatus = 503;
    const uncertain = await call('/newsletter', {body: {email: 'failure@example.test', consent: true}});
    assert.equal(uncertain.status, 200); assert.equal(uncertain.body.welcome_email, 'unconfirmed');
    assert.equal((await pool.query("SELECT status FROM email_subscriptions WHERE email='failure@example.test'")).rows[0].status, 'subscribed');
    assert.equal(captured.length, 2, 'two local HTTP captures, zero external email deliveries');
  });
  await t.test('disabled flags still fail closed with valid virtual credentials and retain the ledger', async () => {
    const pending = (await call('/queue', {wallet: STAFF, stepUp: true})).body.data.reports.find(row => String(row.artwork_id) === '104');
    assert.ok(pending, 'a valid pending decision exists before pausing review');
    const before = await ledger();
    process.env.ARTSOUL_PROTOCOL_ADMIN_ENABLED = 'false';
    assert.equal((await call('/queue', {wallet: STAFF, stepUp: true})).status, 503);
    const pausedReview = await act(pending, 'hide');
    assert.equal(pausedReview.status, 503);
    assert.equal(pausedReview.body.error, 'PROTOCOL_ADMIN_DISABLED');
    assert.deepEqual(await ledger(), before, 'paused review preserves reports, visibility, audit and notification contents');

    process.env.ARTSOUL_PROTOCOL_ADMIN_ENABLED = 'true';
    process.env.ARTSOUL_MODERATION_PASSKEY_ENABLED = 'false';
    const missingFactor = await act(pending, 'hide');
    assert.equal(missingFactor.status, 503);
    assert.equal(missingFactor.body.error, 'PROTOCOL_ADMIN_PASSKEY_REQUIRED');
    assert.deepEqual(await ledger(), before, 'disabling factor verification cannot apply an existing valid review request');

    process.env.ARTSOUL_MODERATION_PASSKEY_ENABLED = 'true';
    process.env.ARTSOUL_REPORTING_ENABLED = 'false';
    const pausedIntake = await submit(REPORTER_B, 112);
    assert.equal(pausedIntake.status, 503);
    assert.equal(pausedIntake.body.error, 'REPORTING_DISABLED');
    assert.equal((await visibleReport(pending.id, 'pending_review')).updated_at, pending.updated_at,
      'existing review work remains available when only intake is paused');
    const history = await call('/notifications', {wallet: REPORTER_A});
    assert.equal(history.status, 200); assert.ok(history.body.items.length > 0, 'pausing write workflows does not revoke recipient history');
    assert.deepEqual(await ledger(), before, 'flag changes and denied writes neither delete nor rewrite the ledger');
    process.env.ARTSOUL_REPORTING_ENABLED = 'true';
  });
  await t.test('failed staff alert delivery and due retries preserve committed decisions and recipient obligations', async () => {
    // Staff alerts originate from REPORT_SUBMITTED; decision notifications stay
    // in-app. Delay these alerts until after review to prove the worker cannot
    // undo an already committed decision, visibility, audit or recipient record.
    const pending = (await call('/queue', {wallet: STAFF, stepUp: true})).body.data.reports.find(row => String(row.artwork_id) === '105');
    assert.equal((await act(pending, 'hide')).status, 200);
    for (const [artwork, failure] of [[103, 'unavailable'], [105, 'lost-response']]) {
      const row = (await pool.query('SELECT id,status FROM artwork_reports WHERE artwork_id=$1', [artwork])).rows[0];
      assert.equal(row.status, 'actioned');
      assert.ok((await pool.query('SELECT count(*)::int AS n FROM artwork_report_notifications WHERE report_id=$1', [row.id])).rows[0].n > 0);
      const before = await ledger(), start = reportEmails.length;
      const inbox = await call('/notifications', {wallet: CREATOR});
      assert.equal(inbox.status, 200);
      reportEmailMode = failure;
      assert.deepEqual(await deliverReportEmail(row.id), {status: 'pending'});
      assert.equal(reportEmails.length, start + 1, 'failed HTTP attempt reached only the local capture sink');
      assert.deepEqual(await ledger(), before);
      const delivery = async () => (await pool.query(`SELECT state,attempt_count,attempt_token,lease_until,accepted_at,last_error_code,
        next_attempt_at>now() AS retry_delayed FROM moderation_report_email_delivery WHERE report_id=$1`, [row.id])).rows[0];
      assert.deepEqual(await delivery(), {state: 'pending', attempt_count: 1, attempt_token: null,
        lease_until: null, accepted_at: null, last_error_code: 'DELIVERY_UNCONFIRMED', retry_delayed: true});
      assert.deepEqual(await deliverReportEmail(row.id), {status: 'not_claimed'});
      assert.equal(reportEmails.length, start + 1, 'an immediate retry must not send');
      // Only this disposable database's delivery schedule is changed. Neither
      // process time nor a real report/worker is accelerated.
      await pool.query("UPDATE moderation_report_email_delivery SET next_attempt_at=now()-interval '1 second' WHERE report_id=$1", [row.id]);
      reportEmailMode = 'accepted';
      assert.deepEqual(await deliverReportEmail(row.id), {status: 'accepted'});
      assert.equal(reportEmails.length, start + 2);
      assert.deepEqual(reportEmails[start + 1], reportEmails[start], 'retry uses the identical payload and provider key');
      const accepted = await delivery();
      assert.equal(accepted.state, 'accepted'); assert.equal(accepted.attempt_count, 2);
      assert.ok(accepted.accepted_at); assert.equal(accepted.last_error_code, null);
      assert.deepEqual(await deliverReportEmail(row.id), {status: 'not_claimed'});
      assert.equal(reportEmails.length, start + 2, 'the durable receipt suppresses another send');
      assert.deepEqual(await ledger(), before, 'the complete moderation ledger survives failure and retry unchanged');
      assert.deepEqual(await call('/notifications', {wallet: CREATOR}), inbox, 'recipient-facing decision notifications remain available');
    }
  });
});
