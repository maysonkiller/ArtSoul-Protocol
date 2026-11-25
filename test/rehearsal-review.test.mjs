import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { sameReview, start, walletRequest } from '../scripts/rehearsal-review/client.mjs';
import { listenForReview, verifyReference } from '../scripts/serve-rehearsal-review.mjs';

const payer = '0x' + '1'.repeat(40), safe = '0x' + '2'.repeat(40), admin = '0x' + '3'.repeat(40);
const target = '0x4e1dcf7ad4e460cfd30791ccc4f9c8a4f820ec67';
const digest = hex => createHash('sha256').update(Buffer.from(hex.slice(2), 'hex')).digest('hex');
const data = '0x1688f0b9aabb', nonce = '0x4';
const plan = { payer, target, nonce, data, dataHash: 'test', dataSha256: digest(data), operation: 'protocolTreasury',
    chainId: '0x14a34', deployments: [safe], codeChecks: [{ address: target, sha256: digest('0x1234') }] };
function wallet(overrides = {}) {
    const calls = [];
    const answers = {
        eth_chainId: () => plan.chainId, eth_accounts: () => [payer],
        eth_getTransactionCount: a => a === payer ? nonce : '0x0', eth_getCode: a => a === target ? '0x1234' : '0x'
    };
    return { calls, request: async ({ method, params = [] }) => {
        calls.push(method);
        return (overrides[method] ?? answers[method])(...params);
    } };
}
test('review returns only the displayed zero-value wallet fields without submitting anything', async () => {
    const provider = wallet();
    const tx = await walletRequest(provider, { ...plan, gasPrice: '0xffff', authorizationList: ['ignored'] });
    assert.deepEqual(tx, { from: payer, to: target, value: '0x0', nonce, data, chainId: '0x14a34' });
    assert.ok(!provider.calls.includes('eth_sendTransaction'));
    const core = await walletRequest(provider, { ...plan, operation: 'OrdinaryMarket', target: 'Direct contract creation' });
    assert.ok(!('to' in core));
});
test('wallet checks refuse wrong chain, payer, pending payer nonce, runtime, destination nonce and calldata', async () => {
    for (const [overrides, pattern] of [
        [{ eth_chainId: () => '0x2105' }, /Base Sepolia/],
        [{ eth_accounts: () => [safe] }, /test payer/],
        [{ eth_getTransactionCount: (a, tag) => a === payer ? tag === 'pending' ? '0x5' : nonce : '0x0' }, /Payer state/],
        [{ eth_getCode: a => a === target ? '0xab' : '0x' }, /different contract code/],
        [{ eth_getTransactionCount: a => a === payer ? nonce : '0x1' }, /occupied/],
        [{ eth_getCode: a => a === payer ? '0x1234' : a === target ? '0x1234' : '0x' }, /Payer state/]
    ]) await assert.rejects(walletRequest(wallet(overrides), plan), pattern);
    await assert.rejects(walletRequest(wallet(), { ...plan, data: data + 'ff' }), /Transaction data changed/);
    await assert.rejects(walletRequest(wallet(), { ...plan, target: admin }), /target or method/);
    let count = 0;
    await assert.rejects(walletRequest(wallet({ eth_chainId: () => ++count === 1 ? plan.chainId : '0x1' }), plan), /Base Sepolia/);
    assert.equal(sameReview(plan, { ...plan, nonce: '0x5' }), false);
    assert.equal(sameReview(plan, { ...plan, block: { number: '0x10' } }), true);
});
test('private custody review binds all owners, role addresses, payer and pending payload, allowing finalized steps to disappear', () => {
    const account = { address: admin, owners: [safe, target, payer], threshold: 2 };
    const roleRequests = [{ role: 'protocolTreasury', safe, dataHash: data }];
    const original = { chainId: 84532, payer, custody: { adminSecurity: account, protocolTreasury: account, ecosystemTreasury: account }, roleRequests };
    verifyReference(original, { ...original, roleRequests: [] });
    assert.throws(() => verifyReference(original, { ...original, custody: { ...original.custody,
        adminSecurity: { ...account, owners: [safe, target, admin] } } }), /owners changed/);
    assert.throws(() => verifyReference(original, { ...original, roleRequests: [{ ...roleRequests[0], dataHash: 'other' }] }), /request changed/);
});
test('rendering never connects the wallet; explicit connect then a double click produces one mock submission', async t => {
    const fields = new Map();
    function field(id) {
        if (!fields.has(id)) fields.set(id, { textContent: '', value: '', append() {}, replaceChildren() {},
            add(option) { if (!this.value) this.value = option.value; } });
        return fields.get(id);
    }
    const sentHash = '0x' + 'a'.repeat(64);
    const provider = wallet({ eth_requestAccounts: () => [payer], eth_sendTransaction: () => sentHash });
    globalThis.document = { createElement: () => ({}), getElementById: field };
    globalThis.window = Object.assign(new EventTarget(), { ethereum: provider });
    globalThis.Option = class { constructor(name, value) { this.text = name; this.value = value; } };
    t.after(() => { delete globalThis.document; delete globalThis.window; delete globalThis.Option; });
    t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({
        ...plan, roles: {}, owners: [], block: { number: '0x1' }
    }) }));
    await start();
    assert.deepEqual(provider.calls, []);
    assert.equal(field('submit').disabled, true);
    await field('submit').onclick();
    assert.deepEqual(provider.calls, []);
    await field('connect').onclick();
    assert.equal(provider.calls.filter(method => method === 'eth_requestAccounts').length, 1);
    assert.ok(!provider.calls.includes('eth_sendTransaction'));
    await Promise.all([field('submit').onclick(), field('submit').onclick()]);
    assert.equal(provider.calls.filter(method => method === 'eth_sendTransaction').length, 1);
    assert.ok(field('status').textContent.includes(sentHash));
    await field('refresh').onclick();
    assert.equal(field('submit').disabled, true);
    assert.equal(field('connect').disabled, true);
});
test('loopback server serves only token-bound read routes on the exact origin', async t => {
    let reads = 0;
    const { server, url } = await listenForReview(async () => { reads++; return { complete: true }; });
    t.after(() => new Promise(resolve => server.close(resolve)));
    async function get(path, options) {
        return new Promise((resolve, reject) => {
            const req = request(new URL(path, url), options, res => { res.resume(); resolve(res); });
            req.on('error', reject).end();
        });
    }
    assert.equal(server.address().address, '127.0.0.1');
    assert.equal((await get('')).statusCode, 200);
    assert.equal((await get('client.mjs')).statusCode, 200);
    assert.equal((await get('review.css')).statusCode, 200);
    assert.equal((await get('plan.json')).headers['cache-control'], 'no-store');
    assert.equal((await get('plan.json', { headers: { Host: 'evil.example' } })).statusCode, 403);
    assert.equal((await get('plan.json', { headers: { Origin: 'https://evil.example' } })).statusCode, 403);
    assert.equal((await get('plan.json', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).statusCode, 403);
    assert.equal((await get('plan.json', { method: 'POST' })).statusCode, 403);
    assert.equal((await get('/plan.json')).statusCode, 403);
    assert.equal((await get('other.js')).statusCode, 404);
    assert.equal(reads, 1);
});
