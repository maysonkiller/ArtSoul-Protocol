import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Interface, ZeroAddress, getAddress, id, keccak256, toBeHex, zeroPadValue } from 'ethers';
import { verifyTreasurySafes, verifyTreasurySafesWithTwoProviders } from '../scripts/verify-treasury-safes.mjs';

const addr = n => getAddress(toBeHex(n, 20));
const roles = ['protocolTreasury', 'ecosystemTreasury', 'adminSecurity'];
const block = { number: '0x32', hash: id('finalized') };
const iface = new Interface([
    'function getOwners() returns (address[])', 'function getThreshold() returns (uint256)',
    'function getModulesPaginated(address,uint256) returns (address[],address)',
    'function nft() returns (address)', 'function core() returns (address)',
    ...roles.map(role => 'function ' + role + '() returns (address)')
]);
const slots = new Map([
    ['0x0', 'singleton'], [id('guard_manager.guard.address'), 'guard'],
    [id('fallback_manager.handler.address'), 'fallbackHandler'],
    [id('module_manager.module_guard.address'), 'moduleGuard']
]);

function fixture() {
    const register = {
        chainId: 84532,
        core: { address: addr(20), codeHash: keccak256('0x6003') },
        nft: { address: addr(23), codeHash: keccak256('0x6004') }
    };
    for (const [index, role] of roles.entries()) {
        register[role] = {
            address: addr(index + 3), owners: [addr(40), addr(41), addr(42)], threshold: 2,
            singleton: addr(21), proxyCodeHash: keccak256('0x6001'), singletonCodeHash: keccak256('0x6002'),
            guard: ZeroAddress, fallbackHandler: addr(22), moduleGuard: ZeroAddress, modules: []
        };
    }
    const chain = structuredClone(register);
    chain.core.pairedNFT = register.nft.address;
    chain.nft.mintingCore = register.core.address;
    async function rpc(method, params) {
        if (method === 'eth_chainId') return '0x14a34';
        if (method === 'eth_getBlockByNumber') return block;
        assert.deepEqual(params.at(-1), { blockHash: block.hash, requireCanonical: true });
        if (method === 'eth_getCode') {
            if (params[0] === chain.core.address) return '0x6003';
            if (params[0] === chain.nft.address) return '0x6004';
            if (params[0] === chain.protocolTreasury.singleton) return '0x6002';
            return '0x6001';
        }
        if (method === 'eth_getStorageAt') {
            const safe = roles.map(role => chain[role]).find(item => item.address === params[0]);
            return zeroPadValue(safe[slots.get(params[1])], 32);
        }
        assert.equal(method, 'eth_call');
        const { to, data } = params[0];
        const fn = iface.parseTransaction({ data });
        if (to === chain.core.address) {
            const value = fn.name === 'nft' ? chain.core.pairedNFT : chain[fn.name].address;
            return iface.encodeFunctionResult(fn.name, [value]);
        }
        if (to === chain.nft.address && fn.name === 'core') return iface.encodeFunctionResult(fn.name, [chain.nft.mintingCore]);
        const safe = roles.map(role => chain[role]).find(item => item.address === to);
        const values = { getOwners: [safe.owners], getThreshold: [safe.threshold] };
        if (fn.name === 'getModulesPaginated') {
            const size = Number(fn.args[1]);
            const entries = safe.modules.slice(0, size);
            return iface.encodeFunctionResult(fn.name, [entries, safe.modules.length > size ? entries.at(-1) : addr(1)]);
        }
        return iface.encodeFunctionResult(fn.name, values[fn.name]);
    }
    return { register, chain, rpc };
}

test('matches all three Safes and Core bindings at one canonical block without printing identities', async () => {
    const { register, rpc } = fixture();
    register.ecosystemTreasury.owners.reverse();
    const report = await verifyTreasurySafes(register, rpc);
    assert.deepEqual(report.roles.adminSecurity, { owners: 3, threshold: 2 });
    assert.equal(report.coreBindingsChecked, true);
    assert.equal(report.nftPairChecked, true);
    assert.ok(!JSON.stringify(report).includes(addr(41)));
    assert.deepEqual(await verifyTreasurySafes(register, rpc, report.block), report);
    delete register.nft;
    const coreOnly = await verifyTreasurySafes(register, rpc);
    assert.equal(coreOnly.coreBindingsChecked, true);
    assert.equal(coreOnly.nftPairChecked, false);
    delete register.core;
    assert.equal((await verifyTreasurySafes(register, rpc)).coreBindingsChecked, false);
});

