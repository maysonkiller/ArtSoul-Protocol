const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function loadEthers() {
    if (!process.env.ARTSOUL_TEST_ETHERS_UMD) return require('ethers');
    return require(require('node:path').resolve(process.env.ARTSOUL_TEST_ETHERS_UMD));
}

const ethers = loadEthers();
const source = fs.readFileSync('contracts-integration.js', 'utf8').replace(/^import .*;\r?\n/gm, '');
const OWNER = `0x${'1'.repeat(40)}`;
const CORE = `0x${'2'.repeat(40)}`;
const RELAYER = `0x${'3'.repeat(40)}`;
const MANAGER = '0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3';
const DELEGATOR_CODE = '0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b';
const OTHER = `0x${'4'.repeat(40)}`;
const ANY_DELEGATE = '0x0000000000000000000000000000000000000a11';
const HASH = `0x${'a'.repeat(64)}`;
const BLOCK_HASH = `0x${'b'.repeat(64)}`;
const ABI = ['function claimSettlementDefault(uint256)', 'function withdraw()',
    'event SettlementDefaulted(uint256 indexed auctionId,address indexed winner,uint256 artistAmount,uint256 platformAmount)'];
const DELEGATION_TYPE = 'tuple(address delegate,address delegator,bytes32 authority,tuple(address enforcer,bytes terms,bytes args)[] caveats,uint256 salt,bytes signature)[]';
const relayInterface = new ethers.Interface([
    'function redeemDelegations(bytes[] permissionContexts,bytes32[] modes,bytes[] executionCallDatas)'
]);

function relayInput(data, overrides = {}) {
    const { target = CORE, value = 0n, delegator = OWNER, delegate = ANY_DELEGATE,
        authority = ethers.toBeHex(ethers.MaxUint256, 32), mode = ethers.ZeroHash,
        count = 1, roots = 1 } = overrides;
    const root = { delegate, delegator, authority, caveats: [], salt: 0n, signature: '0x' };
    const context = ethers.AbiCoder.defaultAbiCoder().encode([DELEGATION_TYPE], [Array(roots).fill(root)]);
    const execution = ethers.solidityPacked(['address', 'uint256', 'bytes'], [target, value, data]);
    return relayInterface.encodeFunctionData('redeemDelegations', [
        Array(count).fill(context), Array(count).fill(mode), Array(count).fill(execution)
    ]);
}

// All transports are local doubles. Real ethers constructs the signer,
// contract transaction response and receipt; no wallet or RPC is contacted.
function fixture({ signed = false, direct = false, router = true, pending = 0,
    status = '0x1', method = 'claimSettlementDefault' } = {}) {
    const iface = new ethers.Interface(ABI);
    const callData = iface.encodeFunctionData(method, method === 'withdraw' ? [] : [25]);
    const canonical = { hash: HASH, chainId: '0x14a34', type: '0x2',
        from: RELAYER, to: MANAGER, nonce: '0x7', input: relayInput(callData), value: '0x0',
        gas: '0x5208', gasPrice: '0x1', maxFeePerGas: '0x2', maxPriorityFeePerGas: '0x1',
        accessList: [], r: `0x${'0'.repeat(63)}1`, s: `0x${'0'.repeat(63)}2`, v: '0x0',
        blockHash: BLOCK_HASH, blockNumber: '0x64', transactionIndex: '0x0' };
    if (signed || direct) Object.assign(canonical, { from: OWNER, to: CORE, input: callData });
    const unsigned = { ...canonical, from: OWNER, to: CORE, nonce: '0x0', input: callData,
        blockHash: null, blockNumber: null, transactionIndex: null };
    delete unsigned.r;
    delete unsigned.s;
    const walletTransaction = signed ? canonical : unsigned;
    const log = { ...iface.encodeEventLog(iface.getEvent('SettlementDefaulted'), [25, OWNER, 8, 2]),
        address: CORE, transactionHash: HASH, transactionIndex: '0x0',
        blockHash: BLOCK_HASH, blockNumber: '0x64', logIndex: '0x0' };
    const receipt = { transactionHash: HASH, blockHash: BLOCK_HASH, blockNumber: '0x64',
        transactionIndex: '0x0', from: canonical.from, to: canonical.to,
        contractAddress: null, gasUsed: '0x5208', cumulativeGasUsed: '0x5208',
        effectiveGasPrice: '0x1', status, type: '0x2',
        logs: status === '0x1' && method !== 'withdraw' ? [log] : [] };
    const state = { chainId: '0x14a34', sends: [], routed: [], publicCalls: [],
        canonicalReply: () => canonical, codeReply: () => DELEGATOR_CODE };
    const raw = { async request({ method, params = [] }) {
        switch (method) {
            case 'eth_accounts': return [OWNER];
            case 'eth_chainId': return state.chainId;
            case 'eth_blockNumber': return '0x65';
            case 'eth_estimateGas': return '0x5208';
            case 'eth_sendTransaction': state.sends.push(params[0]); return HASH;
            case 'eth_getTransactionByHash': assert.equal(params[0], HASH); return walletTransaction;
            case 'eth_getTransactionReceipt': assert.equal(params[0], HASH); return receipt;
            default: assert.fail(`Unexpected wallet method: ${method}`);
        }
    } };
    const window = { ArtSoulBaseSepolia: { chainId: 84532, async rpc(method, params) {
        state.publicCalls.push({ method, params: Array.from(params) });
        if (method === 'eth_getTransactionByHash') {
            assert.equal(params[0], HASH);
            if (pending-- > 0) return null;
            return state.canonicalReply();
        }
        assert.equal(method, 'eth_getCode');
        assert.equal(params[0].toLowerCase(), OWNER.toLowerCase());
        assert.equal(params[1], canonical.blockNumber);
        return state.codeReply();
    } } };
    if (router) window.requestArtSoulWalletProvider = (provider, args) => {
        assert.equal(provider, raw);
        state.routed.push(args.method);
        return provider.request(args);
    };
    vm.runInNewContext(`${source}\nwindow.wrapWallet = wrapProviderForWalletApprovals;`, {
        ethers, window, console: { log() {}, warn() {}, error() {} }
    });
    return { state, canonical, unsigned, walletTransaction, receipt, window, method,
        wrapped: window.wrapWallet(raw), api: window.ArtSoulContracts };
}

