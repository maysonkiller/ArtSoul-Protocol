import assert from 'node:assert/strict';
import test from 'node:test';
import { Interface } from 'ethers';
import { prepareResaleRewind, lockResaleRewind } from '../src/indexer/reorg-resale.js';

const CHAIN = 84532;
const CORE = `0x${'1'.repeat(40)}`;
const SELLER = `0x${'2'.repeat(40)}`;
const hash = number => `0x${BigInt(number).toString(16).padStart(64, '0')}`;
const header = number => ({ number: `0x${number.toString(16)}`, hash: hash(number) });
const resaleInterface = new Interface(['function resaleListings(uint256) view returns(address seller,uint256 price,bool active)']);

function fixture({ heights = [109], chainId = CHAIN, indexed = 115, confirmed = indexed } = {}) {
    const state = { last_indexed_block: String(indexed), last_confirmed_block: String(confirmed),
        contract_address: CORE, revision: '7' };
    const stored = new Map(heights.map(number => [number, hash(number)]));
    const calls = [], rpc = [], visits = new Map(), listings = [];
    const value = { state, stored, calls, rpc, listings, current: true, rpcChain: chainId,
        readHeader: number => header(number) };
    const client = { async query(sql, params) {
        calls.push({ sql, params });
        const normalized = sql.replace(/\s+/g, ' ');
        if (normalized.includes('FROM public.indexer_state')) return { rows: [{ ...state }] };
        if (normalized.includes('FROM public.distributed_locks')) return { rows: [{ lock_name: 'ancestor-test' }] };
        if (normalized.includes('FROM public.v41_resale_listings')) return { rows: listings
            .filter(row => row.block_number < Number(params[1]) && row.last_updated_block >= Number(params[1]))
            .map(({ token_id, revision }) => ({ token_id, revision })) };
        if (normalized.includes('FROM public.block_hashes')) {
            assert.equal(String(params[0]), String(chainId));
            if (/block_number\s*<=/.test(normalized)) {
                const limit = normalized.match(/\bLIMIT\s+(\d+|\$\d+)/i)?.[1];
                assert.ok(limit, 'candidate reads must have an explicit limit');
                const count = Number(limit.startsWith('$') ? params[Number(limit.slice(1)) - 1] : limit);
                return { rows: [...stored].filter(([number]) => number <= Number(params[1]))
                    .sort(([a], [b]) => b - a).slice(0, count)
                    .map(([number, block_hash]) => ({ block_number: String(number), block_hash })) };
            }
            return { rows: stored.has(Number(params[1])) ? [{ block_hash: stored.get(Number(params[1])) }] : [] };
        }
        assert.fail(`Unexpected database operation: ${normalized}`);
    } };
    const listener = { chainId, contractAddress: CORE,
        async _readRpcCall(operation) { return operation({ async send(method, params) {
            rpc.push({ method, params });
            if (method === 'eth_chainId') return `0x${BigInt(value.rpcChain).toString(16)}`;
            if (method === 'eth_getBlockByNumber') {
                const number = Number(BigInt(params[0]));
                const visit = (visits.get(number) || 0) + 1;
                visits.set(number, visit);
                return value.readHeader(number, visit);
            }
            assert.equal(method, 'eth_call');
            assert.equal(params[0].to.toLowerCase(), CORE);
            assert.equal(params[1].requireCanonical, true);
            return resaleInterface.encodeFunctionResult('resaleListings', [SELLER, 2500n, true]);
        } }); }
    };
    Object.assign(value, { client, listener,
        prepare: (boundary = 110, expected = null) => prepareResaleRewind(client, String(chainId), boundary,
            listener, () => ({ lockName: 'ancestor-test', instanceId: 'worker', fencingToken: '1',
                isCurrent: () => value.current }), expected),
        headerReads: () => rpc.filter(call => call.method === 'eth_getBlockByNumber')
            .map(call => Number(BigInt(call.params[0]))) });
    return value;
}

