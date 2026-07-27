// Behavioral coverage for the external-mobile WalletConnect lifecycle.
// The module under test is driven through fake providers, fake modals and
// deterministic deferred promises — no timers are used as correctness
// mechanisms and no source strings stand in for behavior.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const coreWalletSource = read('wallet-core-connect.js');
const appKitSource = read('appkit-init.js');

const ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
const TOPIC_A = 'aaaaaaaabbbbbbbbccccccccdddddddd';
const TOPIC_B = 'eeeeeeeeffffffff1111111122222222';

const CORE_EXPORTS = [
    'CORE_LIFECYCLE',
    'configureCoreWallet',
    'connectCoreWallet',
    'disconnectCoreWallet',
    'disconnectCoreWalletOutcome',
    'getConnectedCoreProvider',
    'getCoreLifecycleState',
    'getCoreSessionAddress',
    'getCoreSessionLiveness',
    'getCoreSessionMethods',
    'isCoreConnectInFlight',
    'isCoreSessionActive',
    'isCoreTopicTombstoned',
    'readAuthoritativeCoreSession',
    'requestCoreWalletMethod',
    'resolveCoreSessionChainId',
    'restoreCoreSessionOutcome',
    'setCoreAuthLifecycleState'
];

function flush(times = 12) {
    let chain = Promise.resolve();
    for (let index = 0; index < times; index += 1) {
        chain = chain.then(() => new Promise((resolve) => setTimeout(resolve, 0)));
    }
    return chain;
}

function createDeferred() {
    const deferred = {};
    deferred.promise = new Promise((resolve, reject) => {
        deferred.resolve = resolve;
        deferred.reject = reject;
    });
    deferred.promise.catch(() => {});
    return deferred;
}

function buildSession(overrides = {}) {
    const {
        topic = TOPIC_A,
        chains = ['eip155:84532'],
        accounts = [`eip155:84532:${ADDRESS}`],
        methods = ['personal_sign', 'eth_sendTransaction'],
        expiry = Math.floor(Date.now() / 1000) + 3600
    } = overrides;
    return {
        topic,
        expiry,
        namespaces: {
            eip155: { chains, accounts, methods, events: ['chainChanged', 'accountsChanged'] }
        }
    };
}

function createFakeProvider() {
    const handlers = new Map();
    const storedSessions = [];
    let connectDeferred = null;

    const provider = {
        session: null,
        accounts: [],
        chainId: 84532,
        connectCalls: 0,
        disconnectCalls: 0,
        resetCalls: 0,
        cleanupCalls: 0,
        signClientRequests: [],
        signerRequests: [],
        signer: {
            uri: null,
            client: {
                session: { getAll: () => storedSessions.slice() },
                request: async (args) => {
                    provider.signClientRequests.push(args);
                    return '0xsignature';
                }
            },
            cleanup: async () => {
                provider.cleanupCalls += 1;
                provider.session = null;
            },
            request: async (args, chain) => {
                provider.signerRequests.push({ args, chain });
                return null;
            }
        },
        on(name, handler) {
            if (!handlers.has(name)) handlers.set(name, new Set());
            handlers.get(name).add(handler);
            return provider;
        },
        removeListener(name, handler) {
            handlers.get(name)?.delete(handler);
            return provider;
        },
        reset() {
            // Mirrors EthereumProvider.reset(): SDK-local chain state drops to 1.
            provider.resetCalls += 1;
            provider.chainId = 1;
            provider.accounts = [];
        },
        connect() {
            provider.connectCalls += 1;
            connectDeferred = createDeferred();
            return connectDeferred.promise;
        },
        async disconnect() {
            provider.disconnectCalls += 1;
            const topic = provider.session?.topic;
            const index = storedSessions.findIndex((session) => session.topic === topic);
            if (index >= 0) storedSessions.splice(index, 1);
            provider.session = null;
        }
    };

    provider.__emit = (name, payload) => {
        for (const handler of handlers.get(name) || []) handler(payload);
    };
    provider.__emitDisplayUri = (uri) => {
        provider.signer.uri = uri;
        provider.__emit('display_uri', uri);
    };
    provider.__settle = (session = buildSession()) => {
        storedSessions.push(session);
        provider.session = session;
        return session;
    };
    provider.__storeSession = (session) => {
        storedSessions.push(session);
    };
    provider.__resolveConnect = (value) => connectDeferred?.resolve(value);
    provider.__rejectConnect = (error) => connectDeferred?.reject(error);
    provider.__connectPending = () => Boolean(connectDeferred);
    return provider;
}