async function send(t, fixture) {
    const provider = new ethers.BrowserProvider(fixture.wrapped);
    t.after(() => provider.destroy());
    const signer = await provider.getSigner();
    const contract = new ethers.Contract(CORE, ABI, signer);
    return fixture.method === 'withdraw' ? contract.withdraw() : contract.claimSettlementDefault(25);
}

for (const router of [true, false]) {
    test(`a relayed transaction confirms after one pending canonical read ${router ? 'with' : 'without'} the approval router`, { timeout: 5000 }, async t => {
        const f = fixture({ router, pending: 1 });
        const tx = await send(t, f);
        const receipt = await f.api.waitForConfirmedTransaction(tx);
        assert.equal(receipt.hash, HASH);
        assert.equal(receipt.status, 1);
        assert.equal(receipt.logs[0].fragment.name, 'SettlementDefaulted');
        assert.equal(receipt.logs[0].args.auctionId, 25n);
        assert.equal(tx.from, RELAYER);
        assert.equal(tx.to, MANAGER);
        assert.equal(tx.nonce, 7);
        assert.equal(tx.data, f.canonical.input);
        assert.equal(f.state.sends.length, 1);
        assert.equal(f.state.sends[0].from, OWNER);
        assert.equal(f.state.sends[0].to, CORE);
        assert.equal(f.state.sends[0].data, f.unsigned.input);
        assert.deepEqual(f.state.publicCalls, [
            { method: 'eth_getTransactionByHash', params: [HASH] },
            { method: 'eth_getTransactionByHash', params: [HASH] },
            { method: 'eth_getCode', params: [OWNER, '0x64'] }
        ]);
        assert.deepEqual(f.state.routed, router ? ['eth_sendTransaction'] : []);
    });
}

test('a relayed transaction with a reverted receipt never becomes confirmed success', { timeout: 5000 }, async t => {
    const f = fixture({ status: '0x0' });
    const tx = await send(t, f);
    await assert.rejects(f.api.waitForConfirmedTransaction(tx), error =>
        error.code === 'CALL_EXCEPTION' && Number(error.receipt?.status) === 0);
    assert.equal(f.state.sends.length, 1);
});

test('an ordinary signed transaction uses the wallet transport without a public lookup', { timeout: 5000 }, async t => {
    const f = fixture({ signed: true });
    const receipt = await f.api.waitForConfirmedTransaction(await send(t, f));
    assert.equal(receipt.status, 1);
    assert.equal(f.state.sends.length, 1);
    assert.equal(f.state.publicCalls.length, 0);
});

test('an unsigned wallet response can recover an exactly matching direct transaction', { timeout: 5000 }, async t => {
    const f = fixture({ direct: true });
    const tx = await send(t, f);
    const receipt = await f.api.waitForConfirmedTransaction(tx);
    assert.equal(receipt.status, 1);
    assert.equal(tx.from, OWNER);
    assert.equal(tx.to, CORE);
    assert.equal(f.state.publicCalls.length, 1);
    assert.equal(f.state.sends.length, 1);
});

test('a validated default relay can confirm a withdrawal that emits no Core event', { timeout: 5000 }, async t => {
    const f = fixture({ method: 'withdraw' });
    const receipt = await f.api.waitForConfirmedTransaction(await send(t, f));
    assert.equal(receipt.status, 1);
    assert.equal(receipt.from, RELAYER);
    assert.equal(receipt.to, MANAGER);
    assert.equal(receipt.logs.length, 0);
    assert.equal(f.state.sends.length, 1);
});

