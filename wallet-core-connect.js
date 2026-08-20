// ============================================
// ARTSOUL CORE WALLETCONNECT PATH
// Mobile external browsers connect through the bare
// @walletconnect/ethereum-provider driving the OFFICIAL WalletConnect modal
// that WE import statically and pinned (showQrModal: false). The provider's
// built-in modal loading builds a second @reown/appkit at runtime inside the
// provider bundle and its open() failures are unobservable — on prod the
// modal silently never rendered and connect() pended forever. Owning the
// modal makes its whole lifecycle deterministic.
// The provider's persisted session is the single source of truth for
// "connected" on this path. AppKit remains the desktop and injected path.
//
// LIFECYCLE OWNERSHIP (deterministic, single-flight)
// This module owns exactly one connect attempt and one accepted session topic
// at a time. Three facts about @walletconnect/ethereum-provider 2.23.10 and
// @walletconnect/universal-provider 2.23.10 shape the design:
//   1. `UniversalProvider.abortPairingAttempt()` is a documented NO-OP
//      ("abortPairingAttempt is deprecated. This is now a no-op."). An
//      in-flight `EthereumProvider.connect()` therefore CANNOT be cancelled.
//      Every started SDK connect is followed to completion and its outcome is
//      either adopted or torn down — never abandoned.
//   2. `EthereumProvider.connect()` has no re-entrancy guard. A second call
//      publishes a SECOND session proposal (a second pairing and a second
//      session topic), and `UniversalProvider.connect()` unsubscribes every
//      existing pairing topic on entry, which sabotages the first attempt.
//      Only ONE SDK connect task may exist per page; later taps join it and
//      reuse the SAME pairing URI.
//   3. `EthereumProvider.setAccounts()` filters accounts by the SDK-local
//      `chainId`, and `reset()` drops that chainId to 1. SDK-local chain state
//      is therefore never wallet truth. Address AND chain are read from ONE
//      snapshot of the authoritative SignClient session.
// ============================================

// Pinned OFFICIAL modal (wcm-* custom elements — no collision with the
// page's @reown/appkit w3m-* elements). The bundle is fully self-contained:
// no runtime dynamic imports left to fail silently.
import { WalletConnectModal } from '@walletconnect/modal';

const WC_ETHEREUM_PROVIDER_VERSION = '2.23.10';
const WC_ETHEREUM_PROVIDER_URL = `https://esm.sh/@walletconnect/ethereum-provider@${WC_ETHEREUM_PROVIDER_VERSION}?bundle`;
const WC_MODAL_VERSION = '2.7.0';
// Keep the external-mobile WalletConnect client in one stable ArtSoul-owned
// storage namespace. Older builds shared the SDK default namespace with
// AppKit and previous connection experiments. On iOS those IndexedDB records
// cannot always be enumerated or deleted, and UniversalProvider restores the
// first stored session. A versioned, deterministic prefix gives this path one
// clean source of truth without breaking persistence on later page loads.
export const CORE_STORAGE_PREFIX = 'artsoul-mobile-core-v4';

const BASE_SEPOLIA_CHAIN_ID = 84532;
const BASE_SEPOLIA_RPC_URL = 'https://sepolia.base.org';
const CORE_RESTORE_TIMEOUT_MS = 4500;
const CORE_RESTORE_POLL_INTERVAL_MS = 120;
// WalletConnect optional permissions are not guaranteed to be approved by a
// wallet. ArtSoul needs personal_sign for SIWE and eth_sendTransaction for the
// product lifecycle, so Base Sepolia and those two methods are required by the
// session proposal. This grants capabilities; it does not replace the explicit
// Base Sepolia confirmation that still runs before every write. Base Mainnet
// and Ethereum remain optional read/display networks.
const REQUIRED_CHAIN_IDS = [BASE_SEPOLIA_CHAIN_ID];
const OPTIONAL_CHAIN_IDS = [8453, 1];
const REQUIRED_METHODS = ['personal_sign', 'eth_sendTransaction'];
const REQUIRED_EVENTS = ['chainChanged', 'accountsChanged'];
// Readiness gate: a Connect attempt may not report success until the
// authoritative session can actually run SIWE. eth_sendTransaction is NOT part
// of the gate — browsing on a foreign chain stays allowed and the write guard
// owns the Base Sepolia requirement at write time.
const READINESS_METHODS = ['personal_sign'];
// Tombstoned topics are remembered so a late relay message or a late SDK
// settle can never re-promote a topic this page already abandoned.
const MAX_TOMBSTONED_TOPICS = 32;

// The complete external-mobile wallet lifecycle. `siwe-signing` and
// `authenticated` are driven by the app layer (SIWE lives in appkit-init.js /
// SupabaseAuth); every other transition is owned here.
export const CORE_LIFECYCLE = Object.freeze({
    DISCONNECTED: 'disconnected',
    PAIRING: 'pairing',
    WAITING_FOR_WALLET: 'waiting-for-wallet',
    SETTLING_SESSION: 'settling-session',
    CONNECTED: 'connected',
    SIWE_SIGNING: 'siwe-signing',
    AUTHENTICATED: 'authenticated',
    DISCONNECTING: 'disconnecting'
});
const APP_DRIVEN_LIFECYCLE_STATES = new Set([
    CORE_LIFECYCLE.SIWE_SIGNING,
    CORE_LIFECYCLE.AUTHENTICATED,
    CORE_LIFECYCLE.CONNECTED
]);

let settings = {
    projectId: null,
    metadata: null,
    log: null,
    onLifecycle: null,
    onSessionAdopted: null,
    // Test seam only. Production leaves this undefined and the pinned CDN
    // module below is imported instead.
    createProvider: null
};
let providerInstance = null;
let providerInitPromise = null;
let rejectionGuardBound = false;
let modalInstance = null;
let lifecycleState = CORE_LIFECYCLE.DISCONNECTED;

// ---- single-flight connect state -------------------------------------
// activeAttempt   : the app-level attempt a caller is awaiting (double taps
//                   reuse its promise).
// sdkConnectTask  : the ONE live EthereumProvider.connect() promise. It can
//                   outlive activeAttempt because the SDK cannot be cancelled.
// sdkConnectWaiters: every attempt that joined the live SDK task, so the late
//                   settle can tell "a caller still owns this" from "nobody
//                   is waiting — adopt or tear down".
let attemptSequence = 0;
let activeAttempt = null;
let sdkConnectTask = null;
// The pairing URI of the CURRENT sdkConnectTask, captured from the PUBLIC
// `display_uri` event. `signer.uri` is an internal UniversalProvider field and
// is never read. Lifetime is bound to one task: cleared when that exact task is
// created, settles or rejects, so a new task can never reuse an old URI.
let sdkPairingUri = null;
const sdkConnectWaiters = new Set();
let disconnectPromise = null;
const tombstonedTopics = [];
// MetaMask Mobile can emit a session_event for the topic it is settling a few
// seconds BEFORE SignClient persists that session. During the one live SDK
// connect task, "topic missing from store" is therefore not yet proof that the
// topic is stale. Defer that decision until connect() has settled, then compare
// every observed topic with the authoritative provider/session store.
const deferredMissingTopics = new Set();
// THE accepted-topic invariant. At most ONE stored topic is ever the current
// ArtSoul session. It is set only when a session passes the authoritative
// readiness gate (connect, restore, adoption) and cleared only by teardown.
// While it is set, no other topic — however it arrives — can be published.
let acceptedSessionTopic = null;

// ONE modal instance per page, constructed on the first connect (the
// projectId only arrives via configureCoreWallet, after module init). The
// z-index ceiling keeps the modal above every ArtSoul overlay so nothing of
// ours can ever cover it. A construction failure propagates to the caller —
// never a silent pending connect.
function getCoreWalletModal() {
    if (modalInstance) return modalInstance;
    modalInstance = new WalletConnectModal({
        projectId: settings.projectId,
        themeMode: 'dark',
        themeVariables: { '--wcm-z-index': '2147483647' }
    });
    coreLog('official modal instantiated', { version: WC_MODAL_VERSION });
    return modalInstance;
}

// Closing the modal without approving is a user rejection (EIP-1193 4001):
// upstream settles quietly and the Connect button is immediately reusable.
function createModalClosedError() {
    const error = new Error('Connection request cancelled: the WalletConnect modal was closed.');
    error.code = 4001;
    return error;
}

