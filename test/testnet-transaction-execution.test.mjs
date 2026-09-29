import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { keccak256, toQuantity } from 'ethers';
import { executePlan, hashPlan } from '../scripts/testnet-transaction.mjs';

// No wallet keys, real vault, RPC network or signatures are used by this suite.
const sender = '0x0000000000000000000000000000000000000001';
const core = '0x0000000000000000000000000000000000000002';
const nft = '0x0000000000000000000000000000000000000003';
const other = '0x0000000000000000000000000000000000000004';
const excluded = '0x0000000000000000000000000000000000000005';
const blockHash = '0x' + 'b'.repeat(64);
const oldHash = '0x' + 'c'.repeat(64);
const code = '0x1234';
const signedBytes = '0xabcd';
const submittedHash = keccak256(signedBytes);
const start = Date.parse('2026-09-29T12:00:00Z');
const digest = hashPlan('execution-test-plan');

function receipt(overrides = {}) {
    return { transactionHash: submittedHash, from: sender, to: core, blockHash, blockNumber: '0x64',
        transactionIndex: '0x0', status: '0x1', gasUsed: '0x3e8', effectiveGasPrice: '0x2', l1Fee: '0x32', logs: [], ...overrides };
}

function harness(t, options = {}) {
    const tempRoot = fs.realpathSync(os.tmpdir());
    const vaultPath = fs.mkdtempSync(path.join(tempRoot, 'artsoul-runner-test-'));
    t.after(() => {
        assert.equal(path.dirname(fs.realpathSync(vaultPath)), tempRoot);
        assert.ok(path.basename(vaultPath).startsWith('artsoul-runner-test-'));
        fs.rmSync(vaultPath, { recursive: true, force: true });
    });
    const plan = { version: 1, id: 'test-withdraw', chainId: 84532, role: 'collector', from: sender,
        target: 'core', method: 'withdraw', args: [], valueWei: '0', expiresAt: new Date(start + 60_000).toISOString() };
    const policy = { version: 1, chainId: 84532, excludedAddresses: [excluded], approvedPlanHashes: [digest],
        contracts: { core: { address: core, codeHash: keccak256(code) }, nft: { address: nft, codeHash: keccak256(code) } },
        limits: { maxValueWei: '100000', maxGasLimit: '2000', maxGasPriceWei: '10', maxTotalReservedWei: '10000', l1ReserveWei: '100' } };
    const journal = path.join(vaultPath, 'transactions');
    const state = { now: start, signatures: [], broadcasts: [], writes: [], calls: [], waits: 0, nonce: 0n, receipts: new Map() };
    const save = (file, value, exclusive) => {
        state.writes.push({ file, value: structuredClone(value), exclusive });
        fs.writeFileSync(file, JSON.stringify(value), { flag: exclusive ? 'wx' : 'w' });
    };
    const rpcs = [0, 1].map(index => async (method, params = []) => {
        state.calls.push({ index, method, params });
        if (options.rpc) {
            const override = await options.rpc({ index, method, params, state });
            if (override !== undefined) return override;
        }
        switch (method) {
        case 'eth_chainId': return toQuantity(84532);
        case 'eth_blockNumber': return '0x64';
        case 'eth_getBlockByNumber': return { hash: blockHash, number: params[0] };
        case 'eth_getCode': return code;
        case 'eth_call': return '0x';
        case 'eth_estimateGas': return '0x3e8';
        case 'eth_gasPrice': return '0x2';
        case 'eth_getBalance': return '0x100000';
        case 'eth_getTransactionCount': return toQuantity(state.nonce);
        case 'eth_sendRawTransaction': {
            assert.equal(params[0], signedBytes);
            const record = JSON.parse(fs.readFileSync(path.join(journal, `${plan.id}.json`), 'utf8'));
            assert.equal(record.hash, submittedHash, 'the immutable journal must exist before RPC broadcast');
            state.broadcasts.push(params[0]);
            return submittedHash;
        }
        case 'eth_getTransactionReceipt': return state.receipts.has(params[0]) ? state.receipts.get(params[0]) : receipt();
        default: throw new Error(`UNEXPECTED_RPC_${method}`);
        }
    });
    const runtime = { rpcs, now: () => state.now, abi: () => ['function withdraw()'],
        wait: async () => { state.waits++; }, writeRecord: options.writeRecord ? (...args) => options.writeRecord(...args, { state, save }) : save,
        wallet: { address: sender, signTransaction: async transaction => {
            state.signatures.push(transaction);
            if (options.sign) await options.sign(state);
            return signedBytes;
        } } };
    return { plan, policy, state, journal, vaultPath, runtime,
        run: () => executePlan({ plan, policy, digest, vaultPath }, runtime),
        prior: (overrides = {}, receiptOverrides = {}) => {
            fs.mkdirSync(journal, { recursive: true });
            const record = { version: 1, chainId: 84532, id: 'previous-plan', sender, to: core, nonce: 0,
                hash: oldHash, valueWei: '0', reservedWei: '2500', ...overrides };
            fs.writeFileSync(path.join(journal, `${record.id}.json`), JSON.stringify(record));
            state.receipts.set(record.hash, receipt({ transactionHash: record.hash, from: record.sender, to: record.to, ...receiptOverrides }));
            if (record.sender === sender) state.nonce = BigInt(record.nonce) + 1n;
            return record;
        } };
}

