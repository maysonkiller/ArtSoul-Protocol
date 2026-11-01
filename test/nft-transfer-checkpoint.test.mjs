import assert from 'node:assert/strict';
import test from 'node:test';
import { readNftTransferProgress, syncNftTransferCheckpoint } from '../src/indexer/nft-transfer-checkpoint.js';

const address = n => `0x${String(n).padStart(40, '0')}`;
const hash = n => `0x${String(n).padStart(64, '0')}`;
function fixture() {
    const f = { calls: [], active: true, rows: [] };
    f.config = Object.freeze({ chainId: 84532, coreAddress: address(1), nftAddress: address(2),
        expectedCoreCodeHash: hash(1), expectedNftCodeHash: hash(2), fromBlock: 100,
        previousBlockHash: hash(99), maxBlocks: 10 });
    f.state = { chain_id: '84532', contract_address: address(1), last_indexed_block: '115', revision: '1', recovery_cache_token: null };
    f.engine = { chainId: 84532, _chainIdString: () => '84532',
        getRecoveryAuthority: () => ({ lockName: 'fixture', instanceId: 'leader', fencingToken: '1', isCurrent: () => f.active }),
        getIndexerState: async () => ({ ...f.state }),
        db: { async query(sql, parameters) { assert.match(sql, /FROM public.indexer_state s LEFT JOIN public.nft_transfer_coverage/);
            assert.deepEqual(parameters, ['84532', address(1), address(2)]);
            return (f.rows.length ? f.rows : [{ covered_through: null }]).map(row => ({ ...row,
                state_block: f.state.last_indexed_block, state_revision: f.state.revision,
                state_cache_token: f.state.recovery_cache_token, ...f.databaseState })); } },
        eventListener: { chainId: 84532, contractAddress: address(1), async getBlock(number) {
            f.calls.push(['header', number]); await f.headerHook?.(); return f.header || { number, hash: hash(number) }; } },
        async _purgeRecoveryCache(authority) { assert.equal(authority.isCurrent(), true); f.calls.push(['purge']);
            if (f.purgeFailure) throw new Error('purge failed'); }
    };
    f.write = async (engine, options) => { assert.equal(engine, f.engine); f.calls.push(['write', options]);
        if (f.writeFailure) throw new Error('write failed'); return { throughBlock: options.blockNumber }; };
    f.cover = through => { f.rows = [{ from_block: '100', origin_block_hash: hash(99), covered_through: String(through),
        covered_hash: hash(through), retained_hash: hash(through), core_code_hash: hash(1), nft_code_hash: hash(2) }]; };
    f.run = () => syncNftTransferCheckpoint(f.engine, f.config, f.write);
    f.progress = () => readNftTransferProgress(f.engine, f.config, f.state);
    return f;
}