test('unsupported or mismatched relay envelopes remain pending without a resend', async () => {
    const cases = [
        ['try mode', { mode: `0x0001${'0'.repeat(60)}` }],
        ['target', { target: OTHER }],
        ['value', { value: 1n }],
        ['delegator', { delegator: OTHER }],
        ['delegate', { delegate: OTHER }],
        ['root authority', { authority: ethers.ZeroHash }],
        ['multiple executions', { count: 2 }],
        ['multiple delegations', { roots: 2 }],
        ['empty delegation', { roots: 0 }]
    ];
    for (const [label, overrides] of cases) {
        const f = fixture();
        f.canonical.input = relayInput(f.unsigned.input, overrides);
        assert.equal(await f.wrapped.request({ method: 'eth_getTransactionByHash', params: [HASH] }), null, label);
        assert.equal(f.state.sends.length, 0, label);
    }
    for (const [label, mutate] of [
        ['calldata', f => { f.canonical.input = relayInput('0x1234'); }],
        ['unknown manager', f => { f.canonical.to = OTHER; }],
        ['outer value', f => { f.canonical.value = '0x1'; }],
        ['malformed envelope', f => { f.canonical.input = '0xcef6d209'; }]
    ]) {
        const f = fixture();
        mutate(f);
        assert.equal(await f.wrapped.request({ method: 'eth_getTransactionByHash', params: [HASH] }), null, label);
        assert.equal(f.state.sends.length, 0, label);
    }
});

test('a single default delegation may authorize its exact relayer instead of any delegate', async () => {
    const f = fixture();
    f.canonical.input = relayInput(f.unsigned.input, { delegate: RELAYER });
    assert.equal(await f.wrapped.request({ method: 'eth_getTransactionByHash', params: [HASH] }), f.canonical);
    assert.equal(f.state.sends.length, 0);
});

test('a relay needs the known delegator implementation at its mined block', async () => {
    for (const codeReply of [() => '0x', () => '0x6000',
        () => `0xef0100${OTHER.slice(2)}`, () => { throw new Error('Code read unavailable'); }]) {
        const f = fixture();
        f.state.codeReply = codeReply;
        assert.equal(await f.wrapped.request({ method: 'eth_getTransactionByHash', params: [HASH] }), null);
        assert.deepEqual(f.state.publicCalls.at(-1), { method: 'eth_getCode', params: [OWNER, '0x64'] });
        assert.equal(f.state.sends.length, 0);
    }
    const pending = fixture();
    pending.canonical.blockNumber = null;
    assert.equal(await pending.wrapped.request({ method: 'eth_getTransactionByHash', params: [HASH] }), null);
    assert.equal(pending.state.publicCalls.length, 1, 'an unmined relay has no historical implementation proof');
    assert.equal(pending.state.sends.length, 0);
});

test('unavailable or mismatched canonical data remains pending without a send', async () => {
    const replies = [
        () => null,
        () => { throw new Error('RPC unavailable'); },
        f => ({ ...f.canonical, hash: `0x${'c'.repeat(64)}` }),
        f => ({ ...f.canonical, chainId: '0x1' }),
        f => ({ ...f.canonical, r: undefined }),
        f => ({ ...f.canonical, s: '0x1' })
    ];
    for (const reply of replies) {
        const f = fixture();
        f.state.canonicalReply = () => reply(f);
        assert.equal(await f.wrapped.request({ method: 'eth_getTransactionByHash', params: [HASH] }), null);
        assert.equal(f.state.sends.length, 0);
    }
});

test('a network switch during transaction or implementation lookup cannot return a Base Sepolia transaction', async () => {
    for (const stage of ['transaction', 'implementation']) {
        const f = fixture();
        if (stage === 'transaction') f.state.canonicalReply = () => { f.state.chainId = '0x1'; return f.canonical; };
        else f.state.codeReply = () => { f.state.chainId = '0x1'; return DELEGATOR_CODE; };
        assert.equal(await f.wrapped.request({ method: 'eth_getTransactionByHash', params: [HASH] }), null, stage);
        assert.equal(f.state.publicCalls.filter(call => call.method === 'eth_getTransactionByHash').length, 1);
        assert.equal(f.state.sends.length, 0);
    }
});

test('a different wallet network never uses the Base Sepolia recovery route', async () => {
    const f = fixture();
    f.state.chainId = '0x1';
    assert.equal(await f.wrapped.request({ method: 'eth_getTransactionByHash', params: [HASH] }), f.unsigned);
    assert.equal(f.state.publicCalls.length, 0);
    assert.equal(f.state.sends.length, 0);
});
