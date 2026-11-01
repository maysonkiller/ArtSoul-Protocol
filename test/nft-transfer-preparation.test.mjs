import assert from 'node:assert/strict';
import test from 'node:test';
import { Interface, keccak256 } from 'ethers';
import { captureWriteContext, withWriteContext } from '../src/indexer/write-fence.js';
import { prepareNftTransferRange, prepareCoordinatedNftTransferRange,
    commitPreparedNftTransferRange, syncNftTransferRange } from '../src/indexer/nft-transfer-sync.js';

const address = n => `0x${n.toString(16).padStart(40, '0')}`;
const hash = n => `0x${n.toString(16).padStart(64, '0')}`;
const hex = n => `0x${n.toString(16)}`;
const CORE = address(1), NFT = address(2), CODE = ['0x6001600055', '0x6002600055'];
const abi = new Interface(['function nftContract() view returns(address)', 'function totalSupply() view returns(uint256)',
    'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)']);
const coverageColumns = ['chain_id','core_address','nft_address','from_block','origin_block_hash',
    'covered_through','covered_hash','core_code_hash','nft_code_hash'];
const log = block => ({ ...abi.encodeEventLog('Transfer', [address(3), address(4), 7n]),
    address: NFT, blockNumber: hex(block), logIndex: '0x1', blockHash: hash(block),
    transactionHash: hash(block * 100), transactionIndex: '0x0', removed: false });

