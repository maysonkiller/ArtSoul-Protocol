const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const walk = require('acorn-walk');

const source = fs.readFileSync(path.join(__dirname, '../appkit-init.js'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
const declarations = new Map(ast.body.filter(node => node.type === 'FunctionDeclaration').map(node => [node.id.name, node]));
const slice = node => source.slice(node.start, node.end);
const functions = names => names.map(name => slice(declarations.get(name))).join('\n');
function assignment(name) {
    return slice(ast.body.find(node => node.type === 'ExpressionStatement' &&
        node.expression.type === 'AssignmentExpression' && node.expression.left.object?.name === 'window' &&
        node.expression.left.property?.name === name));
}
let accountCallback;
walk.simple(ast, {
    CallExpression(node) {
        if (node.callee.object?.name === 'modal' && node.callee.property?.name === 'subscribeAccount') {
            accountCallback = slice(node.arguments[0]);
        }
    }
});
const bootGate = source.match(/const explicitDisconnectRequested = isWalletExplicitlyDisconnected\(\);[\s\S]*?coreSessionRestoreTask = restoreCoreSessionOutcome\(\);\s*\}/)[0];
const A = `0x${'a'.repeat(40)}`;
const B = `0x${'b'.repeat(40)}`;
function storage(initial = {}) {
    const values = { ...initial };
    return Object.defineProperties(values, {
        getItem: { value: key => values[key] ?? null },
        setItem: { value: (key, value) => { values[key] = String(value); } },
        removeItem: { value: key => { delete values[key]; } }
    });
}
function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}
function provider(address, chainId = 1) {
    return {
        selectedAddress: address, chainId, reads: [],
        async request({ method }) {
            this.reads.push(method);
            return method === 'eth_accounts' ? [this.selectedAddress] : this.chainId;
        }
    };
}
function harness({ local = storage(), session = storage(), mobile = false } = {}) {
    const events = [];
    const nav = [];
    const timers = new Map();
    let nextTimer = 0;
    const c = {
        localStorage: local, sessionStorage: session, indexedDB: {},
        console: { log() {}, warn() {}, error() {} },
        window: {
            currentWalletAddress: null, currentChainId: null,
            artsoulWalletStateSettled: true, location: { pathname: '/' },
            SupabaseAuth: { signOut: async () => {} },
            dispatchEvent: event => events.push(event.detail)
        },
        document: { visibilityState: 'visible' },
        CustomEvent: function(type, options) { this.type = type; this.detail = options.detail; },
        setTimeout: (callback, ms) => { timers.set(++nextTimer, { callback, ms }); return nextTimer; },
        clearTimeout: id => timers.delete(id),
        walletConnectionRevision: 0, walletDisconnectPromise: null, activeConnectAttempt: null,
        modalClosePromise: null, modalCloseRetryTimer: null,
        activeWalletProvider: null, latestAppKitAccountSnapshot: null, appKitAccountRevision: 0,
        lastObservedAppKitAccountKey: null, lastProcessedAddress: null, lastProcessedChainId: null,
        lastConfirmedWalletAt: 0, lastDispatchedWalletStateKey: null,
        walletResumeTimer: null, walletResumeWaiters: new Set(), walletHydrationTimer: null,
        walletHydrationPending: false, mobileCoreRestoreState: 'idle', coreSessionRestoreTask: null,
        connectModalIntentUntil: 0, connectAttemptSequence: 0, lastSelectedWallet: null,
        lastWalletConnectUri: null, mobileRetryCleanupRequired: false,
        CORE_NETWORK_CONFIRMATION_KEY: 'network-confirmation', WALLET_STORAGE_VERSION_KEY: 'wallet-version',
        POST_CONNECT_DISCONNECT_GUARD: 5000, WALLET_CONNECT_TIMEOUT_DESKTOP: 45000,
        WALLET_CONFIRMATION_INTERVAL: 100, isMobile: mobile,
        MODAL_CLOSE_RETRY_DELAY: 500, APPKIT_MODAL_OPEN_TIMEOUT: 5000,
        isMobileDevice: () => mobile, isInjectedWalletBrowser: () => false,
        normalizeWalletAddress: value => /^0x[0-9a-f]{40}$/i.test(value || '') ? value.toLowerCase() : null,
        normalizeChainId: value => typeof value === 'object' ? value?.chainId || null : Number(value) || c.window.currentChainId,
        setCurrentChainId(value) { return c.window.currentChainId = c.normalizeChainId(value); },
        maskWalletAddress: value => value, walletDebugLog() {}, getWalletDebugSnapshot: () => ({}),
        getStateChainId: value => value?.chainId, parseChainId: value => Number(value) || null,
        getAppKitWalletProvider: async () => c.selectedProvider,
        requestProviderChainId: p => p.request({ method: 'eth_chainId' }),
        getProviderTruthChainId: p => p.request({ method: 'eth_chainId' }),
        signOutMismatchedSession: async () => {},
        updateNavButtons: state => nav.push(state), updateNetworkBadge() {},
        clearModalIntent() {}, markConnectModalIntent() {},
        setMobileCoreRestoreState(state) { c.mobileCoreRestoreState = state; },
        isCoreSessionActive: () => false, isCoreConnectInFlight: () => false,
        getConnectedCoreProvider: () => null, getCoreProviderInstance: () => null,
        getCoreSessionAddress: p => p?.sessionAddress || null,
        disconnectCoreWallet: async () => {},
        safeCloseModal: async () => {}, scheduleModalCloseRetries() {},
        closeNetworkModalAfterConfirmedChain: async () => {},
        restartWalletConnectTransport: async () => {}, recheckDeferredCoreDisconnect: async () => {},
        bindRuntimeProviderEvents() {}, bindWalletConnectDiagnostics() {}, bindCoreProviderDisconnect() {},
        setConnectButtonPending() {}, notifyForeignChainAccepted() {}, notifyWalletResume() {},
        hasConfirmedWalletAddress: () => Boolean(c.window.currentWalletAddress && c.window.currentWalletAddress === c.lastProcessedAddress),
        describeWalletDebugError: () => ({}), createWalletConnectError: (code, message) => Object.assign(new Error(message), { code }),
        isUserRejectedError: error => error?.code === 4001,
        alert() {}, sleep: async () => {},
        restoreCoreSessionOutcome: async () => ({ status: 'none' })
    };
    vm.createContext(c);
    vm.runInContext(functions([
        'isWalletExplicitlyDisconnected', 'isWalletResultCurrent', 'beginWalletConnection',
        'requestProviderAccounts', 'getWalletProviderCandidates', 'reconcileActiveWalletFromProviders',
        'handleProviderAccountsChanged', 'handleProviderChainConfirmed', 'getProviderWalletState',
        'getAuthoritativeWalletState', 'getRestoredWalletState', 'dispatchWalletStateChanged',
        'applyConfirmedWalletState', 'finishWalletHydration', 'clearWalletConnectionCache',
        'scheduleWalletReconciliation', 'processWalletResume', 'resetWalletConnection',
        'handleAppKitEvent', 'findWalletConnectUri', 'waitForConfirmedDesktopWallet',
        'connectExternalMobileStandard', 'applyCoreConnectedSession', 'shouldDeferMobileAuthentication'
    ]) + '\n' + assignment('resetWalletConnection') + '\n' + assignment('safeConnectWallet') +
        `\nthis.onAccount = ${accountCallback};\nthis.bootRestore = async () => { ${bootGate} };`, c);
    return Object.assign(c, { events, nav, timers });
}

