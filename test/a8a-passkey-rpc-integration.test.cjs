// A8a atomic-RPC integration tests against a REAL, disposable PostgreSQL 17
// database (Docker). In-memory mocks cannot prove transaction atomicity, so
// these exercise the actual SECURITY DEFINER functions from the migration:
// rollback on a failed audit insert, concurrent single-consume of one grant,
// bootstrap supersede / never-recreate, last-key protection, and the
// authentication counter rule. If Docker is unavailable the suite skips.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { execSync, execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const MIGRATION = fs.readFileSync(path.join(root, 'sql', 'migrations', 'a8a_moderation_passkey_foundation.sql'), 'utf8');
const CONTAINER = `artsoul-a8a-pg-${process.pid}`;
const IMAGE = 'postgres:17';

const STAFF = '0x1111111111111111111111111111111111111111';
const PK = Buffer.from([1, 2, 3, 4]).toString('base64url');

function dockerAvailable() {
  try {
    execSync('docker info', { stdio: 'ignore' });
    // The disposable postgres:17 image is a Linux container; skip cleanly on
    // a Docker engine running in Windows-container mode.
    const serverOs = execSync("docker version --format {{.Server.Os}}", { encoding: 'utf8' }).trim();
    return serverOs === 'linux';
  } catch {
    return false;
  }
}

const HAVE_DOCKER = dockerAvailable();

function psql(sql, { expectError = false } = {}) {
  try {
    const out = execFileSync(
      'docker',
      ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'artsoul', '-v', 'ON_ERROR_STOP=1', '-tA', '-F', '|', '-c', sql],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    if (expectError) throw new Error(`Expected an error but statement succeeded:\n${sql}`);
    return out.trim();
  } catch (error) {
    if (expectError) return String(error.stderr || error.message);
    throw new Error(`psql failed: ${sql}\n${error.stderr || error.message}`);
  }
}

