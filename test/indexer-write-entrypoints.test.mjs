import assert from 'node:assert/strict';
import test from 'node:test';
import ArtSoulIndexer from '../src/indexer/index.js';
import IndexerSyncEngine from '../src/indexer/sync-engine.js';
import ProductionIndexer from '../src/indexer/production-runner.js';
import { captureWriteContext } from '../src/indexer/write-fence.js';

test('invalid cursor versions cannot authorize a range read', async () => {
    const authority = { lockName: 'fixture', instanceId: 'worker', fencingToken: '1', isCurrent: () => true };
    for (const cursor of [-1, 'invalid', '9007199254740993']) {
        const engine = { _chainIdString: () => '84532', eventListener: { contractAddress: '0xcore' },
            getIndexerState: async () => ({ chain_id: 84532, contract_address: '0xcore',
                revision: '1', last_indexed_block: cursor }) };
        await assert.rejects(captureWriteContext(engine, authority), { code: 'INDEXER_WRITE_FENCE_LOST' });
    }
});

test('read-only API cannot partially erase projections through the legacy rebuild route', async () => {
    let writes = 0;
    const indexer = Object.create(ArtSoulIndexer.prototype);
    indexer.db = { query: async () => { writes++; throw new Error('unexpected database access'); } };
    await assert.rejects(indexer.rebuildFromBlock(110), /read-only.*leadership-fenced recovery/);
    assert.equal(writes, 0);
});

test('initialization cannot relabel corrupt existing data as the configured deployment', async () => {
    const indexer = Object.create(ProductionIndexer.prototype);
    indexer.config = { chainId: 84532, contractAddress: `0x${'a'.repeat(40)}` };
    const statements = [];
    indexer.db = { async query(sql) {
        statements.push(sql);
        assert.match(sql, /^SELECT/);
        return [{ chain_id: 84532, contract_address: `0x${'0'.repeat(40)}`, last_indexed_block: 115 }];
    } };
    indexer.syncEngine = new IndexerSyncEngine(indexer.db, indexer.config);
    await assert.rejects(indexer._initializeState(), /Invalid persisted deployment/);
    assert.equal(statements.length, 1);
});

test('concurrent indexer bootstrap adopts a matching cursor and refuses a different Core', async () => {
    const core = '0x' + 'a'.repeat(40);
    for (const otherCore of [core.toUpperCase(), '0x' + 'b'.repeat(40)]) {
        const queries = [];
        const engine = new IndexerSyncEngine({ async query(sql, args) {
            queries.push(sql);
            if (queries.length === 1) return [];
            if (queries.length === 2) {
                assert.match(sql, /ON CONFLICT \(chain_id\) DO NOTHING RETURNING chain_id/);
                assert.deepEqual(args, [core, 84532, 122, 3]);
                return [];
            }
            assert.match(sql, /^SELECT/);
            return [{ chain_id: '84532', contract_address: otherCore, last_indexed_block: 456 }];
        } }, { contractAddress: core, chainId: 84532 });
        const init = engine.initialize(core, 84532, 123, 3);
        if (otherCore.toLowerCase() === core) assert.equal(await init, false);
        else await assert.rejects(init, /Invalid persisted deployment/);
        assert.equal(queries.length, 3);
    }
});

test('standalone startup validates the listener and stored Core before any RPC or historical range read', async () => {
    const core = '0x' + 'a'.repeat(40), previous = '0x' + 'b'.repeat(40);
    const indexer = Object.create(ArtSoulIndexer.prototype);
    indexer.config = { contractAddress: core, chainId: 84532, startBlock: 0 };
    indexer.chainId = 84532;
    indexer.eventListener = { ...indexer.config, getCurrentBlock() { assert.fail('Unexpected RPC read'); } };
    let reads = 0;
    indexer.syncEngine = new IndexerSyncEngine({ async query(sql) {
        assert.match(sql, /^SELECT/);
        reads++;
        return [{ chain_id: 84532, contract_address: previous }];
    } }, indexer.eventListener);
    await assert.rejects(indexer.start(), /Invalid persisted deployment/);
    indexer.eventListener.contractAddress = previous;
    await assert.rejects(indexer.start(), /listener deployment/);
    assert.equal(reads, 1);
});

test('zero and first-block bootstrap both start scanning after genesis', async () => {
    const core = '0x' + 'a'.repeat(40);
    for (const startBlock of [0, 1]) {
        const engine = new IndexerSyncEngine({ async query(sql, params) {
            if (sql.startsWith('SELECT')) return [];
            assert.deepEqual(params, [core, 84532, 0, 12]);
            return [{chain_id: '84532'}];
        } }, {contractAddress: core, chainId: 84532});
        assert.equal(await engine.initialize(core, 84532, startBlock), true);
    }
});

test('shutdown status authority retains lock epoch checks after work admission stops', () => {
    const indexer = Object.create(ProductionIndexer.prototype);
    let epoch = 2, token = '1', owned = true;
    indexer.isLeader = false;
    indexer.isRunning = false;
    indexer.isStopping = true;
    indexer.distributedLock = {
        lockName: 'fixture', instanceId: 'worker', get epoch() { return epoch; },
        getFencingToken: () => token, isLeaderInstance: () => owned
    };
    assert.equal(indexer._getRecoveryAuthority().isCurrent(), false);
    const stopping = indexer._getRecoveryAuthority({ allowStopping: true });
    assert.equal(stopping.isCurrent(), true);
    epoch++;
    assert.equal(stopping.isCurrent(), false, 'same token reacquisition cannot revive a stopped attempt');
    const reacquired = indexer._getRecoveryAuthority({ allowStopping: true });
    owned = false;
    assert.equal(reacquired.isCurrent(), false);
    owned = true;
    token = '2';
    assert.equal(reacquired.isCurrent(), false);
});