async function connected(c, p, address = p.selectedAddress) {
    await c.handleProviderAccountsChanged([address], 'test selected provider', p, { allowProviderChange: true });
}
function selectEvent(c, event, name, extra = {}) {
    c.handleAppKitEvent({ timestamp: Date.now(), data: { type: 'track', event, properties: { name, ...extra } } });
}

test('explicit logout survives passive accounts, chain events, focus, and stale extension authorization', async () => {
    const c = harness();
    const phantom = c.window.ethereum = provider(A);
    await connected(c, phantom);
    assert.equal(await c.window.resetWalletConnection(), true);
    assert.equal(c.localStorage.getItem('artsoul_disconnecting'), 'true');
    assert.equal(c.sessionStorage.getItem('artsoul_disconnecting'), 'true');
    c.events.length = 0;
    await c.handleProviderAccountsChanged([A], 'phantom accountsChanged', phantom);
    await c.handleProviderAccountsChanged([], 'phantom accountsChanged', phantom);
    await c.handleProviderChainConfirmed(1, 'phantom chainChanged', phantom);
    await c.onAccount({ address: A, chainId: 1, isConnected: true });
    await c.processWalletResume('window focus');
    assert.equal(await c.reconcileActiveWalletFromProviders(), null);
    assert.equal(c.window.currentWalletAddress, null);
    assert.equal(c.localStorage.getItem('artsoul_wallet'), null);
    assert.equal(c.getProviderWalletState(), null);
    assert.equal(c.getRestoredWalletState().isConnected, false);
    assert.equal(c.events.length, 0);
    assert.equal(phantom.reads.length, 0, 'logout must suppress passive extension reads');
});