// A transactional in-memory adapter exercises the real preparation, range
// proof and write fence. SQL execution/locking is covered by the existing PG suite.
function fixture() {
    const f = { active: true, lockAlive: true, rpc: [], sql: [], logs: [], journal: [], rotations: 0,
        headers: new Map([[115, hash(115)], [120, hash(120)]]) };
    f.state = { chain_id: '84532', contract_address: CORE, last_indexed_block: '115',
        revision: '1', recovery_cache_token: null };
    f.coverage = { chain_id: '84532', core_address: CORE, nft_address: NFT, from_block: '100',
        origin_block_hash: hash(99), covered_through: '115', covered_hash: hash(115),
        core_code_hash: keccak256(CODE[0]), nft_code_hash: keccak256(CODE[1]) };
    f.options = { chainId: 84532, coreAddress: CORE, nftAddress: NFT,
        expectedCoreCodeHash: f.coverage.core_code_hash, expectedNftCodeHash: f.coverage.nft_code_hash,
        fromBlock: 116, previousBlockHash: hash(115), blockNumber: 120, blockHash: hash(120),
        maxBlocks: 10, bootstrap: false };
    const provider = { async send(method, params) {
        f.rpc.push([method, params]);
        const override = await f.rpcHook?.(method, params);
        if (override !== undefined) return override;
        if (method === 'eth_chainId') return '0x14a34';
        if (method === 'eth_getBlockByNumber') return { number: params[0],
            hash: hash(Number(BigInt(params[0]))), timestamp: '0x64' };
        if (method === 'eth_getCode') {
            assert.equal(params[1].requireCanonical, true);
            return params[0] === CORE ? CODE[0] : CODE[1];
        }
        if (method === 'eth_call') {
            assert.equal(params[1].requireCanonical, true);
            const name = abi.parseTransaction(params[0]).name;
            return abi.encodeFunctionResult(name, [name === 'totalSupply' ? 0n : NFT]);
        }
        assert.equal(method, 'eth_getLogs');
        return f.logs;
    } };
    let backup;
    const query = async (sql, values = []) => {
        const text = sql.replace(/\s+/g, ' ').trim();
        f.sql.push(text);
        let rows = [], rowCount = 0;
        if (text.startsWith('BEGIN')) backup = structuredClone({ state: f.state, coverage: f.coverage,
            journal: f.journal, rotations: f.rotations });
        else if (text === 'ROLLBACK') Object.assign(f, backup);
        else if (text === 'COMMIT') backup = null;
        else if (text.includes('FROM public.distributed_locks')) rows = f.lockAlive ? [{ lock_name: 'fixture' }] : [];
        else if (text.startsWith('SELECT *, xmin::TEXT')) rows = [{ ...f.state }];
        else if (text.startsWith('SELECT block_hash')) rows = f.headers.has(values[1]) ? [{ block_hash: f.headers.get(values[1]) }] : [];
        else if (text.startsWith('SELECT chain_id,core_address')) rows = f.coverage ? [{ ...f.coverage }] : [];
        else if (text.startsWith('INSERT INTO public.contract_events')) {
            for (const row of JSON.parse(values[1])) if (!f.journal.some(e => e.transaction_hash === row.transaction_hash && e.log_index === row.log_index)) f.journal.push(row);
        } else if (text.startsWith('SELECT 1 FROM jsonb_to_recordset')) {
            rows = JSON.parse(values[1]).some(row => {
                const found = f.journal.find(e => e.transaction_hash === row.transaction_hash && e.log_index === row.log_index);
                return !found || Object.keys(row).some(key => JSON.stringify(row[key]) !== JSON.stringify(found[key]));
            }) ? [{}] : [];
        } else if (text.startsWith('SELECT 1 FROM public.contract_events')) {
            const records = JSON.parse(values[4]);
            rows = f.journal.some(row => row.contract_address === values[1] && row.block_number >= values[2] && row.block_number <= values[3] &&
                !records.some(e => e.transaction_hash === row.transaction_hash && e.log_index === row.log_index)) ? [{}] : [];
        } else if (text.startsWith('UPDATE public.indexer_state')) {
            f.state.revision = String(Number(f.state.revision) + 1);
            if (text.includes('gen_random_uuid()')) { f.state.recovery_cache_token = `purge-${++f.rotations}`; f.coverage = null; }
        } else if (text.startsWith('INSERT INTO public.nft_transfer_coverage')) {
            assert.equal(f.coverage, null);
            f.coverage = Object.fromEntries(coverageColumns.map((key, index) => [key, values[index]])); rowCount = 1;
        } else if (text.startsWith('UPDATE public.nft_transfer_coverage')) {
            if (f.coverage) { f.coverage.covered_through = values[3]; f.coverage.covered_hash = values[4]; rowCount = 1; }
        } else assert.fail(`Unexpected fixture SQL: ${text}`);
        await f.sqlHook?.(text);
        return { rows, rowCount };
    };
    f.client = { query, release() {} };
    f.engine = { chainId: 84532, _chainIdString: () => '84532',
        getRecoveryAuthority: () => ({ lockName: 'fixture', instanceId: 'leader', fencingToken: '1', isCurrent: () => f.active }),
        getIndexerState: async () => ({ ...f.state }),
        eventListener: { chainId: 84532, contractAddress: CORE, nftAddress: NFT,
            _readRpcCall: callback => callback(provider) },
        db: { query: async (...args) => (await query(...args)).rows, pool: { connect: async () => f.client } } };
    f.prepare = () => prepareCoordinatedNftTransferRange(f.engine, f.options);
    f.commit = (prepared, options) => withWriteContext(f.engine.db, prepared.context,
        client => commitPreparedNftTransferRange(client, prepared, options));
    f.snapshot = () => structuredClone({ state: f.state, coverage: f.coverage, journal: f.journal, rotations: f.rotations });
    return f;
}

test('coordinated preparation is read-only and deeply immutable, using the supplied generation', async () => {
    const f = fixture(); f.logs = [log(118)];
    const context = await captureWriteContext(f.engine);
    const prepared = await prepareCoordinatedNftTransferRange(f.engine, f.options, context);
    assert.equal(prepared.context.revision, context.revision);
    assert.equal(prepared.batch.blockNumber, 120); assert.equal(prepared.batch.events.length, 1);
    for (const value of [prepared, prepared.context, prepared.context.authority, prepared.batch,
        prepared.batch.events, prepared.batch.events[0], prepared.batch.events[0].eventData]) assert.ok(Object.isFrozen(value));
    assert.equal(f.sql.some(sql => !sql.startsWith('SELECT')), false);
    f.options.blockHash = hash(999);
    assert.equal((await f.commit(prepared)).throughBlock, 120);
});

