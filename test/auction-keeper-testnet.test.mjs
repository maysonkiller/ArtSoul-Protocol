import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Interface, Transaction, Wallet, ZeroAddress, encryptKeystoreJsonSync, getAddress, id, keccak256, toBeHex } from 'ethers';
import { openTestnetSubmitter } from '../scripts/auction-keeper-testnet.mjs';

const api = new Interface([
    'function protocolTreasury() returns (address)', 'function ecosystemTreasury() returns (address)',
    'function adminSecurity() returns (address)', 'function getOwners() returns (address[])',
    'function closeAuction(uint256)', 'function finalizeDefault(uint256)', 'function expireRunnerUpOffer(uint256)',
    'function dueAuctionAction(uint256) returns (uint8)',
    'function auctions(uint256) returns (uint256,uint256,uint256,uint256,uint256,address,uint256,uint256,uint8,address)'
]);
const wallet = Wallet.createRandom();
const password = ' keep spaces ';
const encrypted = encryptKeystoreJsonSync(wallet, password, { scrypt: { N: 256, r: 8, p: 1 } });
const address = n => getAddress(toBeHex(n, 20));
const engine = address(100);
const safes = { protocolTreasury: address(10), ecosystemTreasury: address(11), adminSecurity: address(12) };
const code = '0x6000';
const block = { number: 55, hash: id('included'), timestamp: 1800000000 };
const actions = ['closeAuction', 'finalizeDefault', 'expireRunnerUpOffer'];

async function fixture(t) {
    const dir = await mkdtemp(path.join(tmpdir(), 'artsoul-testnet-submit-'));
    const keystorePath = path.join(dir, 'test-keystore');
    const passwordPath = path.join(dir, 'test-password');
    await Promise.all([writeFile(keystorePath, encrypted), writeFile(passwordPath, password + '\r\n')]);
    const sent = [];
    const state = { network: 84532, owner: address(2), due: 1n, bidder: address(5), latest: 4, pending: 4, finalizedNonce: 4,
        finalizedPhase: 1, finalizedBidder: address(5), finalizedEnd: 12n,
        fee: 13n, estimate: 120000n, receipt: null, inPool: null, finalized: 55, timestamp: block.timestamp, code };
    const provider = {
        async send(method) { assert.equal(method, 'eth_chainId'); return toBeHex(state.network); },
        async getCode(to) { return to === engine ? state.code : Object.values(safes).includes(to) ? '0x6001' : state.operatorCode || '0x'; },
        async call({ to, from, data, value, blockTag }) {
            const fn = api.parseTransaction({ data }).name;
            if (fn in safes) return api.encodeFunctionResult(fn, [safes[fn]]);
            if (fn === 'getOwners') {
                assert.ok(Object.values(safes).includes(to));
                return api.encodeFunctionResult(fn, [[address(1), state.owner, address(3)]]);
            }
            assert.equal(to, engine);
            if (fn === 'dueAuctionAction') return api.encodeFunctionResult(fn, [state.due]);
            if (fn === 'auctions') {
                const finalized = blockTag === state.finalized;
                return api.encodeFunctionResult(fn, [1, 10, 12, finalized ? state.finalizedEnd : 12, 0,
                    finalized ? state.finalizedBidder : state.bidder, 10, 1, finalized ? state.finalizedPhase : 1, ZeroAddress]);
            }
            assert.equal(from, wallet.address);
            assert.equal(value, 0n);
            assert.ok(actions.includes(fn));
            if (state.revert) throw Object.assign(new Error('State changed'), { code: 'CALL_EXCEPTION' });
            return '0x';
        },
        async getTransactionCount(_, tag) { return tag === 'finalized' ? state.finalizedNonce : state[tag]; },
        async getFeeData() { return { maxFeePerGas: state.fee, maxPriorityFeePerGas: 2n }; },
        async estimateGas() { return state.estimate; },
        async getBlock(tag) {
            if (tag === 'finalized') return { number: state.finalized, timestamp: block.timestamp };
            if (tag === 'latest') return { ...block, timestamp: state.timestamp };
            return { ...block, hash: state.canonical ?? block.hash };
        },
        async getTransactionReceipt() { return state.receipt; },
        async getTransaction() { return state.inPool; },
        async broadcastTransaction(raw) {
            sent.push(raw);
            if (state.offline) throw new Error('Connection dropped');
            return { hash: keccak256(raw) };
        }
    };
    const config = { chainId: 84532, engine, operator: wallet.address, codeHash: keccak256(code),
        gasLimit: 150000, maxFeePerGasWei: '35', maxDailyAttempts: 1 };
    let worker;
    const peers = [];
    const close = () => { if (worker) { worker.close(); worker = null; } };
    t.after(async () => { close(); for (const peer of peers) peer.close(); await rm(dir, { recursive: true, force: true }); });
    const start = () => openTestnetSubmitter({ config, provider, keystorePath, passwordPath, statePath: path.join(dir, 'state.sqlite') });
    const open = async () => {
        close();
        worker = await start();
        return worker;
    };
    const confirm = (status = 1) => {
        state.receipt = { hash: keccak256(sent.at(-1)), blockNumber: block.number, blockHash: block.hash, status };
        state.latest = state.pending = Transaction.from(sent.at(-1)).nonce + 1;
    };
    const openPeer = async () => { const peer = await start(); peers.push(peer); return peer; };
    return { open, openPeer, close, config, state, sent, confirm, passwordPath };
}

