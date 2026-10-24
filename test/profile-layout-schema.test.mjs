// Disposable database only; no project connection string or credentials.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import pg from 'pg';
import { defaultProfileLayout, validateProfileLayout } from '../src/features/profile/profile-layout.js';

const migration = fs.readFileSync('sql/migrations/profile_layouts.sql', 'utf8');
const A = `0x${'1'.repeat(40)}`, B = `0x${'2'.repeat(40)}`, CORE = `0x${'3'.repeat(40)}`;
const item = id => ({ chain_id: 84532, core_address: CORE, artwork_id: String(id) });
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }).trim();
let available = false; try { available = docker('version', '--format', '{{.Server.Os}}') === 'linux'; } catch {}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('profile layout persistence is service-only, bounded and atomic under concurrent saves', {
  skip: available ? false : 'Disposable PostgreSQL requires Docker', timeout: 60000
}, async t => {
  const container = `artsoul-layout-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  let created = false, pool;
  t.after(async () => { await pool?.end(); if (created) docker('rm', '-f', container); });
  docker('run', '-d', '--name', container, '-e', 'POSTGRES_PASSWORD=local-layout-fixture', '-e', 'POSTGRES_DB=artsoul',
    '-p', '127.0.0.1::5432', 'postgres:17'); created = true;
  const endpoint = docker('port', container, '5432/tcp'); assert.match(endpoint, /^127\.0\.0\.1:\d+$/);
  pool = new pg.Pool({ host: '127.0.0.1', port: Number(endpoint.split(':')[1]), database: 'artsoul', user: 'postgres',
    password: 'local-layout-fixture', connectionTimeoutMillis: 1000 });
  for (let attempt = 0; ; attempt++) {
    try { await pool.query('SELECT 1'); await delay(100); await pool.query('SELECT 1'); break; }
    catch (error) { if (attempt >= 60) throw error; await delay(250); }
  }
  await pool.query(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE ROLE layout_owner NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role,layout_owner;
    GRANT CREATE ON SCHEMA public TO layout_owner;
    ALTER DEFAULT PRIVILEGES FOR ROLE layout_owner IN SCHEMA public REVOKE ALL ON TABLES FROM anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE layout_owner IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC;`);
  async function asRole(role, action) {
    const client = await pool.connect();
    try { await client.query(`SET ROLE ${role}`); return await action(client); }
    finally { await client.query('RESET ROLE'); client.release(); }
  }
  await asRole('layout_owner', client => client.query(migration));
  const save = (wallet, revision, layout = defaultProfileLayout()) => asRole('service_role', async client =>
    (await client.query('SELECT public.save_profile_layout($1,$2,$3::JSONB) AS result', [wallet, revision, JSON.stringify(layout)])).rows[0].result);

  await t.test('anonymous and authenticated clients cannot read, write or execute either function', async () => {
    for (const role of ['anon', 'authenticated']) await asRole(role, async client => {
      for (const sql of ['SELECT * FROM public.profile_layouts', 'DELETE FROM public.profile_layouts',
        "SELECT public.profile_layout_valid('{}')", "SELECT public.save_profile_layout(NULL,0,'{}')"]) {
        await assert.rejects(client.query(sql), { code: '42501' });
      }
    });
    await asRole('service_role', async client => {
      await client.query('SELECT * FROM public.profile_layouts');
      await assert.rejects(client.query('DELETE FROM public.profile_layouts'), { code: '42501' });
      await assert.rejects(client.query("UPDATE public.profile_layouts SET revision=1"), { code: '42501' });
      await assert.rejects(client.query("SELECT public.profile_layout_valid('{}')"), { code: '42501' });
    });
    const flags = (await pool.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='public.profile_layouts'::regclass")).rows[0];
    assert.deepEqual(flags, { relrowsecurity: true, relforcerowsecurity: true });
  });
  await t.test('simultaneous first saves have one winner and preserve exact deployment-scoped work identity', async () => {
    const layout = validateProfileLayout({ ...defaultProfileLayout(), template: 'featured', pinned: item(2n ** 256n - 1n),
      sections: [{ id: 'my-works', label: '作品 🎨', artworks: [item(1), item(2)] }] });
    const results = await Promise.all([save(A, 0, layout), save(A, 0, defaultProfileLayout())]);
    assert.equal(results.filter(result => result.saved).length, 1);
    assert.equal(results.filter(result => result.saved === false).length, 1);
    const stored = (await pool.query('SELECT revision,layout FROM public.profile_layouts WHERE wallet_address=$1', [A])).rows[0];
    assert.equal(stored.revision, 1);
    assert.deepEqual(stored.layout, results.find(result => result.saved).layout);
    assert.deepEqual(await save(B, 0, layout), { saved: true, wallet: B, revision: 1, layout });
  });
  await t.test('concurrent edits, stale retry, missing row and restore default never overwrite a newer revision', async () => {
    const results = await Promise.all([save(A, 1, { ...defaultProfileLayout(), pinned: item(8) }), save(A, 1, { ...defaultProfileLayout(), pinned: item(9) })]);
    assert.equal(results.filter(result => result.saved).length, 1);
    assert.equal(results.find(result => result.saved).revision, 2);
    assert.deepEqual(await save(A, 1), { saved: false });
    assert.deepEqual(await save(CORE, 4), { saved: false });
    assert.deepEqual(await save(A, 2), { saved: true, wallet: A, revision: 3, layout: defaultProfileLayout() });
    assert.deepEqual(await save(A, 0), { saved: false }, 'restore retains the row/revision instead of re-opening first save');
    assert.deepEqual(await save(A, 2, { ...defaultProfileLayout(), pinned: item(10) }), { saved: false });
    assert.equal((await pool.query('SELECT revision FROM public.profile_layouts WHERE wallet_address=$1', [B])).rows[0].revision, 1);
  });
  await t.test('database schema rejects malformed or oversized documents independently of JavaScript', async () => {
    const base = defaultProfileLayout();
    const invalid = [{}, [], null, { ...base, version: 2 }, { ...base, template: null },
      { ...base, is_admin: true }, { ...base, cover_url: 'javascript:alert(1)' },
      { ...base, pinned: {} }, { ...base, pinned: { ...item(1), artwork_id: 1 } },
      { ...base, pinned: { ...item(1), core_address: '0x' + '0'.repeat(40) } },
      { ...base, pinned: item(2n ** 256n) }, { ...base, sections: [{ id: 'one', label: 'x', artworks: [item(1), item(1)] }] },
      { ...base, sections: [{ id: 'one', label: 'x', artworks: [{ ...item(1), artwork_id: 'not-an-id' }] }] },
      { ...base, sections: [{ id: 'one', label: 'x', artworks: [{ ...item(1), chain_id: 0 }] }] },
      { ...base, sections: [{ id: 'one', label: 'x'.repeat(61), artworks: [] }] },
      { ...base, sections: Array.from({ length: 4 }, (_, n) => ({ id: String(n), label: 'x', artworks: [] })) },
      { ...base, pinned: item(21), sections: [{ id: 'one', label: 'x', artworks: Array.from({ length: 20 }, (_, n) => item(n + 1)) }] }
    ];
    for (const layout of invalid) await assert.rejects(save(A, 3, layout), { code: '22023' }, JSON.stringify(layout));
    for (const [wallet, revision] of [[null, 0], ['invalid', 0], ['0x' + '0'.repeat(40), 0], [A, -1], [A, 2147483647]]) {
      await assert.rejects(save(wallet, revision), { code: '22023' });
    }
    assert.equal((await pool.query('SELECT revision FROM public.profile_layouts WHERE wallet_address=$1', [A])).rows[0].revision, 3);
  });
  await t.test('reapplying the feature migration preserves every row and the minimal service grants', async () => {
    const before = (await pool.query('SELECT * FROM public.profile_layouts ORDER BY wallet_address')).rows;
    await asRole('layout_owner', client => client.query(migration));
    assert.deepEqual((await pool.query('SELECT * FROM public.profile_layouts ORDER BY wallet_address')).rows, before);
    const rights = (await pool.query(`SELECT has_table_privilege('service_role','public.profile_layouts','SELECT') AS can_read,
      has_table_privilege('service_role','public.profile_layouts','INSERT,UPDATE,DELETE') AS can_write,
      has_function_privilege('service_role','public.save_profile_layout(text,integer,jsonb)','EXECUTE') AS can_save`)).rows[0];
    assert.deepEqual(rights, { can_read: true, can_write: false, can_save: true });
  });
});
