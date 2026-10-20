// Rehearse the October 30 Supabase default change in disposable PostgreSQL.
// Never uses DATABASE_URL or connects to an existing database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {execFileSync} = require('node:child_process');

const container = `artsoul-data-api-grants-${process.pid}`;
function docker(...args) {
  return execFileSync('docker', args, {encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000}).trim();
}
let available = false;
try { available = docker('version', '--format', '{{.Server.Os}}') === 'linux'; } catch {}
function query(sql) {
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'artsoul',
    '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], {input: sql, encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000}).trim();
}
const noImplicitGrants = `
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE ALL ON TABLES FROM anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role;
`;
const features = [
  'a8a_moderation_passkey_foundation',
  'a8b_artwork_report_intake', 'a8c_protocol_admin_review', 'a8d_moderation_safe_recovery',
  'a8e_moderation_totp_persistence', 'a8f_moderation_dual_wallet_authority',
  'a8g_staff_factor_setup', 'a8h_staff_factor_pgcrypto_resolution',
  'launch_service_quotas', 'profile_email_verification', 'artist_support',
  'artist_support_moderation', 'moderation_report_email_delivery'
];
// These tables deliberately accept writes only through protected RPCs.
const rpcOnly = [
  'artsoul_staff_roles', 'artsoul_staff_setup_permissions', 'artsoul_staff_totp_policy',
  'artsoul_staff_totp_grants', 'artsoul_staff_totp_factors', 'artsoul_staff_totp_attempts',
  'artsoul_staff_authority_policy', 'artsoul_staff_authority_requests', 'artsoul_staff_authority_events'
];

test('new table migrations must join the no-default-grant rehearsal', () => {
  // These immutable historical files are covered by the legacy 18.7b
  // classifier, not by assuming platform default grants. New features must
  // join the explicit-grant rehearsal above rather than this exception list.
  const legacy = new Set([
    'migrations/001_ai_integration.sql', 'sql/schema/init_schema.sql',
    'sql/migrations/indexer_dedup_setup.sql', 'sql/migrations/observability_dashboard.sql',
    'sql/migrations/observability_layer.sql', 'sql/migrations/phase10_auth_final.sql',
    'sql/migrations/phase11_ai_core.sql', 'sql/migrations/phase12_correctness.sql',
    'sql/migrations/stabilization_layer.sql'
  ]);
  const covered = new Set(['phase18_artwork_moderation_visibility', 'collection_launch_services', ...features]
    .map(name => `sql/migrations/${name}.sql`));
  const missing = [];
  for (const dir of ['migrations', 'sql/schema', 'sql/migrations', 'src/indexer/migrations']) {
    for (const name of fs.readdirSync(dir).filter(name => name.endsWith('.sql'))) {
      const file = `${dir}/${name}`;
      if (!/\bCREATE\s+TABLE\b/i.test(fs.readFileSync(file, 'utf8').replace(/--[^\n]*/g, ''))) continue;
      const inIndexerSequence = dir === 'sql/migrations' && /^00[123]_/.test(name)
        || dir === 'src/indexer/migrations' && /^(00[4-9]|01[0-5])_/.test(name);
      if (!inIndexerSequence && !covered.has(file) && !legacy.has(file)) missing.push(file);
    }
  }
  assert.deepEqual(missing, [], 'rehearse each new table and its explicit grants before release');
});

