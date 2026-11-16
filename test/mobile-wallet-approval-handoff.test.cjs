const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync('appkit-init.js', 'utf8');
const functionSource = name => source.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`))[0];

function harness(initialVisibility = 'visible') {
    const listeners = new Set(), timers = new Map(), elements = new Map();
    const state = { requests: 0, launches: 0, timerId: 0 };
    let resolve, reject;
    const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
    const scope = {
        document: {
            visibilityState: initialVisibility,
            body: { appendChild: element => elements.set(element.id, element) },
            addEventListener(name, listener) { assert.equal(name, 'visibilitychange'); listeners.add(listener); },
            removeEventListener(name, listener) { assert.equal(name, 'visibilitychange'); listeners.delete(listener); },
            getElementById: id => elements.get(id)
        },
        setTimeout(fn) { const id = ++state.timerId; timers.set(id, fn); return id; },
        clearTimeout: id => timers.delete(id),
        requestCoreWalletMethod() { state.requests++; return pending; },
        openCoreWalletForApproval() { state.launches++; return true; },
        isMobileDevice: () => true, isInjectedWalletBrowser: () => false,
        describeApprovalMethod: () => 'Approve the signature request in your wallet to continue.', getApprovalWalletName: () => 'MetaMask',
        walletDebugLog() {},
        buildWalletApprovalPrompt() {
            return { id: 'artsoul-wallet-approval-prompt', querySelector: () => ({}), remove() { elements.delete(this.id); } };
        }
    };
    vm.createContext(scope);
    vm.runInContext("const WALLET_APPROVAL_PROMPT_ID = 'artsoul-wallet-approval-prompt'; let walletApprovalPromptDepth = 0, walletApprovalReopenHandler = null;\n"
        + ['showWalletApprovalPrompt', 'hideWalletApprovalPrompt', 'requestCoreNetworkMethod'].map(functionSource).join('\n')
        + '\nthis.reopen = () => walletApprovalReopenHandler?.();', scope);
    return { state, listeners, timers, elements, resolve, reject, reopen: () => scope.reopen(),
        request: () => scope.requestCoreNetworkMethod({}, { method: 'personal_sign' }),
        visibility(value) { scope.document.visibilityState = value; for (const listener of listeners) listener(); },
        fireTimer() { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } } };
}

test('a suspended handoff timer does not reopen the wallet after the user returns', async () => {
    const h = harness(), pending = h.request();
    h.visibility('hidden'); h.visibility('visible'); h.fireTimer();
    assert.equal(h.state.launches, 0);
    assert.equal(h.state.requests, 1);
    assert.equal(h.elements.size, 1, 'the waiting hint still offers the explicit Open action');
    h.reopen(); assert.equal(h.state.launches, 1); assert.equal(h.state.requests, 1);
    h.resolve('same-pending-signature'); assert.equal(await pending, 'same-pending-signature');
    assert.equal(h.listeners.size, 0); assert.equal(h.elements.size, 0); assert.equal(h.timers.size, 0);
});

test('the first foreground handoff still opens the wallet and waits for the same request', async () => {
    const h = harness(), pending = h.request(); h.fireTimer();
    assert.equal(h.state.launches, 1); assert.equal(h.state.requests, 1);
    h.visibility('hidden'); h.visibility('visible'); h.fireTimer();
    assert.equal(h.state.launches, 1);
    h.resolve('approved'); assert.equal(await pending, 'approved'); assert.equal(h.listeners.size, 0);
});

test('an approval started while hidden stays manual on return', async () => {
    const h = harness('hidden'), pending = h.request(); h.visibility('visible'); h.fireTimer();
    assert.equal(h.state.launches, 0); assert.equal(h.elements.size, 1);
    h.reopen(); assert.equal(h.state.launches, 1); assert.equal(h.state.requests, 1);
    h.resolve('approved'); await pending; assert.equal(h.listeners.size, 0);
});

test('success or rejection before the timer removes the listener and cannot launch a late wallet prompt', async () => {
    for (const rejected of [false, true]) {
        const h = harness(), pending = h.request();
        if (rejected) { h.reject(new Error('User rejected')); await assert.rejects(pending, /User rejected/); }
        else { h.resolve('approved'); await pending; }
        h.visibility('hidden'); h.visibility('visible'); h.fireTimer();
        assert.equal(h.state.launches, 0); assert.equal(h.state.requests, 1);
        assert.equal(h.listeners.size, 0); assert.equal(h.elements.size, 0); assert.equal(h.timers.size, 0);
    }
});
