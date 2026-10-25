// Fresh bootstrap and forward-only repair against disposable PostgreSQL.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import pg from 'pg';
import { applyIndexerMigrations, listIndexerMigrations } from '../scripts/apply-migrations.js';

const docker = (...args) => execFileSync('docker', args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000
}).trim();
let available = false;
try { available = docker('version', '--format', '{{.Server.Os}}') === 'linux'; } catch {}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const CORE = `0x${'1'.repeat(40)}`;

test('the complete indexer bootstrap supports state hashes without a fixture schema workaround', {
    skip: available ? false : 'Disposable PostgreSQL requires Docker', timeout: 60000
}, async t => {
    const container = `artsoul-bootstrap-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    let created = false, fresh, legacy;
    const priorRedis = process.env.REDIS_URL;
    process.env.REDIS_URL = '';
    t.after(async () => {
        await fresh?.end();
        await legacy?.end();
        if (created) docker('rm', '-f', container);
        if (priorRedis === undefined) delete process.env.REDIS_URL;
        else process.env.REDIS_URL = priorRedis;
    });
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'warn', () => {});
    const { default: Engine } = await import('../src/indexer/sync-engine.js');
    docker('run', '-d', '--name', container, '-e', 'POSTGRES_PASSWORD=local-bootstrap-fixture',
        '-e', 'POSTGRES_DB=fresh', '-p', '127.0.0.1::5432', 'postgres:17');
    created = true;
    const endpoint = docker('port', container, '5432/tcp');
    assert.match(endpoint, /^127\.0\.0\.1:\d+$/);
    const url = name => `postgresql://postgres:local-bootstrap-fixture@${endpoint}/${name}`;
    fresh = new pg.Pool({ connectionString: url('fresh'), connectionTimeoutMillis: 1000 });
    for (let attempt = 0; ; attempt++) {
        try { await fresh.query('SELECT 1'); await delay(100); await fresh.query('SELECT 1'); break; }
        catch (error) { if (attempt >= 60) throw error; await delay(250); }
    }
    await fresh.query('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;');
    const migrations = listIndexerMigrations();

    await t.test('fresh runner migration, initialization and confirmed cursor update succeed; ledger rerun preserves data', async () => {
        const options = { apply: true, connectionString: url('fresh'), environment: 'local-bootstrap-test' };
        const applied = await applyIndexerMigrations(options);
        assert.ok(applied.migrations.every(row => row.status === 'applied'));
        const db = { pool: fresh, query: async (sql, params) => (await fresh.query(sql, params)).rows,
            isBackpressure: () => false };
        const engine = new Engine(db, { chainId: 84532, queryAllHistoricalEvents: async () => [] });
        await engine.initialize(CORE, 84532, 100);
        assert.equal((await engine.getIndexerState()).state_hash, '0x0');
        const blockHash = `0x${'2'.repeat(64)}`;
        await fresh.query(`INSERT INTO block_hashes(chain_id,block_number,block_hash,parent_hash,timestamp)
            VALUES(84532,101,$1,$2,1700000000)`, [blockHash, `0x${'3'.repeat(64)}`]);
        // This empty confirmed range already has its fixture block hash; no RPC.
        engine._shouldSkipEmptyBlockHashBackfill = () => true;
        assert.equal(await engine.syncHistoricalEvents(101, 101, { currentBlock: 113 }), 0);
        const state = await engine.getIndexerState();
        assert.equal(state.last_indexed_block, 101);
        assert.equal(state.last_confirmed_block, 101);
        assert.equal(state.state_hash, `0x${crypto.createHash('sha256').update(blockHash).digest('hex')}`);
        assert.equal(applied.migrations.length, 17);
        const ledger = (await fresh.query('SELECT * FROM artsoul_schema_migrations ORDER BY migration_id')).rows;
        assert.equal(ledger.length, 17);
        assert.deepEqual(ledger.map(row => [row.migration_id, row.sha256]), migrations.map(row => [row.id, row.checksum]));
        const before = (await fresh.query('SELECT * FROM indexer_state ORDER BY chain_id')).rows;
        const repeated = await applyIndexerMigrations(options);
        assert.ok(repeated.migrations.every(row => row.status === 'already-applied'));
        assert.deepEqual((await fresh.query('SELECT * FROM indexer_state ORDER BY chain_id')).rows, before);
        assert.deepEqual((await fresh.query('SELECT * FROM artsoul_schema_migrations ORDER BY migration_id')).rows, ledger);
        const access = (await fresh.query(`SELECT relrowsecurity,relforcerowsecurity,
            has_table_privilege('anon',oid,'SELECT') AS anon_read,
            has_table_privilege('authenticated',oid,'SELECT') AS authenticated_read
            FROM pg_class WHERE oid='public.artsoul_schema_migrations'::regclass`)).rows[0];
        assert.deepEqual(access, { relrowsecurity: true, relforcerowsecurity: true, anon_read: false, authenticated_read: false });
    });

    await t.test('forward repair preserves existing rows, hashes and access controls and is idempotent', async () => {
        await fresh.query('CREATE DATABASE legacy');
        legacy = new pg.Pool({ connectionString: url('legacy') });
        for (const migration of migrations.filter(row => row.number < 16)) await legacy.query(migration.sql);
        assert.equal((await legacy.query(`SELECT count(*)::INT AS n FROM information_schema.columns
            WHERE table_schema='public' AND table_name='indexer_state' AND column_name='state_hash'`)).rows[0].n, 0,
        'the historical ordered migration sequence reproduces the missing column');
        await legacy.query(`INSERT INTO indexer_state(chain_id,contract_address,last_indexed_block,last_confirmed_block,
            confirmation_depth,total_events_indexed,last_indexed_at,started_at)
            VALUES(84532,$1,120,119,12,42,now(),now())`, [CORE]);
        await legacy.query(`ALTER TABLE indexer_state ENABLE ROW LEVEL SECURITY;
            ALTER TABLE indexer_state FORCE ROW LEVEL SECURITY;
            REVOKE ALL ON indexer_state FROM PUBLIC,anon,authenticated,service_role;
            GRANT SELECT,UPDATE ON indexer_state TO service_role;`);
        const catalog = async () => (await legacy.query(`SELECT c.relacl::TEXT,c.relrowsecurity,c.relforcerowsecurity,
            (SELECT jsonb_agg(jsonb_build_object('name',polname,'roles',polroles,'command',polcmd,
                'qual',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid)) ORDER BY polname)
             FROM pg_policy WHERE polrelid=c.oid) AS policies
            FROM pg_class c WHERE c.oid='public.indexer_state'::regclass`)).rows;
        const beforeRows = (await legacy.query('SELECT to_jsonb(s) AS row FROM indexer_state s ORDER BY chain_id')).rows;
        const beforeCatalog = await catalog();
        const repair = migrations.find(row => row.number === 16);
        assert.ok(repair, 'the forward repair belongs to the numbered migration runner');
        await legacy.query(repair.sql);
        assert.deepEqual((await legacy.query("SELECT to_jsonb(s)-'state_hash' AS row FROM indexer_state s ORDER BY chain_id")).rows, beforeRows);
        assert.deepEqual(await catalog(), beforeCatalog);
        const column = (await legacy.query(`SELECT data_type,character_maximum_length,is_nullable,column_default
            FROM information_schema.columns WHERE table_schema='public' AND table_name='indexer_state' AND column_name='state_hash'`)).rows[0];
        assert.deepEqual(column, { data_type: 'character varying', character_maximum_length: 66,
            is_nullable: 'NO', column_default: "'0x0'::character varying" });
        assert.ok((await legacy.query('SELECT state_hash FROM indexer_state')).rows.every(row => row.state_hash === '0x0'));
        const existingHash = `0x${'a'.repeat(64)}`;
        await legacy.query('UPDATE indexer_state SET state_hash=$1 WHERE chain_id=84532', [existingHash]);
        const withHash = (await legacy.query('SELECT * FROM indexer_state ORDER BY chain_id')).rows;
        await legacy.query(repair.sql);
        await legacy.query(repair.sql);
        assert.deepEqual((await legacy.query('SELECT * FROM indexer_state ORDER BY chain_id')).rows, withHash);
        assert.deepEqual(await catalog(), beforeCatalog);
        assert.deepEqual((await legacy.query(`SELECT has_column_privilege('anon','public.indexer_state','state_hash','SELECT') AS anon_read,
            has_column_privilege('authenticated','public.indexer_state','state_hash','SELECT') AS authenticated_read,
            has_column_privilege('service_role','public.indexer_state','state_hash','UPDATE') AS service_write`)).rows[0],
        { anon_read: false, authenticated_read: false, service_write: true });
    });
});
