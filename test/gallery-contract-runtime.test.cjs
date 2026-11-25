const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const source = fs.readFileSync('src/features/discovery/public-contract-runtime.js', 'utf8');
const connected = { address: '0x1111111111111111111111111111111111111111', isConnected: true };

function start(state, loadContracts, loadServices) {
    const listeners = new Map();
    const window = {
        artsoulSettledWalletState: state,
        addEventListener: (name, callback) => listeners.set(name, callback)
    };
    const script = source.replace('export function installPublicContractRuntime', 'function installPublicContractRuntime')
        .replace('import(/* @vite-ignore */ contractModule)', 'loadContracts()');
    new Function('window', 'loadContracts', 'loadServices',
        script + '\ninstallPublicContractRuntime(loadServices);')(window, loadContracts, loadServices);
    return { load: window.loadArtSoulGalleryContracts, change: detail => listeners.get('artsoul:wallet-state-changed')({ detail }) };
}

test('a guest does not fetch contract services and background wallet restoration starts them only once', async () => {
    let resolveContracts;
    let contracts = 0, services = 0;
    const pending = new Promise(resolve => { resolveContracts = resolve; });
    const runtime = start(null, () => { contracts++; return pending; }, () => { services++; });
    runtime.change({ isConnected: false });
    assert.equal(contracts, 0);
    runtime.change(connected);
    runtime.change(connected);
    assert.equal(contracts, 1);
    assert.equal(services, 0);
    const firstAction = runtime.load();
    assert.equal(firstAction, runtime.load());
    resolveContracts();
    await firstAction;
    assert.equal(services, 1);
});

test('an already-restored wallet can retry after the first load fails', async () => {
    let attempts = 0, services = 0;
    const runtime = start(connected, async () => { if (++attempts === 1) throw Error('Offline'); }, () => { services++; });
    await assert.rejects(runtime.load(), /Offline/);
    await runtime.load();
    assert.equal(attempts, 2);
    assert.equal(services, 1);
});

test('the homepage starts its first wallet read on demand without initializing gallery services', async () => {
    const home = fs.readFileSync('src/entries/index.js', 'utf8');
    const gallery = fs.readFileSync('src/features/discovery/gallery-contract-runtime.js', 'utf8');
    assert.match(home, /^installPublicContractRuntime\(\);$/m);
    assert.match(gallery, /installPublicContractRuntime\(\(\) => import\('\.\.\/\.\.\/index\.js'\)\)/);
    let attempts = 0;
    const runtime = start(null, async () => { attempts++; });
    assert.equal(attempts, 0);
    await Promise.all([runtime.load(), runtime.load()]);
    assert.equal(attempts, 1);
});
