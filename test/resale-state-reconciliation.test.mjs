import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import pg from 'pg';
import { Interface } from 'ethers';
import { readResaleStateAtBlock, reconcileResaleState } from '../src/indexer/resale-state-reconciliation.js';

const CORE = `0x${'1'.repeat(40)}`;
const SELLER = `0x${'2'.repeat(40)}`;
const OTHER = `0x${'3'.repeat(40)}`;
const HASH = `0x${'a'.repeat(64)}`;
const OTHER_HASH = `0x${'b'.repeat(64)}`;
const TX = `0x${'c'.repeat(64)}`;
const leader = { lockName: 'resale-fixture', instanceId: 'worker-a', fencingToken: '1' };
const options = () => ({ chainId: 84532, coreAddress: CORE, blockNumber: 100, leader, isCurrent: () => true });
const listing = (tokenId = '1', active = false) => ({ tokenId, seller: SELLER, price: '1000000000000001', active });
const docker = (...args) => execFileSync('docker', args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, windowsHide: true
}).trim();
let available = false;
try { available = docker('version', '--format', '{{.Server.Os}}') === 'linux'; } catch {}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('resale state observations are pinned to one canonical block hash', async () => {
    const iface = new Interface(['function resaleListings(uint256) view returns(address seller,uint256 price,bool active)']);
    const calls = [];
    const provider = { async send(method, params) {
        calls.push({ method, params });
        if (method === 'eth_chainId') return '0x14a34';
        if (method === 'eth_getBlockByNumber') return { hash: HASH };
        assert.equal(method, 'eth_call');
        assert.deepEqual(params[1], { blockHash: HASH, requireCanonical: true });
        return iface.encodeFunctionResult('resaleListings', [SELLER, 1000000000000001n, false]);
    } };
    const listener = { _readRpcCall: operation => operation(provider) };
    const result = await readResaleStateAtBlock(listener, {
        chainId: 84532, coreAddress: CORE, blockNumber: 100, blockHash: HASH, tokenIds: ['1']
    });
    assert.deepEqual(result, [listing()]);
    assert.equal(calls.filter(call => call.method === 'eth_getBlockByNumber').length, 2);
    assert.ok(calls.every(call => !JSON.stringify(call.params).includes('latest')));

    provider.send = async method => method === 'eth_chainId' ? '0x1' : { hash: HASH };
    await assert.rejects(readResaleStateAtBlock(listener, {
        chainId: 84532, coreAddress: CORE, blockNumber: 100, blockHash: HASH, tokenIds: ['1']
    }), /chain mismatch/);
    provider.send = async method => method === 'eth_chainId' ? '0x14a34' : { hash: OTHER_HASH };
    await assert.rejects(readResaleStateAtBlock(listener, {
        chainId: 84532, coreAddress: CORE, blockNumber: 100, blockHash: HASH, tokenIds: ['1']
    }), /canonical block changed/);
    let headerReads = 0;
    provider.send = async method => {
        if (method === 'eth_chainId') return '0x14a34';
        if (method === 'eth_call') return iface.encodeFunctionResult('resaleListings', [SELLER, 1n, false]);
        return { hash: ++headerReads === 1 ? HASH : OTHER_HASH };
    };
    await assert.rejects(readResaleStateAtBlock(listener, {
        chainId: 84532, coreAddress: CORE, blockNumber: 100, blockHash: HASH, tokenIds: ['1']
    }), /canonical block changed/);
});