function coreLog(step, detail = null) {
    try {
        settings.log?.(step, detail);
    } catch {
        // Diagnostics must never break the connection flow.
    }
}

export function configureCoreWallet(config = {}) {
    settings = { ...settings, ...config };
}

// ---- lifecycle -------------------------------------------------------

export function getCoreLifecycleState() {
    return lifecycleState;
}

function setCoreLifecycleState(next, detail = null) {
    if (lifecycleState === next) return lifecycleState;
    const previous = lifecycleState;
    lifecycleState = next;
    coreLog('core wallet lifecycle', { from: previous, to: next, ...(detail || {}) });
    try {
        settings.onLifecycle?.(next, { from: previous, ...(detail || {}) });
    } catch {
        // Lifecycle observers must never break the connection flow.
    }
    return lifecycleState;
}

// The app layer owns SIWE. It may only move between connected/signing/
// authenticated — it can never claim a connection this module has not proven.
export function setCoreAuthLifecycleState(next) {
    if (!APP_DRIVEN_LIFECYCLE_STATES.has(next)) return lifecycleState;
    if (!isCoreSessionActive()) return lifecycleState;
    return setCoreLifecycleState(next, { source: 'app' });
}

export function isCoreConnectInFlight() {
    // The relay transport restart on browser resume depends on this: an SDK
    // task that outlived a cancelled attempt still needs the socket reopened
    // so the wallet approval can land in THIS tab.
    return Boolean(activeAttempt || sdkConnectTask);
}

export function isCoreSessionActive() {
    return getCoreSessionLiveness(providerInstance).live;
}

export function getConnectedCoreProvider() {
    return getCoreSessionLiveness(providerInstance).live ? providerInstance : null;
}

// The provider instance regardless of session state. An IN-FLIGHT connect()
// has a provider (and a relay socket) but no session yet — the browser-return
// transport restart needs to reach that relayer so the wallet's approval
// message lands in this tab and the pending connect() settles here.
export function getCoreProviderInstance() {
    return providerInstance;
}

// ---- topic tombstones ------------------------------------------------

function tombstoneCoreTopic(topic) {
    const value = String(topic || '');
    if (!value || tombstonedTopics.includes(value)) return;
    tombstonedTopics.push(value);
    while (tombstonedTopics.length > MAX_TOMBSTONED_TOPICS) tombstonedTopics.shift();
    coreLog('WalletConnect topic tombstoned', { topic: maskCoreTopic(value) });
}

export function isCoreTopicTombstoned(topic) {
    const value = String(topic || '');
    return Boolean(value) && tombstonedTopics.includes(value);
}

// ---- the accepted-topic invariant ------------------------------------

export function getAcceptedCoreTopic() {
    return acceptedSessionTopic;
}

function setAcceptedCoreTopic(topic, reason) {
    const value = String(topic || '');
    if (!value || acceptedSessionTopic === value) return acceptedSessionTopic;
    acceptedSessionTopic = value;
    coreLog('accepted ArtSoul WalletConnect topic set', { topic: maskCoreTopic(value), reason });
    return acceptedSessionTopic;
}

function clearAcceptedCoreTopic(reason) {
    if (!acceptedSessionTopic) return;
    coreLog('accepted ArtSoul WalletConnect topic cleared', {
        topic: maskCoreTopic(acceptedSessionTopic),
        reason
    });
    acceptedSessionTopic = null;
}

// Every session the ArtSoul-DEDICATED store holds, minus topics this page has
// already abandoned. `customStoragePrefix: artsoul-mobile-core-v4` means this
// store is created and written by this provider alone: AppKit runs its own
// default namespace and is not even instantiated on the external mobile path,
// so enumerating this store can never reach an unrelated wallet session.
function getAllCoreStoredSessionTopics(instance = providerInstance) {
    const storeState = readCoreSessionStore(instance);
    if (!storeState.available || storeState.readFailed) return [];
    return [...new Set(
        storeState.sessions
            .map((session) => String(session?.topic || ''))
            .filter(Boolean)
    )];
}

export function getCoreStoredSessionTopics(instance = providerInstance) {
    return getAllCoreStoredSessionTopics(instance)
        .filter((topic) => !isCoreTopicTombstoned(topic));
}

// Two or more live ArtSoul sessions in one dedicated store is a conflict: the
// iOS deep-link race produced exactly this (topics 7138... and 81b7...).
// `resolved` means one of them is already the accepted topic, so the extras are
// leftovers that can never be published; otherwise nothing may be published at
// all until an explicit Connect or Disconnect reconciles the store.
export function readCoreSessionConflict(instance = providerInstance) {
    const topics = getCoreStoredSessionTopics(instance);
    if (topics.length <= 1) return null;
    return {
        topics,
        accepted: acceptedSessionTopic && topics.includes(acceptedSessionTopic)
            ? acceptedSessionTopic
            : null,
        resolved: Boolean(acceptedSessionTopic && topics.includes(acceptedSessionTopic))
    };
}

// ---- authoritative session reads -------------------------------------

// Every eip155 account the APPROVED session carries, paired with the chain it
// was approved on. This is the only snapshot address and chain are read from,
// so a connected wallet can never be published with a chain from a different
// point in time.
export function readCoreSessionAccounts(session) {
    const entries = [];
    for (const namespace of Object.values(session?.namespaces || {})) {
        for (const account of namespace?.accounts || []) {
            const match = String(account).match(/^eip155:(\d+):(0x[a-fA-F0-9]{40})$/);
            if (!match) continue;
            const chainId = Number(match[1]);
            if (!Number.isFinite(chainId) || chainId <= 0) continue;
            entries.push({ chainId, address: match[2] });
        }
    }
    return entries;
}

function selectCoreAccount(accounts, preferredChainId = null) {
    if (!accounts?.length) return null;
    const preferred = preferredChainId
        ? accounts.find((entry) => entry.chainId === preferredChainId)
        : null;
    if (preferred) return preferred;
    return accounts.find((entry) => entry.chainId === BASE_SEPOLIA_CHAIN_ID) || accounts[0];
}

// The SDK's `instance.accounts` is filtered by the provider's CURRENT chainId
// (setAccounts drops every namespace account whose chain differs), and that
// chainId is persisted across page loads and reset to 1 by the SDK's reset().
// A session whose wallet sits on a foreign network (observed: MetaMask parked
// on 8453) therefore reports [] while the session record — with the address —
// is alive in storage. Read the address chain-independently from the session
// namespaces: the address is what "connected" means; the network is the
// write-guard's business.
export function getCoreSessionAddress(instance = providerInstance) {
    if (!getCoreSessionLiveness(instance).live) return null;
    const account = selectCoreAccount(
        readCoreSessionAccounts(instance.session),
        parseCoreChainId(instance?.chainId)
    );
    if (account) return account.address;
    return (instance.accounts || []).filter(Boolean)[0] || null;
}

