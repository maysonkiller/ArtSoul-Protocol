// A8d Safe-only recovery invariants (static). The real PostgreSQL behavior
// is exercised separately in a8d-safe-recovery-rpc-integration.test.cjs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8').replace(/\r\n/g, '\n');
const migration = read('sql', 'migrations', 'a8d_moderation_safe_recovery.sql');
const verification = read('sql', 'verification', 'a8d_moderation_safe_recovery_verification.sql');
const recovery = read('src', 'api', 'moderation-safe-recovery.js');
const route = read('src', 'api', 'routes', 'moderation', 'passkey-recovery.js');

test('A8d is additive and changes only its request table plus the A8a audit vocabulary', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.artsoul_staff_recovery_requests/);
  assert.doesNotMatch(migration, /DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE|DELETE\s+FROM/i);
  const altered = [...migration.matchAll(/ALTER TABLE public\.([a-z0-9_]+)/g)].map(match => match[1]);
  assert.deepEqual([...new Set(altered)].sort(), [
    'artsoul_staff_auth_events',
    'artsoul_staff_recovery_requests'
  ]);
});

test('the request table is forced-RLS and service-role-only', () => {
  assert.match(migration, /ALTER TABLE public\.artsoul_staff_recovery_requests ENABLE ROW LEVEL SECURITY;/);
  assert.match(migration, /ALTER TABLE public\.artsoul_staff_recovery_requests FORCE ROW LEVEL SECURITY;/);
  assert.match(migration, /REVOKE ALL ON public\.artsoul_staff_recovery_requests FROM PUBLIC, anon, authenticated;/);
  assert.match(migration, /GRANT ALL ON public\.artsoul_staff_recovery_requests TO service_role;/);
  assert.doesNotMatch(migration, /GRANT[^;]+TO\s+(anon|authenticated)/i);
});

test('only hashes and the exact bounded recovery statement are persisted', () => {
  const table = migration.slice(
    migration.indexOf('CREATE TABLE IF NOT EXISTS public.artsoul_staff_recovery_requests'),
    migration.indexOf('CREATE INDEX IF NOT EXISTS idx_artsoul_staff_recovery_requests_target')
  );
  assert.match(table, /message TEXT NOT NULL/);
  assert.match(table, /message_hash TEXT NOT NULL/);
  assert.match(table, /expires_at <= created_at \+ INTERVAL '5 minutes'/);
  assert.doesNotMatch(table, /\bsignature\b(?!_hash)|\btoken\b(?!_hash)|private_key|secret_key|seed|ip_address|user_agent/i);
  for (const binding of ['Request ID:', 'Target wallet:', 'Authorizing Safe:', 'Chain ID:', 'RP ID:', 'Origin:', 'Expires at:']) {
    assert.match(recovery, new RegExp(binding));
  }
});

test('EIP-1271 verification is fail-closed across at least two exact RPC endpoints', () => {
  assert.match(recovery, /rpcUrls\.length < 2/);
  assert.match(recovery, /results\.length >= 2 && results\.every\(Boolean\)/);
  assert.match(recovery, /EIP1271_MAGIC_VALUE = '0x1626ba7e'/);
  assert.match(recovery, /EIP1271_LEGACY_MAGIC_VALUE = '0x20c13b0b'/);
  assert.match(recovery, /provider\.call\(\{ from: safeAddress, to: safeAddress, data \}\)/);
  assert.match(recovery, /await provider\.getCode\(config\.safeAddress\) === '0x'/);
  assert.match(recovery, /NODE_ENV === 'production'.*parsed\.protocol !== 'https:'/s);
});

test('the HTTP route cannot choose a wallet, Safe, role, or bootstrap grant from request data', () => {
  assert.match(route, /requirePasskeyRouteContext\(req\)/);
  assert.match(route, /wallet = context\.wallet/);
  assert.match(route, /safeAddress: safeConfig\.safeAddress/);
  assert.doesNotMatch(route, /body\?\.(target_wallet|wallet|safe_address|role|purpose)/);
  assert.doesNotMatch(route, /['"]bootstrap['"]/);
  assert.doesNotMatch(route, /setModerationSession|INSERT INTO public\.artsoul_staff_(passkeys|roles)/);
});

test('the completion RPC consumes one request and creates one additional grant atomically', () => {
  const fn = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.a8d_complete_safe_recovery('));
  assert.match(fn, /FOR UPDATE/);
  assert.match(fn, /v_request\.consumed_at IS NOT NULL/);
  assert.match(fn, /v_request\.expires_at <= NOW\(\)/);
  assert.match(fn, /SET consumed_at = NOW\(\)/);
  assert.match(fn, /INSERT INTO public\.artsoul_staff_enrollment_grants/);
  assert.match(fn, /'additional'/);
  assert.match(fn, /'recovery_authorized'/);
  assert.match(fn, /'grant_issued'/);
  assert.doesNotMatch(fn, /INSERT INTO public\.artsoul_staff_(passkeys|roles)/);
});

test('the completion RPC is SECURITY DEFINER with service-role-only execute', () => {
  assert.match(migration, /SECURITY DEFINER\s+SET search_path = public/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.a8d_complete_safe_recovery\([^;]+\)\s+FROM PUBLIC, anon, authenticated;/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.a8d_complete_safe_recovery\([^;]+\)\s+TO service_role;/);
});

test('the A8d verification script is strictly read-only', () => {
  assert.doesNotMatch(verification, /^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE)\b/im);
  assert.match(verification, /^SELECT /m);
  assert.match(verification, /relforcerowsecurity/);
  assert.match(verification, /prosecdef/);
});
