// A8a migration invariants (static): additive service-role-only tables, one
// token-hash-only grant model, safe-retry bootstrap semantics, the atomic
// RPC contract, and the founder runbook staying outside any public code path.
// Transactional/atomicity behavior of the RPCs is proven against a real
// PostgreSQL 17 database in test/a8a-passkey-rpc-integration.test.cjs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
// Normalize CRLF to LF so structural assertions (indexOf with '\n', slices)
// are line-ending independent across a Windows CI checkout and Ubuntu/local.
const readSql = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8').replace(/\r\n/g, '\n');
const migration = readSql('sql', 'migrations', 'a8a_moderation_passkey_foundation.sql');
const verification = readSql('sql', 'verification', 'a8a_passkey_foundation_verification.sql');
const bootstrap = readSql('sql', 'runbooks', 'a8a_bootstrap_enrollment_grant.sql');

const TABLES = [
  'artsoul_staff_passkeys',
  'artsoul_webauthn_challenges',
  'artsoul_staff_enrollment_grants',
  'artsoul_staff_auth_events'
];

const RPCS = [
  'a8a_issue_enrollment_grant',
  'a8a_complete_registration',
  'a8a_revoke_credential',
  'a8a_complete_authentication'
];

test('the migration creates all four tables additively and edits no historical table', () => {
  for (const table of TABLES) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
  }
  assert.doesNotMatch(migration, /DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE|DELETE\s+FROM/i);
  assert.doesNotMatch(migration, /ALTER TABLE public\.(?!artsoul_staff_passkeys|artsoul_webauthn_challenges|artsoul_staff_enrollment_grants|artsoul_staff_auth_events)/);
});

test('RLS is enabled AND forced with service-role-only grants on every table', () => {
  for (const table of TABLES) {
    assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`));
    assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} FORCE ROW LEVEL SECURITY;`));
    assert.match(migration, new RegExp(`REVOKE ALL ON public\\.${table} FROM PUBLIC, anon, authenticated;`));
    assert.match(migration, new RegExp(`GRANT ALL ON public\\.${table} TO service_role;`));
  }
  assert.doesNotMatch(migration, /GRANT[^;]+TO\s+(anon|authenticated)/i);
});

test('credential storage keeps only public material with the required invariants', () => {
  assert.match(migration, /credential_id TEXT NOT NULL UNIQUE/);
  assert.match(migration, /public_key TEXT NOT NULL/);
  assert.match(migration, /sign_count BIGINT NOT NULL DEFAULT 0/);
  assert.match(migration, /last_used_at TIMESTAMPTZ/);
  assert.match(migration, /revoked_at TIMESTAMPTZ/);
  assert.match(migration, /wallet_address = LOWER\(wallet_address\)/);
  assert.doesNotMatch(migration, /private_key|secret_key|seed/i);
});

test('enrollment grants store only a token hash — never a raw token', () => {
  assert.match(migration, /token_hash TEXT NOT NULL/);
  const grantBlock = migration.slice(
    migration.indexOf('CREATE TABLE IF NOT EXISTS public.artsoul_staff_enrollment_grants'),
    migration.indexOf('idx_artsoul_enrollment_grants_active_bootstrap')
  );
  // No plaintext token column.
  assert.doesNotMatch(grantBlock, /\btoken\b(?!_hash)/);
  assert.match(grantBlock, /revoked_at TIMESTAMPTZ/);
  assert.match(grantBlock, /superseded_by BIGINT/);
});

test('challenges bind to a grant id and are one-time with purpose and expiry', () => {
  assert.match(migration, /purpose TEXT NOT NULL CHECK \(purpose IN \('registration', 'authentication'\)\)/);
  const challengeBlock = migration.slice(
    migration.indexOf('artsoul_webauthn_challenges (\n'),
    migration.indexOf('idx_artsoul_webauthn_challenges_expiry')
  );
  assert.match(challengeBlock, /grant_id BIGINT/);
  assert.match(challengeBlock, /expires_at TIMESTAMPTZ NOT NULL/);
  assert.match(challengeBlock, /consumed_at TIMESTAMPTZ/);
});

test('the bootstrap index allows superseding an expired unused grant (active-only partial)', () => {
  // The unique index is scoped to unconsumed AND unrevoked so an expired
  // unused bootstrap can be revoked/superseded and replaced.
  assert.match(
    migration,
    /CREATE UNIQUE INDEX IF NOT EXISTS idx_artsoul_enrollment_grants_active_bootstrap\s+ON public\.artsoul_staff_enrollment_grants \(purpose\)\s+WHERE purpose = 'bootstrap' AND consumed_at IS NULL AND revoked_at IS NULL;/
  );
  // The old "any bootstrap row is unique" index must be gone.
  assert.doesNotMatch(migration, /idx_artsoul_enrollment_grants_single_bootstrap/);
});