test('resale reconciliation SQL fences stale observations in disposable PostgreSQL', {
    skip: available ? false : 'Disposable PostgreSQL requires Docker', timeout: 60000
}, async t => {
    const container = `artsoul-resale-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    let pool, created = false;
    t.after(async () => { await pool?.end(); if (created) docker('rm', '-f', container); });
    docker('run', '-d', '--name', container, '-e', 'POSTGRES_PASSWORD=local-resale-fixture',
        '-e', 'POSTGRES_DB=artsoul', '-p', '127.0.0.1::5432', 'postgres:17');
    created = true;
    const endpoint = docker('port', container, '5432/tcp');
    assert.match(endpoint, /^127\.0\.0\.1:\d+$/);
    pool = new pg.Pool({ host: '127.0.0.1', port: Number(endpoint.split(':')[1]),
        database: 'artsoul', user: 'postgres', password: 'local-resale-fixture', connectionTimeoutMillis: 1000 });
    pool.on('error', () => {});
    for (let attempt = 0; ; attempt++) {
        try { await pool.query('SELECT 1'); await delay(100); await pool.query('SELECT 1'); break; }
        catch (error) { if (attempt >= 80) throw error; await delay(250); }
    }
    const db = { query: async (sql, values) => (await pool.query(sql, values)).rows };
    await pool.query(`CREATE TABLE indexer_state(chain_id NUMERIC PRIMARY KEY,contract_address TEXT,last_indexed_block BIGINT,last_confirmed_block BIGINT);
        CREATE TABLE block_hashes(chain_id NUMERIC,block_number BIGINT,block_hash TEXT,PRIMARY KEY(chain_id,block_number));
        CREATE TABLE distributed_locks(lock_name TEXT PRIMARY KEY,instance_id TEXT,fencing_token BIGINT,expires_at TIMESTAMPTZ);
        CREATE TABLE v41_resale_listings(chain_id NUMERIC,token_id NUMERIC(78,0),seller TEXT,price NUMERIC(78,0),active BOOLEAN,
            block_number BIGINT,transaction_hash TEXT,log_index INTEGER,indexed_at TIMESTAMPTZ,last_updated_block BIGINT,last_updated_at TIMESTAMPTZ,
            PRIMARY KEY(chain_id,token_id));`);
    const addRow = async (id = '1', active = true) => db.query(`INSERT INTO v41_resale_listings VALUES
        (84532,$1,$2,1000000000000001,$3,50,$4,7,'2026-01-01',50,'2026-01-01')`, [id, SELLER, active, TX]);
    const reset = async () => {
        await pool.query('TRUNCATE indexer_state,block_hashes,distributed_locks,v41_resale_listings');
        await db.query('INSERT INTO indexer_state VALUES(84532,$1,100,100)', [CORE]);
        await db.query('INSERT INTO block_hashes VALUES(84532,100,$1)', [HASH]);
        await db.query("INSERT INTO distributed_locks VALUES($1,$2,1,clock_timestamp()+INTERVAL '1 hour')", [leader.lockName, leader.instanceId]);
        await addRow();
    };
    const row = async () => (await db.query('SELECT *,xmin::TEXT revision FROM v41_resale_listings WHERE token_id=1'))[0];

    await t.test('eventless cancellation updates public state and preserves event provenance', async () => {
        await reset(); const before = await row();
        const result = await reconcileResaleState(db, options(), async snapshot => {
            assert.equal(snapshot.blockHash, HASH); return [listing()];
        });
        const after = await row();
        assert.equal(result.updated, 1); assert.equal(after.active, false);
        assert.equal(after.last_updated_block, '100');
        for (const field of ['block_number', 'transaction_hash', 'log_index', 'indexed_at']) {
            assert.deepEqual(after[field], before[field]);
        }
        const unchanged = await reconcileResaleState(db, options(), async () => [listing()]);
        assert.equal(unchanged.updated, 0); assert.equal((await row()).revision, after.revision);
    });

    await t.test('inactive rows recover an orphaned cancellation and stale repricing', async () => {
        await reset(); await db.query('UPDATE v41_resale_listings SET active=false,seller=$1,price=123,last_updated_block=95', [OTHER]);
        await reconcileResaleState(db, options(), async () => [listing('1', true)]);
        const after = await row();
        assert.equal(after.active, true); assert.equal(after.seller, SELLER); assert.equal(after.price, '1000000000000001');
    });

    await t.test('a newer listing or delete/reinsert rejects the old xmin even with identical values', async () => {
        for (const replace of [false, true]) {
            await reset();
            const result = await reconcileResaleState(db, options(), async () => {
                if (replace) { await db.query('DELETE FROM v41_resale_listings'); await addRow(); }
                else await db.query('UPDATE v41_resale_listings SET price=2000000000000001');
                return [listing()];
            });
            assert.equal(result.updated, 0); assert.equal((await row()).active, true);
        }
    });

    await t.test('boundary movement, reorg and expired or replaced leadership fence writes', async () => {
        const mutations = [
            ['UPDATE indexer_state SET last_indexed_block=101', []],
            ['UPDATE indexer_state SET last_confirmed_block=99', []],
            ['UPDATE block_hashes SET block_hash=$1', [OTHER_HASH]],
            ['UPDATE distributed_locks SET fencing_token=2', []],
            ["UPDATE distributed_locks SET expires_at=clock_timestamp()-INTERVAL '1 second'", []]
        ];
        for (const [sql, args] of mutations) {
            await reset();
            const result = await reconcileResaleState(db, options(), async () => {
                await db.query(sql, args); return [listing()];
            });
            assert.equal(result.updated, 0, sql); assert.equal((await row()).active, true);
        }
    });

    await t.test('RPC failure, partial snapshots and loss of leadership preserve existing state', async () => {
        await reset();
        await assert.rejects(reconcileResaleState(db, options(), async () => { throw new Error('RPC unavailable'); }), /RPC unavailable/);
        await assert.rejects(reconcileResaleState(db, options(), async () => []), /Invalid confirmed/);
        let current = true;
        await reconcileResaleState(db, { ...options(), isCurrent: () => current }, async () => { current = false; return [listing()]; });
        assert.equal((await row()).active, true);
    });

    await t.test('future rows wait for catch-up and a missing indexed boundary never triggers RPC', async () => {
        await reset(); await db.query('UPDATE v41_resale_listings SET last_updated_block=101');
        const failRead = () => { throw new Error('unexpected read'); };
        assert.equal((await reconcileResaleState(db, options(), failRead)).checked, 0);
        await db.query('DELETE FROM block_hashes');
        await assert.rejects(reconcileResaleState(db, options(), failRead), /boundary unavailable/);
    });

    await t.test('bounded sweeps include inactive rows, retain a high-water mark and restart safely', async () => {
        await reset(); for (let id = 2; id <= 10; id++) await addRow(String(id), id % 2 === 0);
        const seen = [];
        const read = async snapshot => { seen.push(snapshot.tokenIds); return snapshot.tokenIds.map(id => listing(id)); };
        const first = await reconcileResaleState(db, options(), read);
        assert.equal(first.checked, 8); assert.equal(first.cursor, '8'); assert.equal(first.sweepEnd, '10');
        await addRow('11');
        const second = await reconcileResaleState(db, { ...options(), cursor: first.cursor, sweepEnd: first.sweepEnd }, read);
        assert.deepEqual(seen[1], ['9', '10']); assert.equal(second.cursor, '0');
        const restart = await reconcileResaleState(db, options(), read);
        assert.equal(restart.cursor, '8'); assert.equal(restart.sweepEnd, '11');
        assert.equal(restart.updated, 0, 'rechecking after restart must not churn unchanged rows');
    });
});

test('the runner serializes reconciliation with catch-up and reorg checks', async () => {
    const { default: ProductionIndexer } = await import('../src/indexer/production-runner.js');
    const runner = Object.create(ProductionIndexer.prototype);
    let release, starts = 0, reorgChecks = 0;
    const held = new Promise(resolve => { release = resolve; });
    Object.assign(runner, { isLeader: true, isRunning: true, lastReorgCheckAt: 0, reorgCheckInterval: 1,
        syncEngine: { async _purgeRecoveryCache() { return false; }, async detectReorg() { reorgChecks++; return false; } },
        async _catchUpToSafeBlock() { starts++; return { currentBlock: 103, safeBlock: 100 }; },
        async _processConfirmations() {}, async _refreshResaleState() { await held; }, _refreshSearchMetadata() {} });
    const first = runner._runConfirmationPoll();
    await Promise.resolve(); await Promise.resolve();
    const second = runner._runConfirmationPoll();
    assert.equal(first, second); assert.equal(starts, 1); assert.equal(reorgChecks, 1);
    release(); await first; assert.equal(runner.confirmationInFlight, null);
    runner.syncEngine.detectReorg = async () => true;
    runner.lastReorgCheckAt = 0; runner.resaleCursor = '8'; runner.resaleSweepEnd = '11';
    await runner._runConfirmationPoll();
    assert.equal(runner.resaleCursor, '0'); assert.equal(runner.resaleSweepEnd, null); assert.equal(starts, 1);
});

test('the runner preserves failed reconciliation batches and continues event catch-up', async t => {
    const { default: ProductionIndexer } = await import('../src/indexer/production-runner.js');
    const runner = Object.create(ProductionIndexer.prototype);
    let catchUps = 0, messages = 0;
    t.mock.method(console, 'warn', () => { messages++; });
    Object.assign(runner, { config: { chainId: 84532, contractAddress: CORE },
        isLeader: true, isRunning: true, resaleCursor: '8', resaleSweepEnd: '11',
        lastReorgCheckAt: Date.now(), reorgCheckInterval: 60000,
        syncEngine: { async _purgeRecoveryCache() { return false; } },
        distributedLock: { ...leader, getFencingToken: () => '1', isLeaderInstance: () => true },
        db: { async query() { throw new Error('database unavailable'); } },
        async _catchUpToSafeBlock() { catchUps++; return { currentBlock: 103, safeBlock: 100 }; },
        async _processConfirmations() {}, _refreshSearchMetadata() {} });
    await runner._runConfirmationPoll(); await runner._runConfirmationPoll();
    assert.equal(catchUps, 2); assert.equal(messages, 2);
    assert.equal(runner.resaleCursor, '8'); assert.equal(runner.resaleSweepEnd, '11');
    assert.equal(runner.resaleReconciliationError, 'Confirmed resale state refresh failed');
    runner.db.healthCheck = async () => ({ healthy: true });
    runner.syncEngine = { async _purgeRecoveryCache() { return false; },
        async getIndexerState() { return { last_indexed_block: 100, started_at: new Date().toISOString() }; },
        async getUnresolvedErrors() { return []; }, async getEventFailureCounts() { return { failed: 0, dead: 0 }; } };
    runner.eventListener = { async getCurrentBlock() { return 103; }, getRpcHealth() { return []; } };
    const health = await runner.getHealth();
    assert.equal(health.status, 'degraded');
    assert.equal(health.indexer.resaleReconciliationError, runner.resaleReconciliationError);
    runner._catchUpToSafeBlock = async () => undefined;
    await runner._runConfirmationPoll(); assert.equal(messages, 2, 'failed catch-up must skip reconciliation');
});