test('Data API migrations work without implicit table or sequence grants (PostgreSQL 17)', {
  skip: available ? false : 'Docker Linux PostgreSQL is unavailable'
}, async t => {
  let created = false;
  t.after(() => { if (created) docker('rm', '-f', container); });
  docker('run', '-d', '--name', container, '-e', 'POSTGRES_PASSWORD=local-grants-only',
    '-e', 'POSTGRES_DB=artsoul', 'postgres:17');
  created = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { query('SELECT 1;'); ready = true; break; } catch {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  assert.ok(ready, 'disposable PostgreSQL must start');
  query(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    ${noImplicitGrants}
  `);
  const {listIndexerMigrations} = await import('../scripts/apply-migrations.js');
  for (const migration of listIndexerMigrations()) query(migration.sql);
  // This legacy feature precedes the final legacy classifier, unlike A8.
  query(fs.readFileSync('sql/migrations/phase18_artwork_moderation_visibility.sql', 'utf8'));

  await t.test('historical indexer sequence alone needs the explicit hardening step', () => {
    assert.equal(query("SELECT has_table_privilege('service_role','public.v41_artworks','SELECT');"), 'f');
    assert.throws(() => query('SET ROLE service_role; SELECT * FROM public.v41_artworks LIMIT 0;'),
      /permission denied for table v41_artworks/);
    // The newer 015 feature is already self-contained before legacy hardening.
    for (const name of ['v41_public_metrics','v41_public_metric_events','v41_public_metric_participants']) {
      assert.equal(query(`SELECT has_table_privilege('service_role','public.${name}','SELECT');`), 't', name);
    }
  });
  query(fs.readFileSync('sql/migrations/phase18_7b_supabase_security_hardening.sql', 'utf8'));
  await t.test('legacy hardening restores only the approved public reads and server access', () => {
    assert.equal(query("SELECT has_table_privilege('service_role','public.v41_artworks','SELECT');"), 't');
    assert.equal(query("SELECT has_table_privilege('anon','public.v41_artworks','SELECT');"), 't');
    assert.equal(query("SELECT has_table_privilege('anon','public.artwork_social_signals','SELECT');"), 'f');
    query('SET ROLE service_role; SELECT * FROM public.v41_artworks LIMIT 0; RESET ROLE;');
    query('SET ROLE anon; SELECT * FROM public.v41_artworks LIMIT 0; RESET ROLE;');
  });

  // Historical hardening grants defaults to service_role. Revoke them before
  // EVERY feature, so no feature can silently borrow an earlier default grant.
  for (const name of features) {
    query(noImplicitGrants);
    query(fs.readFileSync(`sql/migrations/${name}.sql`, 'utf8'));
  }
  await t.test('all application tables have explicit service reads and forced RLS', () => {
    assert.equal(query(`SELECT c.relname FROM pg_class c WHERE c.relnamespace='public'::regnamespace
      AND c.relkind IN ('r','p') AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity
        OR NOT has_table_privilege('service_role',c.oid,'SELECT'));`), '');
  });
  await t.test('no client can write tables or use sequences', () => {
    assert.equal(query(`SELECT count(*) FROM pg_class c CROSS JOIN (VALUES ('anon'),('authenticated')) r(name)
      WHERE c.relnamespace='public'::regnamespace AND
        ((c.relkind IN ('r','p') AND has_table_privilege(r.name,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE'))
        OR CASE WHEN c.relkind='S'
          THEN has_sequence_privilege(r.name,c.oid,'USAGE,SELECT,UPDATE') ELSE false END);`), '0');
  });
  await t.test('all feature tables remain private to the server', () => {
    const tables = new Set(['phase18_artwork_moderation_visibility', ...features].flatMap(name => [...fs.readFileSync(`sql/migrations/${name}.sql`, 'utf8')
      .matchAll(/CREATE TABLE IF NOT EXISTS public\.(\w+)/g)].map(m => m[1])));
    assert.ok(tables.size >= 20);
    for (const name of tables) {
      assert.equal(query(`SELECT has_table_privilege('anon','public.${name}','SELECT')
        OR has_table_privilege('authenticated','public.${name}','SELECT');`), 'f', name);
    }
  });
  await t.test('paired authority and factor tables remain RPC-only', () => {
    for (const name of rpcOnly) {
      assert.equal(query(`SELECT has_table_privilege('service_role','public.${name}','INSERT,UPDATE,DELETE');`), 'f', name);
    }
    assert.throws(() => query('SET ROLE service_role; DELETE FROM public.artsoul_staff_roles WHERE false;'),
      /permission denied for table artsoul_staff_roles/);
    assert.throws(() => query("SET ROLE anon; SELECT public.a8f_create_authority_request(NULL,NULL,NULL,NULL,NULL,NULL);"),
      /permission denied for function a8f_create_authority_request/);
  });
  await t.test('other application tables retain explicit server CRUD grants', () => {
    assert.equal(query(`SELECT c.relname FROM pg_class c
      CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) p(name)
      WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p')
        AND c.relname NOT IN (${rpcOnly.map(name => `'${name}'`).join(',')})
        AND NOT has_table_privilege('service_role',c.oid,p.name);`), '');
  });
  await t.test('server writes still work for a signal, email and identity-backed auth event', () => {
    // All rows are disposable; rollback also prevents accidental fixture coupling.
    query(`BEGIN; SET LOCAL ROLE service_role;
      INSERT INTO artwork_social_signals(artwork_id,wallet_address,signal_type)
        VALUES('1','0x1111111111111111111111111111111111111111','like');
      INSERT INTO profile_email_connections(wallet_address)
        VALUES('0x1111111111111111111111111111111111111111');
      UPDATE profile_email_connections SET updated_at=now();
      DELETE FROM profile_email_connections;
      INSERT INTO artsoul_staff_auth_events(wallet_address,event_type,details)
        VALUES('0x1111111111111111111111111111111111111111','passkey_auth_failure','{}');
      ROLLBACK;`);
  });
  await t.test('only the two RPC-owned authority sequences deny service usage', () => {
    assert.equal(query(`SELECT string_agg(c.relname,',' ORDER BY c.relname) FROM pg_class c
      WHERE c.relnamespace='public'::regnamespace AND CASE WHEN c.relkind='S'
        THEN NOT has_sequence_privilege('service_role',c.oid,'USAGE') ELSE false END;`),
    'artsoul_staff_authority_events_id_seq,artsoul_staff_authorization_version_seq');
  });
  await t.test('unapplied collection draft also grants access explicitly without exposing email', () => {
    query(noImplicitGrants);
    query(fs.readFileSync('sql/migrations/collection_launch_services.sql','utf8'));
    for (const name of ['launch_service_quotas','collection_ai_reviews','email_subscriptions']) {
      assert.equal(query(`SELECT has_table_privilege('service_role','public.${name}','SELECT')
        AND has_table_privilege('service_role','public.${name}','INSERT')
        AND has_table_privilege('service_role','public.${name}','UPDATE')
        AND has_table_privilege('service_role','public.${name}','DELETE')
        AND NOT has_table_privilege('anon','public.${name}','SELECT')
        AND NOT has_table_privilege('authenticated','public.${name}','SELECT');`), 't', name);
    }
  });
  await t.test('read-only verification accepts explicit grants with empty default grants', () => {
    const report = fs.readFileSync('sql/verification/phase_a_security_verification.sql', 'utf8');
    assert.ok(report.includes('-- 9.'));
    assert.equal(query(report.slice(report.indexOf('-- 9.'))), '');
  });
});