test('sparse recovery uses the proven retained ancestor before querying resale observations', async () => {
    const value = fixture({ heights: [100, 105, 110, 115] });
    value.readHeader = number => ({ ...header(number), hash: hash(number >= 103 ? number + 10000 : number) });
    value.listings.push({ token_id: '7', revision: '1', block_number: 103, last_updated_block: 112 });
    const plan = await value.prepare();
    assert.equal(plan.rewindTo, 100);
    assert.equal(plan.boundary, 101);
    assert.equal(plan.confirmedTo, 100);
    assert.equal(plan.blockHash, hash(100));
    assert.deepEqual(plan.rows, [], 'a listing created after the ancestor belongs to rollback, not restoration');
    assert.deepEqual(value.headerReads(), [105, 100, 100]);
    assert.deepEqual(value.calls.filter(call => call.sql.includes('v41_resale_listings')).map(call => call.params[1]), [101]);
});

test('no-resale recovery proves and rechecks the exact retained predecessor', async () => {
    const value = fixture();
    const plan = await value.prepare();
    assert.equal(plan.rewindTo, 109);
    assert.equal(plan.blockHash, hash(109));
    assert.deepEqual(value.headerReads(), [109, 109]);
    assert.ok(value.rpc.some(call => call.method === 'eth_chainId'));
    await lockResaleRewind(value.client, plan);
    assert.ok(value.calls.some(call => call.sql.includes('block_hashes') && call.sql.includes('FOR SHARE')),
        'zero resale rows must still lock the stored ancestor proof');
});

test('missing exact predecessor falls back to an earlier matching retained header', async () => {
    const value = fixture({ heights: [100, 105, 115] });
    const plan = await value.prepare();
    assert.equal(plan.rewindTo, 105);
    assert.equal(plan.boundary, 106);
    assert.deepEqual(value.headerReads(), [105, 105]);
});

test('recovery never chooses a retained header beyond the captured indexed cursor', async () => {
    const value = fixture({ heights: [90, 99, 109], indexed: 99, confirmed: 90 });
    const plan = await value.prepare();
    assert.equal(plan.rewindTo, 99);
    assert.equal(plan.confirmedTo, 90);
    assert.deepEqual(value.headerReads(), [99, 99]);
});

test('historical no-resale proof accepts a matching positive chain without a Base-only gate', async () => {
    const value = fixture({ chainId: 11155111 });
    const plan = await value.prepare();
    assert.equal(plan.chainId, '11155111');
    assert.equal(plan.blockHash, hash(109));
    assert.deepEqual(value.headerReads(), [109, 109]);
});

for (const [name, result] of [
    ['missing', null], ['missing hash', { number: '0x6d' }],
    ['malformed hash', { number: '0x6d', hash: '0x1234' }],
    ['missing height', { hash: hash(109) }],
    ['wrong height', { number: '0x6c', hash: hash(109) }],
    ['malformed height', { number: 'invalid', hash: hash(109) }]
]) test(`${name} RPC header cannot establish a no-resale ancestor`, async () => {
    const value = fixture();
    value.readHeader = () => result;
    await assert.rejects(value.prepare(), /ancestor|header|boundary|block|BigInt/i);
    assert.equal(value.calls.some(call => call.sql.startsWith('BEGIN')), false);
    assert.equal(value.calls.some(call => call.sql.includes('FOR UPDATE')), false);
});

test('an unavailable RPC header propagates failure without entering the transaction', async () => {
    const value = fixture();
    const failure = new Error('fixture header unavailable');
    value.readHeader = () => { throw failure; };
    await assert.rejects(value.prepare(), error => error === failure);
    assert.equal(value.calls.some(call => call.sql.startsWith('BEGIN')), false);
});

