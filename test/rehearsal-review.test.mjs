import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { keccak256 } from 'ethers';
import { sameReview, start, walletRequest } from '../scripts/rehearsal-review/client.mjs';
import { chooseTreasury, listenForReview, reviewedPairStatus, reviewedRuntimePresent, verifyReference } from '../scripts/serve-rehearsal-review.mjs';

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
async function renderReview(t, provider, current = () => ({ ...plan, roles: {}, owners: [], block: { number: '0x1' } })) {
    const fields = new Map();
    function field(id) {
        if (!fields.has(id)) fields.set(id, { textContent: '', value: '', append() {}, replaceChildren() {},
            add(option) { if (!this.value) this.value = option.value; } });
        return fields.get(id);
    }
    globalThis.document = { createElement: () => ({}), getElementById: field };
    globalThis.window = Object.assign(new EventTarget(), { ethereum: provider });
    globalThis.Option = class { constructor(name, value) { this.text = name; this.value = value; } };
    t.after(() => { delete globalThis.document; delete globalThis.window; delete globalThis.Option; });
    t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: current }));
    await start();
    return field;
}
test('rendering never connects the wallet; explicit connect then a double click produces one mock submission', async t => {
    const sentHash = '0x' + 'a'.repeat(64);
    const provider = wallet({ eth_requestAccounts: () => [payer], eth_sendTransaction: () => sentHash });
    const field = await renderReview(t, provider);
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
test('after connecting, changing account and explicitly switching to Base Sepolia enables review without a second connection or a send', async t => {
    let chain = '0x2105', account = safe;
    const listeners = new Map();
    const provider = wallet({
        eth_requestAccounts: () => [account], eth_accounts: () => [account], eth_chainId: () => chain,
        wallet_switchEthereumChain: args => {
            assert.deepEqual(args, { chainId: '0x14a34' });
            chain = args.chainId;
            listeners.get('chainChanged')();
        }
    });
    provider.on = (event, callback) => listeners.set(event, callback);
    provider.removeListener = event => listeners.delete(event);
    const field = await renderReview(t, provider);
    await field('connect').onclick();
    assert.equal(field('submit').disabled, true);
    assert.ok(field('wallet-status').textContent.includes(payer));
    assert.ok(field('wallet-status').textContent.includes('8453'));
    assert.equal(field('switch').hidden, false);
    assert.ok(!provider.calls.includes('wallet_switchEthereumChain'));
    await field('switch').onclick();
    assert.equal(field('submit').disabled, true);
    assert.equal(field('switch').hidden, true);
    account = payer;
    listeners.get('accountsChanged')();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(field('submit').disabled, false);
    await field('refresh').onclick();
    assert.equal(field('submit').disabled, false);
    assert.equal(provider.calls.filter(m => m === 'eth_requestAccounts').length, 1);
    account = safe;
    listeners.get('accountsChanged')();
    assert.equal(field('submit').disabled, true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(field('submit').disabled, true);
    assert.ok(!provider.calls.includes('eth_sendTransaction'));
});
test('wallet discovery explains an empty picker and picks up a late-injected extension without connecting', async t => {
    const field = await renderReview(t);
    assert.equal(field('discover').hidden, false);
    assert.equal(field('connect').disabled, true);
    assert.match(field('wallet-status').textContent, /No wallet detected/);
    const provider = wallet();
    window.ethereum = provider;
    await field('discover').onclick();
    assert.equal(field('connect').disabled, false);
    assert.equal(field('submit').disabled, true);
    assert.deepEqual(provider.calls, []);
});
test('only the agreed expected Safe runtime with a nonzero account nonce counts as waiting for finality', async () => {
    function rpc(code, accountNonce) {
        return async method => method === 'eth_getCode' ? code : accountNonce;
    }
    const code = '0x60016000', hash = keccak256(code);
    assert.equal(await reviewedRuntimePresent([rpc(code, '0x1'), rpc(code, '0x1')], safe, hash), true);
    assert.equal(await reviewedRuntimePresent([rpc('0x', '0x0'), rpc('0x', '0x0')], safe, hash), false);
    for (const [first, second, pin] of [
        [rpc(code, '0x1'), rpc('0x', '0x1'), hash], [rpc(code, '0x1'), rpc(code, '0x2'), hash],
        [rpc(code, '0x0'), rpc(code, '0x0'), hash], [rpc('0xaa', '0x1'), rpc('0xaa', '0x1'), hash],
        [rpc(code, '0x1'), rpc(code, '0x1'), undefined], [rpc('0x', '0x1'), rpc('0x', '0x1'), hash]
    ]) await assert.rejects(reviewedRuntimePresent([first, second], safe, pin), /disagree|occupied/);
});

test('the Core page distinguishes an unfinalized bound pair from an absent, partial or incorrect pair', async t => {
    const addresses = [safe, admin], codes = ['0x6001', '0x6002'];
    const [core, nft] = addresses.map((address, i) => ({ address, codeHash: keccak256(codes[i]) }));
    function providers(latest, finalized) {
        const read = async (method, [address, tag]) => {
            const index = addresses.indexOf(address);
            assert.notEqual(index, -1);
            if (method === 'eth_getTransactionCount') return latest[index] === '0x' ? '0x0' : '0x1';
            return tag === 'latest' ? latest[index] : finalized[index];
        };
        return [read, read.bind(null)];
    }
    const block = { number: '0x1', hash: '0x' + 'a'.repeat(64) }, empty = ['0x', '0x'];
    const state = (latest, finalized) => reviewedPairStatus(providers(latest, finalized), { core, nft }, block);
    assert.equal(await state(empty, empty), undefined);
    const waiting = await state(codes, empty);
    assert.deepEqual(waiting, { waitingForFinality: { role: 'OrdinaryMarket', core: safe, nft: admin } });
    for (const [latest, finalized] of [[['0x1234', codes[1]], empty], [[codes[0], '0x'], empty], [codes, ['0x', codes[1]]]]) {
        await assert.rejects(state(latest, finalized), /occupied|part of the reviewed|finalized runtimes/);
    }
    const provider = wallet();
    let outcome = waiting;
    const field = await renderReview(t, provider, () => outcome);
    assert.ok(field('status').textContent.includes('Waiting for Base Sepolia finality'));
    outcome = { complete: true, finalizedPair: { core: safe, nft: admin }, evidence: { block } };
    await field('refresh').onclick();
    assert.ok(field('status').textContent.includes(block.hash));
    assert.equal(field('review').hidden, true);
    assert.equal(field('connect').disabled, true);
    assert.deepEqual(provider.calls, []);
});
test('explicit treasury selection leaves an independently reviewed request available until that role finalizes', () => {
    const protocol = { role: 'protocolTreasury', dataHash: 'first' }, ecosystem = { role: 'ecosystemTreasury', dataHash: 'second' };
    assert.equal(chooseTreasury([protocol, ecosystem]), protocol);
    assert.equal(chooseTreasury([protocol, ecosystem], 'ecosystemTreasury'), ecosystem);
    assert.equal(chooseTreasury([protocol], 'ecosystemTreasury'), undefined);
    assert.throws(() => chooseTreasury([protocol, ecosystem], 'adminSecurity'), /Choose/);
});
test('newly included Safe suppresses all wallet actions on refresh and on the final preflight', async t => {
    const waiting = { waitingForFinality: { role: 'protocolTreasury', address: safe } };
    let response = { ...plan, block: { number: '0x1' }, roles: {}, owners: [] };
    const provider = wallet({ eth_requestAccounts: () => [payer] });
    const field = await renderReview(t, provider, () => response);
    await field('connect').onclick();
    response = waiting;
    await field('submit').onclick();
    assert.equal(field('submit').disabled, true);
    assert.equal(field('review').hidden, true);
    assert.match(field('status').textContent, /Waiting for Base Sepolia finality/);
    assert.ok(field('status').textContent.includes(safe));
    await field('refresh').onclick();
    assert.equal(field('connect').disabled, true);
    assert.equal(field('review').hidden, true);
    assert.ok(!provider.calls.includes('eth_sendTransaction'));
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
