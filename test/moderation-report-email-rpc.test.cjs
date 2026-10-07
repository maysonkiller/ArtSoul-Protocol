const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const test = require('node:test');
const run = promisify(execFile);
const container = `artsoul-report-email-pg-${process.pid}`;
const migration = fs.readFileSync(path.join(__dirname, '../sql/migrations/moderation_report_email_delivery.sql'), 'utf8');
const H = 'a'.repeat(64), OTHER = 'b'.repeat(64);
const id = n => `10000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const args = sql => ['exec', container, 'psql', '-U', 'postgres', '-d', 'artsoul', '-v', 'ON_ERROR_STOP=1', '-tA', '-c', sql];
const sql = query => execFileSync('docker', args(query), {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
let available = false;
try { available = execFileSync('docker', ['version', '--format', '{{.Server.Os}}'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim() === 'linux'; } catch {}

test('report email claims and receipts use real PostgreSQL transactions', {skip: available ? false : 'Docker unavailable'}, async t => {
  execFileSync('docker', ['run', '-d', '--name', container, '-e', 'POSTGRES_PASSWORD=postgres', '-e', 'POSTGRES_DB=artsoul', 'postgres:17'], {stdio: 'ignore'});
  t.after(() => execFileSync('docker', ['rm', '-f', container], {stdio: 'ignore'}));
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { sql('SELECT 1'); await new Promise(resolve => setTimeout(resolve, 500)); sql('SELECT 1'); ready = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  assert(ready, 'disposable database ready');
  sql(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE artwork_reports(id UUID PRIMARY KEY);
    CREATE TABLE artwork_report_events(report_id UUID REFERENCES artwork_reports(id),event_type TEXT,created_at TIMESTAMPTZ DEFAULT NOW());`);
  execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'artsoul', '-v', 'ON_ERROR_STOP=1', '-f', '-'], {input: migration, stdio: ['pipe', 'ignore', 'pipe']});
  const seed = n => sql(`INSERT INTO artwork_reports VALUES('${id(n)}'); INSERT INTO artwork_report_events(report_id,event_type) VALUES('${id(n)}','REPORT_SUBMITTED');`);
  const claim = (n, hash = H) => `SELECT attempt_token FROM claim_moderation_report_email('${id(n)}','${hash}');`;
  const finish = (n, token, accepted) => sql(`SELECT finish_moderation_report_email('${id(n)}','${token}',${accepted},${accepted ? 'NULL' : "'DELIVERY_UNCONFIRMED'"});`);

  await t.test('unrecorded report has no delivery row', () => {
    assert.throws(() => sql(claim(1)), /REPORT_NOT_RECORDED/);
    assert.equal(sql('SELECT count(*) FROM moderation_report_email_delivery'), '0');
  });
  await t.test('two concurrent workers acquire only one lease; accepted result never replays', async () => {
    seed(1);
    const claims = (await Promise.all([run('docker', args(claim(1))), run('docker', args(claim(1)))])).map(result => result.stdout.trim());
    assert.equal(claims.filter(Boolean).length, 1);
    assert.equal(sql(`SELECT attempt_count FROM moderation_report_email_delivery WHERE report_id='${id(1)}'`), '1');
    assert.equal(finish(1, claims.find(Boolean), true), 't');
    assert.equal(sql(claim(1)), '');
    assert.equal(sql(`SELECT state FROM moderation_report_email_delivery WHERE report_id='${id(1)}'`), 'accepted');
  });
  await t.test('uncertain delivery retries only when due; stale attempt cannot overwrite new receipt', () => {
    seed(2); const first = sql(claim(2));
    assert.equal(finish(2, first, false), 't');
    assert.equal(sql(claim(2)), '');
    sql(`UPDATE moderation_report_email_delivery SET next_attempt_at=NOW()-INTERVAL '1 second' WHERE report_id='${id(2)}'`);
    const second = sql(claim(2)); assert(second); assert.notEqual(second, first);
    assert.equal(finish(2, first, true), 'f');
    assert.equal(finish(2, second, true), 't');
  });
  await t.test('changed recipient or content requires review instead of another send', () => {
    seed(3); const token = sql(claim(3)); finish(3, token, false);
    sql(`UPDATE moderation_report_email_delivery SET next_attempt_at=NOW()-INTERVAL '1 second' WHERE report_id='${id(3)}'`);
    assert.equal(sql(claim(3, OTHER)), '');
    assert.equal(sql(`SELECT state||':'||last_error_code FROM moderation_report_email_delivery WHERE report_id='${id(3)}'`), 'needs_review:CONFIG_CHANGED');
  });
  await t.test('uncertain attempt cannot be resent beyond provider idempotency retention', () => {
    seed(4); sql(claim(4));
    sql(`UPDATE moderation_report_email_delivery SET first_attempt_at=NOW()-INTERVAL '23 hours',lease_until=NOW()-INTERVAL '1 second' WHERE report_id='${id(4)}'`);
    assert.equal(sql(claim(4)), '');
    assert.equal(sql(`SELECT state||':'||last_error_code FROM moderation_report_email_delivery WHERE report_id='${id(4)}'`), 'needs_review:RETRY_WINDOW_EXPIRED');
  });
  await t.test('bounded pending read excludes completed and review-only records', () => {
    for (let n = 5; n <= 9; n++) seed(n);
    const rows = sql('SELECT report_id FROM pending_moderation_report_emails()').split('\n');
    assert.equal(rows.length, 3);
    assert.deepEqual(rows, [id(5), id(6), id(7)]);
  });
  await t.test('RLS and execute privileges isolate state from public and authenticated clients', () => {
    assert.equal(sql("SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='moderation_report_email_delivery'::regclass"), 't');
    for (const role of ['anon', 'authenticated']) {
      assert.equal(sql(`SELECT has_table_privilege('${role}','moderation_report_email_delivery','SELECT')`), 'f');
      assert.equal(sql(`SELECT has_function_privilege('${role}','claim_moderation_report_email(uuid,text)','EXECUTE')`), 'f');
      assert.equal(sql(`SELECT has_function_privilege('${role}','finish_moderation_report_email(uuid,uuid,boolean,text)','EXECUTE')`), 'f');
      assert.equal(sql(`SELECT has_function_privilege('${role}','pending_moderation_report_emails()','EXECUTE')`), 'f');
    }
    assert.equal(sql("SELECT has_function_privilege('service_role','claim_moderation_report_email(uuid,text)','EXECUTE')"), 't');
  });
});