test('audit events cover the required lifecycle and store no IP or user agent', () => {
  for (const eventType of [
    'passkey_enrolled', 'passkey_auth_success', 'passkey_auth_failure',
    'passkey_revoked', 'passkey_revoke_denied', 'grant_issued',
    'grant_consumed', 'grant_superseded', 'recovery_denied'
  ]) {
    assert.match(migration, new RegExp(`'${eventType}'`));
  }
  const auditBlock = migration.slice(migration.indexOf('artsoul_staff_auth_events (\n'));
  assert.doesNotMatch(auditBlock, /ip_address|user_agent/i);
});

test('the four atomic RPCs are SECURITY DEFINER with a fixed search_path and service-role-only execute', () => {
  for (const fn of RPCS) {
    const fnStart = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
    assert.notEqual(fnStart, -1, `${fn} must exist`);
    const fnBody = migration.slice(fnStart, migration.indexOf('$$;', fnStart));
    assert.match(fnBody, /SECURITY DEFINER/, `${fn} must be SECURITY DEFINER`);
    assert.match(fnBody, /SET search_path = public/, `${fn} must pin search_path`);
    assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`));
    assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role;`));
  }
});

test('the registration RPC consumes the grant and challenge and writes both audit events atomically', () => {
  const fn = migration.slice(
    migration.indexOf('CREATE OR REPLACE FUNCTION public.a8a_complete_registration('),
    migration.indexOf('CREATE OR REPLACE FUNCTION public.a8a_revoke_credential(')
  );
  // Validation gates.
  assert.match(fn, /token_hash <> p_token_hash/);
  assert.match(fn, /grant_id IS DISTINCT FROM p_grant_id/);
  assert.match(fn, /RETURN 'GRANT_INVALID'/);
  assert.match(fn, /RETURN 'CHALLENGE_INVALID'/);
  // Consumption + credential insert + both audit events.
  assert.match(fn, /UPDATE public\.artsoul_webauthn_challenges\s+SET consumed_at/);
  assert.match(fn, /UPDATE public\.artsoul_staff_enrollment_grants\s+SET consumed_at/);
  assert.match(fn, /INSERT INTO public\.artsoul_staff_passkeys/);
  assert.match(fn, /'grant_consumed'/);
  assert.match(fn, /'passkey_enrolled'/);
});

test('the revoke RPC enforces last-key protection; the auth RPC enforces the counter rule', () => {
  const revoke = migration.slice(
    migration.indexOf('CREATE OR REPLACE FUNCTION public.a8a_revoke_credential('),
    migration.indexOf('CREATE OR REPLACE FUNCTION public.a8a_complete_authentication(')
  );
  assert.match(revoke, /v_active_count <= 1/);
  assert.match(revoke, /RETURN 'LAST_ACTIVE_CREDENTIAL'/);
  assert.match(revoke, /'passkey_revoke_denied'/);

  const auth = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.a8a_complete_authentication('));
  assert.match(auth, /p_new_counter > v_stored OR \(p_new_counter = 0 AND v_stored = 0\)/);
  assert.match(auth, /RETURN 'STALE_COUNTER'/);
});

test('the issue RPC blocks a second bootstrap once one is consumed or a bootstrap credential exists', () => {
  const fn = migration.slice(
    migration.indexOf('CREATE OR REPLACE FUNCTION public.a8a_issue_enrollment_grant('),
    migration.indexOf('CREATE OR REPLACE FUNCTION public.a8a_complete_registration(')
  );
  assert.match(fn, /A8A_BOOTSTRAP_ALREADY_ESTABLISHED/);
  assert.match(fn, /A8A_ACTIVE_BOOTSTRAP_EXISTS/);
  assert.match(fn, /'grant_superseded'/);
});

test('the verification script is strictly read-only', () => {
  assert.doesNotMatch(verification, /^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE)\b/im);
  assert.match(verification, /^SELECT /m);
  assert.match(verification, /relforcerowsecurity/);
  assert.match(verification, /prosecdef/);
});

test('the bootstrap runbook issues via the atomic RPC, shows the raw token once, stores only a hash', () => {
  assert.match(bootstrap, /BEGIN;/);
  assert.match(bootstrap, /COMMIT;/);
  assert.match(bootstrap, /a8a_issue_enrollment_grant\(/);
  assert.match(bootstrap, /gen_random_bytes\(32\)/);
  assert.match(bootstrap, /encode\(sha256\(convert_to\(token\.raw, 'UTF8'\)\), 'hex'\)/);
  assert.match(bootstrap, /one_time_enrollment_token/);
  // No hardcoded wallet address in repository SQL.
  assert.doesNotMatch(bootstrap, /0x[0-9a-fA-F]{40}/);
});

test('no moderation route creates a bootstrap grant', () => {
  const routesDir = path.join(root, 'src', 'api', 'routes', 'moderation');
  for (const file of fs.readdirSync(routesDir)) {
    const source = fs.readFileSync(path.join(routesDir, file), 'utf8');
    assert.doesNotMatch(source, /'bootstrap'/, `${file} must not reference bootstrap issuance`);
  }
});