test('first range starts at reviewed origin, is bounded, then purges after write', async () => {
    const f = fixture(), result = await f.run();
    assert.equal(result.advanced, true);
    assert.deepEqual(f.calls.map(c => c[0]), ['header', 'write', 'purge']);
    assert.deepEqual(f.calls[1][1], { ...f.config, blockNumber: 109, blockHash: hash(109), bootstrap: true });
});
test('persisted coverage resumes with its predecessor and stops at Core cursor', async () => {
    const f = fixture(); f.cover(109); await f.run();
    assert.deepEqual(f.calls[1][1], { ...f.config, fromBlock: 110, previousBlockHash: hash(109),
        blockNumber: 115, blockHash: hash(115), bootstrap: false });
});
test('recovery invalidation restarts from origin instead of an in-memory cursor', async () => {
    const f = fixture(); f.cover(109); await f.run(); f.rows = []; f.calls = []; await f.run();
    assert.equal(f.calls[1][1].fromBlock, 100); assert.equal(f.calls[1][1].bootstrap, true);
});
test('caught-up history performs no RPC or write and reports exact readiness', async () => {
    const f = fixture(); f.cover(115);
    const result = await f.run(); assert.equal(result.advanced, false); assert.equal(result.progress.ready, true);
    assert.equal(result.progress.blocksBehind, 0); assert.deepEqual(f.calls, []);
});
test('a pending cache obligation is never reported ready even when history is complete', async () => {
    const f = fixture(); f.cover(115); f.state.recovery_cache_token = 'pending';
    const result = await f.progress(); assert.equal(result.ready, false); assert.equal(result.cacheReady, false);
});
test('Core before reviewed origin makes no NFT request and does not claim completeness', async () => {
    const f = fixture(); f.state.last_indexed_block = '98'; const result = await f.run();
    assert.equal(result.advanced, false); assert.equal(result.progress.ready, false); assert.deepEqual(f.calls, []);
});
for (const [key, value] of [['from_block','101'],['origin_block_hash',hash(5)],['covered_hash','invalid'],
    ['core_code_hash',hash(5)],['nft_code_hash',hash(5)],['covered_through','116'],['covered_through','99'],
    ['covered_through','115.0'],['covered_through','9007199254740992']]) {
    test(`invalid stored coverage ${key}=${value} fails before external reads`, async () => {
        const f = fixture(); f.cover(109); f.rows[0][key] = value; await assert.rejects(f.run()); assert.deepEqual(f.calls, []);
    });
}
for (const retained of [null, hash(987)]) test(`complete coverage with unmatched retained header ${retained} fails`, async () => {
    const f = fixture(); f.cover(115); f.rows[0].retained_hash = retained; await assert.rejects(f.progress());
});
test('partial historical endpoint need not be in the sparse Core header journal', async () => {
    const f = fixture(); f.cover(109); f.rows[0].retained_hash = null; await f.run(); assert.equal(f.calls[1][1].fromBlock, 110);
});
for (const key of ['chain_id','contract_address','last_indexed_block','recovery_cache_token']) {
    test(`missing Core field ${key} cannot claim coverage`, async () => {
        const f = fixture(); delete f.state[key]; await assert.rejects(f.run()); assert.deepEqual(f.calls, []);
    });
}
test('ambiguous coverage fails before RPC', async () => {
    const f = fixture(); f.cover(109); f.rows.push(f.rows[0]); await assert.rejects(f.run()); assert.deepEqual(f.calls, []);
});
test('leadership loss during endpoint read prevents writer admission', async () => {
    const f = fixture(); f.headerHook = () => { f.active = false; }; await assert.rejects(f.run(), /fence lost/);
    assert.deepEqual(f.calls, [['header',109]]);
});
for (const header of [{ number: 108, hash: hash(109) }, { number: 109, hash: hash(0) }, { number: null, hash: hash(109) }]) {
    test(`invalid endpoint ${JSON.stringify(header)} cannot reach writer`, async () => {
        const f = fixture(); f.header = header; await assert.rejects(f.run()); assert.equal(f.calls.length, 1);
    });
}
test('writer failure never acknowledges a purge', async () => {
    const f = fixture(); f.writeFailure = true; await assert.rejects(f.run(), /write failed/);
    assert.deepEqual(f.calls.map(c => c[0]), ['header','write']);
});
test('purge failure propagates after durable write; it is not a successful refresh', async () => {
    const f = fixture(); f.purgeFailure = true; await assert.rejects(f.run(), /purge failed/);
    assert.deepEqual(f.calls.map(c => c[0]), ['header','write','purge']);
});
for (const delta of [{ state_block: '116' }, { state_revision: '2' }, { state_cache_token: 'recovery' }]) {
    test(`a changed state boundary cannot report NFT history ready: ${JSON.stringify(delta)}`, async () => {
        const f = fixture(); f.cover(115); f.databaseState = delta;
        await assert.rejects(f.progress(), /state changed/); assert.deepEqual(f.calls, []);
    });
}