test('broadcast follows durable journal; two canonical matching receipts record actual gas and L1 cost', async t => {
    const h = harness(t);
    const result = await h.run();
    assert.equal(result.status, 'CONFIRMED');
    assert.equal(result.reservedWei, '2500');
    assert.equal(result.actualCostWei, '2050');
    assert.equal(result.blockHash, blockHash);
    assert.equal(h.state.signatures.length, 1);
    assert.equal(h.state.broadcasts.length, 1);
    assert.equal(h.state.writes.length, 2);
    assert.ok(h.state.writes.every(write => write.exclusive));
    const original = JSON.parse(fs.readFileSync(path.join(h.journal, `${h.plan.id}.json`)));
    assert.equal(original.status, 'SIGNED_NOT_CONFIRMED');
    assert.equal(original.valueWei, '0');
    assert.equal(original.to, core);
    for (const index of [0, 1]) {
        assert.equal(h.state.calls.filter(call => call.index === index && call.method === 'eth_getTransactionReceipt').length, 1);
        assert.equal(h.state.calls.filter(call => call.index === index && call.method === 'eth_getBlockByNumber').length, 2);
    }
    assert.equal(fs.existsSync(path.join(h.journal, '.operator.lock')), false);
    await assert.rejects(h.run(), /OPERATION_ALREADY_RECORDED/);
    assert.equal(h.state.broadcasts.length, 1);
});

test('journal failure, including asynchronous failure, prevents broadcast', async t => {
    const h = harness(t, { writeRecord: async () => { throw new Error('TEST_DISK_FULL'); } });
    await assert.rejects(h.run(), /TEST_DISK_FULL/);
    assert.equal(h.state.signatures.length, 1);
    assert.equal(h.state.broadcasts.length, 0);
    assert.equal(fs.existsSync(path.join(h.journal, '.operator.lock')), false);
});

test('expiry during RPC work stops before signing', async t => {
    const h = harness(t, { rpc: ({ method, state }) => { if (method === 'eth_getBalance') state.now += 60_001; } });
    await assert.rejects(h.run(), /PLAN_EXPIRED/);
    assert.equal(h.state.signatures.length, 0);
    assert.equal(h.state.writes.length, 0);
    assert.equal(h.state.broadcasts.length, 0);
});

test('expiry during signing or durable journal write stops before broadcast', async t => {
    for (const boundary of ['sign', 'write']) await t.test(boundary, async st => {
        const h = harness(st, boundary === 'sign' ? { sign: state => { state.now += 60_001; } } : {
            writeRecord: (file, value, exclusive, { state, save }) => { save(file, value, exclusive); state.now += 60_001; }
        });
        await assert.rejects(h.run(), /PLAN_EXPIRED/);
        assert.equal(h.state.signatures.length, 1);
        assert.equal(h.state.broadcasts.length, 0);
        assert.equal(h.state.writes.length, 1, 'signed hash stays fenced even if expiry prevents sending');
    });
});

test('campaign budget includes verified actual costs for prior operations by every role', async t => {
    const h = harness(t);
    h.prior({ sender: other });
    h.policy.limits.maxTotalReservedWei = '4549'; // 2050 already spent + 2500 reserved.
    await assert.rejects(h.run(), /CAMPAIGN_BUDGET/);
    assert.equal(h.state.signatures.length, 0);
    h.policy.limits.maxTotalReservedWei = '4550';
    assert.equal((await h.run()).status, 'CONFIRMED');
});

