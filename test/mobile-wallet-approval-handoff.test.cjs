const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync('appkit-init.js', 'utf8');
const functionSource = name => source.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`))[0];

function harness(initialVisibility = 'visible') {
    const timers = new Map(), elements = new Map();
    const state = { requests: [], launches: [], timerId: 0 };
    let resolve, reject;
    const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
    const scope = {
        document: {
            visibilityState: initialVisibility,
            body: { appendChild: element => elements.set(element.id, element) },
            getElementById: id => elements.get(id)
        },
        window: { location: { assign: url => state.launches.push(url) } },
        setTimeout(fn) { const id = ++state.timerId; timers.set(id, fn); return id; },
        clearTimeout: id => timers.delete(id),
        requestCoreWalletMethod(provider, request) { state.requests.push(request); return pending; },
        getCoreWalletApprovalUrl: () => 'metamask://',
        isMobileDevice: () => true, isInjectedWalletBrowser: () => false,
        describeApprovalMethod: () => 'Approve the signature request in your wallet to continue.', getApprovalWalletName: () => 'MetaMask',
        walletDebugLog() {},
        buildWalletApprovalPrompt() {
            return { id: 'artsoul-wallet-approval-prompt', querySelector: () => ({}), remove() { elements.delete(this.id); } };
        }
    };
    vm.createContext(scope);
    vm.runInContext("const WALLET_APPROVAL_PROMPT_ID = 'artsoul-wallet-approval-prompt'; let walletApprovalPromptDepth = 0, walletApprovalReopenHandler = null;\n"
        + ['openCoreWalletForApproval', 'showWalletApprovalPrompt', 'hideWalletApprovalPrompt', 'requestCoreNetworkMethod'].map(functionSource).join('\n')
        + '\nthis.reopen = () => walletApprovalReopenHandler?.();', scope);
    return { state, timers, elements, resolve, reject, reopen: () => scope.reopen(),
        request: (method = 'personal_sign') => scope.requestCoreNetworkMethod({}, { method }),
        visibility(value) { scope.document.visibilityState = value; },
        fireTimer() { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } } };
}

test('a suspended handoff timer does not reopen the wallet after the user returns', async () => {
    const h = harness(), pending = h.request();
    h.visibility('hidden'); h.visibility('visible'); h.fireTimer();
    assert.equal(h.state.launches.length, 0);
    assert.equal(h.state.requests.length, 1);
    assert.equal(h.elements.size, 1, 'the waiting hint still offers the explicit Open action');
    h.reopen(); assert.deepEqual(h.state.launches, ['metamask://']); assert.equal(h.state.requests.length, 1);
    h.resolve('same-pending-signature'); assert.equal(await pending, 'same-pending-signature');
    assert.equal(h.elements.size, 0); assert.equal(h.timers.size, 0);
});

test('a foreground approval only shows the in-page hint until the user chooses Open', async () => {
    const h = harness(), pending = h.request(); h.fireTimer();
    assert.equal(h.state.launches.length, 0); assert.equal(h.state.requests.length, 1);
    assert.equal(h.elements.size, 1);
    h.reopen(); assert.deepEqual(h.state.launches, ['metamask://']);
    h.visibility('hidden'); h.visibility('visible'); h.fireTimer();
    assert.equal(h.state.launches.length, 1); assert.equal(h.state.requests.length, 1);
    h.resolve('approved'); assert.equal(await pending, 'approved');
    assert.equal(h.elements.size, 0);
    h.reopen(); assert.equal(h.state.launches.length, 1, 'a completed request has no remaining Open action');
});

test('an approval started while hidden stays manual on return', async () => {
    const h = harness('hidden'), pending = h.request(); h.visibility('visible'); h.fireTimer();
    assert.equal(h.state.launches.length, 0); assert.equal(h.elements.size, 1);
    h.reopen(); assert.equal(h.state.launches.length, 1); assert.equal(h.state.requests.length, 1);
    h.resolve('approved'); await pending; assert.equal(h.elements.size, 0);
});

test('success or rejection before the timer cannot flash a hint or open the wallet later', async () => {
    for (const rejected of [false, true]) {
        const h = harness(), pending = h.request();
        if (rejected) { h.reject(new Error('User rejected')); await assert.rejects(pending, /User rejected/); }
        else { h.resolve('approved'); await pending; }
        h.visibility('hidden'); h.visibility('visible'); h.fireTimer();
        assert.equal(h.state.launches.length, 0); assert.equal(h.state.requests.length, 1);
        assert.equal(h.elements.size, 0); assert.equal(h.timers.size, 0);
    }
});

test('approval or rejection after the hint is shown removes it and clears its Open action', async () => {
    for (const rejected of [false, true]) {
        const h = harness(), pending = h.request(); h.fireTimer();
        assert.equal(h.elements.size, 1); assert.equal(h.state.launches.length, 0);
        if (rejected) { h.reject(new Error('User rejected')); await assert.rejects(pending, /User rejected/); }
        else { h.resolve('approved'); assert.equal(await pending, 'approved'); }
        h.reopen(); h.visibility('hidden'); h.visibility('visible'); h.fireTimer();
        assert.equal(h.state.launches.length, 0); assert.equal(h.state.requests.length, 1);
        assert.equal(h.elements.size, 0); assert.equal(h.timers.size, 0);
    }
});

test('signatures, transactions and network approvals share the same explicit handoff without replaying requests', async () => {
    for (const method of ['personal_sign', 'eth_signTypedData_v4', 'eth_sendTransaction', 'wallet_switchEthereumChain', 'wallet_addEthereumChain']) {
        const h = harness(), pending = h.request(method); h.fireTimer();
        assert.equal(h.state.launches.length, 0, method);
        assert.deepEqual(h.state.requests.map(request => request.method), [method]);
        h.reopen(); assert.deepEqual(h.state.launches, ['metamask://']);
        assert.equal(h.state.requests.length, 1);
        h.resolve('approved'); await pending;
        assert.equal(h.elements.size, 0);
    }
});
