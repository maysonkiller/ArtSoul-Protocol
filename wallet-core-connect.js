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
// ============================================

// Pinned OFFICIAL modal (wcm-* custom elements — no collision with the
// page's @reown/appkit w3m-* elements). The bundle is fully self-contained:
// no runtime dynamic imports left to fail silently.
import { WalletConnectModal } from 'https://esm.sh/@walletconnect/modal@2.7.0?bundle';

const WC_ETHEREUM_PROVIDER_VERSION = '2.23.10';
const WC_ETHEREUM_PROVIDER_URL = `https://esm.sh/@walletconnect/ethereum-provider@${WC_ETHEREUM_PROVIDER_VERSION}?bundle`;
const WC_MODAL_VERSION = '2.7.0';

const BASE_SEPOLIA_CHAIN_ID = 84532;
const BASE_SEPOLIA_RPC_URL = 'https://sepolia.base.org';
// Optional chains let wallets sitting on another network settle the session.
// Nothing on this path ever requests a chain switch — the write guard
// (ensureArtSoulWriteNetwork) is the only place that ever asks for 84532.
const OPTIONAL_CHAIN_IDS = [8453, 1];

let settings = { projectId: null, metadata: null, log: null };
let providerInstance = null;
let providerInitPromise = null;
let connectPromise = null;
let rejectionGuardBound = false;
let modalInstance = null;

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

export function isCoreConnectInFlight() {
    return Boolean(connectPromise);
}

export function isCoreSessionActive() {
    return Boolean(providerInstance?.session);
}

export function getConnectedCoreProvider() {
    return providerInstance?.session ? providerInstance : null;
}

// The provider instance regardless of session state. An IN-FLIGHT connect()
// has a provider (and a relay socket) but no session yet — the browser-return
// transport restart needs to reach that relayer so the wallet's approval
// message lands in this tab and the pending connect() settles here.
export function getCoreProviderInstance() {
    return providerInstance;
}