export function parseCoreChainId(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const text = String(value);
    const caipMatch = text.match(/^eip155:(\d+)/i);
    if (caipMatch) return Number(caipMatch[1]);
    const parsed = text.startsWith('0x') ? parseInt(text, 16) : parseInt(text, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function maskCoreTopic(value) {
    const topic = String(value || '');
    if (!topic) return null;
    if (topic.length <= 12) return '[redacted-topic]';
    return `${topic.slice(0, 8)}...${topic.slice(-4)}`;
}

function readCoreSessionStore(instance) {
    const store = instance?.signer?.client?.session;
    if (typeof store?.getAll !== 'function') {
        return { available: false, sessions: [] };
    }
    try {
        const sessions = store.getAll();
        return {
            available: true,
            sessions: Array.isArray(sessions) ? sessions : []
        };
    } catch (error) {
        coreLog('core session store read failed', describeCoreError(error));
        return { available: true, readFailed: true, sessions: [] };
    }
}

// `provider.session` is a cached UniversalProvider field, not proof that the
// SignClient still owns that topic. WalletConnect documents
// "session topic doesn't exist" as a missing/disconnected session. Verify the
// cached topic against the initialized SignClient store. The pinned SDK exposes
// this store; if it is absent or unreadable, connected state cannot be proven.
export function getCoreSessionLiveness(instance = providerInstance, nowMs = Date.now()) {
    const session = instance?.session || null;
    const topic = String(session?.topic || '');
    if (!session || !topic) {
        return { live: false, topic: topic || null, reason: 'provider-session-missing' };
    }

    // A topic this page abandoned (explicit disconnect, proven-dead cache, or
    // an SDK "no matching key" rejection) can never become current again, no
    // matter which late callback carries it.
    if (isCoreTopicTombstoned(topic)) {
        return { live: false, topic, reason: 'session-topic-tombstoned' };
    }

    // The accepted-topic invariant. Once a topic has been accepted, a second
    // settle, a duplicate session event, or an SDK cache overwrite carrying a
    // DIFFERENT topic is a leftover — never the current session.
    if (acceptedSessionTopic && topic !== acceptedSessionTopic) {
        return { live: false, topic, reason: 'session-topic-not-accepted' };
    }

    const expiry = Number(session.expiry || 0);
    if (Number.isFinite(expiry) && expiry > 0 && expiry <= Math.floor(nowMs / 1000)) {
        return { live: false, topic, reason: 'session-expired' };
    }

    const storeState = readCoreSessionStore(instance);
    if (!storeState.available) {
        return { live: false, topic, reason: 'session-store-unavailable' };
    }
    if (storeState.readFailed) {
        return { live: false, topic, reason: 'session-store-read-failed' };
    }
    const stored = storeState.sessions.some(
        (candidate) => String(candidate?.topic || '') === topic
    );
    if (!stored) {
        return { live: false, topic, reason: 'session-topic-missing' };
    }

    // Nothing has been accepted yet and the dedicated store holds more than one
    // live ArtSoul session: which one is current is genuinely unknown, so fail
    // closed. Nothing is deleted here — reconciliation needs an explicit
    // Connect or Disconnect gesture.
    if (!acceptedSessionTopic && getCoreStoredSessionTopics(instance).length > 1) {
        return { live: false, topic, reason: 'session-store-duplicate' };
    }

    return { live: true, topic, reason: 'session-store-confirmed' };
}

// THE readiness gate. One read of the authoritative SignClient session answers
// every question a Connect attempt must answer before it may report success:
// is the topic live, does it carry an account, is that account on an approved
// EVM chain, and did the wallet approve the signing method SIWE needs.
export function readAuthoritativeCoreSession(instance = providerInstance, options = {}) {
    const liveness = getCoreSessionLiveness(instance, options.nowMs);
    const snapshot = {
        live: liveness.live,
        ready: false,
        topic: liveness.topic,
        address: null,
        chainId: null,
        approvedChainIds: [],
        approvedMethods: [],
        missingMethods: [],
        reason: liveness.reason
    };
    if (!liveness.live) return snapshot;

    snapshot.approvedChainIds = getCoreSessionChainIds(instance);
    snapshot.approvedMethods = getCoreSessionMethods(instance);

    const account = selectCoreAccount(
        readCoreSessionAccounts(instance.session),
        parseCoreChainId(options.confirmedChainId) || parseCoreChainId(instance?.chainId)
    );
    if (!account) {
        snapshot.reason = 'session-address-missing';
        return snapshot;
    }
    snapshot.address = account.address;
    // Chain-tolerant: ANY approved EVM chain is a valid connection. Base
    // Sepolia is requested by the write guard, never here.
    snapshot.chainId = resolveCoreSessionChainId(instance, options.confirmedChainId) || account.chainId;
    if (!snapshot.chainId) {
        snapshot.reason = 'session-chain-missing';
        return snapshot;
    }

    snapshot.missingMethods = READINESS_METHODS.filter((method) => (
        !snapshot.approvedMethods.some((approved) => approved.toLowerCase() === method)
    ));
    if (snapshot.missingMethods.length) {
        snapshot.reason = 'session-method-not-approved';
        return snapshot;
    }

    snapshot.ready = true;
    snapshot.reason = 'session-ready';
    return snapshot;
}

// An explicit Disconnect that lands while a connect attempt is pending is a
// user cancellation, not a failure: it settles the attempt immediately (4001,
// so the app layer stays silent) instead of leaving the button pending until
// the uncancellable SDK task finishes.
function createConnectCancelledError(reason) {
    const error = new Error('Connection request cancelled: the wallet was disconnected.');
    error.code = 4001;
    error.reason = reason;
    return error;
}

function createCoreSessionNotLiveError(reason, detail = null) {
    const error = new Error(
        'WalletConnect did not establish a live session. Return to ArtSoul and tap Connect again.'
    );
    error.code = 'CORE_SESSION_NOT_LIVE';
    error.reason = reason;
    if (detail) error.detail = detail;
    return error;
}

// This is NOT a remote disconnect. It drops a cached UniversalProvider session
// after the SignClient store proves the topic is absent/expired/tombstoned, or
// when the explicit user Disconnect could not reach the peer (`force`). The
// topic is tombstoned so no late callback can resurrect it, and the next user
// tap creates a fresh pairing.
export async function discardInvalidCoreSession(instance = providerInstance, options = {}) {
    const liveness = getCoreSessionLiveness(instance, options.nowMs);
    const force = Boolean(options.force);
    if (!instance?.session || (liveness.live && !force)) return false;

    // Tombstone FIRST. A discard that cannot complete must still leave the
    // topic unpublishable — an unavailable or failing SDK cleanup may never
    // resurrect this session as connected.
    tombstoneCoreTopic(liveness.topic);
    if (acceptedSessionTopic === liveness.topic) clearAcceptedCoreTopic('session discarded');

    const cleanup = instance?.signer?.cleanup;
    if (typeof cleanup !== 'function') {
        coreLog('WalletConnect local session cleanup is unavailable', {
            topic: maskCoreTopic(liveness.topic)
        });
        throw createCoreSessionNotLiveError('session-cleanup-unavailable');
    }

    coreLog('invalid WalletConnect session discarded locally', {
        topic: maskCoreTopic(liveness.topic),
        reason: force ? 'forced-local-teardown' : liveness.reason
    });
    try {
        await cleanup.call(instance.signer);
        instance.reset?.();
        return true;
    } catch (error) {
        coreLog('invalid WalletConnect session cleanup failed', describeCoreError(error));
        throw createCoreSessionNotLiveError('session-cleanup-failed');
    }
}

export function getCoreSessionChainIds(instance = providerInstance) {
    if (!instance?.session) return [];
    const chainIds = Object.values(instance.session.namespaces || {})
        .flatMap((namespace) => [
            ...(namespace?.chains || []),
            ...((namespace?.accounts || []).map((account) => String(account).split(':').slice(0, 2).join(':')))
        ])
        .map(parseCoreChainId)
        .filter(Boolean);
    return [...new Set(chainIds)];
}

export function getCoreSessionMethods(instance = providerInstance) {
    if (!instance?.session) return [];
    const methods = Object.values(instance.session.namespaces || {})
        .flatMap((namespace) => namespace?.methods || [])
        .map((method) => String(method || '').trim())
        .filter(Boolean);
    return [...new Set(methods)];
}

export function getCoreSessionStoreDiagnostics(instance = providerInstance) {
    const storeState = readCoreSessionStore(instance);
    const sessions = storeState.sessions || [];
    const providerNamespaceMethods = instance?.signer?.rpcProviders?.eip155?.namespace?.methods;
    return {
        storagePrefix: CORE_STORAGE_PREFIX,
        storeAvailable: storeState.available,
        readFailed: Boolean(storeState.readFailed),
        sessionCount: sessions.length,
        currentTopic: maskCoreTopic(instance?.session?.topic),
        storedTopics: sessions.map((session) => maskCoreTopic(session?.topic)).filter(Boolean),
        tombstonedTopicCount: tombstonedTopics.length,
        universalProviderNamespaceReady: Array.isArray(providerNamespaceMethods)
    };
}

export function getCoreWalletApprovalUrl(instance = providerInstance) {
    const redirect = instance?.session?.peer?.metadata?.redirect || {};
    const candidates = [redirect.native, redirect.universal].filter(Boolean);
    for (const candidate of candidates) {
        try {
            const url = new URL(String(candidate));
            if (url.protocol === 'http:' || url.protocol === 'https:') {
                if (url.origin === window.location.origin) continue;
            }
            return url.toString();
        } catch {
            // Some wallets publish a native scheme without a URL-compatible
            // host. It is still safe to use when it is an explicit scheme.
            if (/^[a-z][a-z0-9+.-]*:\/\//i.test(String(candidate))) {
                return String(candidate);
            }
        }
    }
    return null;
}

export function resolveCoreRequestChainId(instance = providerInstance) {
    const approvedChainIds = getCoreSessionChainIds(instance);
    if (!approvedChainIds.length) return null;

    const currentChainId = parseCoreChainId(instance?.chainId);
    const preferredChainIds = [currentChainId, BASE_SEPOLIA_CHAIN_ID, 8453, 1]
        .filter(Boolean);
    return preferredChainIds.find((chainId) => approvedChainIds.includes(chainId)) || approvedChainIds[0];
}

// Route every wallet method through an actually approved session chain.
// Required signing/write methods use SignClient directly after checking the
// authoritative session permissions; network-management methods keep the
// UniversalProvider behavior that updates its local chain state.
export async function requestCoreWalletMethod(instance, request) {
    if (!instance?.session || !instance?.signer) {
        throw new Error('WalletConnect session provider is not available');
    }
    if (!request?.method) throw new Error('WalletConnect request method is required');

    const routeChainId = resolveCoreRequestChainId(instance);
    if (!routeChainId) throw new Error('WalletConnect session has no approved EVM request route');

    const approvedMethods = getCoreSessionMethods(instance);
    const normalizedMethod = String(request.method).toLowerCase();
    const requiredMethod = REQUIRED_METHODS.some(
        (method) => method.toLowerCase() === normalizedMethod
    );
    if (
        requiredMethod &&
        !approvedMethods.some((method) => method.toLowerCase() === normalizedMethod)
    ) {
        const error = new Error(
            `WalletConnect session did not approve ${request.method}. Disconnect and reconnect the wallet once.`
        );
        error.code = 'CORE_METHOD_NOT_APPROVED';
        coreLog('core wallet method missing from approved session', {
            method: request.method,
            approvedMethods
        });
        throw error;
    }

    const directSignClient = requiredMethod ? instance.signer?.client : null;
    if (requiredMethod && typeof directSignClient?.request !== 'function') {
        const error = new Error(
            `WalletConnect SignClient is unavailable for required method ${request.method}.`
        );
        error.code = 'CORE_SIGN_CLIENT_UNAVAILABLE';
        throw error;
    }
    if (!requiredMethod && typeof instance.signer?.request !== 'function') {
        throw new Error('WalletConnect session provider request is not available');
    }

    const transport = requiredMethod ? 'sign-client' : 'universal-provider';
    coreLog('core wallet method routed', {
        method: request.method,
        route: `eip155:${routeChainId}`,
        transport
    });
    try {
        if (requiredMethod) {
            // UniversalProvider reconstructs its local EIP-155 provider from a
            // separately persisted namespace record. A session can settle in
            // SignClient while that local record is absent (observed after an
            // iOS deep-link race), leaving `namespace.methods` undefined even
            // though the authoritative session approved the method. Required
            // wallet methods already passed the session permission check
            // above, so route them through SignClient's public request API.
            return await directSignClient.request({
                topic: instance.session.topic,
                chainId: `eip155:${routeChainId}`,
                request
            });
        }
        return await instance.signer.request(request, `eip155:${routeChainId}`);
    } catch (error) {
        const methodUnavailable = requiredMethod && (
            Number(error?.code) === -32601 ||
            /method not found/i.test(String(error?.message || error || ''))
        );
        if (!methodUnavailable) throw error;

        const mismatch = new Error(
            `The WalletConnect session cannot execute ${request.method}. Reconnect the wallet to create a fresh ArtSoul session.`
        );
        mismatch.code = 'CORE_METHOD_RUNTIME_MISMATCH';
        mismatch.cause = error;
        coreLog('core wallet method rejected by the approved peer session', {
            method: request.method,
            route: `eip155:${routeChainId}`,
            ...getCoreSessionStoreDiagnostics(instance)
        });
        throw mismatch;
    }
}

// A confirmation supplied by the app represents a successful wallet-approved
// switch for this exact session topic. It outranks the namespace list because
// some mobile wallets do not extend that list after adding a test network.
// After that: the SDK-local chainId only when the session actually approved it,
// then the chain of the very account this path reports as connected. A live
// account is NEVER published without a chain — `EthereumProvider.reset()` sets
// the SDK-local chainId to 1, and taking that gap as "unknown chain" is what
// produced connected addresses with a null network.
export function resolveCoreSessionChainId(instance = providerInstance, confirmedChainId = null) {
    const normalizedConfirmedChainId = parseCoreChainId(confirmedChainId);
    if (normalizedConfirmedChainId) return normalizedConfirmedChainId;

    const sessionChainIds = getCoreSessionChainIds(instance);
    const providerChainId = parseCoreChainId(instance?.chainId);
    if (!sessionChainIds.length) return providerChainId;
    if (providerChainId && sessionChainIds.includes(providerChainId)) return providerChainId;

    const account = selectCoreAccount(readCoreSessionAccounts(instance?.session), providerChainId);
    if (account) return account.chainId;
    if (sessionChainIds.length === 1) return sessionChainIds[0];
    return null;
}

function waitForCoreDelay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function readCoreSessionSnapshot(instance = providerInstance) {
    if (!getCoreSessionLiveness(instance).live) return null;
    const address = getCoreSessionAddress(instance);
    if (!address) return null;
    return {
        provider: instance,
        address,
        chainId: resolveCoreSessionChainId(instance),
        restored: true
    };
}

// WalletConnect persistence hydration can finish shortly after
// EthereumProvider.init() resolves on iOS. A single immediate session read is
// therefore not proof that no saved session exists. Poll only for the bounded
// boot restore window, then perform one final direct read.
export async function waitForCoreSessionSnapshot(instance, options = {}) {
    const timeoutMs = Math.max(0, Number(options.timeoutMs ?? CORE_RESTORE_TIMEOUT_MS));
    const pollIntervalMs = Math.max(10, Number(options.pollIntervalMs ?? CORE_RESTORE_POLL_INTERVAL_MS));
    const now = options.now || Date.now;
    const wait = options.wait || waitForCoreDelay;
    const deadline = now() + timeoutMs;

    let snapshot = readCoreSessionSnapshot(instance);
    while (!snapshot && now() < deadline) {
        await wait(Math.min(pollIntervalMs, Math.max(0, deadline - now())));
        snapshot = readCoreSessionSnapshot(instance);
    }

    return snapshot || readCoreSessionSnapshot(instance);
}

function describeCoreError(error) {
    return {
        name: error?.name || 'Error',
        code: error?.code ?? null,
        message: error?.message || String(error)
    };
}

// A wallet may settle without eip155:84532. Surface that gap in one line so
// field logs show it immediately; network confirmation owns the routed switch.
function warnIfWriteChainMissing(instance) {
    try {
        const chains = [...new Set(Object.values(instance?.session?.namespaces || {})
            .flatMap((namespace) => [
                ...(namespace?.chains || []),
                ...((namespace?.accounts || []).map((account) => String(account).split(':').slice(0, 2).join(':')))
            ]))];
        if (!chains.includes(`eip155:${BASE_SEPOLIA_CHAIN_ID}`)) {
            coreLog('warning: approved namespaces are missing eip155:84532; the write guard switch will request it', { chains });
        }
    } catch {
        // Diagnostics must never break the connection flow.
    }
}

function extractMissingSessionTopic(message) {
    const match = String(message || '').match(
        /session topic doesn't exist:\s*["']?([a-z0-9_-]{12,})/i
    );
    return match?.[1] || null;
}

// Neutralize the known stale-topic SDK rejection at the browser boundary.
// Source (proven from @walletconnect/ethereum-provider 2.23.10):
// `EthereumProvider.switchEthereumChain()` fires `this.request(...)` WITHOUT
// awaiting or catching it, and it is called from the inbound `chainChanged`
// session_event handler. When the wallet emits chainChanged for a topic the
// SignClient store no longer holds, SignClient's `isValidSessionTopic` throws
// "No matching key. session topic doesn't exist: <topic>" straight into an
// unhandled rejection. It is pure noise about a topic we do not own: suppress
// it, tombstone the topic so it can never become current, and never let it
// destroy a session the authoritative store still confirms.
// The provider-route rejection remains non-fatal for the same reason: it is
// the recursive switch triggered by a chainChanged for a chain just added.
function bindStaleTopicRejectionGuard() {
    if (rejectionGuardBound) return;
    rejectionGuardBound = true;
    window.addEventListener('unhandledrejection', (event) => {
        const message = String(event?.reason?.message || event?.reason || '');
        const stack = String(event?.reason?.stack || '');
        if (/no matching key/i.test(message)) {
            const topic = extractMissingSessionTopic(message);
            // During pairing, MetaMask Mobile may emit chainChanged for the NEW
            // topic before SignClient's session store is committed. Tombstoning
            // it at this instant poisons the valid session that arrives moments
            // later. While the one SDK connect task is alive, suppress the SDK
            // rejection but defer the stale/live decision until connect()
            // settles. Outside pairing, a store-missing topic is proven stale.
            if (topic && !isCoreSessionTopicStored(topic)) {
                if (sdkConnectTask) {
                    deferredMissingTopics.add(topic);
                } else {
                    tombstoneCoreTopic(topic);
                }
            }
            event.preventDefault();
            coreLog(
                topic && sdkConnectTask
                    ? 'early WalletConnect session topic deferred until settle'
                    : topic
                        ? 'stale WalletConnect session topic neutralized'
                    : 'non-session WalletConnect stale-key rejection suppressed',
                { topic: maskCoreTopic(topic) }
            );
            return;
        }
        const providerRouteMissing = providerInstance?.session &&
            /getProvider\([^)]*\)\.request|this\.getProvider/i.test(`${message} ${stack}`) &&
            /ethereum-provider/i.test(stack);
        if (providerRouteMissing) {
            event.preventDefault();
            coreLog('non-fatal WalletConnect SDK provider-route rejection suppressed', {
                message: message.slice(0, 160)
            });
        }
    });
}

