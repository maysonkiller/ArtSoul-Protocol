// A8a migration invariants: additive service-role-only tables for the
// moderation passkey foundation, one-time bootstrap semantics, and the
// founder-operated runbook staying outside any public code path.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'sql', 'migrations', 'a8a_moderation_passkey_foundation.sql'), 'utf8');
const verification = fs.readFileSync(path.join(root, 'sql', 'verification', 'a8a_passkey_foundation_verification.sql'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'sql', 'runbooks', 'a8a_bootstrap_enrollment_grant.sql'), 'utf8');

const TABLES = [
  'artsoul_staff_passkeys',
  'artsoul_webauthn_challenges',
  'artsoul_staff_enrollment_grants',
  'artsoul_staff_auth_events'
];

test('the migration creates all four tables additively', () => {
  for (const table of TABLES) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
  }
  // Additive only: no destructive statement against any table.
  assert.doesNotMatch(migration, /DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE|DELETE\s+FROM/i);
  // Existing production tables are not altered.
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
  // Wallet normalization is enforced in the schema, not just the app.
  assert.match(migration, /wallet_address = LOWER\(wallet_address\)/);
  // No private-key-shaped columns exist.
  assert.doesNotMatch(migration, /private_key|secret_key|seed/i);
});

test('challenges and grants are one-time with purpose and expiry', () => {
  assert.match(migration, /purpose TEXT NOT NULL CHECK \(purpose IN \('registration', 'authentication'\)\)/);
  assert.match(migration, /purpose TEXT NOT NULL CHECK \(purpose IN \('bootstrap', 'additional'\)\)/);
  const challengeBlock = migration.slice(
    migration.indexOf('artsoul_webauthn_challenges'),
    migration.indexOf('artsoul_staff_enrollment_grants')
  );
  assert.match(challengeBlock, /expires_at TIMESTAMPTZ NOT NULL/);
  assert.match(challengeBlock, /consumed_at TIMESTAMPTZ/);
  const grantBlock = migration.slice(
    migration.indexOf('CREATE TABLE IF NOT EXISTS public.artsoul_staff_enrollment_grants'),
    migration.indexOf('artsoul_staff_auth_events')
  );
  assert.match(grantBlock, /expires_at TIMESTAMPTZ NOT NULL/);
  assert.match(grantBlock, /consumed_at TIMESTAMPTZ/);
});

test('at most one bootstrap grant can ever exist (partial unique index)', () => {
  assert.match(
    migration,
    /CREATE UNIQUE INDEX IF NOT EXISTS idx_artsoul_enrollment_grants_single_bootstrap\s+ON public\.artsoul_staff_enrollment_grants \(purpose\)\s+WHERE purpose = 'bootstrap';/
  );
});

test('audit events cover the required lifecycle and store no IP or user agent', () => {
  for (const eventType of [
    'passkey_enrolled',
    'passkey_auth_success',
    'passkey_auth_failure',
    'passkey_revoked',
    'grant_issued',
    'grant_consumed',
    'recovery_denied'
  ]) {
    assert.match(migration, new RegExp(`'${eventType}'`));
  }
  const auditBlock = migration.slice(migration.indexOf('artsoul_staff_auth_events'));
  assert.doesNotMatch(auditBlock, /ip_address|user_agent/i);
});

test('the verification script is strictly read-only', () => {
  // Only statement-leading keywords count; words inside comments or
  // catalog identifiers (role_table_grants, "created") are not statements.
  assert.doesNotMatch(verification, /^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE)\b/im);
  assert.match(verification, /^SELECT /m);
  assert.match(verification, /relforcerowsecurity/);
  assert.match(verification, /grantee IN \('anon', 'authenticated'\)/);
});

test('the bootstrap runbook is one transaction and relies on the single-bootstrap index', () => {
  assert.match(bootstrap, /BEGIN;/);
  assert.match(bootstrap, /COMMIT;/);
  // Grant and audit record are created together inside the transaction.
  const begin = bootstrap.indexOf('BEGIN;');
  const commit = bootstrap.indexOf('COMMIT;');
  const transaction = bootstrap.slice(begin, commit);
  assert.match(transaction, /INSERT INTO public\.artsoul_staff_enrollment_grants/);
  assert.match(transaction, /INSERT INTO public\.artsoul_staff_auth_events/);
  assert.match(transaction, /'grant_issued'/);
  assert.match(transaction, /'bootstrap'/);
  // No wallet address is hardcoded anywhere in repository SQL.
  assert.doesNotMatch(bootstrap, /0x[0-9a-fA-F]{40}/);
});

test('no public route can insert a bootstrap grant', () => {
  const routesDir = path.join(root, 'src', 'api', 'routes', 'moderation');
  for (const file of fs.readdirSync(routesDir)) {
    const source = fs.readFileSync(path.join(routesDir, file), 'utf8');
    // 'bootstrap' may appear only as a read/display value (enrolled_via from
    // a consumed grant), never as an inserted grant purpose.
    assert.doesNotMatch(
      source,
      /purpose:\s*'bootstrap'/,
      `${file} must not create bootstrap grants`
    );
  }
});