for (const heights of [[], [100, 105, 109]]) test(`recovery rejects ${heights.length ? 'no matching' : 'no retained'} ancestor`, async () => {
    const value = fixture({ heights });
    value.readHeader = number => ({ ...header(number), hash: hash(number + 10000) });
    await assert.rejects(value.prepare(), /ancestor|boundary/i);
    assert.equal(value.calls.some(call => call.sql.includes('FOR UPDATE')), false);
});

test('candidate exhaustion stops at 64 retained headers instead of searching all history', async () => {
    const value = fixture({ heights: Array.from({ length: 65 }, (_, index) => 100 + index), indexed: 165 });
    value.readHeader = number => ({ ...header(number), hash: hash(number === 100 ? number : number + 10000) });
    await assert.rejects(value.prepare(165), /ancestor|boundary|budget/i);
    assert.equal(value.headerReads().length, 64);
    assert.equal(value.headerReads().includes(100), false, 'the matching 65th candidate exceeds the recovery budget');
    assert.equal(value.calls.filter(call => call.sql.includes('block_hashes')).length, 1);
});

test('the 64th retained candidate can establish the ancestor within budget', async () => {
    const value = fixture({ heights: Array.from({ length: 64 }, (_, index) => 100 + index), indexed: 165 });
    value.readHeader = number => ({ ...header(number), hash: hash(number === 100 ? number : number + 10000) });
    const plan = await value.prepare(165);
    assert.equal(plan.rewindTo, 100);
    assert.equal(value.headerReads().length, 65, 'the final proof recheck is separate from candidate search');
});

test('wrong RPC chain cannot establish an ancestor even when its header hash matches', async () => {
    const value = fixture();
    value.rpcChain = 1;
    await assert.rejects(value.prepare(), /chain mismatch|chain/i);
    assert.deepEqual(value.headerReads(), []);
});

for (const [name, alter] of [
    ['listener chain', value => { value.listener.chainId = 1; }],
    ['deployment', value => { value.listener.contractAddress = SELLER; }],
    ['malformed deployment', value => { value.listener.contractAddress = value.state.contract_address = 'fixture-core'; }]
]) test(`invalid ${name} aborts no-resale proof before RPC`, async () => {
    const value = fixture();
    alter(value);
    await assert.rejects(value.prepare(), /authority|deployment|chain/i);
    assert.equal(value.rpc.length, 0);
});

for (const chainId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) test(`invalid chain ${chainId} aborts before RPC`, async () => {
    const value = fixture({ chainId });
    await assert.rejects(value.prepare(), /authority|deployment|chain/i);
    assert.equal(value.rpc.length, 0);
});

test('an ancestor changed after selection fails the final no-resale recheck', async () => {
    const value = fixture();
    value.readHeader = (number, visit) => ({ ...header(number), hash: hash(visit === 1 ? number : number + 10000) });
    await assert.rejects(value.prepare(), /ancestor|canonical|boundary|changed/i);
    assert.deepEqual(value.headerReads(), [109, 109]);
    assert.equal(value.calls.some(call => call.sql.startsWith('BEGIN')), false);
});

test('the final ancestor check runs after the resale reader completes its own two checks', async () => {
    const value = fixture();
    value.listings.push({ token_id: '7', revision: '1', block_number: 100, last_updated_block: 112 });
    value.readHeader = (number, visit) => ({ ...header(number), hash: hash(visit < 4 ? number : number + 10000) });
    await assert.rejects(value.prepare(), /ancestor|canonical|boundary|changed/i);
    assert.equal(value.rpc.filter(call => call.method === 'eth_call').length, 1);
    assert.deepEqual(value.headerReads(), [109, 109, 109, 109]);
});

test('an original state snapshot that is stale aborts before ancestor RPC', async () => {
    const value = fixture();
    await assert.rejects(value.prepare(110, { ...value.state, chain_id: String(CHAIN), revision: '6' }), /snapshot is stale/);
    assert.equal(value.rpc.length, 0);
});

