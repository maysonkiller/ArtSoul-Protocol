// Disposable PostgreSQL only; no hosted database, credentials or deployment.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const CONTAINER = `artsoul-eligibility-view-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
const VIEW = 'v41_project_eligibility_signals';
const TABLES = ['v41_artworks', 'v41_bids', 'v41_settlements', 'v41_project_eligibility', 'v41_genesis_holders'];
const ROLES = ['anon', 'authenticated', 'service_role'];
const migration = fs.readFileSync(path.join(ROOT, 'sql/migrations/20261116112454_eligibility_view_security_invoker.sql'), 'utf8');
const historical = fs.readFileSync(path.join(ROOT, 'src/indexer/migrations/013_chain_scoped_v41_projections.sql'), 'utf8');
const viewSql = historical.match(/CREATE OR REPLACE VIEW v41_project_eligibility_signals AS[\s\S]*?;/)?.[0];
assert.ok(viewSql, 'use the maintained historical view definition');

function docker(args, input) {
  return execFileSync('docker', args, { input, encoding: 'utf8', windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000 }).trim();
}
let available = false;
try { available = docker(['version', '--format', '{{.Server.Os}}']) === 'linux'; } catch {}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('eligibility view preserves public results while enforcing caller permissions (PostgreSQL 17)', {
  skip: available ? false : 'Disposable PostgreSQL requires Docker', timeout: 120000
}, async t => {
  let created = false;
  t.after(() => { if (created) docker(['rm', '-f', CONTAINER]); });
  docker(['run', '-d', '--name', CONTAINER, '--network', 'none',
    '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_DB=artsoul', 'postgres:17']);
  created = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const probe = ['exec', CONTAINER, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'artsoul', '-c', 'SELECT 1'];
      assert.equal(docker(probe), '1'); await delay(250); assert.equal(docker(probe), '1');
      ready = true; break;
    }
    catch { await delay(500); }
  }
  assert.ok(ready, 'isolated database becomes ready');
  const inspected = JSON.parse(docker(['inspect', CONTAINER]))[0];
  assert.equal(inspected.HostConfig.NetworkMode, 'none');
  assert.equal(Object.keys(inspected.HostConfig.PortBindings || {}).length, 0);
  const sql = statement => docker(['exec', '-i', CONTAINER, 'psql', '-X', '-qAt',
    '-U', 'postgres', '-d', 'artsoul', '-v', 'ON_ERROR_STOP=1'], statement);
  const json = statement => JSON.parse(sql(statement));
  const results = role => json(`SET ROLE ${role}; SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY chain_id,user_address),'[]') FROM public.${VIEW} v;`);

  sql(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
    CREATE TABLE v41_artworks(chain_id numeric,artwork_id numeric,creator text);
    CREATE TABLE v41_bids(chain_id numeric,auction_id numeric,bidder text);
    CREATE TABLE v41_settlements(chain_id numeric,winner text,settlement_status text);
    CREATE TABLE v41_project_eligibility(chain_id numeric,user_address text,eligibility_hash text,achieved boolean);
    CREATE TABLE v41_genesis_holders(chain_id numeric,user_address text,token_id numeric);
    INSERT INTO v41_artworks VALUES(84532,1,'artist-a'),(84532,2,'artist-a'),(84532,3,'artist-b'),(11155111,1,'artist-a');
    INSERT INTO v41_bids VALUES(84532,10,'artist-a'),(84532,10,'artist-a'),(84532,10,'artist-b'),(84532,11,'artist-b'),(11155111,1,'artist-c');
    INSERT INTO v41_settlements VALUES(84532,'artist-a','completed'),(84532,'artist-a','completed'),(84532,'artist-a','defaulted'),(84532,'artist-b','completed');
    INSERT INTO v41_project_eligibility VALUES(84532,'artist-a','historical-a',true),(84532,'artist-b','historical-b',false);
    INSERT INTO v41_genesis_holders VALUES(11155111,'artist-a',7);
    ${viewSql}
    GRANT SELECT ON public.${VIEW} TO anon,authenticated;
    GRANT ALL ON public.${VIEW} TO service_role;`);
  for (const table of TABLES) sql(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY;
    CREATE POLICY artsoul_public_read ON public.${table} FOR SELECT TO anon,authenticated USING(true);
    GRANT SELECT ON public.${table} TO anon,authenticated;
    GRANT ALL ON public.${table} TO service_role;`);

  const catalog = () => json(`SELECT jsonb_build_object(
    'view',(SELECT jsonb_build_object('oid',oid,'owner',relowner,'acl',relacl::text,'definition',pg_get_viewdef(oid))
      FROM pg_class WHERE oid='public.${VIEW}'::regclass),
    'columns',(SELECT jsonb_agg(to_jsonb(a) ORDER BY attnum) FROM
      (SELECT attname,atttypid,atttypmod,attnum FROM pg_attribute WHERE attrelid='public.${VIEW}'::regclass AND attnum>0) a),
    'tables',(SELECT jsonb_agg(jsonb_build_object('name',relname,'acl',relacl::text,'rls',relrowsecurity,'force',relforcerowsecurity) ORDER BY relname)
      FROM pg_class WHERE oid=ANY(ARRAY[${TABLES.map(name => `'public.${name}'::regclass`).join(',')}])),
    'data',jsonb_build_object(${TABLES.map(name => `'${name}',(SELECT jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text) FROM public.${name} r)`).join(',')}));`);
  const before = catalog();
  const baseline = Object.fromEntries(ROLES.map(role => [role, results(role)]));
  assert.equal(baseline.anon.length, 4);
  assert.deepEqual(baseline.anon, baseline.authenticated);
  assert.deepEqual(baseline.anon, baseline.service_role);
  const artist = baseline.anon.find(row => row.chain_id === 84532 && row.user_address === 'artist-a');
  assert.equal(artist.artwork_upload_count, 2);
  assert.equal(artist.auction_participation_count, 1);
  assert.equal(artist.successful_settlement_count, 2);

  await t.test('migration and replay preserve view identity, columns, grants, source data and every role result', () => {
    for (let pass = 0; pass < 2; pass++) {
      sql(migration);
      assert.deepEqual(catalog(), before);
      assert.equal(json(`SELECT to_jsonb(reloptions @> ARRAY['security_invoker=true']) FROM pg_class WHERE oid='public.${VIEW}'::regclass;`), true);
      for (const role of ROLES) assert.deepEqual(results(role), baseline[role], `${role} result parity`);
    }
  });

  await t.test('public reads remain available while source-table writes remain denied', () => {
    for (const role of ['anon', 'authenticated']) {
      for (const table of TABLES) assert.ok(Number(sql(`SET ROLE ${role}; SELECT count(*) FROM public.${table};`)) > 0);
      assert.throws(() => sql(`SET ROLE ${role}; DELETE FROM public.v41_artworks;`), /permission denied/);
    }
    assert.deepEqual(catalog(), before);
  });

  await t.test('later source RLS restrictions constrain browser reads without constraining the service role', () => {
    for (const table of TABLES) sql(`ALTER POLICY artsoul_public_read ON public.${table} USING(chain_id=84532);`);
    try {
      for (const role of ['anon', 'authenticated']) assert.deepEqual(results(role), baseline[role].filter(row => row.chain_id === 84532));
      assert.deepEqual(results('service_role'), baseline.service_role);
    } finally {
      for (const table of TABLES) sql(`ALTER POLICY artsoul_public_read ON public.${table} USING(true);`);
    }
  });

  await t.test('view grants cannot bypass a revoked underlying table grant', () => {
    sql('REVOKE SELECT ON public.v41_bids FROM anon;');
    try {
      assert.throws(() => results('anon'), /permission denied for table v41_bids/);
      assert.deepEqual(results('authenticated'), baseline.authenticated);
      assert.deepEqual(results('service_role'), baseline.service_role);
    } finally { sql('GRANT SELECT ON public.v41_bids TO anon;'); }
    assert.deepEqual(results('anon'), baseline.anon);
  });
});