test('rejects a mainnet or wrong runtime, a Safe owner, contract operator and mismatched keystore', async t => {
    const { open, config, state, sent, passwordPath } = await fixture(t);
    config.chainId = 8453;
    await assert.rejects(open, /requires Base Sepolia/);
    config.chainId = 84532;
    state.network = 8453;
    await assert.rejects(open, /chain mismatch/);
    state.network = 84532;
    state.code = '0x6008';
    await assert.rejects(open, /runtime mismatch/);
    state.code = code;
    state.owner = wallet.address;
    await assert.rejects(open, /independent/);
    state.owner = address(2);
    state.operatorCode = '0x6000';
    await assert.rejects(open, /plain EOA/);
    state.operatorCode = '0x';
    config.operator = address(8);
    await writeFile(passwordPath, 'wrong-password');
    await assert.rejects(open, /keystore address/);
    config.operator = wallet.address;
    await assert.rejects(open, /decrypt dedicated/);
    assert.equal(sent.length, 0);
});

test('each due lifecycle call signs only the fixed engine, action, exact auction ID, and zero value', async t => {
    for (const [index, action] of actions.entries()) await t.test(action, async t => {
        const { open, state, sent, config, confirm } = await fixture(t);
        state.due = BigInt(index + 1);
        const worker = await open();
        const auctionId = 9007199254740993n;
        const result = await worker.submit({ id: auctionId, action, data: '0xdeadbeef', to: address(7), value: 123n });
        assert.equal(result.status, 'submitted');
        const tx = Transaction.from(sent[0]);
        assert.equal(tx.chainId, 84532n); assert.equal(tx.to, engine); assert.equal(tx.from, wallet.address);
        assert.equal(tx.data, api.encodeFunctionData(action, [auctionId]));
        assert.equal(tx.value, 0n); assert.equal(tx.gasLimit, BigInt(config.gasLimit)); assert.equal(tx.maxFeePerGas, state.fee);
        assert.equal(tx.hash, result.hash);
        state.inPool = { hash: result.hash };
        assert.equal((await worker.reconcile()).status, 'pending');
        confirm();
        state.finalized = 54;
        assert.equal((await worker.reconcile()).status, 'pending');
        state.finalized = 55;
        state.canonical = id('fork');
        assert.equal((await worker.reconcile()).status, 'pending');
        state.canonical = block.hash;
        assert.equal((await worker.reconcile()).status, 'confirmed');
        assert.equal(await worker.reconcile(), null);
        assert.equal(sent.length, 1);
    });
});

test('outbox survives an ambiguous send and restart and preserves the first hash, nonce and daily reservation', async t => {
    const { open, state, sent, confirm } = await fixture(t);
    let worker = await open();
    state.offline = true;
    await assert.rejects(worker.submit({ id: 9, action: 'closeAuction' }), /Connection dropped/);
    worker = await open();
    state.offline = false;
    assert.equal((await worker.reconcile()).status, 'submitted');
    assert.equal(sent[1], sent[0]);
    state.pending++;
    assert.equal((await worker.submit({ id: 10, action: 'closeAuction' })).status, 'nonce-conflict');
    state.pending--;
    state.due = 0n;
    assert.equal((await worker.reconcile()).status, 'stale-pending');
    assert.equal(sent.length, 2);
    confirm(0);
    assert.equal((await worker.reconcile()).status, 'reverted');
    worker = await open();
    state.due = 1n;
    state.receipt = null;
    assert.equal((await worker.submit({ id: 10, action: 'closeAuction' })).status, 'daily-cap');
    state.timestamp += 86400;
    assert.equal((await worker.submit({ id: 10, action: 'closeAuction' })).status, 'submitted');
    assert.equal(Transaction.from(sent.at(-1)).nonce, Transaction.from(sent[0]).nonce + 1);
});