test('a same-cursor state revision change invalidates the prepared no-resale proof under lock', async () => {
    const value = fixture();
    const plan = await value.prepare();
    value.state.revision = '8';
    await assert.rejects(lockResaleRewind(value.client, plan), /preparation is stale/i);
});

for (const remove of [false, true]) test(`a stored ancestor ${remove ? 'deleted' : 'changed'} after preparation rejects the no-resale lock`, async () => {
    const value = fixture();
    const plan = await value.prepare();
    if (remove) value.stored.delete(109); else value.stored.set(109, hash(999));
    await assert.rejects(lockResaleRewind(value.client, plan), /boundary changed|ancestor/i);
});

test('leadership lost during ancestor RPC aborts no-resale preparation', async () => {
    const value = fixture();
    value.readHeader = number => { value.current = false; return header(number); };
    await assert.rejects(value.prepare(), /leadership changed/);
});

test('a malformed retained hash cannot be repaired by a valid RPC response', async () => {
    const value = fixture();
    value.stored.set(109, '0x1234');
    await assert.rejects(value.prepare(), /retained ancestor header/i);
    assert.equal(value.rpc.length, 0);
});

test('a chain change after the header read invalidates that proof', async () => {
    const value = fixture();
    value.readHeader = number => { value.rpcChain = 1; return header(number); };
    await assert.rejects(value.prepare(), /RPC chain changed/);
    assert.deepEqual(value.headerReads(), [109]);
    assert.equal(value.rpc.filter(call => call.method === 'eth_chainId').length, 2);
});

for (const field of ['chainId', 'contractAddress']) test(`a listener ${field} change during RPC invalidates preparation`, async () => {
    const value = fixture();
    value.readHeader = number => {
        value.listener[field] = field === 'chainId' ? 1 : SELLER;
        return header(number);
    };
    await assert.rejects(value.prepare(), /authority or deployment unavailable/);
    assert.equal(value.rpc.length, 2, 'the changed deployment cannot make another RPC call');
});

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

for (const fallback of [false, true]) for (const blockedSend of [1, 2, 3]) test(
    `an expired RPC callback paused at send ${blockedSend} stops ${fallback ? 'when fallback supersedes it' : 'after preparation rejects'}`,
    async () => {
        const value = fixture();
        const normalRead = value.listener._readRpcCall;
        const reached = deferred(), releaseLate = deferred(), fallbackStarted = deferred(), releaseFallback = deferred();
        const lateCalls = [];
        const reply = (method, params) => method === 'eth_chainId' ? '0x14a34' : header(Number(BigInt(params[0])));
        let lateOutcome, attempted = false;
        value.listener._readRpcCall = async operation => {
            if (attempted) return normalRead(operation);
            attempted = true;
            lateOutcome = operation({ async send(method, params) {
                lateCalls.push(method);
                if (lateCalls.length === blockedSend) { reached.resolve(); await releaseLate.promise; }
                return reply(method, params);
            } }).then(() => null, error => error);
            await reached.promise;
            if (!fallback) throw new Error('fixture expired read');
            const replacement = operation({ async send(method, params) {
                fallbackStarted.resolve();
                await releaseFallback.promise;
                return reply(method, params);
            } });
            await fallbackStarted.promise;
            releaseLate.resolve();
            assert.match((await lateOutcome)?.message || '', /read superseded/,
                'the old callback must stop while the replacement remains active');
            releaseFallback.resolve();
            return replacement;
        };
        if (fallback) {
            const plan = await value.prepare();
            assert.equal(plan.blockHash, hash(109));
            assert.equal(plan.rewindTo, 109);
        } else {
            await assert.rejects(value.prepare(), /fixture expired read/);
            releaseLate.resolve();
            assert.match((await lateOutcome)?.message || '', /read superseded/);
        }
        assert.equal(lateCalls.length, blockedSend, 'a stale callback cannot send its next request');
    }
);