for (const [name, change] of [
    ['bootstrap', f => { f.options.bootstrap = true; }],
    ['skipped block', f => { f.options.fromBlock++; }],
    ['overlap', f => { f.options.fromBlock--; }],
    ['nonadvancing endpoint', f => { f.options.blockNumber = 115; }],
    ['pending cache', f => { f.state.recovery_cache_token = 'pending'; }],
    ['missing cache schema', f => { delete f.state.recovery_cache_token; }],
    ['missing coverage', f => { f.coverage = null; }],
    ['partial coverage', f => { f.coverage.covered_through = '114'; }],
    ['origin-only coverage', f => { f.coverage.from_block = '116'; }],
    ['different Core code', f => { f.coverage.core_code_hash = hash(8); }],
    ['different NFT code', f => { f.coverage.nft_code_hash = hash(8); }],
    ['missing retained predecessor', f => { f.headers.delete(115); }],
    ['wrong retained predecessor', f => { f.headers.set(115, hash(8)); }],
    ['mismatched covered hash', f => { f.coverage.covered_hash = hash(8); }],
    ['range exceeds caller bound', f => { f.options.maxBlocks = 4; }],
    ['unbounded range', f => { f.options.maxBlocks = Infinity; }]
]) test(`coordinated ${name} is rejected before RPC or mutation`, async () => {
    const f = fixture(); change(f); const before = f.snapshot();
    await assert.rejects(f.prepare()); assert.deepEqual(f.rpc, []); assert.deepEqual(f.snapshot(), before);
});

test('normal preparation still rejects a future Core endpoint', async () => {
    const f = fixture(); await assert.rejects(prepareNftTransferRange(f.engine, f.options)); assert.deepEqual(f.rpc, []);
});

test('coordinated empty ranges advance coverage without a new purge obligation', async () => {
    const f = fixture(), prepared = await f.prepare();
    const result = await f.commit(prepared, { coreRangeEmpty: true });
    assert.equal(result.cacheInvalidationPending, false); assert.equal(f.rotations, 0);
    assert.equal(f.coverage.covered_through, 120); assert.equal(f.coverage.from_block, '100');
    assert.equal(f.state.last_indexed_block, '115', 'Core checkpoint remains the transaction owner responsibility');
    assert.equal(f.state.revision, '2'); assert.deepEqual(f.journal, []);
});
for (const [name, coreRangeEmpty, hasTransfer] of [['unknown Core contents', undefined, false],
    ['Core event', false, false], ['NFT transfer', true, true]]) {
    test(`coordinated ${name} retains durable invalidation`, async () => {
        const f = fixture(); if (hasTransfer) f.logs = [log(118)];
        const result = await f.commit(await f.prepare(), { coreRangeEmpty });
        assert.equal(result.cacheInvalidationPending, true); assert.equal(f.rotations, 1);
        assert.equal(f.coverage.origin_block_hash, hash(99)); assert.equal(f.coverage.covered_through, 120);
        assert.equal(f.journal.length, hasTransfer ? 1 : 0);
    });
}

for (const [name, change] of [
    ['missing new endpoint', f => { f.headers.delete(120); }],
    ['wrong new endpoint', f => { f.headers.set(120, hash(8)); }],
    ['changed predecessor', f => { f.headers.set(115, hash(8)); }],
    ['changed coverage', f => { f.coverage.origin_block_hash = hash(8); }],
    ['recovery invalidated coverage', f => { f.coverage = null; }],
    ['state revision changed', f => { f.state.revision = '2'; }],
    ['state deployment changed', f => { f.state.contract_address = address(8); }],
    ['local lease lost', f => { f.active = false; }],
    ['database lease lost', f => { f.lockAlive = false; }],
    ['listener replaced', f => { f.engine.eventListener = { ...f.engine.eventListener }; }],
    ['listener chain changed', f => { f.engine.eventListener.chainId = 1; }],
    ['listener NFT changed', f => { f.engine.eventListener.nftAddress = address(8); }]
]) test(`prepared ${name} cannot write a range`, async () => {
    const f = fixture(), prepared = await f.prepare(); change(f); const before = f.snapshot();
    await assert.rejects(f.commit(prepared, { coreRangeEmpty: true })); assert.deepEqual(f.snapshot(), before);
});

test('a future endpoint may be retained by the Core transaction after preparation', async () => {
    const f = fixture(); f.headers.delete(120); const prepared = await f.prepare();
    f.headers.set(120, hash(120)); assert.equal((await f.commit(prepared, { coreRangeEmpty: true })).throughBlock, 120);
});

