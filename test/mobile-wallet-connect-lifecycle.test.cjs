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
    'getAcceptedCoreTopic',
    'getCoreStoredSessionTopics',
    'readCoreSessionConflict',
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
    'discardInvalidCoreSession',
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

function createFakeProvider(options = {}) {
    const handlers = new Map();
    const storedSessions = [];
    let connectDeferred = null;

    // Mirrors SignClient.disconnect(): deletes the session from the store and
    // throws for a topic the store does not hold (MISMATCHED_TOPIC). It does
    // NOT touch UniversalProvider's cached `session` — the engine deletes with
    // emitEvent: false, so only the provider's own disconnect()/cleanup clears
    // that cache. Keeping the fake faithful is what makes the cleanup-failure
    // cases meaningful.
    const clientDisconnect = async ({ topic }) => {
        provider.clientDisconnectCalls.push(topic);
        if (options.failClientDisconnect) throw new Error('relay unavailable');
        const index = storedSessions.findIndex((session) => session.topic === topic);
        if (index < 0) throw new Error(`Session or pairing topic not found: ${topic}`);
        storedSessions.splice(index, 1);
    };

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
        clientDisconnectCalls: [],
        signer: {
            // NOTE: deliberately no `uri` field — the module must never read it.
            client: {
                session: { getAll: () => storedSessions.slice() },
                request: async (args) => {
                    provider.signClientRequests.push(args);
                    return '0xsignature';
                },
                ...(options.omitClientDisconnect ? {} : { disconnect: clientDisconnect })
            },
            ...(options.omitCleanup ? {} : {
                cleanup: async () => {
                    provider.cleanupCalls += 1;
                    if (options.failCleanup) throw new Error('storage locked');
                    provider.session = null;
                }
            }),
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
            if (options.failProviderDisconnect) throw new Error('relay unavailable');
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
        provider.__emit('display_uri', uri);
    };
    provider.__settle = (session = buildSession()) => {
        storedSessions.push(session);
        provider.session = session;
        return session;
    };
    provider.__storeSession = (session) => {
        storedSessions.push(session);
        return session;
    };
    provider.__storedTopics = () => storedSessions.map((session) => session.topic);
    provider.__storedCount = () => storedSessions.length;
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

    const provider = options.provider || createFakeProvider(options.providerOptions);
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

// ---------------------------------------------------------------------------
// BLOCKER 1 — a store that really holds TWO live ArtSoul sessions.
// Reproduces production: topics 7138... and 81b7... coexisting in the isolated
// artsoul-mobile-core-v4 store after the iOS deep-link race.
// ---------------------------------------------------------------------------


// A real page always boots the provider (restore) before the user can tap
// anything. Tests that start from a pre-populated store do the same.
async function bootProvider(api) {
    return api.restoreCoreSessionOutcome({ timeoutMs: 50 });
}

function seedTwoStoredSessions(provider, { currentTopic = TOPIC_A } = {}) {
    const first = buildSession({ topic: TOPIC_A });
    const second = buildSession({ topic: TOPIC_B });
    provider.__storeSession(first);
    provider.__storeSession(second);
    provider.session = currentTopic === TOPIC_A ? first : (currentTopic === TOPIC_B ? second : null);
    return { first, second };
}

test('two stored sessions with provider.session = A are a conflict, and nothing is published', () => {
    const provider = createFakeProvider();
    seedTwoStoredSessions(provider, { currentTopic: TOPIC_A });
    const { api } = loadCoreWallet({ provider });

    assert.deepEqual(api.getCoreStoredSessionTopics(provider).sort(), [TOPIC_A, TOPIC_B].sort());
    const conflict = api.readCoreSessionConflict(provider);
    assert.equal(conflict.resolved, false);
    assert.equal(conflict.topics.length, 2);

    // The topic is in the store, yet it is NOT live: which one is current is
    // unknown, so the path fails closed instead of guessing.
    const liveness = api.getCoreSessionLiveness(provider);
    assert.equal(liveness.live, false);
    assert.equal(liveness.reason, 'session-store-duplicate');
    assert.equal(api.readAuthoritativeCoreSession(provider).ready, false);
    assert.equal(api.isCoreSessionActive(), false);
    assert.equal(api.getAcceptedCoreTopic(), null);
});

test('two stored sessions with provider.session = null are still a conflict the store owns', async () => {
    const provider = createFakeProvider();
    seedTwoStoredSessions(provider, { currentTopic: null });
    const { api } = loadCoreWallet({ provider });

    assert.equal(provider.session, null);
    assert.equal(api.readCoreSessionConflict(provider).topics.length, 2);

    // Passive boot must NOT delete healthy sessions: fail closed with a stable
    // diagnostic instead.
    const outcome = await api.restoreCoreSessionOutcome({ timeoutMs: 200 });
    assert.equal(outcome.status, 'conflict');
    assert.equal(outcome.reason, 'duplicate-stored-sessions');
    assert.equal(outcome.topicCount, 2);
    assert.equal(outcome.session, null);
    assert.equal(provider.__storedCount(), 2, 'boot deletes nothing');
    assert.equal(provider.disconnectCalls, 0);
    assert.deepEqual(provider.clientDisconnectCalls, []);

    // A Disconnect with a null provider.session still has work to do.
    const disconnect = await api.disconnectCoreWalletOutcome();
    assert.equal(disconnect.hadSession, true);
    assert.equal(disconnect.disconnected, true);
    assert.equal(disconnect.remainingSessionCount, 0);
    assert.equal(provider.__storedCount(), 0);
});

test('explicit Disconnect leaves zero ArtSoul sessions in the dedicated store', async () => {
    const provider = createFakeProvider();
    seedTwoStoredSessions(provider, { currentTopic: TOPIC_A });
    const { api } = loadCoreWallet({ provider });
    assert.equal((await bootProvider(api)).status, 'conflict');

    const outcome = await api.disconnectCoreWalletOutcome();
    assert.equal(outcome.disconnected, true);
    assert.equal(outcome.hadSession, true);
    assert.deepEqual(outcome.topics.sort(), [TOPIC_A, TOPIC_B].sort());
    assert.equal(outcome.remainingSessionCount, 0);

    // The cached provider session went through the provider; the leftover went
    // through the PUBLIC SignClient disconnect API.
    assert.equal(provider.disconnectCalls, 1);
    assert.deepEqual(provider.clientDisconnectCalls, [TOPIC_B]);
    assert.deepEqual(provider.__storedTopics(), []);
    assert.equal(api.isCoreTopicTombstoned(TOPIC_A), true);
    assert.equal(api.isCoreTopicTombstoned(TOPIC_B), true);
    assert.equal(api.getAcceptedCoreTopic(), null);
});

test('a reload after Disconnect cannot restore a leftover topic', async () => {
    const provider = createFakeProvider();
    seedTwoStoredSessions(provider, { currentTopic: TOPIC_A });
    const first = loadCoreWallet({ provider });
    await bootProvider(first.api);
    await first.api.disconnectCoreWalletOutcome();
    assert.equal(provider.__storedCount(), 0);

    // Simulate the next page load: a brand-new module instance (no in-memory
    // tombstones) over the SAME store, exactly like UniversalProvider adopting
    // client.session.getAll()[0] on boot.
    const reloaded = loadCoreWallet({ provider });
    const outcome = await reloaded.api.restoreCoreSessionOutcome({ timeoutMs: 200 });
    assert.equal(outcome.status, 'none');
    assert.equal(outcome.session, null);
    assert.equal(reloaded.api.isCoreSessionActive(), false);
});

test('a tombstoned current topic never lets another stored topic take its place', async () => {
    const provider = createFakeProvider();
    const { second } = seedTwoStoredSessions(provider, { currentTopic: TOPIC_A });
    const { api } = loadCoreWallet({ provider });

    // Accept A explicitly (an explicit Connect reconciles first, so emulate the
    // post-reconciliation state directly by connecting to a single session).
    const singleProvider = createFakeProvider();
    const singleApi = loadCoreWallet({ provider: singleProvider });
    const connectPromise = singleApi.api.connectCoreWallet();
    await flush();
    singleProvider.__emitDisplayUri('wc:pairing-a');
    await flush();
    singleProvider.__settle(buildSession({ topic: TOPIC_A }));
    singleProvider.__resolveConnect();
    await connectPromise;
    assert.equal(singleApi.api.getAcceptedCoreTopic(), TOPIC_A);

    // The accepted topic is disconnected; a leftover B is then pushed into the
    // provider cache by a late SDK callback. It must not become current.
    singleProvider.__storeSession(buildSession({ topic: TOPIC_B }));
    await singleApi.api.disconnectCoreWalletOutcome();
    singleProvider.session = buildSession({ topic: TOPIC_B });
    const liveness = singleApi.api.getCoreSessionLiveness(singleProvider);
    assert.equal(liveness.live, false);
    assert.equal(liveness.reason, 'session-topic-tombstoned');
    assert.equal(singleApi.api.isCoreSessionActive(), false);

    // And in the untouched two-session provider, B cannot replace A either.
    provider.session = second;
    assert.equal(api.getCoreSessionLiveness(provider).live, false);
});

test('a duplicate session event cannot replace the accepted topic', async () => {
    const { api, provider } = loadCoreWallet();
    const connectPromise = api.connectCoreWallet();
    await flush();
    provider.__emitDisplayUri('wc:pairing-a');
    await flush();
    provider.__settle(buildSession({ topic: TOPIC_A }));
    provider.__resolveConnect();
    await connectPromise;
    assert.equal(api.getAcceptedCoreTopic(), TOPIC_A);

    // A second settle lands (duplicate proposal accepted by the wallet): it is
    // written to the store and overwrites the SDK's cached session.
    provider.__settle(buildSession({ topic: TOPIC_B }));
    const liveness = api.getCoreSessionLiveness(provider);
    assert.equal(liveness.live, false);
    assert.equal(liveness.reason, 'session-topic-not-accepted');
    assert.equal(api.readAuthoritativeCoreSession(provider).ready, false);
    assert.equal(api.getAcceptedCoreTopic(), TOPIC_A, 'the accepted topic is unchanged');
});

test('explicit Connect repairs a duplicate that overwrote the accepted provider cache', async () => {
    const { api, provider } = loadCoreWallet();
    const firstConnect = api.connectCoreWallet();
    await flush();
    provider.__emitDisplayUri('wc:pairing-a');
    await flush();
    provider.__settle(buildSession({ topic: TOPIC_A }));
    provider.__resolveConnect();
    await firstConnect;
    assert.equal(api.getAcceptedCoreTopic(), TOPIC_A);

    // Another tab or a late pre-fix proposal settles B. The accepted topic A is
    // still in the dedicated store, but UniversalProvider's cache now points at
    // B. This is a conflict even though A remains identifiable.
    provider.__settle(buildSession({ topic: TOPIC_B }));
    const conflict = api.readCoreSessionConflict(provider);
    assert.equal(conflict.resolved, true);
    assert.equal(api.getCoreSessionLiveness(provider).reason, 'session-topic-not-accepted');

    const repairedConnect = api.connectCoreWallet();
    await flush();

    // Explicit Connect must end BOTH topics before starting one fresh pairing.
    assert.equal(provider.disconnectCalls, 1, 'the cached duplicate B is disconnected');
    assert.deepEqual(provider.clientDisconnectCalls, [TOPIC_A], 'accepted A is also reconciled');
    assert.deepEqual(provider.__storedTopics(), []);
    assert.equal(provider.connectCalls, 2);

    const freshTopic = 'ffffffff00000000ffffffff00000000';
    provider.__emitDisplayUri('wc:pairing-fresh');
    await flush();
    provider.__settle(buildSession({ topic: freshTopic }));
    provider.__resolveConnect();
    const connected = await repairedConnect;

    assert.equal(connected.address, ADDRESS);
    assert.equal(api.getAcceptedCoreTopic(), freshTopic);
    assert.deepEqual(provider.__storedTopics(), [freshTopic]);
    assert.equal(api.isCoreSessionActive(), true);
});

test('an explicit Connect reconciles a duplicated store before creating a pairing', async () => {
    const provider = createFakeProvider();
    seedTwoStoredSessions(provider, { currentTopic: TOPIC_A });
    const { api } = loadCoreWallet({ provider });
    assert.equal((await bootProvider(api)).status, 'conflict');

    const connectPromise = api.connectCoreWallet();
    await flush();

    // Both leftovers are gone BEFORE the new pairing starts.
    assert.equal(provider.__storedCount(), 0);
    assert.equal(provider.connectCalls, 1);

    const freshTopic = 'ffffffff00000000ffffffff00000000';
    provider.__emitDisplayUri('wc:pairing-fresh');
    await flush();
    provider.__settle(buildSession({ topic: freshTopic }));
    provider.__resolveConnect();
    const connected = await connectPromise;

    assert.equal(connected.address, ADDRESS);
    assert.equal(api.getAcceptedCoreTopic(), freshTopic);
    assert.deepEqual(provider.__storedTopics(), [freshTopic]);
    assert.equal(api.isCoreSessionActive(), true);
});

// ---------------------------------------------------------------------------
// BLOCKER 2 — the pairing URI is ArtSoul-owned, captured from `display_uri`.
// ---------------------------------------------------------------------------

test('a second Connect after a modal close reopens the cached display_uri', async () => {
    const { api, provider, modals } = loadCoreWallet();
    const first = api.connectCoreWallet();
    await flush();
    provider.__emitDisplayUri('wc:pairing-a');
    await flush();
    modals[0].__userClose();
    await assert.rejects(first, (error) => error.code === 4001);

    const second = api.connectCoreWallet();
    await flush();
    assert.deepEqual(modals[0].openCalls, ['wc:pairing-a', 'wc:pairing-a']);
    assert.equal(provider.connectCalls, 1);

    provider.__settle(buildSession());
    provider.__resolveConnect();
    await second;
});

test('an attempt that joins before display_uri arrives still receives it', async () => {
    const { api, provider, modals } = loadCoreWallet();
    const first = api.connectCoreWallet();
    await flush();
    // No display_uri yet: cancel and re-tap.
    modals[0].__userClose();
    await assert.rejects(first, (error) => error.code === 4001);

    const second = api.connectCoreWallet();
    await flush();
    assert.deepEqual(modals[0].openCalls, [], 'nothing to show yet');

    provider.__emitDisplayUri('wc:pairing-late');
    await flush();
    assert.deepEqual(modals[0].openCalls, ['wc:pairing-late']);
    assert.equal(provider.connectCalls, 1);

    provider.__settle(buildSession());
    provider.__resolveConnect();
    await second;
});

test('a settled or rejected SDK task clears the cached URI and a new task cannot reuse it', async () => {
    const { api, provider, modals } = loadCoreWallet();

    // Task 1 rejects (wallet refused / proposal expired).
    const first = api.connectCoreWallet();
    await flush();
    provider.__emitDisplayUri('wc:pairing-a');
    await flush();
    provider.__rejectConnect(new Error('Proposal expired'));
    await assert.rejects(first);
    await flush();

    // Task 2 must NOT reopen the dead pairing.
    const second = api.connectCoreWallet();
    await flush();
    assert.equal(provider.connectCalls, 2, 'a settled task is replaced, not joined');
    assert.deepEqual(modals[0].openCalls, ['wc:pairing-a'], 'no stale URI is re-shown');

    provider.__emitDisplayUri('wc:pairing-b');
    await flush();
    assert.deepEqual(modals[0].openCalls, ['wc:pairing-a', 'wc:pairing-b']);

    provider.__settle(buildSession());
    provider.__resolveConnect();
    await second;

    // After a SUCCESSFUL task the cache is cleared too: a later attempt on a
    // live session reuses it and never reopens a pairing view.
    const third = await api.connectCoreWallet();
    assert.equal(third.restored, true);
    assert.deepEqual(modals[0].openCalls, ['wc:pairing-a', 'wc:pairing-b']);
});

test('the module never reads the internal signer.uri field', () => {
    assert.doesNotMatch(
        coreWalletSource.replace(/\/\/[^\n]*/g, ''),
        /signer[^\n]*\.uri/,
        'signer.uri is an internal UniversalProvider field'
    );
    assert.match(coreWalletSource, /let sdkPairingUri = null;/);
    assert.match(coreWalletSource, /instance\.on\('display_uri', capturePairingUri\)/);
});

// ---------------------------------------------------------------------------
// Private-cleanup compatibility: signer.cleanup is not a public SDK contract.
// ---------------------------------------------------------------------------

test('an unavailable signer.cleanup cannot report a successful disconnect', async () => {
    const provider = createFakeProvider({ omitCleanup: true, failProviderDisconnect: true });
    provider.__settle(buildSession({ topic: TOPIC_A }));
    const { api } = loadCoreWallet({ provider });
    assert.equal((await bootProvider(api)).status, 'restored');

    const outcome = await api.disconnectCoreWalletOutcome();
    assert.equal(outcome.disconnected, false, 'a teardown that could not complete is never reported as success');
    assert.equal(outcome.hadSession, true);
    assert.equal(outcome.reason, 'disconnect-incomplete');
    assert.ok(outcome.remainingSessionCount >= 0);

    // ...and the session it could not tear down is still unpublishable.
    assert.equal(api.isCoreTopicTombstoned(TOPIC_A), true);
    assert.equal(api.getCoreSessionLiveness(provider).reason, 'session-topic-tombstoned');
    assert.equal(api.isCoreSessionActive(), false);
    assert.equal(api.getAcceptedCoreTopic(), null);
});

test('a failing signer.cleanup yields a stable diagnostic, never a connected session', async () => {
    const provider = createFakeProvider({ failCleanup: true, failProviderDisconnect: true });
    provider.__settle(buildSession({ topic: TOPIC_A }));
    const { api } = loadCoreWallet({ provider });
    assert.equal((await bootProvider(api)).status, 'restored');

    const outcome = await api.disconnectCoreWalletOutcome();
    assert.equal(outcome.disconnected, false);
    assert.equal(outcome.reason, 'disconnect-incomplete');
    assert.equal(provider.cleanupCalls, 1);
    assert.equal(api.isCoreSessionActive(), false);

    // The same guarantee for a proven-dead session whose cleanup is missing.
    const bare = createFakeProvider({ omitCleanup: true });
    const staleSession = buildSession({ topic: TOPIC_B });
    bare.session = staleSession; // present on the provider, absent from the store
    const second = loadCoreWallet({ provider: bare });
    await assert.rejects(
        second.api.discardInvalidCoreSession(bare),
        (error) => error.code === 'CORE_SESSION_NOT_LIVE' && error.reason === 'session-cleanup-unavailable'
    );
    assert.equal(second.api.isCoreTopicTombstoned(TOPIC_B), true);
    assert.equal(second.api.isCoreSessionActive(), false);
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