test('rechecks authority, due state, bidless rounds, fee and gas limits, simulation and nonce before sending', async t => {
    const { open, state, sent } = await fixture(t);
    const worker = await open();
    const op = () => worker.submit({ id: 1n, action: 'closeAuction' });
    state.owner = wallet.address;
    await assert.rejects(op, /independent/);
    state.owner = address(2);
    await assert.rejects(worker.submit({ id: 1, action: 'withdraw' }), /Unsupported/);
    state.bidder = ZeroAddress;
    assert.equal((await op()).status, 'changed');
    state.bidder = address(5);
    state.due = 3n;
    assert.equal((await op()).status, 'changed');
    state.due = 1n;
    state.fee = 40n;
    assert.equal((await op()).status, 'fee-cap');
    state.fee = 13n;
    state.estimate = 150001n;
    assert.equal((await op()).status, 'gas-cap');
    state.estimate = 120000n;
    state.revert = true;
    assert.equal((await op()).status, 'simulation-rejected');
    state.revert = false;
    state.pending += 2;
    assert.equal((await op()).status, 'nonce-conflict');
    assert.equal(sent.length, 0);
});

test('conflicting pending or mined nonces never imply keeper success; finalized nonce consumption releases the outbox', async t => {
    const { open, state, config, sent } = await fixture(t);
    config.maxDailyAttempts = 2;
    const worker = await open();
    await worker.submit({ id: 1, action: 'closeAuction' });
    state.latest = state.pending = 5;
    assert.equal((await worker.reconcile()).status, 'nonce-conflict');
    state.finalizedNonce = 5;
    assert.equal((await worker.reconcile()).status, 'nonce-consumed');
    assert.equal(await worker.reconcile(), null);
    assert.equal((await worker.submit({ id: 2, action: 'closeAuction' })).status, 'submitted');
    assert.equal(Transaction.from(sent[1]).nonce, 5);
});

test('two clients using one journal reserve one nonce and count the signed attempt once', async t => {
    const { open, openPeer, state, sent, confirm } = await fixture(t);
    const [first, second] = await Promise.all([open(), openPeer()]);
    const results = await Promise.all([
        first.submit({ id: 101, action: 'closeAuction' }),
        second.submit({ id: 102, action: 'closeAuction' })
    ]);
    assert.ok(results.some(r => r.status === 'submitted'));
    assert.ok(results.every(r => ['pending', 'submitted'].includes(r.status)));
    assert.equal(new Set(sent).size, 1);
    const firstTransaction = Transaction.from(sent[0]);
    confirm();
    assert.equal((await second.reconcile()).status, 'confirmed');
    state.receipt = null;
    assert.equal((await first.submit({ id: 103, action: 'closeAuction' })).status, 'daily-cap');
    assert.equal(Transaction.from(sent.at(-1)).hash, firstTransaction.hash);
});

test('only finalized irreversible progress releases an absent transaction for the next permitted call at the same nonce', async t => {
    for (const [index, action] of actions.entries()) await t.test(action, async t => {
        const { open, state, config, sent } = await fixture(t);
        config.maxDailyAttempts = 2;
        const worker = await open();
        state.due = BigInt(index + 1);
        await worker.submit({ id: 1, action });
        state.due = 0n;
        for (const phase of [[0,1], [0,1,2], [0,1,2,6]][index]) {
            state.finalizedPhase = phase;
            assert.equal((await worker.reconcile()).status, 'stale-pending');
        }
        state.finalizedPhase = [2,6,5][index];
        state.inPool = { hash: keccak256(sent[0]) };
        assert.equal((await worker.reconcile()).status, 'pending');
        state.inPool = null;
        state.pending++;
        assert.equal((await worker.reconcile()).status, 'nonce-conflict');
        state.pending--;
        assert.equal((await worker.reconcile()).status, 'superseded');
        const newWorker = await open();
        assert.equal(await newWorker.reconcile(), null);
        state.due = 1n;
        assert.equal((await newWorker.submit({ id: 2, action: 'closeAuction' })).status, 'submitted');
        assert.notEqual(sent[1], sent[0]);
        assert.equal(Transaction.from(sent[1]).nonce, Transaction.from(sent[0]).nonce);
    });
});