// The SDK's `instance.accounts` is filtered by the provider's CURRENT chainId
// (setAccounts drops every namespace account whose chain differs), and that
// chainId is persisted across page loads. A session whose wallet sits on a
// foreign network (observed: MetaMask parked on 8453) therefore reports []
// while the session record — with the address — is alive in storage. Read the
// address chain-independently from the session namespaces: the address is what
// "connected" means; the network is the write-guard's business.
export function getCoreSessionAddress(instance = providerInstance) {
    if (!instance?.session) return null;
    const liveAccount = (instance.accounts || []).filter(Boolean)[0] || null;
    if (liveAccount) return liveAccount;
    const namespaceAccounts = Object.values(instance.session.namespaces || {})
        .flatMap((namespace) => namespace?.accounts || []);
    for (const account of namespaceAccounts) {
        const match = String(account).match(/^eip155:\d+:(0x[a-fA-F0-9]{40})$/);
        if (match) return match[1];
    }
    return null;
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

function describeCoreError(error) {
    return {
        name: error?.name || 'Error',
        code: error?.code ?? null,
        message: error?.message || String(error)
    };
}

// Diagnostic only: requests route to the provider's CURRENT chainId (84532 by
// construction — chains: [84532]), and the write guard's switch covers every
// action. But a wallet may approve namespaces WITHOUT eip155:84532 (observed
// on prod: MetaMask approved [1,59144,8453,...] while provider chainId was
// 84532). Surface that gap in one line so field logs show it immediately.
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

// The WalletConnect SDK has a pairing/session topic rotation race that
// surfaces as an unhandled "No matching key" rejection. In the proven
// bare-provider session it is non-fatal — swallow it so nothing upstream
// treats it as a failed connection.
function bindStaleTopicRejectionGuard() {
    if (rejectionGuardBound) return;
    rejectionGuardBound = true;
    window.addEventListener('unhandledrejection', (event) => {
        const message = String(event?.reason?.message || event?.reason || '');
        if (/no matching key/i.test(message)) {
            event.preventDefault();
            coreLog('stale WalletConnect topic rejection suppressed', { message: message.slice(0, 160) });
        }
    });
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
            coreLog('core provider module import started', { version: WC_ETHEREUM_PROVIDER_VERSION });
            const module = await import(WC_ETHEREUM_PROVIDER_URL);
            const EthereumProvider = module.EthereumProvider || module.default;
            const instance = await EthereumProvider.init({
                projectId: settings.projectId,
                chains: [BASE_SEPOLIA_CHAIN_ID],
                optionalChains: OPTIONAL_CHAIN_IDS,
                showQrModal: false,
                metadata: settings.metadata,
                rpcMap: { [BASE_SEPOLIA_CHAIN_ID]: BASE_SEPOLIA_RPC_URL }
            });
            bindProviderDiagnostics(instance);
            providerInstance = instance;
            coreLog('core provider initialized', {
                version: WC_ETHEREUM_PROVIDER_VERSION,
                chains: [BASE_SEPOLIA_CHAIN_ID],
                optionalChains: OPTIONAL_CHAIN_IDS,
                sessionRestorable: Boolean(instance.session)
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
export async function restoreCoreSessionOutcome() {
    try {
        const instance = await getCoreEthereumProvider();
        if (!instance.session) return { status: 'none', session: null };
        // Chain-independent: a session parked on a foreign chain (accounts
        // getter filtered empty) is still a connected wallet, not "no session".
        const address = getCoreSessionAddress(instance);
        if (!address) return { status: 'none', session: null };
        const restored = {
            provider: instance,
            address,
            chainId: parseCoreChainId(instance.chainId),
            restored: true
        };
        coreLog('core session restored from storage', {
            chainId: restored.chainId,
            namespaceChains: instance.session?.namespaces?.eip155?.chains || null
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

// The standard connect: await provider.connect() while OUR official modal
// shows the pairing. The modal handles wallet choice, deep linking and QR.
// No timeout marks the attempt failed — the user approves at their own pace.
// A second tap while a connect is in flight reuses the SAME promise (and
// therefore the same pairing): a page never holds two pairings for one
// attempt, and the URI is never regenerated within an attempt.
export async function connectCoreWallet() {
    if (connectPromise) {
        coreLog('core connect already in flight; reusing the active pairing', {});
        return connectPromise;
    }

    connectPromise = (async () => {
        const instance = await getCoreEthereumProvider();

        if (instance.session) {
            const address = getCoreSessionAddress(instance);
            if (address) {
                coreLog('core connect reused live session', { chainId: parseCoreChainId(instance.chainId) });
                return {
                    provider: instance,
                    address,
                    chainId: parseCoreChainId(instance.chainId),
                    restored: true
                };
            }
        }

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
            if (attemptSettled) return;
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
        // attempt so the Connect button is immediately reusable: abort the
        // pairing loop (abortPairingAttempt only sets a loop flag inside the
        // signer — it cannot delete a settled session or touch storage) and
        // settle as a user rejection. Never a disconnect, never a WalletConnect
        // storage write, never a hint clear — the user's explicit Disconnect
        // stays the only teardown on this path.
        const unsubscribeModal = modal.subscribeModal((state) => {
            if (state?.open) return;
            if (instance.session || attemptSettled) {
                coreLog('wc modal closed with a live session; no action', {});
                return;
            }
            coreLog('official modal closed without a session; attempt cancelled', {});
            try {
                instance.signer?.abortPairingAttempt?.();
            } catch {
                // Abort is best effort; the rejection below settles the attempt.
            }
            rejectAttempt(createModalClosedError());
        });

        try {
            const connectTask = instance.connect();
            // If the attempt is cancelled, the losing connect() may reject
            // much later (aborted pairing loop) — keep it observed.
            connectTask.catch(() => {});
            await Promise.race([connectTask, attemptAborted]);
            markAttemptSettled('connect() resolved');
            const result = {
                provider: instance,
                address: getCoreSessionAddress(instance),
                chainId: parseCoreChainId(instance.chainId),
                restored: false
            };
            coreLog('core connect settled', {
                elapsedMs: Date.now() - startedAt,
                chainId: result.chainId,
                namespaceChains: instance.session?.namespaces?.eip155?.chains || null
            });
            warnIfWriteChainMissing(instance);
            return result;
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
    })().finally(() => {
        connectPromise = null;
    });

    return connectPromise;
}

// Explicit user disconnect is the ONLY place session/storage teardown happens
// on this path.
export async function disconnectCoreWallet() {
    if (!providerInstance?.session) return false;
    try {
        await providerInstance.disconnect();
        coreLog('core session disconnected');
        return true;
    } catch (error) {
        coreLog('core session disconnect failed', describeCoreError(error));
        return false;
    }
}