test('prior successful value is spent, while a reverted value is not; fees are spent in either case', async t => {
    for (const status of ['0x0', '0x1']) await t.test(status, async st => {
        const h = harness(st);
        h.prior({ sender: other, valueWei: '500', reservedWei: '3000' }, { status });
        h.policy.limits.maxTotalReservedWei = '5000';
        if (status === '0x1') {
            await assert.rejects(h.run(), /CAMPAIGN_BUDGET/);
            assert.equal(h.state.signatures.length, 0);
        } else assert.equal((await h.run()).status, 'CONFIRMED');
    });
});

test('a prior fee reservation overrun by another role blocks all new signing', async t => {
    const h = harness(t);
    h.prior({ sender: other }, { l1Fee: '0x1f5' }); // 2000 gas + 501 L1 > 2500 reserved.
    await assert.rejects(h.run(), /ACTUAL_COST_EXCEEDS_RESERVE/);
    assert.equal(h.state.signatures.length, 0);
    assert.equal(h.state.broadcasts.length, 0);
});

test('current fee overrun retains the receipt before stopping and blocks the next plan', async t => {
    const h = harness(t);
    h.state.receipts.set(submittedHash, receipt({ l1Fee: '0x1f5' }));
    await assert.rejects(h.run(), /ACTUAL_COST_EXCEEDS_RESERVE/);
    const saved = JSON.parse(fs.readFileSync(path.join(h.journal, `${h.plan.id}.receipt`)));
    assert.equal(saved.actualCostWei, '2501');
    h.plan.id = 'next-plan';
    h.state.nonce = 1n;
    await assert.rejects(h.run(), /ACTUAL_COST_EXCEEDS_RESERVE/);
    assert.equal(h.state.signatures.length, 1);
    assert.equal(h.state.broadcasts.length, 1);
});

test('uncertain broadcast retains its hash and blocks a different next plan', async t => {
    const h = harness(t, { rpc: ({ method }) => {
        if (method === 'eth_sendRawTransaction') throw new Error('TEST_CONNECTION_LOST');
        if (method === 'eth_getTransactionReceipt') return null;
    } });
    await assert.rejects(h.run(), /TEST_CONNECTION_LOST/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(h.journal, `${h.plan.id}.json`))).hash, submittedHash);
    h.plan.id = 'different-plan';
    await assert.rejects(h.run(), /PRIOR_TRANSACTION_UNRESOLVED/);
    assert.equal(h.state.signatures.length, 1);
    assert.equal(h.state.calls.filter(call => call.method === 'eth_sendRawTransaction').length, 1);
});

test('one RPC lagging confirmation returns pending, then blocks subsequent signing', async t => {
    const h = harness(t, { rpc: ({ index, method }) => index === 1 && method === 'eth_getTransactionReceipt' ? null : undefined });
    const result = await h.run();
    assert.equal(result.status, 'SUBMITTED_CONFIRMATION_PENDING');
    assert.equal(h.state.waits, 20);
    assert.equal(fs.existsSync(path.join(h.journal, `${h.plan.id}.receipt`)), false);
    h.plan.id = 'next-after-lag';
    await assert.rejects(h.run(), /PRIOR_TRANSACTION_UNRESOLVED/);
    assert.equal(h.state.signatures.length, 1);
});

test('a receipt whose canonical block has not propagated waits without rebroadcasting', async t => {
    const h = harness(t, { rpc: ({ index, method, state }) => {
        if (index === 1 && method === 'eth_getBlockByNumber' && state.broadcasts.length && state.waits < 1) return null;
    } });
    assert.equal((await h.run()).status, 'CONFIRMED');
    assert.equal(h.state.waits, 1);
    assert.equal(h.state.broadcasts.length, 1);
    assert.equal(h.state.signatures.length, 1);
});

test('wrong receipt identity, costs, logs or noncanonical block cannot become confirmation', async t => {
    const cases = {
        transactionHash: { transactionHash: oldHash }, from: { from: other }, to: { to: nft },
        status: { status: '0x0' }, gasUsed: { gasUsed: '0x3e9' }, effectiveGasPrice: { effectiveGasPrice: '0x3' },
        l1Fee: { l1Fee: '0x33' }, missingL1: { l1Fee: undefined }, blockHash: { blockHash: oldHash },
        blockNumber: { blockNumber: '0x65' }, transactionIndex: { transactionIndex: '0x1' }, logs: { logs: [{ address: core }] }
    };
    for (const [name, overrides] of Object.entries(cases)) await t.test(name, async st => {
        const h = harness(st, { rpc: ({ index, method }) => index === 1 && method === 'eth_getTransactionReceipt' ? receipt(overrides) : undefined });
        await assert.rejects(h.run(), /RECEIPT_DISAGREEMENT/);
        assert.equal(fs.existsSync(path.join(h.journal, `${h.plan.id}.receipt`)), false);
    });
    await t.test('matching receipts on an orphan block', async st => {
        const h = harness(st);
        h.state.receipts.set(submittedHash, receipt({ blockHash: oldHash }));
        await assert.rejects(h.run(), /RECEIPT_DISAGREEMENT/);
        assert.equal(fs.existsSync(path.join(h.journal, `${h.plan.id}.receipt`)), false);
    });
});