function createFakeModal() {
    const instances = [];
    class FakeModal {
        constructor(options) {
            this.options = options;
            this.open = false;
            this.openCalls = [];
            this.closeCalls = 0;
            this.subscribers = new Set();
            instances.push(this);
        }

        async openModal({ uri }) {
            this.openCalls.push(uri);
            this.open = true;
            for (const subscriber of this.subscribers) subscriber({ open: true });
        }

        closeModal() {
            this.closeCalls += 1;
            if (!this.open) return;
            this.open = false;
            for (const subscriber of this.subscribers) subscriber({ open: false });
        }

        subscribeModal(subscriber) {
            this.subscribers.add(subscriber);
            return () => this.subscribers.delete(subscriber);
        }

        // The user dismissing the official modal.
        __userClose() {
            this.open = true;
            this.closeModal();
        }
    }
    return { FakeModal, instances };
}

function loadCoreWallet(options = {}) {
    const executable = coreWalletSource
        .replace(/import \{ WalletConnectModal \} from [^;]+;/, 'const WalletConnectModal = window.__WalletConnectModal;')
        .replace(/\bexport\s+/g, '');
    const { FakeModal, instances } = createFakeModal();
    const windowListeners = new Map();
    const win = {
        __WalletConnectModal: FakeModal,
        location: { origin: 'https://artsoul.vercel.app' },
        addEventListener(type, handler) {
            if (!windowListeners.has(type)) windowListeners.set(type, new Set());
            windowListeners.get(type).add(handler);
        }
    };
    const api = new Function(
        'window',
        `${executable}\nreturn { ${CORE_EXPORTS.join(', ')} };`
    )(win);

    const provider = options.provider || createFakeProvider();
    const logs = [];
    const adopted = [];
    const lifecycle = [];
    api.configureCoreWallet({
        projectId: 'test-project',
        metadata: { name: 'ArtSoul', url: 'https://artsoul.vercel.app', icons: [] },
        createProvider: async () => provider,
        log: (step, detail) => logs.push({ step, detail }),
        onSessionAdopted: (snapshot) => adopted.push(snapshot),
        onLifecycle: (state, detail) => lifecycle.push({ state, detail })
    });

    const dispatchUnhandledRejection = (reason) => {
        let prevented = false;
        const event = { reason, preventDefault: () => { prevented = true; } };
        for (const handler of windowListeners.get('unhandledrejection') || []) handler(event);
        return prevented;
    };

    return { api, provider, modals: instances, logs, adopted, lifecycle, dispatchUnhandledRejection };
}

// 1. Cold connection success.
test('cold connect resolves only after an authoritative session provides address, chain and personal_sign', async () => {
    const { api, provider, modals, lifecycle } = loadCoreWallet();
    const connectPromise = api.connectCoreWallet();
    await flush();

    assert.equal(provider.connectCalls, 1);
    provider.__emitDisplayUri('wc:pairing-a');
    await flush();
    assert.deepEqual(modals[0].openCalls, ['wc:pairing-a']);
    assert.equal(api.getCoreLifecycleState(), 'waiting-for-wallet');

    provider.__settle(buildSession());
    provider.__resolveConnect();
    const connected = await connectPromise;

    assert.equal(connected.address, ADDRESS);
    assert.equal(connected.chainId, 84532);
    assert.equal(connected.restored, false);
    assert.equal(api.getCoreLifecycleState(), 'connected');
    assert.equal(modals[0].open, false);
    assert.equal(api.isCoreConnectInFlight(), false);
    assert.deepEqual(
        lifecycle.map((entry) => entry.state),
        ['pairing', 'waiting-for-wallet', 'settling-session', 'connected']
    );
});

// 2. Restored healthy session.
test('a stored healthy session restores without creating a pairing', async () => {
    const provider = createFakeProvider();
    const session = buildSession();
    provider.__settle(session);
    const { api } = loadCoreWallet({ provider });

    const outcome = await api.restoreCoreSessionOutcome({ timeoutMs: 200 });
    assert.equal(outcome.status, 'restored');
    assert.equal(outcome.session.address, ADDRESS);
    assert.equal(outcome.session.chainId, 84532);
    assert.equal(provider.connectCalls, 0);
    assert.equal(api.getCoreLifecycleState(), 'connected');

    // Connecting on top of a live session reuses it — never a second topic.
    const reused = await api.connectCoreWallet();
    assert.equal(reused.restored, true);
    assert.equal(provider.connectCalls, 0);
});