function isCoreSessionTopicStored(topic) {
    const storeState = readCoreSessionStore(providerInstance);
    if (!storeState.available || storeState.readFailed) return false;
    return storeState.sessions.some((session) => String(session?.topic || '') === String(topic));
}

function reconcileDeferredMissingTopics(instance, reason) {
    if (!deferredMissingTopics.size) return;
    const currentTopic = String(instance?.session?.topic || '');
    for (const topic of deferredMissingTopics) {
        if (topic === currentTopic || isCoreSessionTopicStored(topic)) {
            coreLog('deferred WalletConnect topic confirmed by settled session', {
                topic: maskCoreTopic(topic),
                reason
            });
            continue;
        }
        tombstoneCoreTopic(topic);
        coreLog('deferred WalletConnect topic confirmed stale after settle', {
            topic: maskCoreTopic(topic),
            reason
        });
    }
    deferredMissingTopics.clear();
}

function bindProviderDiagnostics(instance) {
    const providerEvents = [
        'display_uri',
        'connect',
        'disconnect',
        'chainChanged',
        'accountsChanged',
        'session_event',
        'session_update',
        'session_delete'
    ];
    for (const eventName of providerEvents) {
        try {
            instance.on(eventName, (payload) => {
                try {
                    coreLog(`core provider ${eventName}`, summarizeEventPayload(eventName, payload));
                } catch {
                    // Never throw back into the SDK event emitter.
                }
            });
        } catch {
            coreLog('core provider event binding unavailable', { eventName });
        }
    }

    // A session the wallet ended is dead for good: tombstone it here so no
    // queued relay message or late settle can promote it back to current.
    try {
        instance.on('session_delete', (payload) => {
            const deleted = String(payload?.topic || payload?.data || instance?.session?.topic || '');
            tombstoneCoreTopic(deleted);
            if (acceptedSessionTopic === deleted) clearAcceptedCoreTopic('session_delete');
            setCoreLifecycleState(CORE_LIFECYCLE.DISCONNECTED, { reason: 'session_delete' });
        });
    } catch {
        coreLog('core provider event binding unavailable', { eventName: 'session_delete tombstone' });
    }

    const client = instance?.signer?.client || null;
    if (client?.on) {
        ['session_proposal', 'session_settle', 'session_expire', 'proposal_expire'].forEach((eventName) => {
            try {
                client.on(eventName, (event) => {
                    try {
                        coreLog(`core client ${eventName}`, {
                            topic: event?.topic || event?.params?.topic || null,
                            id: event?.id ?? null
                        });
                    } catch {
                        // Swallow — unknown topics must not become failures.
                    }
                });
            } catch {
                coreLog('core client event binding unavailable', { eventName });
            }
        });
    }
}