test('additional operator fees fail closed instead of being omitted from the budget', async t => {
    const h = harness(t);
    h.state.receipts.set(submittedHash, receipt({ operatorFeeScalar: '0x1' }));
    await assert.rejects(h.run(), /UNSUPPORTED_RECEIPT_FEE/);
    assert.equal(fs.existsSync(path.join(h.journal, `${h.plan.id}.receipt`)), false);
});

test('receipt evidence write failure never removes the prebroadcast nonce fence', async t => {
    const h = harness(t, { writeRecord: async (file, value, exclusive, { save }) => {
        if (file.endsWith('.receipt')) throw new Error('TEST_RECEIPT_DISK_FULL');
        save(file, value, exclusive);
    } });
    await assert.rejects(h.run(), /TEST_RECEIPT_DISK_FULL/);
    assert.equal(h.state.broadcasts.length, 1);
    assert.equal(fs.existsSync(path.join(h.journal, `${h.plan.id}.json`)), true);
    await assert.rejects(h.run(), /OPERATION_ALREADY_RECORDED/);
    assert.equal(h.state.signatures.length, 1);
});

test('missing agreed reference blocks and unsafe nonce values stop before signing', async t => {
    for (const boundary of ['block', 'nonce']) await t.test(boundary, async st => {
        const h = harness(st, { rpc: ({ method }) => {
            if (boundary === 'block' && method === 'eth_getBlockByNumber') return null;
            if (boundary === 'nonce' && method === 'eth_getTransactionCount') return '0x20000000000000';
        } });
        await assert.rejects(h.run(), boundary === 'block' ? /RPC_BLOCK_DISAGREEMENT/ : /INVALID_NONCE/);
        assert.equal(h.state.signatures.length, 0);
    });
});

test('CLI stdin cannot override file-derived plan, policy, digest or test runtime', t => {
    const h = harness(t);
    const planFile = path.join(h.vaultPath, 'plan.json');
    const policyFile = path.join(h.vaultPath, 'policy.json');
    fs.writeFileSync(planFile, JSON.stringify(h.plan));
    fs.writeFileSync(policyFile, JSON.stringify(h.policy));
    const runner = fileURLToPath(new URL('../scripts/testnet-transaction.mjs', import.meta.url));
    for (const field of ['plan', 'policy', 'digest', 'runtime', 'rpcs', 'wallet']) {
        const child = spawnSync(process.execPath, [runner, planFile, policyFile], { encoding: 'utf8',
            input: JSON.stringify({ address: sender, vaultPath: h.vaultPath, privateKey: 'not-a-key', [field]: {} }) });
        assert.equal(child.status, 1, child.error?.message);
        assert.equal(child.stdout, '');
        assert.deepEqual(JSON.parse(child.stderr), { status: 'STOPPED', code: 'INVALID_INPUT' });
    }
    assert.equal(fs.existsSync(h.journal), false);
});

test('a BOM-prefixed transaction pipe still enforces stored-account identity before execution', t => {
    const h = harness(t);
    const planFile = path.join(h.vaultPath, 'plan.json');
    const policyFile = path.join(h.vaultPath, 'policy.json');
    fs.writeFileSync(planFile, JSON.stringify(h.plan));
    fs.writeFileSync(policyFile, JSON.stringify(h.policy));
    const runner = fileURLToPath(new URL('../scripts/testnet-transaction.mjs', import.meta.url));
    const child = spawnSync(process.execPath, [runner, planFile, policyFile], { encoding: 'utf8',
        input: '\uFEFF' + JSON.stringify({ address: other, privateKey: 'not-a-key', vaultPath: h.vaultPath }) });
    assert.equal(child.status, 1);
    assert.equal(child.stdout, '');
    assert.deepEqual(JSON.parse(child.stderr), { status: 'STOPPED', code: 'WRONG_STORED_ACCOUNT' });
    assert.equal(fs.existsSync(h.journal), false);
});
