const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ethers = process.env.ARTSOUL_TEST_ETHERS_UMD
    ? require(path.resolve(process.env.ARTSOUL_TEST_ETHERS_UMD)) : require('ethers');

const source = fs.readFileSync('contracts-integration.js', 'utf8').replace(/^import .*;\r?\n/gm, '');
const ACCOUNT = `0x${'1'.repeat(40)}`;
const CONTRACT = `0x${'2'.repeat(40)}`;

for (const accounts of [[ACCOUNT], [], [`0x${'3'.repeat(40)}`]]) {
    test(`passive initialization ${accounts[0] === ACCOUNT ? 'uses the selected signer' : accounts.length ? 'rejects another account' : 'rejects a disconnected account'} without prompting`, async t => {
        const requests = [];
        const provider = { request: async ({ method }) => {
            requests.push(method);
            if (method === 'eth_accounts') return accounts;
            if (method === 'eth_chainId') return '0x14a34';
            assert.fail(`Passive initialization requested ${method}`);
        } };
        const window = { ARTSOUL_CONTRACTS: { baseSepolia: {
            core: CONTRACT, nft: CONTRACT, projectNFT: CONTRACT
        } } };
        vm.runInNewContext(source, { ethers, window, ARTSOUL_CONTRACTS: window.ARTSOUL_CONTRACTS,
            console: { log() {}, warn() {}, error() {} } });
        const adapter = window.ArtSoulContracts;
        t.after(() => adapter.provider?.destroy());
        if (accounts[0] === ACCOUNT) {
            assert.equal(await adapter.init(provider, { passiveWallet: ACCOUNT }), true);
            assert.equal(await adapter.signer.getAddress(), ACCOUNT);
            assert.equal(adapter.isReady(), true);
        } else {
            await assert.rejects(adapter.init(provider, { passiveWallet: ACCOUNT }), /no longer connected/);
            assert.equal(adapter.isReady(), false);
        }
        assert.ok(requests.includes('eth_accounts'));
        assert.ok(requests.every(method => ['eth_accounts', 'eth_chainId'].includes(method)));
    });
}