function summarizeEventPayload(eventName, payload) {
    if (eventName === 'display_uri') return { uriAvailable: Boolean(payload) };
    if (eventName === 'accountsChanged') {
        const accounts = Array.isArray(payload) ? payload : [];
        return { count: accounts.length };
    }
    if (eventName === 'chainChanged') return { chainId: parseCoreChainId(payload) };
    if (payload && typeof payload === 'object') {
        return {
            topic: payload.topic || payload.params?.topic || null,
            code: payload.code ?? null,
            message: payload.message || null
        };
    }
    return { value: payload ?? null };
}

// ONE provider instance per page. showQrModal: false — the provider must
// NOT build its own runtime modal; our statically imported official modal
// (wallet list, deep links, QR) drives the whole connect UX instead. Still
// no custom wallet sheet and no hand-rolled deep links.
export async function getCoreEthereumProvider() {
    if (providerInstance) return providerInstance;
    if (!providerInitPromise) {
        providerInitPromise = (async () => {
            bindStaleTopicRejectionGuard();
            const options = {
                projectId: settings.projectId,
                customStoragePrefix: CORE_STORAGE_PREFIX,
                chains: REQUIRED_CHAIN_IDS,
                optionalChains: OPTIONAL_CHAIN_IDS,
                methods: REQUIRED_METHODS,
                events: REQUIRED_EVENTS,
                showQrModal: false,
                metadata: settings.metadata,
                rpcMap: { [BASE_SEPOLIA_CHAIN_ID]: BASE_SEPOLIA_RPC_URL }
            };
            let instance;
            if (typeof settings.createProvider === 'function') {
                instance = await settings.createProvider(options);
            } else {
                coreLog('core provider module import started', { version: WC_ETHEREUM_PROVIDER_VERSION });
                const module = await import(WC_ETHEREUM_PROVIDER_URL);
                const EthereumProvider = module.EthereumProvider || module.default;
                instance = await EthereumProvider.init(options);
            }
            bindProviderDiagnostics(instance);
            providerInstance = instance;
            coreLog('core provider initialized', {
                version: WC_ETHEREUM_PROVIDER_VERSION,
                chains: REQUIRED_CHAIN_IDS,
                optionalChains: OPTIONAL_CHAIN_IDS,
                methods: REQUIRED_METHODS,
                events: REQUIRED_EVENTS,
                sessionRestorable: Boolean(instance.session),
                sessionStore: getCoreSessionStoreDiagnostics(instance)
            });
            return instance;
        })().catch((error) => {
            providerInitPromise = null;
            coreLog('core provider initialization failed', describeCoreError(error));
            throw error;
        });
    }
    return providerInitPromise;
}