// 3. Connect double-tap.
test('a second Connect tap reuses the same attempt promise and the same pairing', async () => {
    const { api, provider, modals } = loadCoreWallet();
    const first = api.connectCoreWallet();
    const second = api.connectCoreWallet();
    assert.equal(first, second, 'repeated taps must reuse one promise');
    await flush();
    provider.__emitDisplayUri('wc:pairing-a');
    await flush();

    assert.equal(provider.connectCalls, 1, 'exactly one SDK connect attempt');
    assert.equal(modals[0].openCalls.length, 1, 'the pairing URI is never regenerated');

    provider.__settle(buildSession());
    provider.__resolveConnect();
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a.address, b.address);
});

// 4. Disconnect double-tap.
test('repeated Disconnect taps are idempotent and report what actually happened', async () => {
    const { api, provider } = loadCoreWallet();
    const connectPromise = api.connectCoreWallet();
    await flush();
    provider.__emitDisplayUri('wc:pairing-a');
    await flush();
    provider.__settle(buildSession());
    provider.__resolveConnect();
    await connectPromise;

    const [first, second] = await Promise.all([
        api.disconnectCoreWalletOutcome(),
        api.disconnectCoreWalletOutcome()
    ]);
    assert.equal(first, second, 'concurrent taps join one teardown');
    assert.equal(first.disconnected, true);
    assert.equal(first.hadSession, true);
    assert.equal(provider.disconnectCalls, 1);

    const third = await api.disconnectCoreWalletOutcome();
    assert.equal(third.disconnected, false);
    assert.equal(third.hadSession, false);
    assert.equal(third.reason, 'no-active-session');
    assert.equal(provider.disconnectCalls, 1, 'a second teardown never runs');
    assert.equal(api.getCoreLifecycleState(), 'disconnected');
});

// 5. Disconnect while a connect is pending.
test('Disconnect settles the pending attempt and tears down the session it later produces', async () => {
    const { api, provider, adopted } = loadCoreWallet();
    const connectPromise = api.connectCoreWallet();
    await flush();
    provider.__emitDisplayUri('wc:pairing-a');
    await flush();

    const disconnectOutcome = await api.disconnectCoreWalletOutcome();
    assert.equal(disconnectOutcome.hadSession, false);
    assert.equal(disconnectOutcome.cancelledAttempts, 1);

    await assert.rejects(connectPromise, (error) => error.code === 4001);
    assert.equal(api.isCoreConnectInFlight(), true, 'the uncancellable SDK task is still tracked');

    // The wallet approval lands anyway.
    provider.__settle(buildSession());
    provider.__resolveConnect();
    await flush();

    assert.deepEqual(adopted, [], 'a disconnected attempt never restores UI state');
    assert.equal(provider.disconnectCalls, 1, 'the late session is torn down');
    assert.equal(api.isCoreSessionActive(), false);
    assert.equal(api.getCoreLifecycleState(), 'disconnected');
});

// 5b. A cancelled-but-not-disconnected attempt is adopted, never abandoned.
test('a modal cancellation still adopts the session the user approved', async () => {
    const { api, provider, modals, adopted } = loadCoreWallet();
    const connectPromise = api.connectCoreWallet();
    await flush();
    provider.__emitDisplayUri('wc:pairing-a');
    await flush();

    modals[0].__userClose();
    await assert.rejects(connectPromise, (error) => error.code === 4001);

    provider.__settle(buildSession());
    provider.__resolveConnect();
    await flush();

    assert.equal(adopted.length, 1);
    assert.equal(adopted[0].address, ADDRESS);
    assert.equal(adopted[0].chainId, 84532);
    assert.equal(adopted[0].adopted, true);
    assert.equal(api.getCoreLifecycleState(), 'connected');
    assert.equal(provider.disconnectCalls, 0, 'an approved session is never silently deleted');
});