test('the explicit pair check requires both reviewed contracts before reading providers', async () => {
    const failIfCalled = () => assert.fail('Unexpected RPC read');
    for (const field of ['core', 'nft']) {
        const { register } = fixture();
        delete register[field];
        await assert.rejects(verifyTreasurySafesWithTwoProviders(register, failIfCalled, failIfCalled, { requirePair: true }),
            /requires reviewed Core and NFT entries/);
    }
    const { register, rpc } = fixture();
    delete register.core;
    await assert.rejects(verifyTreasurySafes(register, rpc), /requires its paired Core/);
});

test('verifies each Safe independently through two successive owner replacements', async () => {
    const first = fixture();
    const second = fixture();
    const expected = first.register;
    delete expected.core;
    delete expected.nft;
    const readBoth = () => verifyTreasurySafesWithTwoProviders(expected, first.rpc, second.rpc);
    for (const [retired, incoming] of [[addr(41), addr(51)], [addr(42), addr(52)]]) {
        for (const role of roles) {
            const updated = expected[role].owners.map(owner => owner === retired ? incoming : owner);
            expected[role].owners = updated;
            first.chain[role].owners = updated;
            // Even one provider still returning the previous set for just this Safe fails the check.
            await assert.rejects(readBoth(), new RegExp(role + ' owner set mismatch'));
            second.chain[role].owners = [...updated].reverse();
            const { roles: checked } = await readBoth();
            for (const account of roles) assert.deepEqual(checked[account], { owners: 3, threshold: 2 });
        }
    }
});

test('the pair CLI refuses a missing provider, the same origin, a missing pair or an unknown flag', () => {
    const script = fileURLToPath(new URL('../scripts/verify-treasury-safes.mjs', import.meta.url));
    const incompleteRegister = fileURLToPath(new URL('../package.json', import.meta.url));
    const first = 'https://first.invalid/rpc';
    for (const [flag, second, error] of [
        ['--require-pair', '', /requires two independent RPC endpoints/],
        ['--require-pair', 'https://first.invalid/another-path', /separate RPC provider origins/],
        ['--require-pair', 'https://second.invalid', /requires reviewed Core and NFT entries/],
        ['--require-pairs', '', /Usage:/]
    ]) {
        const result = spawnSync(process.execPath, [script, incompleteRegister, flag], {
            encoding: 'utf8', env: { ...process.env, ARTSOUL_CUSTODY_RPC_URL: first, ARTSOUL_CUSTODY_RPC_CHECK_URL: second }
        });
        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, error);
        assert.equal(result.stdout, '');
    }
});

test('rejects either incorrect immutable binding, unreviewed NFT code and aliases', async () => {
    const changes = [
        [({ chain }) => { chain.core.pairedNFT = addr(45); }, /Core binding mismatch for NFT/],
        [({ chain }) => { chain.nft.mintingCore = addr(45); }, /NFT binding mismatch for Core/],
        [({ register }) => { register.nft.codeHash = id('different'); }, /Runtime code mismatch for NFT/],
        [({ register }) => { delete register.nft.codeHash; }, /Missing reviewed runtime hash for NFT/],
        [({ register }) => { register.nft.address = register.core.address; }, /must be distinct/],
        [({ register }) => { register.nft.address = register.adminSecurity.address; }, /must be distinct/]
    ];
    for (const [change, reason] of changes) {
        const setup = fixture();
        change(setup);
        await assert.rejects(verifyTreasurySafes(setup.register, setup.rpc), reason);
    }
});

test('rejects wrong chains, aliased roles, single signers, unexpected code or owners and changed thresholds', async () => {
    const changes = [
        [r => { r.chainId = 8453; }, /Wrong RPC chain/],
        [r => { r.adminSecurity.address = r.protocolTreasury.address; }, /own Safe/],
        [r => { r.protocolTreasury.threshold = 1; }, /Invalid multisig/],
        [r => { r.adminSecurity.singletonCodeHash = id('wrong'); }, /Runtime code mismatch/],
        [r => { r.adminSecurity.proxyCodeHash = keccak256('0x'); }, /Runtime code mismatch/],
        [r => { r.protocolTreasury.singleton = addr(32); }, /singleton mismatch/],
        [r => { r.protocolTreasury.owners[0] = addr(43); }, /owner set mismatch/],
        [r => { r.ecosystemTreasury.threshold = 3; }, /threshold mismatch/]
    ];
    for (const [change, reason] of changes) {
        const { register, rpc } = fixture();
        change(register);
        await assert.rejects(verifyTreasurySafes(register, rpc), reason);
    }
});