test('logout persists in a reload and a new same-origin tab and skips mobile restore', async () => {
    const local = storage();
    const first = harness({ local });
    await first.window.resetWalletConnection();
    for (const session of [first.sessionStorage, storage()]) {
        const c = harness({ local, session, mobile: true });
        c.window.ethereum = provider(A);
        let restores = 0;
        c.restoreCoreSessionOutcome = async () => { restores++; return {}; };
        await c.bootRestore();
        assert.equal(restores, 0);
        assert.equal(c.getRestoredWalletState().isConnected, false);
        assert.equal(local.getItem('artsoul_disconnecting'), 'true');
    }
});

for (const phase of ['accounts', 'authentication', 'chain']) {
    test(`logout rejects reconciliation delayed during ${phase}`, async () => {
        const c = harness();
        const p = c.window.ethereum = provider(A);
        const paused = deferred();
        const started = deferred();
        if (phase === 'authentication') {
            c.signOutMismatchedSession = () => { started.resolve(); return paused.promise; };
        } else {
            const request = p.request.bind(p);
            p.request = payload => {
                if (payload.method === (phase === 'accounts' ? 'eth_accounts' : 'eth_chainId')) {
                    started.resolve(); return paused.promise;
                }
                return request(payload);
            };
        }
        const pending = c.reconcileActiveWalletFromProviders();
        await started.promise;
        await c.window.resetWalletConnection();
        c.events.length = 0;
        paused.resolve(phase === 'accounts' ? [A] : phase === 'chain' ? 1 : undefined);
        assert.equal(await pending, null);
        assert.equal(c.window.currentWalletAddress, null);
        assert.equal(c.window.currentChainId, null);
        assert.equal(c.events.length, 0);
    });
}

test('late AppKit account confirmation cannot restore a wallet after logout', async () => {
    const c = harness();
    c.selectedProvider = provider(A);
    const pendingAccounts = deferred();
    c.selectedProvider.request = () => pendingAccounts.promise;
    const pending = c.onAccount({ address: A, isConnected: true, chainId: 1 });
    await c.window.resetWalletConnection();
    c.events.length = 0;
    pendingAccounts.resolve([A]);
    await pending;
    assert.equal(c.window.currentWalletAddress, null);
    assert.equal(c.events.length, 0);
});

test('a stale provider disconnect cannot clear a newly chosen wallet after its sign-out completes', async () => {
    const c = harness();
    const first = provider(A);
    await connected(c, first);
    c.lastConfirmedWalletAt = 0;
    const signOut = deferred();
    c.window.SupabaseAuth.signOut = () => signOut.promise;
    const pending = c.handleProviderAccountsChanged([], 'old provider', first);
    c.beginWalletConnection();
    await connected(c, provider(B));
    c.events.length = 0;
    signOut.resolve();
    await pending;
    assert.equal(c.window.currentWalletAddress, B);
    assert.equal(c.events.length, 0);
});