// 6. Late session event after disconnect / 6b. tombstoned topic.
test('a tombstoned topic can never become current again', async () => {
    const { api, provider } = loadCoreWallet();
    const connectPromise = api.connectCoreWallet();
    await flush();
    provider.__emitDisplayUri('wc:pairing-a');
    await flush();
    const session = provider.__settle(buildSession());
    provider.__resolveConnect();
    await connectPromise;

    await api.disconnectCoreWalletOutcome();
    assert.equal(api.isCoreTopicTombstoned(TOPIC_A), true);

    // A late SDK callback re-caches the very same topic (and the store even
    // reports it again). It must stay dead.
    provider.session = session;
    provider.__storeSession(session);
    const liveness = api.getCoreSessionLiveness(provider);
    assert.equal(liveness.live, false);
    assert.equal(liveness.reason, 'session-topic-tombstoned');
    assert.equal(api.isCoreSessionActive(), false);
    assert.equal(api.getConnectedCoreProvider(), null);
});

// 7. provider.connect() resolves before accounts arrive.
test('connect() resolving without an account is an explicit failure, never a success', async () => {
    const { api, provider } = loadCoreWallet();
    const connectPromise = api.connectCoreWallet();
    await flush();
    provider.__emitDisplayUri('wc:pairing-a');
    await flush();

    provider.__settle(buildSession({ accounts: [] }));
    provider.__resolveConnect();

    await assert.rejects(connectPromise, (error) => (
        error.code === 'CORE_SESSION_NOT_LIVE' && error.reason === 'session-address-missing'
    ));
    assert.equal(api.getCoreLifecycleState(), 'disconnected');
});

// 7b. A session without personal_sign is not SIWE-capable readiness.
test('connect() does not report success without the personal_sign permission', async () => {
    const { api, provider } = loadCoreWallet();
    const connectPromise = api.connectCoreWallet();
    await flush();
    provider.__emitDisplayUri('wc:pairing-a');
    await flush();

    provider.__settle(buildSession({ methods: ['eth_sendTransaction'] }));
    provider.__resolveConnect();

    await assert.rejects(connectPromise, (error) => (
        error.code === 'CORE_SESSION_NOT_LIVE' &&
        error.reason === 'session-method-not-approved' &&
        error.detail.missingMethods.includes('personal_sign')
    ));
});

// 8. Address arrives before chain.
test('a connected address is never published without the chain from the same snapshot', async () => {
    const { api, provider } = loadCoreWallet();
    // SDK-local chain state is stale/reset (EthereumProvider.reset() -> 1) and
    // several chains are approved: the old resolver returned null here.
    provider.chainId = 1;
    const session = buildSession({
        chains: ['eip155:84532', 'eip155:8453'],
        accounts: [`eip155:8453:${ADDRESS}`, `eip155:84532:${ADDRESS}`]
    });
    provider.__settle(session);

    const snapshot = api.readAuthoritativeCoreSession(provider);
    assert.equal(snapshot.ready, true);
    assert.equal(snapshot.address, ADDRESS);
    assert.equal(snapshot.chainId, 84532);
    assert.equal(api.resolveCoreSessionChainId(provider), 84532);
    assert.notEqual(api.resolveCoreSessionChainId(provider), null);
});

// 9. Chain arrives before address.
test('a chainChanged before the session settles publishes nothing', async () => {
    const { api, provider, adopted } = loadCoreWallet();
    const connectPromise = api.connectCoreWallet();
    await flush();
    provider.__emitDisplayUri('wc:pairing-a');
    await flush();

    provider.__emit('chainChanged', '0x14a34');
    provider.__emit('accountsChanged', []);
    await flush();

    assert.equal(api.isCoreSessionActive(), false);
    assert.equal(api.getCoreLifecycleState(), 'waiting-for-wallet');
    assert.deepEqual(adopted, []);

    provider.__settle(buildSession());
    provider.__resolveConnect();
    const connected = await connectPromise;
    assert.equal(connected.chainId, 84532);
});

// 10. Two topics race.
test('a second tap after a cancelled attempt joins the live pairing instead of proposing a second topic', async () => {
    const { api, provider, modals } = loadCoreWallet();
    const first = api.connectCoreWallet();
    await flush();
    provider.__emitDisplayUri('wc:pairing-a');
    await flush();

    modals[0].__userClose();
    await assert.rejects(first, (error) => error.code === 4001);

    const second = api.connectCoreWallet();
    await flush();
    assert.equal(provider.connectCalls, 1, 'no second proposal is ever published');
    assert.deepEqual(modals[0].openCalls, ['wc:pairing-a', 'wc:pairing-a'], 'the same pairing URI is reused');

    provider.__settle(buildSession({ topic: TOPIC_A }));
    provider.__resolveConnect();
    const connected = await second;
    assert.equal(connected.address, ADDRESS);
    assert.equal(provider.session.topic, TOPIC_A);
    assert.equal(api.isCoreTopicTombstoned(TOPIC_B), false);
});