test('detects unreviewed modules, pagination overflow, guard and handler changes', async () => {
    for (const field of ['guard', 'moduleGuard', 'fallbackHandler']) {
        const { register, chain, rpc } = fixture();
        chain.adminSecurity[field] = addr(33);
        await assert.rejects(verifyTreasurySafes(register, rpc), /mismatch/);
    }
    const { register, chain, rpc } = fixture();
    chain.adminSecurity.modules.push(addr(33), addr(34));
    register.adminSecurity.modules = [addr(33)];
    await assert.rejects(verifyTreasurySafes(register, rpc), /modules mismatch/);
    register.adminSecurity.modules.push(addr(34));
    assert.equal((await verifyTreasurySafes(register, rpc)).coreBindingsChecked, true);
});

test('detects wrong Core bindings, nonmatching finalized headers and omitted contract code', async () => {
    const { register, rpc } = fixture();
    [register.protocolTreasury, register.ecosystemTreasury] = [register.ecosystemTreasury, register.protocolTreasury];
    await assert.rejects(verifyTreasurySafes(register, rpc), /Core binding mismatch/);
    await assert.rejects(verifyTreasurySafes(register, rpc, { ...block, hash: id('other') }), /disagree/);
    await assert.rejects(verifyTreasurySafes(register, rpc, { ...block, number: '0x33' }), /not finalized/);
    await assert.rejects(verifyTreasurySafes(register, (method, params) =>
        method === 'eth_getCode' ? '0x' : rpc(method, params)), /No deployed code for protocolTreasury proxy at finalized block 50/);
});

function providerAt(rpc, head, canonical = block) {
    const calls = [];
    async function read(method, params) {
        calls.push([method, params]);
        if (method === 'eth_getBlockByNumber') {
            if (params[0] === 'finalized') return head;
            assert.equal(params[0], block.number);
            return canonical;
        }
        return rpc(method, params);
    }
    return { read, calls };
}

test('both providers read every role at the highest shared finalized block in either endpoint order', async () => {
    const { register, rpc } = fixture();
    const higher = { number: '0x792', hash: id('1888 blocks later') };
    for (const heads of [[higher, block], [block, higher], [block, block]]) {
        const providers = heads.map(head => providerAt(rpc, head));
        const report = await verifyTreasurySafesWithTwoProviders(register, providers[0].read, providers[1].read, { requirePair: true });
        assert.deepEqual(report.block, block);
        assert.equal(report.coreBindingsChecked, true);
        assert.equal(report.nftPairChecked, true);
        for (const { calls } of providers) {
            const numberedHeaders = calls.filter(([method, params]) => method === 'eth_getBlockByNumber' && params[0] !== 'finalized');
            assert.deepEqual(numberedHeaders, [['eth_getBlockByNumber', [block.number, false]]]);
            const wallets = calls.filter(([method]) => method === 'eth_getCode').map(([, params]) => params[0]);
            for (const role of roles) assert.ok(wallets.includes(register[role].address));
            assert.ok(wallets.includes(register.core.address));
            assert.ok(wallets.includes(register.nft.address));
        }
    }
});

test('the pair check fails when the second provider returns a different NFT authority at the same block', async () => {
    const first = fixture();
    const second = fixture();
    second.chain.nft.mintingCore = addr(77);
    await assert.rejects(verifyTreasurySafesWithTwoProviders(first.register, first.rpc, second.rpc, { requirePair: true }),
        /NFT binding mismatch for Core/);
});

test('rejects differing finalized headers, inconsistent numbered responses and missing history before reading custody', async () => {
    const { register, rpc } = fixture();
    const fork = { ...block, hash: id('fork') };
    const ahead = { number: '0x40', hash: id('higher') };
    for (const [head, canonical] of [[fork, block], [ahead, fork], [ahead, null], [ahead, { ...block, number: '0x31' }]]) {
        const first = providerAt(rpc, block);
        const second = providerAt(rpc, head, canonical);
        await assert.rejects(verifyTreasurySafesWithTwoProviders(register, first.read, second.read), /disagree on the finalized block/);
        assert.ok([...first.calls, ...second.calls].every(([method]) => ['eth_chainId', 'eth_getBlockByNumber'].includes(method)));
    }
});

test('a second reading with the wrong runtime fails verification even after the providers agree on the header', async () => {
    const { register, rpc } = fixture();
    const wrongCode = (method, params) => method === 'eth_getCode' && params[0] === register.adminSecurity.address
        ? '0x6004' : rpc(method, params);
    await assert.rejects(verifyTreasurySafesWithTwoProviders(register, rpc, wrongCode), /Runtime code mismatch for adminSecurity proxy/);
});