// EthereumProvider persists its session in WalletConnect storage. On page
// load an existing session is restored without a new pairing. The outcome
// distinguishes "no session exists" from "restore errored" — an error (flaky
// network, failed SDK import, relay hiccup) does NOT mean the user is
// disconnected: the persisted session is still in storage and a later retry
// or page load can restore it.
export async function restoreCoreSessionOutcome(options = {}) {
    const timeoutMs = Math.max(0, Number(options.timeoutMs ?? CORE_RESTORE_TIMEOUT_MS));
    const startedAt = Date.now();
    try {
        let initTimeoutId = null;
        const initTimeout = new Promise((_, reject) => {
            initTimeoutId = setTimeout(() => {
                const error = new Error('WalletConnect provider restore timed out.');
                error.code = 'CORE_RESTORE_TIMEOUT';
                reject(error);
            }, timeoutMs);
        });
        let instance;
        try {
            instance = await Promise.race([getCoreEthereumProvider(), initTimeout]);
        } finally {
            if (initTimeoutId) clearTimeout(initTimeoutId);
        }

        // Fail closed on an unresolved duplicated store. Boot is a PASSIVE path: it must
        // never pick a winner and never delete healthy sessions without a user
        // gesture. Report a stable diagnostic instead and let an explicit
        // Connect (reconcile + fresh pairing) or Disconnect (clear the store)
        // resolve it.
        const conflict = readCoreSessionConflict(instance);
        if (conflict && !conflict.resolved) {
            setCoreLifecycleState(CORE_LIFECYCLE.DISCONNECTED, { reason: 'duplicate stored sessions' });
            coreLog('core session restore found duplicate ArtSoul sessions', {
                sessionTopics: conflict.topics.map(maskCoreTopic),
                sessionCount: conflict.topics.length,
                resolution: 'explicit Connect or Disconnect required',
                elapsedMs: Date.now() - startedAt
            });
            return {
                status: 'conflict',
                session: null,
                reason: 'duplicate-stored-sessions',
                topicCount: conflict.topics.length
            };
        }

        const remainingMs = Math.max(0, timeoutMs - (Date.now() - startedAt));
        // Chain-independent: a session parked on a foreign chain (accounts
        // getter filtered empty) is still a connected wallet, not "no session".
        const restored = await waitForCoreSessionSnapshot(instance, {
            timeoutMs: remainingMs,
            pollIntervalMs: options.pollIntervalMs
        });
        if (!restored) {
            if (instance?.session && !getCoreSessionLiveness(instance).live) {
                await discardInvalidCoreSession(instance);
            }
            setCoreLifecycleState(CORE_LIFECYCLE.DISCONNECTED, { reason: 'restore found no session' });
            coreLog('core session restore completed without a session', {
                elapsedMs: Date.now() - startedAt,
                providerSessionPresent: Boolean(instance?.session),
                providerAccountsCount: Array.isArray(instance?.accounts) ? instance.accounts.length : 0
            });
            return { status: 'none', session: null };
        }
        const authoritative = readAuthoritativeCoreSession(instance);
        setAcceptedCoreTopic(instance.session?.topic, 'restored from storage');
        setCoreLifecycleState(CORE_LIFECYCLE.CONNECTED, { reason: 'restored from storage' });
        coreLog('core session restored from storage', {
            chainId: restored.chainId,
            namespaceChains: instance.session?.namespaces?.eip155?.chains || null,
            namespaceMethods: authoritative.approvedMethods,
            // A restored session that cannot sign is NOT torn down at boot (no
            // user gesture); the SIWE route reports CORE_METHOD_NOT_APPROVED
            // and the next explicit Connect replaces it.
            signingReady: authoritative.ready,
            sessionStore: getCoreSessionStoreDiagnostics(instance),
            elapsedMs: Date.now() - startedAt
        });
        return { status: 'restored', session: restored };
    } catch (error) {
        coreLog('core session restore failed', describeCoreError(error));
        return { status: 'error', session: null, error };
    }
}

export async function restoreCoreSession() {
    const outcome = await restoreCoreSessionOutcome();
    return outcome.session;
}

// ---- the one SDK connect task ----------------------------------------

// `EthereumProvider.connect()` has no re-entrancy guard and
// `UniversalProvider.connect()` unsubscribes every existing pairing topic on
// entry. Calling it twice therefore produces two proposals, two pairings and
// two session topics while breaking the first attempt's inbound channel — the
// exact "two topics, both emitting events" failure. Exactly one task exists per
// page; every later tap joins it and reuses the SAME pairing URI.
function startCoreSdkConnect(instance, attempt) {
    sdkConnectWaiters.add(attempt);
    if (sdkConnectTask) {
        attempt.joinedExistingPairing = true;
        coreLog('joining the in-flight WalletConnect pairing', {
            attemptId: attempt.id,
            waiters: sdkConnectWaiters.size,
            pairingUriCached: Boolean(sdkPairingUri)
        });
        return sdkConnectTask;
    }

    // A new task starts with NO cached URI: the previous task's pairing is
    // dead and must never be re-shown. The URI is captured from the public
    // `display_uri` event, never from the SDK's internal `signer.uri`.
    sdkPairingUri = null;
    let capturingTask = null;
    const capturePairingUri = (uri) => {
        if (sdkConnectTask !== capturingTask) return;
        sdkPairingUri = String(uri || '') || null;
    };

    const task = Promise.resolve()
        .then(() => instance.connect())
        .finally(() => {
            try {
                instance.removeListener?.('display_uri', capturePairingUri);
            } catch {
                // Teardown is best effort.
            }
            if (sdkConnectTask === task) {
                sdkConnectTask = null;
                sdkPairingUri = null;
            }
        });
    capturingTask = task;
    sdkConnectTask = task;
    try {
        instance.on('display_uri', capturePairingUri);
    } catch {
        coreLog('core provider event binding unavailable', { eventName: 'display_uri capture' });
    }
    // The SDK cannot be cancelled (abortPairingAttempt is a no-op in 2.23.10),
    // so every task outcome is accounted for: adopted when the user approved
    // after cancelling our attempt, torn down when they disconnected, and
    // always observed so it can never surface as an unhandled rejection.
    task.then(
        () => void finalizeLateCoreSdkConnect(instance),
        (error) => {
            reconcileDeferredMissingTopics(instance, 'SDK connect rejected');
            const waiters = [...sdkConnectWaiters];
            sdkConnectWaiters.clear();
            if (waiters.some((waiter) => !waiter.cancelled)) return;
            coreLog('WalletConnect pairing ended without a session', describeCoreError(error));
            if (!isCoreSessionActive()) {
                setCoreLifecycleState(CORE_LIFECYCLE.DISCONNECTED, { reason: 'pairing ended' });
            }
        }
    );
    return task;
}

// The SDK task settled. If any attempt is still awaiting it, that caller owns
// the outcome and publishes it. Otherwise the attempt was cancelled while the
// wallet round trip stayed alive: adopt the session the user really approved,
// or tear it down when the cancellation was an explicit Disconnect.
async function finalizeLateCoreSdkConnect(instance) {
    const waiters = [...sdkConnectWaiters];
    sdkConnectWaiters.clear();
    if (waiters.some((waiter) => !waiter.cancelled)) return;

    reconcileDeferredMissingTopics(instance, 'late SDK connect settled');
    const tombstoned = waiters.some((waiter) => waiter.tombstoned);
    const snapshot = readAuthoritativeCoreSession(instance);
    if (!snapshot.live) {
        coreLog('cancelled WalletConnect attempt ended without a live session', {
            reason: snapshot.reason
        });
        if (!isCoreSessionActive()) {
            setCoreLifecycleState(CORE_LIFECYCLE.DISCONNECTED, { reason: 'cancelled attempt ended' });
        }
        return;
    }

    if (tombstoned) {
        coreLog('late WalletConnect session settled after Disconnect; tearing it down', {
            topic: maskCoreTopic(snapshot.topic)
        });
        await disconnectCoreWalletOutcome({ cancelPendingAttempt: false, reason: 'late settle after disconnect' });
        return;
    }

    if (!snapshot.ready) {
        coreLog('late WalletConnect session is not SIWE-capable; not adopted', {
            topic: maskCoreTopic(snapshot.topic),
            reason: snapshot.reason,
            missingMethods: snapshot.missingMethods
        });
        return;
    }

    setAcceptedCoreTopic(snapshot.topic, 'late settle adopted');
    setCoreLifecycleState(CORE_LIFECYCLE.CONNECTED, { reason: 'late settle adopted' });
    coreLog('late WalletConnect session adopted after a cancelled attempt', {
        topic: maskCoreTopic(snapshot.topic),
        chainId: snapshot.chainId
    });
    warnIfWriteChainMissing(instance);
    try {
        settings.onSessionAdopted?.({
            provider: instance,
            address: snapshot.address,
            chainId: snapshot.chainId,
            restored: false,
            adopted: true
        });
    } catch (error) {
        coreLog('late WalletConnect session adoption handler failed', describeCoreError(error));
    }
}

// The standard connect: await provider.connect() while OUR official modal
// shows the pairing. The modal handles wallet choice, deep linking and QR.
// No timeout marks the attempt failed — the user approves at their own pace.
// A second tap while a connect is in flight reuses the SAME promise (and
// therefore the same pairing): a page never holds two pairings for one
// attempt, and the URI is never regenerated within an attempt.
// Deliberately NOT an async function: an async wrapper would hand every tap a
// fresh promise object, and "repeated taps reuse the same promise" is the
// invariant that keeps one attempt from becoming two pairings.
export function connectCoreWallet() {
    if (activeAttempt) {
        coreLog('core connect already in flight; reusing the active attempt', {
            attemptId: activeAttempt.id
        });
        return activeAttempt.promise;
    }

    const attempt = {
        id: ++attemptSequence,
        cancelled: false,
        tombstoned: false,
        joinedExistingPairing: false,
        startedAt: Date.now()
    };
    activeAttempt = attempt;
    attempt.promise = runCoreConnectAttempt(attempt).finally(() => {
        if (activeAttempt === attempt) activeAttempt = null;
    });
    // The caller still receives the rejection; this only keeps the internal
    // reference from surfacing as unhandled when nobody awaits it.
    attempt.promise.catch(() => {});
    return attempt.promise;
}

