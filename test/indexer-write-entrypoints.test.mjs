import assert from 'node:assert/strict';
import test from 'node:test';
import ArtSoulIndexer from '../src/indexer/index.js';
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
    await assert.rejects(indexer._initializeState(), /Invalid persisted deployment/);
    assert.equal(statements.length, 1);
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
