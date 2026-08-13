// A8d atomic recovery tests against a real disposable PostgreSQL 17 database.
// This proves one-request/one-grant behavior and rollback if audit evidence
// cannot be written. The suite skips cleanly when Docker is unavailable.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { execFile, execFileSync, execSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const A8A = fs.readFileSync(path.join(root, 'sql', 'migrations', 'a8a_moderation_passkey_foundation.sql'), 'utf8');
const A8D = fs.readFileSync(path.join(root, 'sql', 'migrations', 'a8d_moderation_safe_recovery.sql'), 'utf8');
const CONTAINER = `artsoul-a8d-pg-${process.pid}`;
const IMAGE = 'postgres:17';
const STAFF = '0x1111111111111111111111111111111111111111';
const SAFE = '0x3333333333333333333333333333333333333333';

function wait(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function dockerAvailable() {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return execSync('docker version --format {{.Server.Os}}', { encoding: 'utf8' }).trim() === 'linux';
  } catch {
    return false;
  }
}

const HAVE_DOCKER = dockerAvailable();

function psql(sql, { expectError = false } = {}) {
  try {
    const out = execFileSync('docker', [
      'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'artsoul',
      '-v', 'ON_ERROR_STOP=1', '-tA', '-F', '|', '-c', sql
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (expectError) throw new Error(`Expected failure: ${sql}`);
    return out.trim();
  } catch (error) {
    if (expectError) return String(error.stderr || error.message);
    throw new Error(`psql failed: ${sql}\n${error.stderr || error.message}`);
  }
}

function psqlAsync(sql) {
  return new Promise((resolve, reject) => {
    execFile('docker', [
      'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'artsoul',
      '-v', 'ON_ERROR_STOP=1', '-tA', '-c', sql
    ], { encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message));
      else resolve(stdout.trim());
    });
  });
}

function applyMigration(sql) {
  execFileSync('docker', [
    'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'artsoul',
    '-v', 'ON_ERROR_STOP=1', '-f', '-'
  ], { input: sql, stdio: ['pipe', 'ignore', 'pipe'], encoding: 'utf8' });
}

function hh() {
  return crypto.randomBytes(32).toString('hex');
}

function seedRequest({
  requestId = crypto.randomUUID(),
  created = 'NOW()',
  expires = "NOW() + INTERVAL '5 minutes'"
} = {}) {
  const messageHash = `0x${hh()}`;
  psql(`INSERT INTO public.artsoul_staff_recovery_requests
    (request_id, target_wallet, safe_address, chain_id, rp_id, origin, message, message_hash, created_at, expires_at)
    VALUES ('${requestId}', '${STAFF}', '${SAFE}', 84532, 'artsoulprotocol.com',
      'https://artsoulprotocol.com', 'bounded recovery message', '${messageHash}', ${created}, ${expires});`);
  return { requestId, messageHash };
}

function completionSql(request, tokenHash = hh()) {
  return `SELECT public.a8d_complete_safe_recovery(
    '${request.requestId}', '${STAFF}', '${SAFE}', 84532, '${request.messageHash}',
    '${hh()}', '${tokenHash}', NOW() + INTERVAL '10 minutes');`;
}