// 11. Stale-topic "No matching key".
test('a stale-topic SDK rejection is neutralized and can never destroy a live session', async () => {
    const { api, provider, dispatchUnhandledRejection } = loadCoreWallet();
    const connectPromise = api.connectCoreWallet();
    await flush();
    provider.__emitDisplayUri('wc:pairing-a');
    await flush();
    provider.__settle(buildSession({ topic: TOPIC_A }));
    provider.__resolveConnect();
    await connectPromise;

    // The wallet emits chainChanged for a topic this page no longer owns.
    // EthereumProvider.switchEthereumChain() fires that request without a
    // catch, so it surfaces as an unhandled rejection.
    const prevented = dispatchUnhandledRejection(
        new Error(`No matching key. session topic doesn't exist: ${TOPIC_B}`)
    );
    assert.equal(prevented, true, 'the rejection never reaches the application');
    assert.equal(api.isCoreTopicTombstoned(TOPIC_B), true);

    // The live, store-confirmed session survives untouched.
    assert.equal(api.isCoreTopicTombstoned(TOPIC_A), false);
    assert.equal(api.isCoreSessionActive(), true);
    assert.equal(provider.disconnectCalls, 0);
    assert.equal(provider.cleanupCalls, 0);

    // A rejection naming the CURRENT topic while the store still confirms it
    // is noise, not a teardown order.
    dispatchUnhandledRejection(new Error(`No matching key. session topic doesn't exist: ${TOPIC_A}`));
    assert.equal(api.isCoreSessionActive(), true);
});

// 12. focus + visibility fire together.
test('a resume burst reconciles once, not once per duplicated browser event', () => {
    const block = appKitSource.match(
        /const WALLET_RESUME_BURST_WINDOW_MS[\s\S]*?function notifyWalletResume\(source\) \{[\s\S]*?\n\}/
    )?.[0];
    assert.ok(block, 'the resume coalescing block must exist');

    const processed = [];
    const timers = [];
    const notifyWalletResume = new Function(
        'processWalletResume',
        'setTimeout',
        `${block}\nreturn notifyWalletResume;`
    )(
        (source) => processed.push(source),
        (handler) => { timers.push(handler); return timers.length; }
    );

    notifyWalletResume('pageshow');
    notifyWalletResume('visibility return');
    notifyWalletResume('window focus');
    assert.equal(timers.length, 1, 'one coalesced reconciliation per burst');
    timers[0]();
    assert.deepEqual(processed, ['pageshow + visibility return + window focus']);

    // A later, separate resume still reconciles.
    notifyWalletResume('window focus');
    assert.equal(timers.length, 2);
    timers[1]();
    assert.deepEqual(processed[1], 'window focus');
});

// 13. SIWE personal_sign routing.
test('SIWE personal_sign runs through SignClient once authoritative readiness exists', async () => {
    const { api, provider } = loadCoreWallet();
    provider.__settle(buildSession());
    assert.equal(api.readAuthoritativeCoreSession(provider).ready, true);

    const signature = await api.requestCoreWalletMethod(provider, {
        method: 'personal_sign',
        params: ['0xmessage', ADDRESS]
    });
    assert.equal(signature, '0xsignature');
    assert.equal(provider.signClientRequests.length, 1);
    assert.equal(provider.signClientRequests[0].topic, TOPIC_A);
    assert.equal(provider.signClientRequests[0].chainId, 'eip155:84532');
    assert.equal(provider.signClientRequests[0].request.method, 'personal_sign');
    assert.equal(provider.signerRequests.length, 0, 'required methods never take the UniversalProvider route');

    // Network management keeps the UniversalProvider route.
    await api.requestCoreWalletMethod(provider, { method: 'wallet_switchEthereumChain', params: [] });
    assert.equal(provider.signerRequests.length, 1);
    assert.equal(provider.signerRequests[0].chain, 'eip155:84532');
});

