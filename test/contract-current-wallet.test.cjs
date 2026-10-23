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

test('registration obtains one-time permission only after preflight and rechecks the live context before sending',async()=>{
    for(const change of ['none','wallet','core','form','permission']) {
        const {api}=fixture(),calls=[];let begun=false;
        api.ensureBaseSepoliaWrite=async()=>calls.push('network');
        api.coreContract={target:'0x'+'aa'.repeat(20),async registerArtwork(uri){calls.push('send');assert.equal(uri,'https://example.com/pinned.json');
            return {hash:'0xhash',wait:async()=>({status:1})};}};
        api.assertExpectedWallet=async()=>{calls.push('wallet');if(begun&&change==='wallet')throw Error('wallet changed');};
        api.waitForEvent=async()=>({args:{artworkId:36n}});
        const options={expectedCoreAddress:'0x'+'aa'.repeat(20),
            beforeSubmit:async()=>{calls.push('begin');begun=true;if(change==='permission')throw Error('No permission');
                if(change==='core')api.coreContract={...api.coreContract};},
            assertCurrent:()=>{if(begun&&change==='form')throw Error('form changed');}};
        if(change==='none'){
            assert.equal((await api.registerArtwork('https://example.com/pinned.json',options)).artworkId,'36');
            assert.deepEqual(calls,['network','wallet','begin','wallet','send']);
        }else{await assert.rejects(api.registerArtwork('https://example.com/pinned.json',options));assert(!calls.includes('send'));}
    }
});

test('a different Core target fails before consuming submission permission',async()=>{
    const {api}=fixture();api.ensureBaseSepoliaWrite=async()=>{};api.assertExpectedWallet=async()=>{};
    api.coreContract={target:'0x'+'bb'.repeat(20)};
    await assert.rejects(api.registerArtwork('https://example.com/pinned.json',{
        expectedCoreAddress:'0x'+'aa'.repeat(20),beforeSubmit:()=>assert.fail('must not begin')
    }),/contract changed/);
});