function esc(value) {
  return String(value).replace(/'/g, "''");
}

test('A8a atomic RPC integration (PostgreSQL 17)', { skip: HAVE_DOCKER ? false : 'Docker is not available' }, async (t) => {
  t.before(() => {
    execSync(`docker rm -f ${CONTAINER}`, { stdio: 'ignore' });
    execSync(
      `docker run -d --name ${CONTAINER} -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=artsoul ${IMAGE}`,
      { stdio: 'ignore' }
    );
    // Wait for readiness.
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try {
        execSync(`docker exec ${CONTAINER} pg_isready -U postgres -d artsoul`, { stdio: 'ignore' });
        ready = true;
        break;
      } catch {
        execSync(process.platform === 'win32' ? 'ping -n 2 127.0.0.1 > NUL' : 'sleep 1', { stdio: 'ignore' });
      }
    }
    if (!ready) throw new Error('PostgreSQL did not become ready in time');

    // Supabase-style roles the migration grants to must exist first.
    psql("CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;");
    // Apply the real migration verbatim.
    execFileSync(
      'docker',
      ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'artsoul', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
      { input: MIGRATION, stdio: ['pipe', 'ignore', 'pipe'], encoding: 'utf8' }
    );
  });

  t.after(() => {
    execSync(`docker rm -f ${CONTAINER}`, { stdio: 'ignore' });
  });

  t.beforeEach(() => {
    psql(`TRUNCATE public.artsoul_staff_passkeys, public.artsoul_webauthn_challenges,
           public.artsoul_staff_enrollment_grants, public.artsoul_staff_auth_events RESTART IDENTITY;`);
  });

  // 64-hex token hash (matches the app's SHA-256 hex format and clears the
  // RPC's minimum-length gate).
  function hh() {
    return crypto.randomBytes(32).toString('hex');
  }

  // Helper: seed a grant row directly and a bound registration challenge.
  function seedGrant({ purpose = 'additional', tokenHash = hh(), consumed = false, expiresMin = 10 } = {}) {
    const out = psql(`INSERT INTO public.artsoul_staff_enrollment_grants
      (target_wallet, purpose, token_hash, issued_by, expires_at${consumed ? ', consumed_at' : ''})
      VALUES ('${STAFF}', '${purpose}', '${esc(tokenHash)}', '${STAFF}', NOW() + INTERVAL '${expiresMin} minutes'${consumed ? ', NOW()' : ''})
      RETURNING id;`);
    // psql appends the "INSERT 0 1" command tag after the RETURNING value;
    // take the first purely-numeric line.
    const id = Number(out.split('\n').map(l => l.trim()).find(l => /^\d+$/.test(l)));
    return { id, tokenHash };
  }

  function seedChallenge(challenge, grantId, { expiresMin = 10 } = {}) {
    psql(`INSERT INTO public.artsoul_webauthn_challenges (challenge, wallet_address, purpose, grant_id, expires_at)
           VALUES ('${esc(challenge)}', '${STAFF}', 'registration', ${grantId}, NOW() + INTERVAL '${expiresMin} minutes');`);
  }

  function completeRegistration(grantId, tokenHash, challenge, credId, purpose = 'additional') {
    return psql(`SELECT public.a8a_complete_registration(${grantId}, '${esc(tokenHash)}', '${STAFF}', '${purpose}',
      '${esc(challenge)}', '${credId}', '${PK}', 0, '[]', 'aaguid', 'label');`);
  }

  await t.test('a failed audit insert rolls back the credential and grant consumption', () => {
    const grant = seedGrant();
    seedChallenge('chal-rollback', grant.id);
    // Force the SECOND audit insert (passkey_enrolled) to fail mid-transaction.
    psql(`CREATE OR REPLACE FUNCTION public._a8a_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $f$
          BEGIN IF NEW.event_type = 'passkey_enrolled' THEN RAISE EXCEPTION 'forced audit failure'; END IF; RETURN NEW; END; $f$;`);
    psql(`CREATE TRIGGER _a8a_fail_audit BEFORE INSERT ON public.artsoul_staff_auth_events
          FOR EACH ROW EXECUTE FUNCTION public._a8a_fail_audit();`);

    // The forced trigger raises mid-transaction; the whole RPC must roll back.
    try {
      completeRegistration(grant.id, grant.tokenHash, 'chal-rollback', 'cred-rollback');
      assert.fail('registration should have raised from the forced audit failure');
    } catch (error) {
      assert.match(String(error.message), /forced audit failure/);
    }

    psql('DROP TRIGGER _a8a_fail_audit ON public.artsoul_staff_auth_events;');

    // Nothing must have persisted: no credential, grant unconsumed, challenge unconsumed.
    assert.equal(psql(`SELECT COUNT(*) FROM public.artsoul_staff_passkeys;`), '0');
    assert.equal(psql(`SELECT consumed_at IS NULL FROM public.artsoul_staff_enrollment_grants WHERE id = ${grant.id};`), 't');
    assert.equal(psql(`SELECT consumed_at IS NULL FROM public.artsoul_webauthn_challenges WHERE challenge = 'chal-rollback';`), 't');
  });

  await t.test('concurrent registration consumes one grant exactly once (one credential)', () => {
    const grant = seedGrant();
    seedChallenge('chal-a', grant.id);
    seedChallenge('chal-b', grant.id);
    // Two parallel psql processes racing on the same grant. The FOR UPDATE
    // lock serializes them; the loser sees the consumed grant.
    const cmd = (challenge, cred) =>
      `docker exec -i ${CONTAINER} psql -U postgres -d artsoul -tA -c ` +
      `"SELECT public.a8a_complete_registration(${grant.id}, '${grant.tokenHash}', '${STAFF}', 'additional', '${challenge}', '${cred}', '${PK}', 0, '[]', 'a', 'l');"`;
    // Launch both without waiting individually, then join.
    const runner = process.platform === 'win32'
      ? `${cmd('chal-a', 'cc-a')} & ${cmd('chal-b', 'cc-b')} & wait`
      : `( ${cmd('chal-a', 'cc-a')} & ${cmd('chal-b', 'cc-b')} & wait )`;
    try {
      execSync(runner, { stdio: 'ignore', shell: process.platform === 'win32' ? undefined : '/bin/bash' });
    } catch {
      // One of the two may legitimately return a non-OK code path; ignore.
    }
    assert.equal(psql(`SELECT COUNT(*) FROM public.artsoul_staff_passkeys;`), '1');
    assert.equal(psql(`SELECT COUNT(*) FROM public.artsoul_staff_enrollment_grants WHERE consumed_at IS NOT NULL;`), '1');
  });

  await t.test('registration retry with a consumed grant returns GRANT_INVALID and adds no credential', () => {
    const grant = seedGrant();
    seedChallenge('chal-1', grant.id);
    assert.equal(completeRegistration(grant.id, grant.tokenHash, 'chal-1', 'cred-1'), 'OK');
    seedChallenge('chal-2', grant.id);
    assert.equal(completeRegistration(grant.id, grant.tokenHash, 'chal-2', 'cred-2'), 'GRANT_INVALID');
    assert.equal(psql(`SELECT COUNT(*) FROM public.artsoul_staff_passkeys;`), '1');
  });

  await t.test('a challenge bound to a different grant is rejected (CHALLENGE_INVALID)', () => {
    const grantA = seedGrant();
    const grantB = seedGrant({ tokenHash: 'hash-b' });
    seedChallenge('chal-forB', grantB.id);
    assert.equal(completeRegistration(grantA.id, grantA.tokenHash, 'chal-forB', 'cred-x'), 'CHALLENGE_INVALID');
    assert.equal(psql(`SELECT COUNT(*) FROM public.artsoul_staff_passkeys;`), '0');
  });

  await t.test('an expired unused bootstrap grant is safely superseded by a fresh one', () => {
    // Seed an expired unused bootstrap grant (negative TTL).
    const { id } = seedGrant({ purpose: 'bootstrap', expiresMin: -1 });
    const newId = Number(psql(`SELECT public.a8a_issue_enrollment_grant('${STAFF}', 'bootstrap', '${STAFF}', '${hh()}', NOW() + INTERVAL '10 minutes');`));
    assert.notEqual(newId, id);
    assert.equal(psql(`SELECT revoked_at IS NOT NULL FROM public.artsoul_staff_enrollment_grants WHERE id = ${id};`), 't');
    assert.equal(psql(`SELECT superseded_by FROM public.artsoul_staff_enrollment_grants WHERE id = ${id};`), String(newId));
    assert.equal(psql(`SELECT COUNT(*) FROM public.artsoul_staff_auth_events WHERE event_type = 'grant_superseded';`), '1');
  });

  await t.test('an active unexpired bootstrap grant blocks a duplicate issue', () => {
    psql(`SELECT public.a8a_issue_enrollment_grant('${STAFF}', 'bootstrap', '${STAFF}', '${hh()}', NOW() + INTERVAL '10 minutes');`);
    const err = psql(`SELECT public.a8a_issue_enrollment_grant('${STAFF}', 'bootstrap', '${STAFF}', '${hh()}', NOW() + INTERVAL '10 minutes');`, { expectError: true });
    assert.match(err, /A8A_ACTIVE_BOOTSTRAP_EXISTS/);
  });

  await t.test('a consumed bootstrap can never be recreated', () => {
    const grant = seedGrant({ purpose: 'bootstrap', tokenHash: 'boot-hash' });
    seedChallenge('boot-chal', grant.id);
    assert.equal(completeRegistration(grant.id, grant.tokenHash, 'boot-chal', 'boot-cred', 'bootstrap'), 'OK');
    const err = psql(`SELECT public.a8a_issue_enrollment_grant('${STAFF}', 'bootstrap', '${STAFF}', '${hh()}', NOW() + INTERVAL '10 minutes');`, { expectError: true });
    assert.match(err, /A8A_BOOTSTRAP_ALREADY_ESTABLISHED/);
  });

  await t.test('the last active credential cannot be revoked; two-key wallet can revoke one', () => {
    psql(`INSERT INTO public.artsoul_staff_passkeys (wallet_address, credential_id, public_key, enrolled_via)
          VALUES ('${STAFF}', 'only', '${PK}', 'bootstrap');`);
    assert.equal(psql(`SELECT public.a8a_revoke_credential('${STAFF}', 'only', '${STAFF}');`), 'LAST_ACTIVE_CREDENTIAL');
    assert.equal(psql(`SELECT revoked_at IS NULL FROM public.artsoul_staff_passkeys WHERE credential_id = 'only';`), 't');
    assert.equal(psql(`SELECT COUNT(*) FROM public.artsoul_staff_auth_events WHERE event_type = 'passkey_revoke_denied';`), '1');

    psql(`INSERT INTO public.artsoul_staff_passkeys (wallet_address, credential_id, public_key, enrolled_via)
          VALUES ('${STAFF}', 'second', '${PK}', 'additional');`);
    assert.equal(psql(`SELECT public.a8a_revoke_credential('${STAFF}', 'only', '${STAFF}');`), 'OK');
    assert.equal(psql(`SELECT revoked_at IS NOT NULL FROM public.artsoul_staff_passkeys WHERE credential_id = 'only';`), 't');
  });

  await t.test('authentication rejects a stale counter and supports a zero-counter authenticator', () => {
    psql(`INSERT INTO public.artsoul_staff_passkeys (wallet_address, credential_id, public_key, sign_count, enrolled_via)
          VALUES ('${STAFF}', 'auth-cred', '${PK}', 9, 'bootstrap');`);
    assert.equal(psql(`SELECT public.a8a_complete_authentication('${STAFF}', 'auth-cred', 5);`), 'STALE_COUNTER');
    assert.equal(psql(`SELECT sign_count FROM public.artsoul_staff_passkeys WHERE credential_id = 'auth-cred';`), '9');
    assert.equal(psql(`SELECT public.a8a_complete_authentication('${STAFF}', 'auth-cred', 12);`), 'OK');
    assert.equal(psql(`SELECT sign_count FROM public.artsoul_staff_passkeys WHERE credential_id = 'auth-cred';`), '12');

    psql(`INSERT INTO public.artsoul_staff_passkeys (wallet_address, credential_id, public_key, sign_count, enrolled_via)
          VALUES ('${STAFF}', 'zero-cred', '${PK}', 0, 'additional');`);
    assert.equal(psql(`SELECT public.a8a_complete_authentication('${STAFF}', 'zero-cred', 0);`), 'OK');
  });

  await t.test('RLS is forced and anon/authenticated hold no table or execute privileges', () => {
    const forced = psql(`SELECT bool_and(relforcerowsecurity) FROM pg_class
      WHERE relnamespace = 'public'::regnamespace
      AND relname IN ('artsoul_staff_passkeys','artsoul_webauthn_challenges','artsoul_staff_enrollment_grants','artsoul_staff_auth_events');`);
    assert.equal(forced, 't');

    const tableGrants = psql(`SELECT COUNT(*) FROM information_schema.role_table_grants
      WHERE table_schema='public' AND grantee IN ('anon','authenticated')
      AND table_name LIKE 'artsoul_%';`);
    assert.equal(tableGrants, '0');

    const execGrants = psql(`SELECT COUNT(*) FROM information_schema.routine_privileges
      WHERE routine_schema='public' AND grantee IN ('anon','authenticated')
      AND routine_name LIKE 'a8a_%';`);
    assert.equal(execGrants, '0');
  });
});