function throwIfAttemptCancelled(attempt) {
    if (!attempt.cancelled) return;
    throw createConnectCancelledError('cancelled-before-pairing');
}

async function runCoreConnectAttempt(attempt) {
    const instance = await getCoreEthereumProvider();
    throwIfAttemptCancelled(attempt);

    // 0. An explicit Connect gesture is the deterministic reconciliation point
    // for a store that ended up with more than one ArtSoul session (the iOS
    // deep-link race). Nothing is guessed: every session in this dedicated
    // store is ended, then a single fresh pairing is created.
    const conflict = readCoreSessionConflict(instance);
    if (conflict) {
        coreLog('duplicate ArtSoul WalletConnect sessions reconciled on Connect', {
            topics: conflict.topics.map(maskCoreTopic),
            acceptedTopicPresent: conflict.resolved
        });
        await disconnectCoreWalletOutcome({
            cancelPendingAttempt: false,
            reason: 'duplicate sessions reconciled on Connect'
        });
        throwIfAttemptCancelled(attempt);
    }

    // 1. An authoritative, SIWE-capable session IS the answer. Never pair over
    // a live session: EthereumProvider.connect() would settle a second topic.
    const existing = readAuthoritativeCoreSession(instance);
    if (existing.ready) {
        setAcceptedCoreTopic(existing.topic, 'existing session reused');
        setCoreLifecycleState(CORE_LIFECYCLE.CONNECTED, { reason: 'existing session reused' });
        coreLog('core connect reused live session', {
            chainId: existing.chainId,
            namespaceMethods: existing.approvedMethods,
            sessionStore: getCoreSessionStoreDiagnostics(instance)
        });
        return {
            provider: instance,
            address: existing.address,
            chainId: existing.chainId,
            restored: true
        };
    }

    if (instance.session && !existing.live) {
        // Proven dead by the authoritative store (or tombstoned): local cache
        // only, no remote disconnect.
        await discardInvalidCoreSession(instance);
    } else if (instance.session && !existing.ready) {
        // Live but unusable — most often a session the wallet settled without
        // personal_sign. Replacing it is the whole point of this explicit user
        // tap, and it must be a REAL disconnect: leaving it in the SignClient
        // store would let EthereumProvider.connect() add a second topic beside
        // it. This is the only non-Disconnect teardown and it is user-driven.
        coreLog('live WalletConnect session cannot sign; replacing it on user request', {
            topic: maskCoreTopic(existing.topic),
            reason: existing.reason,
            missingMethods: existing.missingMethods
        });
        await disconnectCoreWalletOutcome({
            cancelPendingAttempt: false,
            reason: 'unusable session replaced'
        });
    }

    // A tombstoned or otherwise orphaned topic is intentionally invisible to
    // liveness/conflict reads, but it still occupies the dedicated SignClient
    // store. An explicit Connect must physically remove every such leftover
    // before publishing a new proposal, otherwise the next settle creates a
    // raw two-session store even though only one topic is eligible for UI use.
    const orphanedTopics = getAllCoreStoredSessionTopics(instance);
    if (orphanedTopics.length) {
        coreLog('orphaned ArtSoul WalletConnect sessions reconciled on Connect', {
            topics: orphanedTopics.map(maskCoreTopic)
        });
        await disconnectCoreWalletOutcome({
            cancelPendingAttempt: false,
            reason: 'orphaned sessions reconciled on Connect'
        });
        throwIfAttemptCancelled(attempt);
    }

    setCoreLifecycleState(CORE_LIFECYCLE.PAIRING, { attemptId: attempt.id });

    const modal = getCoreWalletModal();
    const startedAt = Date.now();

    // Modal lifecycle for THIS attempt, idempotent and total: display_uri
    // opens the official modal with the pairing URI; closeModal() fires on
    // EVERY settle signal — the awaited connect() resolution, the provider
    // 'connect' event, accountsChanged carrying an address — whichever
    // lands first, plus a final close when the attempt ends. Every close
    // (and every close failure) is logged, and later signals retry a
    // failed close, so the Connecting view can never outlive a settled
    // session. A failure to open is a real rejection of the attempt —
    // never a silent pending connect.
    let rejectAttempt = () => {};
    const attemptAborted = new Promise((_, reject) => {
        rejectAttempt = reject;
    });
    // Disconnect settles a pending attempt through this hook.
    attempt.abort = rejectAttempt;
    // A late rejection after the race already settled (e.g. an openModal
    // failure landing post-settle) must not surface as unhandled.
    attemptAborted.catch(() => {});
    let attemptSettled = false;
    const closeAttemptModal = (reason) => {
        try {
            modal.closeModal();
            coreLog(`wc modal closed (${reason})`, {});
        } catch (error) {
            coreLog('wc modal close failed', { reason, ...describeCoreError(error) });
        }
    };
    const markAttemptSettled = (reason) => {
        attemptSettled = true;
        closeAttemptModal(reason);
    };
    const handleDisplayUri = (uri) => {
        if (attemptSettled || attempt.cancelled) return;
        setCoreLifecycleState(CORE_LIFECYCLE.WAITING_FOR_WALLET, { attemptId: attempt.id });
        Promise.resolve()
            .then(() => modal.openModal({ uri }))
            .then(() => {
                coreLog('official modal opened', {});
                // The wcm open resolves from a readiness poll and can land
                // AFTER a fast settle: close again so a late open never
                // resurrects the Connecting view.
                if (attemptSettled) closeAttemptModal('settle landed during modal open');
            })
            .catch((error) => {
                coreLog('official modal open failed', describeCoreError(error));
                rejectAttempt(error);
            });
    };
    const handleConnectSettleSignal = () => markAttemptSettled('provider connect event');
    const handleAccountsSettleSignal = (accounts) => {
        const hasAddress = (Array.isArray(accounts) ? accounts : []).filter(Boolean).length > 0;
        if (hasAddress) markAttemptSettled('accountsChanged with address');
    };
    instance.on('display_uri', handleDisplayUri);
    instance.on('connect', handleConnectSettleSignal);
    instance.on('accountsChanged', handleAccountsSettleSignal);
    // Modal close is NEVER destructive. Re-read the LIVE state at close
    // time (never a captured snapshot): with a session settled — or any
    // settle signal already landed — the close is just the modal going
    // away, and nothing happens. Only a true mid-flight close cancels the
    // ATTEMPT so the Connect button is immediately reusable. It cannot
    // cancel the SDK (abortPairingAttempt is a no-op in 2.23.10), so the
    // pairing keeps running and its outcome is adopted or torn down by
    // finalizeLateCoreSdkConnect. Never a disconnect, never a WalletConnect
    // storage write, never a hint clear — the user's explicit Disconnect
    // stays the only teardown on this path.
    const unsubscribeModal = modal.subscribeModal((state) => {
        if (state?.open) return;
        if (instance.session || attemptSettled) {
            coreLog('wc modal closed with a live session; no action', {});
            return;
        }
        coreLog('official modal closed without a session; attempt cancelled', {});
        attempt.cancelled = true;
        rejectAttempt(createModalClosedError());
    });

    try {
        throwIfAttemptCancelled(attempt);
        // ArtSoul-owned cache of the CURRENT task's pairing URI. Never
        // `signer.uri` — that is an internal UniversalProvider field.
        const joinedPairingUri = sdkConnectTask ? sdkPairingUri : null;
        const connectTask = startCoreSdkConnect(instance, attempt);
        // Joining a live pairing must re-show the SAME uri: the SDK already
        // emitted display_uri for it and will not emit it again.
        if (joinedPairingUri) handleDisplayUri(joinedPairingUri);
        await Promise.race([connectTask, attemptAborted]);
        sdkConnectWaiters.delete(attempt);
        markAttemptSettled('connect() resolved');
        setCoreLifecycleState(CORE_LIFECYCLE.SETTLING_SESSION, { attemptId: attempt.id });
        reconcileDeferredMissingTopics(instance, 'SDK connect resolved');

        // Authoritative readiness, not "connect() resolved", decides success.
        const settled = readAuthoritativeCoreSession(instance);
        if (!settled.ready) {
            if (!settled.live) await discardInvalidCoreSession(instance);
            setCoreLifecycleState(CORE_LIFECYCLE.DISCONNECTED, { reason: settled.reason });
            throw createCoreSessionNotLiveError(settled.reason, {
                missingMethods: settled.missingMethods,
                approvedChainIds: settled.approvedChainIds
            });
        }

        setAcceptedCoreTopic(settled.topic, 'connect settled');
        setCoreLifecycleState(CORE_LIFECYCLE.CONNECTED, { attemptId: attempt.id });
        coreLog('core connect settled', {
            elapsedMs: Date.now() - startedAt,
            chainId: settled.chainId,
            namespaceChains: instance.session?.namespaces?.eip155?.chains || null,
            namespaceMethods: settled.approvedMethods,
            joinedExistingPairing: attempt.joinedExistingPairing,
            sessionStore: getCoreSessionStoreDiagnostics(instance)
        });
        warnIfWriteChainMissing(instance);
        return {
            provider: instance,
            address: settled.address,
            chainId: settled.chainId,
            restored: false
        };
    } catch (error) {
        if (!isCoreSessionActive() && lifecycleState !== CORE_LIFECYCLE.DISCONNECTING) {
            setCoreLifecycleState(CORE_LIFECYCLE.DISCONNECTED, {
                reason: error?.code === 4001 ? 'attempt cancelled' : 'attempt failed'
            });
        }
        throw error;
    } finally {
        try {
            instance.removeListener?.('display_uri', handleDisplayUri);
            instance.removeListener?.('connect', handleConnectSettleSignal);
            instance.removeListener?.('accountsChanged', handleAccountsSettleSignal);
        } catch {
            // Listener teardown must never mask the connect outcome.
        }
        try {
            unsubscribeModal?.();
        } catch {
            // Same: teardown is best effort.
        }
        closeAttemptModal('attempt finalized');
    }
}