test('chooser ignores stale AppKit and injected accounts until the selected connector succeeds', async () => {
    const c = harness();
    const old = c.window.ethereum = provider(A);
    await c.window.resetWalletConnection();
    c.beginWalletConnection();
    c.activeConnectAttempt = { startedAt: Date.now(), accountRevision: c.appKitAccountRevision };
    c.selectedProvider = old;
    await c.onAccount({ address: A, isConnected: true });
    assert.equal(await c.reconcileActiveWalletFromProviders(), null);
    assert.equal(c.getRestoredWalletState().isConnected, false);
    selectEvent(c, 'SELECT_WALLET', 'Other wallet', { platform: 'browser' });
    await c.onAccount({ address: A, isConnected: true });
    selectEvent(c, 'CONNECT_SUCCESS', 'Old wallet', { method: 'browser' });
    assert.equal(await c.reconcileActiveWalletFromProviders(), null);
    c.selectedProvider = provider(B, 84532);
    await c.onAccount({ address: B, isConnected: true, chainId: 84532 });
    selectEvent(c, 'CONNECT_SUCCESS', 'Other wallet', { method: 'browser' });
    assert.equal((await c.reconcileActiveWalletFromProviders()).address, B);
    c.activeConnectAttempt = null;
    await c.handleProviderAccountsChanged([A], 'old wallet event', old);
    await c.handleProviderAccountsChanged([], 'old wallet empty event', old);
    await c.handleProviderChainConfirmed(1, 'old wallet chain', old);
    assert.equal(c.window.currentWalletAddress, B);
    assert.equal(c.window.currentChainId, 84532);
    assert.equal(c.getRestoredWalletState().address, B);
    assert.equal(old.reads.length, 0);
    await c.handleProviderAccountsChanged([A], 'selected wallet changes account', c.selectedProvider);
    assert.equal(c.window.currentWalletAddress, A, 'real account switching remains supported');
});

test('cancelling a reconnect restores logout intent, including after reload', async () => {
    const c = harness();
    c.window.ethereum = provider(A);
    c.window.web3Modal = { disconnect: async () => {} };
    await c.window.resetWalletConnection();
    c.openAppKitConnectModal = async () => {};
    c.waitForConfirmedDesktopWallet = async () => null;
    assert.equal(await c.window.safeConnectWallet(), null);
    assert.equal(c.localStorage.getItem('artsoul_disconnecting'), 'true');
    await c.processWalletResume('focus after cancellation');
    assert.equal(await c.reconcileActiveWalletFromProviders(), null);
    const reload = harness({ local: c.localStorage });
    reload.window.ethereum = provider(A);
    assert.equal(reload.getRestoredWalletState().isConnected, false);
});

test('new Connect waits for ongoing logout teardown before allowing the chosen wallet', async () => {
    const c = harness();
    const teardown = deferred();
    c.disconnectCoreWallet = () => teardown.promise;
    c.window.web3Modal = { disconnect: async () => {} };
    let opened = false;
    c.openAppKitConnectModal = async () => {
        opened = true;
        assert.equal(c.localStorage.getItem('artsoul_disconnecting'), null);
        selectEvent(c, 'SELECT_WALLET', 'Other wallet', { platform: 'browser' });
        c.selectedProvider = provider(B, 84532);
        await c.onAccount({ address: B, chainId: 84532, isConnected: true });
        selectEvent(c, 'CONNECT_SUCCESS', 'Other wallet', { method: 'browser' });
    };
    const logout = c.window.resetWalletConnection();
    const connect = c.window.safeConnectWallet();
    await Promise.resolve();
    assert.equal(opened, false);
    teardown.resolve();
    assert.equal(await logout, true);
    assert.equal(await connect, B);
    assert.equal(c.window.currentWalletAddress, B);
    assert.equal(c.localStorage.getItem('artsoul_disconnecting'), null);
    assert.equal(c.sessionStorage.getItem('artsoul_disconnecting'), null);
});

test('authorized mobile restore and transient empty accounts retain the live core session', async () => {
    const c = harness({ mobile: true });
    let restores = 0;
    c.restoreCoreSessionOutcome = async () => { restores++; return { status: 'restored' }; };
    await c.bootRestore();
    assert.equal(restores, 1);
    const core = provider(A);
    c.getConnectedCoreProvider = () => core;
    c.isCoreSessionActive = () => true;
    c.applyConfirmedWalletState({ address: A, chainId: 1 });
    c.activeWalletProvider = core;
    c.lastConfirmedWalletAt = 0;
    await c.handleProviderAccountsChanged([], 'temporary relay drop', core);
    assert.equal(c.window.currentWalletAddress, A);
});

