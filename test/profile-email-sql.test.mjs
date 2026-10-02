// Real private schema/RPC checks in disposable PostgreSQL, never a live migration.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import test from 'node:test';
import pg from 'pg';

const CONTAINER = `artsoul-email-pg-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
const WALLET = `0x${'1'.repeat(40)}`, OTHER = `0x${'2'.repeat(40)}`;
const HASH = crypto.createHash('sha256').update('local-token-only').digest('hex');
function docker(...args) {return execFileSync('docker', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();}
function available() {try {return docker('version', '--format', '{{.Server.Os}}') === 'linux';} catch {return false;}}

test('private email schema enforces client denial, atomic confirmation, replay/expiry and revision fencing', {
  skip: available() ? false : 'Disposable PostgreSQL requires local Docker'
}, async t => {
  let created = false, pool;
  t.after(async () => {if (pool) await pool.end(); if (created) docker('rm', '-f', CONTAINER);});
  docker('run', '-d', '--name', CONTAINER, '-e', 'POSTGRES_PASSWORD=local-disposable-only',
    '-e', 'POSTGRES_DB=artsoul', '-p', '127.0.0.1::5432', 'postgres:17');
  created = true;
  const endpoint = docker('port', CONTAINER, '5432/tcp');
  assert.match(endpoint, /^127\.0\.0\.1:\d+$/);
  pool = new pg.Pool({host: '127.0.0.1', port: Number(endpoint.split(':')[1]), database: 'artsoul',
    user: 'postgres', password: 'local-disposable-only', connectionTimeoutMillis: 1000});
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {await pool.query('SELECT 1'); ready = true; break;} catch {await new Promise(resolve => setTimeout(resolve, 500));}
  }
  assert.ok(ready);
  await pool.query('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;');
  const quotaMigration = fs.readFileSync(new URL('../sql/migrations/launch_service_quotas.sql', import.meta.url), 'utf8');
  await pool.query(quotaMigration);
  await pool.query(quotaMigration);
  assert.equal((await pool.query("SELECT to_regclass('public.email_subscriptions') IS NULL AND to_regclass('public.collection_ai_reviews') IS NULL AS isolated")).rows[0].isolated, true);
  const quotaDefinition = (await pool.query("SELECT pg_get_functiondef('public.consume_launch_service_quota(text,integer,integer)'::regprocedure) AS definition")).rows[0].definition.replace(/\r/g, '');
  const migration = fs.readFileSync(new URL('../sql/migrations/profile_email_verification.sql', import.meta.url), 'utf8');
  await pool.query(migration);
  await pool.query(migration);
  const schema = await pool.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='public.profile_email_connections'::regclass");
  assert.deepEqual(schema.rows[0], {relrowsecurity: true, relforcerowsecurity: true});
  for (const role of ['anon', 'authenticated']) {
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      assert.equal((await pool.query("SELECT has_table_privilege($1,'public.profile_email_connections',$2) AS permitted", [role, privilege])).rows[0].permitted, false);
    }
    assert.equal((await pool.query("SELECT has_function_privilege($1,'public.confirm_profile_email(text,text)','EXECUTE') AS permitted", [role])).rows[0].permitted, false);
    assert.equal((await pool.query("SELECT has_table_privilege($1,'public.launch_service_quotas','SELECT') AS permitted", [role])).rows[0].permitted, false);
    assert.equal((await pool.query("SELECT has_function_privilege($1,'public.consume_launch_service_quota(text,integer,integer)','EXECUTE') AS permitted", [role])).rows[0].permitted, false);
    const client = await pool.connect();
    try {
      await client.query(`SET ROLE ${role}`);
      await assert.rejects(client.query('SELECT * FROM public.profile_email_connections'), {code: '42501'});
      await assert.rejects(client.query('SELECT * FROM public.confirm_profile_email($1,$2)', [WALLET, HASH]), {code: '42501'});
    } finally {await client.query('RESET ROLE'); client.release();}
  }
  assert.equal((await pool.query('SELECT consume_launch_service_quota($1,1,3600) AS allowed', [HASH])).rows[0].allowed, true);
  assert.equal((await pool.query('SELECT consume_launch_service_quota($1,1,3600) AS allowed', [HASH])).rows[0].allowed, false);
  await pool.query(`INSERT INTO profile_email_connections(wallet_address,pending_email,pending_token_hash,pending_expires_at)
    VALUES($1,'artist@gmail.com',$2,now()+interval '15 minutes')`, [WALLET, HASH]);
  assert.equal((await pool.query('SELECT * FROM confirm_profile_email($1,$2)', [OTHER, HASH])).rowCount, 0);
  const confirmations = await Promise.all([pool.query('SELECT * FROM confirm_profile_email($1,$2)', [WALLET, HASH]),
    pool.query('SELECT * FROM confirm_profile_email($1,$2)', [WALLET, HASH])]);
  assert.equal(confirmations.reduce((count, result) => count + result.rowCount, 0), 1, 'concurrent confirmation has exactly one consumer');
  assert.equal((await pool.query('SELECT * FROM confirm_profile_email($1,$2)', [WALLET, HASH])).rowCount, 0);
  const confirmed = (await pool.query('SELECT * FROM profile_email_connections WHERE wallet_address=$1', [WALLET])).rows[0];
  assert.equal(confirmed.verified_email, 'artist@gmail.com');
  assert.equal(confirmed.pending_token_hash, null);
  await pool.query(`UPDATE profile_email_connections SET pending_email='changed@example.test',pending_token_hash=$2,
    pending_expires_at=now()-interval '1 second' WHERE wallet_address=$1`, [WALLET, HASH]);
  assert.equal((await pool.query('SELECT * FROM confirm_profile_email($1,$2)', [WALLET, HASH])).rowCount, 0);
  const beforeDisconnect = (await pool.query('SELECT revision FROM profile_email_connections WHERE wallet_address=$1', [WALLET])).rows[0].revision;
  await pool.query(`UPDATE profile_email_connections SET revision=gen_random_uuid(),verified_email=NULL,verified_at=NULL,
    pending_email=NULL,pending_token_hash=NULL,pending_expires_at=NULL WHERE wallet_address=$1`, [WALLET]);
  const lateRequest = await pool.query(`UPDATE profile_email_connections SET pending_email='late@example.test',
    pending_token_hash=$3,pending_expires_at=now()+interval '15 minutes'
    WHERE wallet_address=$1 AND revision=$2 RETURNING wallet_address`, [WALLET, beforeDisconnect, HASH]);
  assert.equal(lateRequest.rowCount, 0, 'a stale request cannot replace the disconnect tombstone');
  assert.equal((await pool.query('SELECT * FROM confirm_profile_email($1,$2)', [WALLET, HASH])).rowCount, 0);
  await assert.rejects(pool.query("INSERT INTO profile_email_connections(wallet_address,pending_email) VALUES($1,'partial@example.test')", [OTHER]), {code: '23514'});
  await pool.query(fs.readFileSync(new URL('../sql/verification/profile_email_verification.sql', import.meta.url), 'utf8'));
  await pool.query(fs.readFileSync(new URL('../sql/verification/launch_service_quotas.sql', import.meta.url), 'utf8'));
  // Compatibility is checked only in this disposable database. No launch
  // tables are needed by the independently prepared email feature.
  await pool.query(fs.readFileSync(new URL('../sql/migrations/collection_launch_services.sql', import.meta.url), 'utf8'));
  assert.equal((await pool.query("SELECT pg_get_functiondef('public.consume_launch_service_quota(text,integer,integer)'::regprocedure) AS definition")).rows[0].definition.replace(/\r/g, ''), quotaDefinition);
  assert.equal((await pool.query('SELECT consume_launch_service_quota($1,1,3600) AS allowed', [HASH])).rows[0].allowed, false);
  await pool.query(quotaMigration);
  assert.equal((await pool.query('SELECT consume_launch_service_quota($1,1,3600) AS allowed', [HASH])).rows[0].allowed, false);
});