// Explicit user disconnect is the ONLY place session/storage teardown happens
// on this path. Repeated taps are idempotent: the second tap joins the first
// outcome instead of starting a second teardown, and a disconnect with nothing
// to disconnect is reported as such instead of as a successful teardown.
export async function disconnectCoreWalletOutcome(options = {}) {
    if (disconnectPromise) {
        coreLog('core disconnect already in flight; reusing it', {});
        return disconnectPromise;
    }
    disconnectPromise = runCoreDisconnect(options).finally(() => {
        disconnectPromise = null;
    });
    return disconnectPromise;
}

// Boolean-compatible wrapper for existing callers.
export async function disconnectCoreWallet() {
    const outcome = await disconnectCoreWalletOutcome();
    return outcome.disconnected;
}

async function runCoreDisconnect(options = {}) {
    // Boot starts the provider init before the user can tap anything, and a
    // Disconnect landing inside that window must still reach the store — not
    // silently no-op and leave every ArtSoul session behind. If no init was
    // ever started there is genuinely no store to clear.
    let instance = providerInstance;
    if (!instance && providerInitPromise) {
        instance = await providerInitPromise.catch(() => null);
    }
    const cancelPendingAttempt = options.cancelPendingAttempt !== false;
    let cancelledAttempts = 0;

    if (cancelPendingAttempt) {
        // Disconnect invalidates the current attempt AND every attempt waiting
        // on the uncancellable SDK task, so a late settle is torn down instead
        // of restoring connected UI behind the user's back. Each attempt is
        // settled at once so the Connect button is immediately reusable and
        // `activeAttempt` is released for a fresh tap.
        const pending = new Set(sdkConnectWaiters);
        if (activeAttempt) pending.add(activeAttempt);
        for (const attempt of pending) {
            attempt.cancelled = true;
            attempt.tombstoned = true;
            cancelledAttempts += 1;
            try {
                attempt.abort?.(createConnectCancelledError('disconnected-during-connect'));
            } catch {
                // Aborting is best effort; the flags above are authoritative.
            }
        }
    }

    // The store is ArtSoul-dedicated, so "disconnect" means every session in
    // it — not only the one UniversalProvider happens to have cached. A leftover
    // stored topic is exactly what survives a Disconnect and gets restored on
    // the next page load (UniversalProvider.createClient() adopts
    // `client.session.getAll()[0]`).
    const providerTopic = String(instance?.session?.topic || '');
    // Teardown must enumerate the RAW dedicated store. Tombstones prevent a
    // topic from becoming UI state; they must never exempt it from deletion.
    const topics = [...new Set([providerTopic, ...getAllCoreStoredSessionTopics(instance)].filter(Boolean))];
    if (!topics.length) {
        clearAcceptedCoreTopic(options.reason || 'no active session');
        setCoreLifecycleState(CORE_LIFECYCLE.DISCONNECTED, { reason: options.reason || 'no active session' });
        coreLog('core disconnect found no active session', { cancelledAttempts });
        return {
            disconnected: false,
            hadSession: false,
            reason: 'no-active-session',
            cancelledAttempts,
            topic: null,
            topics: [],
            remainingSessionCount: 0
        };
    }

    setCoreLifecycleState(CORE_LIFECYCLE.DISCONNECTING, { reason: options.reason || 'user disconnect' });
    // Tombstone BEFORE any network call: whatever the relay does, none of these
    // topics may be published as connected again.
    for (const candidate of topics) tombstoneCoreTopic(candidate);
    clearAcceptedCoreTopic(options.reason || 'user disconnect');

    const failures = [];
    // The cached provider session goes through the provider so UniversalProvider
    // also drops its own session/namespace state.
    if (providerTopic && instance?.session) {
        try {
            await instance.disconnect();
            coreLog('core session disconnected', { topic: maskCoreTopic(providerTopic) });
        } catch (error) {
            failures.push({ topic: providerTopic, error });
            coreLog('core session disconnect failed', {
                topic: maskCoreTopic(providerTopic),
                ...describeCoreError(error)
            });
            // The peer may already be gone. The local cache must not survive as
            // "connected" after the user asked to disconnect.
            try {
                await discardInvalidCoreSession(instance, { force: true });
            } catch (cleanupError) {
                failures.push({ topic: providerTopic, error: cleanupError, local: true });
                coreLog('core session local teardown failed', describeCoreError(cleanupError));
            }
        }
    }

    // Everything still in the dedicated store goes through the PUBLIC
    // SignClient disconnect API.
    const client = instance?.signer?.client;
    for (const leftover of readCoreSessionStore(instance).sessions || []) {
        const leftoverTopic = String(leftover?.topic || '');
        if (!leftoverTopic) continue;
        tombstoneCoreTopic(leftoverTopic);
        if (typeof client?.disconnect !== 'function') {
            failures.push({ topic: leftoverTopic, error: new Error('SignClient disconnect is unavailable') });
            continue;
        }
        try {
            await client.disconnect({
                topic: leftoverTopic,
                reason: { code: 6000, message: 'User disconnected.' }
            });
            coreLog('leftover ArtSoul WalletConnect session disconnected', {
                topic: maskCoreTopic(leftoverTopic)
            });
        } catch (error) {
            failures.push({ topic: leftoverTopic, error });
            coreLog('leftover ArtSoul WalletConnect session disconnect failed', {
                topic: maskCoreTopic(leftoverTopic),
                ...describeCoreError(error)
            });
        }
    }

    const remainingSessionCount = (readCoreSessionStore(instance).sessions || []).length;
    const disconnected = failures.length === 0 && remainingSessionCount === 0;
    setCoreLifecycleState(CORE_LIFECYCLE.DISCONNECTED, {
        reason: disconnected ? 'session disconnected' : 'disconnect incomplete'
    });
    coreLog('core disconnect settled', {
        topics: topics.map(maskCoreTopic),
        cancelledAttempts,
        failureCount: failures.length,
        remainingSessionCount
    });
    return {
        disconnected,
        hadSession: true,
        reason: disconnected ? 'session-disconnected' : 'disconnect-incomplete',
        cancelledAttempts,
        topic: providerTopic || topics[0],
        topics,
        remainingSessionCount,
        ...(failures.length ? { error: failures[0].error } : {})
    };
}