for (const method of ['browser', 'qrcode']) {
    test(`first-time desktop ${method} connection accepts the selected provider on its current chain`, async () => {
        const c = harness();
        c.window.web3Modal = {};
        c.window.ethereum = provider(A);
        c.openAppKitConnectModal = async () => {
            selectEvent(c, 'SELECT_WALLET', method === 'qrcode' ? 'WalletConnect' : 'Selected wallet', { platform: method });
            c.selectedProvider = provider(B, 1);
            await c.onAccount({ address: B, chainId: 1, isConnected: true });
            selectEvent(c, 'CONNECT_SUCCESS', 'Selected wallet', { method });
        };
        assert.equal(await c.window.safeConnectWallet(), B);
        assert.equal(c.window.currentWalletAddress, B);
        assert.equal(c.window.currentChainId, 1);
        assert.equal(c.window.ethereum.reads.length, 0);
    });
}

test('first-time injected mobile connection uses the requested wallet accounts', async () => {
    const c = harness({ mobile: true });
    c.isInjectedWalletBrowser = () => true;
    c.window.ethereum = provider(B);
    c.requestInjectedMobileAccounts = async () => [B];
    assert.equal(await c.window.safeConnectWallet(), B);
    assert.equal(c.window.currentWalletAddress, B);
});

test('first-time external mobile connection and cancelled explicit reconnect keep their existing semantics', async () => {
    const c = harness({ mobile: true });
    c.connectCoreWallet = async () => ({ address: B, chainId: 1, provider: provider(B), restored: false });
    assert.equal(await c.window.safeConnectWallet(), B);
    assert.equal(c.window.currentWalletAddress, B);
    await c.window.resetWalletConnection();
    c.connectCoreWallet = async () => { throw Object.assign(new Error('User cancelled'), { code: 4001 }); };
    assert.equal(await c.window.safeConnectWallet(), null);
    assert.equal(c.localStorage.getItem('artsoul_disconnecting'), 'true');
});

test('logout cleanup retries cannot close a newer connection chooser, even when already queued', async () => {
    const c = harness();
    let closes = 0;
    c.modal = c.window.web3Modal = { getState: () => ({ open: true }), close: async () => { closes++; } };
    vm.runInContext(functions(['safeCloseModal', 'scheduleModalCloseRetries']), c);
    c.scheduleModalCloseRetries('disconnect complete');
    const staleTimer = c.modalCloseRetryTimer;
    const alreadyQueued = c.timers.get(staleTimer).callback;
    c.beginWalletConnection();
    assert.equal(c.timers.has(staleTimer), false, 'new connection cancels scheduled cleanup');
    alreadyQueued();
    await Promise.resolve();
    assert.equal(closes, 0, 'an already-queued stale callback is also inert');
    c.scheduleModalCloseRetries('current connection complete');
    c.timers.get(c.modalCloseRetryTimer).callback();
    await Promise.resolve();
    assert.equal(closes, 1, 'cleanup still runs for its own connection revision');
});

test('a new chooser waits for an already-running modal close before it opens', async () => {
    const c = harness();
    const closing = deferred();
    const calls = [];
    c.sleep = () => new Promise(() => {});
    c.modal = c.window.web3Modal = {
        getState: () => ({ open: true }),
        close: async () => { await closing.promise; calls.push('closed'); },
        open: async () => { calls.push('opened'); }
    };
    vm.runInContext(functions(['safeCloseModal', 'openAppKitConnectModal']), c);
    const cleanup = c.safeCloseModal('old connection cleanup');
    c.beginWalletConnection();
    const opening = c.openAppKitConnectModal({ cancelled: false });
    await Promise.resolve();
    assert.deepEqual(calls, []);
    closing.resolve();
    await Promise.all([cleanup, opening]);
    assert.deepEqual(calls, ['closed', 'opened']);
});

test('a stale failed close cannot fall through to closing the newer modal', async () => {
    const c = harness();
    const closing = deferred();
    let fallbackCloses = 0;
    c.sleep = () => new Promise(() => {});
    c.modal = { getState: () => ({ open: true }), close: () => closing.promise.then(() => { throw new Error('old close failed'); }) };
    c.window.web3Modal = { getState: () => ({ open: true }), close: async () => { fallbackCloses++; } };
    vm.runInContext(functions(['safeCloseModal']), c);
    const cleanup = c.safeCloseModal('old connection cleanup');
    c.beginWalletConnection();
    closing.resolve();
    assert.equal(await cleanup, false);
    assert.equal(fallbackCloses, 0);
});