test('personal_sign is refused when the approved session never granted it', async () => {
    const { api, provider } = loadCoreWallet();
    provider.__settle(buildSession({ methods: ['eth_sendTransaction'] }));
    await assert.rejects(
        api.requestCoreWalletMethod(provider, { method: 'personal_sign', params: [] }),
        (error) => error.code === 'CORE_METHOD_NOT_APPROVED'
    );
    assert.equal(provider.signClientRequests.length, 0);
});

// 14. Foreign-chain connection accepted for browsing.
test('a session settled on a foreign chain is accepted for browsing', async () => {
    const { api, provider } = loadCoreWallet();
    const connectPromise = api.connectCoreWallet();
    await flush();
    provider.__emitDisplayUri('wc:pairing-a');
    await flush();

    provider.chainId = 8453;
    provider.__settle(buildSession({
        chains: ['eip155:8453'],
        accounts: [`eip155:8453:${ADDRESS}`]
    }));
    provider.__resolveConnect();

    const connected = await connectPromise;
    assert.equal(connected.address, ADDRESS);
    assert.equal(connected.chainId, 8453);
    assert.equal(api.getCoreLifecycleState(), 'connected');
});

// 15. Base Sepolia is requested only at write time.
test('connecting never requests a network switch; the write guard owns Base Sepolia', async () => {
    const { api, provider } = loadCoreWallet();
    const connectPromise = api.connectCoreWallet();
    await flush();
    provider.__emitDisplayUri('wc:pairing-a');
    await flush();
    provider.__settle(buildSession({
        chains: ['eip155:8453'],
        accounts: [`eip155:8453:${ADDRESS}`]
    }));
    provider.__resolveConnect();
    await connectPromise;

    assert.deepEqual(provider.signClientRequests, []);
    assert.deepEqual(provider.signerRequests, []);
    assert.doesNotMatch(coreWalletSource, /wallet_switchEthereumChain/);
    assert.doesNotMatch(coreWalletSource, /wallet_addEthereumChain/);

    const standard = appKitSource.match(/async function connectExternalMobileStandard[\s\S]*?\n\}/)?.[0] || '';
    assert.doesNotMatch(standard, /wallet_switchEthereumChain|wallet_addEthereumChain/);
    // The Base Sepolia requirement lives in the write guard only.
    assert.match(appKitSource, /window\.ensureArtSoulWriteNetwork = async/);
});

// 16. Desktop and injected wallet paths are untouched.
test('only the mobile external browser takes the core path', () => {
    const safeConnect = appKitSource.match(/window\.safeConnectWallet = async \(\) => \{[\s\S]*?\n\};/)?.[0] || '';
    assert.ok(safeConnect, 'safeConnectWallet must exist');
    assert.match(safeConnect, /if \(mobileConnect && !injectedMobileConnect\) \{\s*\n\s*return connectExternalMobileStandard\(\);/);
    // The injected-mobile and AppKit desktop branches keep their own flow.
    assert.match(safeConnect, /const accounts = await requestInjectedMobileAccounts\(\);/);
    assert.match(safeConnect, /await openAppKitConnectModal\(attempt\);/);
    assert.match(safeConnect, /await waitForConfirmedDesktopWallet\(WALLET_CONNECT_TIMEOUT_DESKTOP\);/);
    // Reconciliation from AppKit/Wagmi/injected reads stays off the core path.
    const reconciliation = appKitSource.match(/function scheduleWalletReconciliation[\s\S]*?\n\}/)?.[0] || '';
    assert.match(reconciliation, /if \(isMobileDevice\(\) && !isInjectedWalletBrowser\(\)\) return;/);
});

// Lifecycle surface.
test('the app layer can only mark SIWE states on top of a proven live session', async () => {
    const { api, provider } = loadCoreWallet();
    assert.equal(api.setCoreAuthLifecycleState('authenticated'), 'disconnected');

    const connectPromise = api.connectCoreWallet();
    await flush();
    provider.__emitDisplayUri('wc:pairing-a');
    await flush();
    provider.__settle(buildSession());
    provider.__resolveConnect();
    await connectPromise;

    assert.equal(api.setCoreAuthLifecycleState('siwe-signing'), 'siwe-signing');
    assert.equal(api.setCoreAuthLifecycleState('authenticated'), 'authenticated');
    assert.equal(api.setCoreAuthLifecycleState('pairing'), 'authenticated', 'connection states stay module-owned');
});