for (const failure of ['conflicting replay', 'extra journal event', 'authority lost after write']) {
    test(`${failure} rolls back the prepared journal and coverage together`, async () => {
        const f = fixture(); f.logs = [log(118)]; const prepared = await f.prepare();
        if (failure === 'conflicting replay') f.journal = [{ transaction_hash: hash(11800), log_index: 1, contract_address: address(8) }];
        if (failure === 'extra journal event') f.journal = [{ transaction_hash: hash(999), log_index: 2, contract_address: NFT, block_number: 119 }];
        if (failure === 'authority lost after write') f.sqlHook = sql => { if (sql.startsWith('INSERT INTO public.nft_transfer_coverage')) f.active = false; };
        const before = f.snapshot(); await assert.rejects(f.commit(prepared)); assert.deepEqual(f.snapshot(), before);
    });
}

test('prepared metadata cannot be forged or changed to bypass invalidation', async () => {
    const f = fixture(), prepared = await f.prepare();
    await assert.rejects(f.commit({ ...prepared }, { coreRangeEmpty: true }), /not prepared/);
    await assert.rejects(f.commit(prepared, { coreRangeEmpty: 'true' }), /cache policy/);
    assert.equal(f.coverage.covered_through, '115');
});

test('a changed authority during RPC prevents preparation and all writes', async () => {
    const f = fixture(); f.rpcHook = method => { if (method === 'eth_getLogs') f.active = false; };
    await assert.rejects(f.prepare(), /authority changed/);
    assert.equal(f.sql.some(sql => !sql.startsWith('SELECT')), false);
});

function historical(f, terminal = true) {
    Object.assign(f.options, { fromBlock: 110, previousBlockHash: hash(109),
        blockNumber: terminal ? 115 : 114, blockHash: hash(terminal ? 115 : 114) });
    Object.assign(f.coverage, { covered_through: '109', covered_hash: hash(109) });
}

test('normal terminal wrapper preserves mandatory invalidation for an empty catch-up', async () => {
    const f = fixture(); historical(f);
    const result = await syncNftTransferRange(f.engine, f.options);
    assert.equal(result.cacheInvalidationPending, true); assert.equal(f.rotations, 1);
    assert.equal(f.coverage.covered_through, 115); assert.equal(f.state.last_indexed_block, '115');
});

for (const timing of ['before preparation', 'during RPC']) test(`normal terminal hash changed ${timing} still fails closed`, async () => {
    const f = fixture(); historical(f);
    if (timing === 'before preparation') f.headers.set(115, hash(8));
    else f.rpcHook = method => { if (method === 'eth_getLogs') f.headers.set(115, hash(8)); };
    const before = f.snapshot();
    await assert.rejects(syncNftTransferRange(f.engine, f.options), /checkpoint hash/);
    assert.deepEqual(f.snapshot(), before);
    if (timing === 'before preparation') assert.deepEqual(f.rpc, []);
});

test('normal historical empty range still needs no retained endpoint or purge', async () => {
    const f = fixture(); historical(f, false);
    const result = await syncNftTransferRange(f.engine, f.options);
    assert.equal(result.cacheInvalidationPending, false); assert.equal(f.rotations, 0);
    assert.equal(f.coverage.covered_through, 114);
});

test('normal bootstrap retains origin proof and durable invalidation', async () => {
    const f = fixture(); f.coverage = null;
    Object.assign(f.options, { fromBlock: 100, previousBlockHash: hash(99), blockNumber: 105,
        blockHash: hash(105), bootstrap: true });
    const result = await syncNftTransferRange(f.engine, f.options);
    assert.equal(result.cacheInvalidationPending, true); assert.equal(f.coverage.from_block, 100);
    assert.equal(f.coverage.origin_block_hash, hash(99));
    assert.ok(f.rpc.some(([method, params]) => method === 'eth_call' && abi.parseTransaction(params[0]).name === 'totalSupply'));
});

test('the normal preparation cannot opt into the coordinated empty-range exception', async () => {
    const f = fixture(); historical(f); const prepared = await prepareNftTransferRange(f.engine, f.options);
    await assert.rejects(f.commit(prepared, { coreRangeEmpty: true }), /cache policy/);
    assert.equal(f.coverage.covered_through, '109');
});