test('A8d atomic recovery RPC integration (PostgreSQL 17)', { skip: HAVE_DOCKER ? false : 'Docker is not available' }, async (t) => {
  t.before(() => {
    try { execSync(`docker rm -f ${CONTAINER}`, { stdio: 'ignore' }); } catch { /* no prior container */ }
    execSync(`docker run -d --name ${CONTAINER} -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=artsoul ${IMAGE}`, { stdio: 'ignore' });
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        execFileSync('docker', ['exec', CONTAINER, 'psql', '-U', 'postgres', '-d', 'artsoul', '-c', 'SELECT 1;'], { stdio: 'ignore' });
        wait(300);
        ready = true;
        break;
      } catch { wait(500); }
    }
    if (!ready) throw new Error('PostgreSQL did not become ready in time');
    psql('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;');
    applyMigration(A8A);
    applyMigration(A8D);
  });

  t.after(() => {
    execSync(`docker rm -f ${CONTAINER}`, { stdio: 'ignore' });
  });

  t.beforeEach(() => {
    psql(`TRUNCATE public.artsoul_staff_recovery_requests, public.artsoul_staff_passkeys,
      public.artsoul_webauthn_challenges, public.artsoul_staff_enrollment_grants,
      public.artsoul_staff_auth_events RESTART IDENTITY;`);
  });

  await t.test('one valid completion consumes the request and creates only an additional grant', () => {
    const request = seedRequest();
    assert.equal(psql(completionSql(request)), 'OK');
    assert.equal(psql(`SELECT consumed_at IS NOT NULL FROM public.artsoul_staff_recovery_requests WHERE request_id = '${request.requestId}';`), 't');
    assert.equal(psql(`SELECT purpose || '|' || target_wallet || '|' || issued_by FROM public.artsoul_staff_enrollment_grants;`), `additional|${STAFF}|${SAFE}`);
    assert.equal(psql(`SELECT string_agg(event_type, ',' ORDER BY id) FROM public.artsoul_staff_auth_events;`), 'recovery_authorized,grant_issued');
  });

  await t.test('two concurrent completions produce one OK and exactly one grant', async () => {
    const request = seedRequest();
    const outcomes = await Promise.all([psqlAsync(completionSql(request)), psqlAsync(completionSql(request))]);
    assert.deepEqual(outcomes.sort(), ['OK', 'RECOVERY_REQUEST_INVALID']);
    assert.equal(psql('SELECT COUNT(*) FROM public.artsoul_staff_enrollment_grants;'), '1');
    assert.equal(psql(`SELECT COUNT(*) FROM public.artsoul_staff_auth_events WHERE event_type = 'recovery_authorized';`), '1');
  });

  await t.test('expired and mismatched requests fail without state mutation', () => {
    const expired = seedRequest({
      created: "NOW() - INTERVAL '10 minutes'",
      expires: "NOW() - INTERVAL '5 minutes'"
    });
    assert.equal(psql(completionSql(expired)), 'RECOVERY_REQUEST_INVALID');
    const current = seedRequest();
    const wrongHashSql = completionSql({ ...current, messageHash: `0x${hh()}` });
    assert.equal(psql(wrongHashSql), 'RECOVERY_REQUEST_INVALID');
    assert.equal(psql('SELECT COUNT(*) FROM public.artsoul_staff_enrollment_grants;'), '0');
    assert.equal(psql('SELECT COUNT(*) FROM public.artsoul_staff_recovery_requests WHERE consumed_at IS NOT NULL;'), '0');
  });

  await t.test('audit failure rolls back request consumption and grant creation', () => {
    const request = seedRequest();
    psql(`CREATE OR REPLACE FUNCTION public._a8d_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN IF NEW.event_type = 'recovery_authorized' THEN RAISE EXCEPTION 'forced recovery audit failure'; END IF; RETURN NEW; END; $f$;`);
    psql(`CREATE TRIGGER _a8d_fail_audit BEFORE INSERT ON public.artsoul_staff_auth_events
      FOR EACH ROW EXECUTE FUNCTION public._a8d_fail_audit();`);
    const error = psql(completionSql(request), { expectError: true });
    assert.match(error, /forced recovery audit failure/);
    psql('DROP TRIGGER _a8d_fail_audit ON public.artsoul_staff_auth_events;');
    assert.equal(psql(`SELECT consumed_at IS NULL FROM public.artsoul_staff_recovery_requests WHERE request_id = '${request.requestId}';`), 't');
    assert.equal(psql('SELECT COUNT(*) FROM public.artsoul_staff_enrollment_grants;'), '0');
  });

  await t.test('table and RPC remain service-role-only with forced RLS', () => {
    assert.equal(psql(`SELECT relrowsecurity || '|' || relforcerowsecurity FROM pg_class
      WHERE oid = 'public.artsoul_staff_recovery_requests'::regclass;`), 'true|true');
    assert.equal(psql(`SELECT has_table_privilege('anon', 'public.artsoul_staff_recovery_requests', 'SELECT');`), 'f');
    assert.equal(psql(`SELECT has_table_privilege('authenticated', 'public.artsoul_staff_recovery_requests', 'SELECT');`), 'f');
    assert.equal(psql(`SELECT has_function_privilege('anon',
      'public.a8d_complete_safe_recovery(uuid,text,text,bigint,text,text,text,timestamptz)', 'EXECUTE');`), 'f');
    assert.equal(psql(`SELECT has_function_privilege('service_role',
      'public.a8d_complete_safe_recovery(uuid,text,text,bigint,text,text,text,timestamptz)', 'EXECUTE');`), 't');
  });
});
