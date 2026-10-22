const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync('contracts-integration.js', 'utf8').replace(/^import .*;\r?\n/gm, '');

function fixture() {
    const fresh = {request: async () => []};
    const window = {web3Modal: {getWalletProvider: async () => fresh}, ensureArtSoulWriteNetwork: async () => true};
    vm.runInNewContext(source, {window, console: {log() {}}, ethers: {
        BrowserProvider: class {async getNetwork() {return {chainId: 84532n};}}
    }});
    return {api: window.ArtSoulContracts, window, fresh};
}

test('a same-chain reconnect rebuilds the contract signer from the current provider', async () => {
    const {api, fresh} = fixture();
    api.currentNetwork = 'baseSepolia';
    let initialized;
    api.init = async provider => {initialized = provider;};
    await api.ensureBaseSepoliaWrite();
    assert.equal(initialized, fresh);
});

test('a refused network preparation never initializes a signer', async () => {
    const {api, window} = fixture();
    window.ensureArtSoulWriteNetwork = async () => false;
    api.init = async () => assert.fail('must not initialize');
    await assert.rejects(api.ensureBaseSepoliaWrite(), /Base Sepolia/);
});

test('registration refuses a wallet change before asking for a transaction', async () => {
    const {api} = fixture();
    api.ensureBaseSepoliaWrite = async () => {};
    api.coreContract = {registerArtwork: async () => assert.fail('must not submit')};
    api.assertExpectedWallet = async options => {
        assert.equal(options.expectedWallet, '0xcreator');
        throw new Error('The wallet changed. Review the action again.');
    };
    await assert.rejects(api.registerArtwork('https://example.com/art.json', {expectedWallet: '0xcreator'}), /wallet changed/);
});
