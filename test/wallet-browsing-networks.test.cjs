const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createAvatarHarness } = require('./helpers/avatar-dropdown-harness.cjs');
const source = fs.readFileSync('appkit-init.js', 'utf8');

async function switchHarness({ core = false, chain = 84532, outcome = 'confirmed' } = {}) {
    const { baseSepolia, base, mainnet } = await import('@reown/appkit/networks');
    const calls = [];
    const provider = { request() {} };
    const context = {
        baseSepolia, base, mainnet, BASE_SEPOLIA_CHAIN_ID: 84532,
        BASE_SEPOLIA_RPC_URLS: ['https://sepolia.base.org'], NETWORK_CONFIRMATION_TIMEOUT: 1,
        window: { web3Modal: { switchNetwork: async () => { throw new Error('Use provider fallback'); } } },
        console: { log() {}, warn() {}, error() {} },
        parseChainId: value => Number(value),
        alert: message => calls.push(['alert', message]),
        markNetworkModalIntent: reason => calls.push(['intent', reason]),
        getSwitchProvider: async () => provider,
        getConnectedCoreProvider: () => core ? provider : null,
        coreSessionNeedsBaseSepoliaConfirmation: () => true,
        getProviderTruthChainId: async () => chain,
        closeNetworkModalAfterConfirmedChain: async id => calls.push(['confirmed', id]),
        confirmCoreBaseSepolia: async () => calls.push(['coreBase']),
        switchEthereumChain: async (_provider, target) => {
            assert.equal(_provider, provider);
            calls.push(['switch', target.chainId]);
            if (outcome === 'rejected') throw Object.assign(new Error('Rejected'), { code: 4001 });
        },
        waitForProviderChainId: async id => outcome === 'unconfirmed' ? chain : id,
        isPendingRequestError: () => false,
        isUserRejectedError: error => error.code === 4001,
        createWalletConnectError: (_code, message) => new Error(message),
        describeNetworkSwitchFailure: error => error.message
    };
    vm.createContext(context);
    const targets = source.slice(source.indexOf('const SUPPORTED_NETWORKS ='), source.indexOf('// metadata.url'));
    const resolver = source.slice(source.indexOf('function getSupportedNetworkTarget('), source.indexOf('\n}', source.indexOf('function getSupportedNetworkTarget(')) + 2);
    const selector = source.match(/window\.switchArtSoulNetwork = async[\s\S]*?\n\};/)[0];
    vm.runInContext(`let activeNetworkSwitchChainId = null;\n${targets}\n${resolver}\n${selector}`, context);
    return { calls, select: context.window.switchArtSoulNetwork, context };
}

for (const core of [false, true]) {
    for (const chain of [8453, 1]) {
        test(`wallet browsing switches to ${chain}, core=${core}, without a Base-only confirmation`, async () => {
            const h = await switchHarness({ core });
            assert.equal(await h.select(chain), true);
            assert.deepEqual(h.calls.filter(([kind]) => kind !== 'intent'), [['switch', chain], ['confirmed', chain]]);
        });
    }
}
test('Base Sepolia still requires confirmation for an unconfirmed mobile core session', async () => {
    const h = await switchHarness({ core: true });
    assert.equal(await h.select(84532), true);
    assert.deepEqual(h.calls.filter(([kind]) => kind !== 'intent'), [['coreBase'], ['confirmed', 84532]]);
});
for (const outcome of ['rejected', 'unconfirmed']) {
    test(`${outcome} switch does not publish the requested chain as confirmed`, async () => {
        const h = await switchHarness({ outcome });
        assert.equal(await h.select(1), false);
        assert.equal(h.calls.some(([kind]) => kind === 'confirmed'), false);
        assert.equal(h.calls.filter(([kind]) => kind === 'switch').length, 1);
    });
}
test('cancelling the AppKit request does not trigger another wallet prompt', async () => {
    const h = await switchHarness();
    h.context.window.web3Modal.switchNetwork = async () => {
        throw Object.assign(new Error('User cancelled'), { code: 4001 });
    };
    assert.equal(await h.select(1), false);
    assert.equal(h.calls.some(([kind]) => kind === 'switch' || kind === 'confirmed'), false);
    assert.equal(h.calls.filter(([kind]) => kind === 'alert').length, 1);
});

test('unknown chains are rejected before any provider call', async () => {
    const h = await switchHarness();
    assert.equal(await h.select(999), false);
    assert.deepEqual(h.calls.map(([kind]) => kind), ['alert']);
});
test('simultaneous choices cannot open conflicting wallet prompts', async () => {
    const h = await switchHarness();
    let release;
    h.context.getSwitchProvider = () => new Promise(resolve => { release = resolve; });
    const first = h.select(1);
    assert.equal(await h.select(8453), false);
    release(null);
    assert.equal(await first, false);
    assert.equal(h.calls.some(([kind]) => kind === 'switch'), false);
});
test('account network row opens choices even on a non-product chain', async () => {
    const h = createAvatarHarness();
    h.context.window.isArtSoulBaseSepoliaConfirmed = () => false;
    let opened = 0;
    h.dropdown.toggleNetworkOptions = () => ++opened;
    h.dropdown.selectNetwork = () => { throw new Error('Opening choices must not switch'); };
    assert.equal(await h.dropdown.handleNetworkRowClick({}), 1);
});
test('account chooser passes only configured targets and retains rejected choices', async () => {
    const h = createAvatarHarness();
    const calls = [];
    h.context.window.switchArtSoulNetwork = async id => { calls.push(id); return false; };
    h.dropdown.closeNetworkOptions = () => { throw new Error('Do not close on rejection'); };
    assert.equal(await h.dropdown.selectNetwork(1), false);
    assert.equal(await h.dropdown.selectNetwork(999), false);
    assert.deepEqual(calls, [1]);
    assert.equal(h.dropdown.networkSelectionPending, false);
});
test('browsing targets do not replace the fixed Base Sepolia write guard', () => {
    const guard = source.slice(source.indexOf('window.ensureArtSoulWriteNetwork ='), source.indexOf('window.openArtSoulNetworkSelector ='));
    assert.match(guard, /getSupportedNetworkTarget\(BASE_SEPOLIA_CHAIN_ID\)/);
    assert.match(guard, /confirmedChainId !== BASE_SEPOLIA_CHAIN_ID/);
    assert.match(guard, /This action requires Base Sepolia/);
});
