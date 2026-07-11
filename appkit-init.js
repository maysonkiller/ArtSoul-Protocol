// ============================================
// APPKIT INITIALIZATION MODULE
// Centralized Web3 wallet connection for ArtSoul
// ============================================

import { createAppKit } from 'https://esm.sh/@reown/appkit@1.8.21?bundle'
import { WagmiAdapter } from 'https://esm.sh/@reown/appkit-adapter-wagmi@1.8.21?bundle'
import { baseSepolia, base, mainnet } from 'https://esm.sh/@reown/appkit@1.8.21/networks?bundle'
// Mobile external browsers connect through the proven bare
// @walletconnect/ethereum-provider path instead of the AppKit modal.
import {
    configureCoreWallet,
    connectCoreWallet,
    disconnectCoreWallet,
    getConnectedCoreProvider,
    getCoreSessionAddress,
    isCoreConnectInFlight,
    isCoreSessionActive,
    restoreCoreSessionOutcome,
    showCoreWalletSheet,
    waitForWalletChainSettle
} from './wallet-core-connect.js?v=3'

// ============================================
// CONFIGURATION
// ============================================

// Public Reown project identifier for the verified ArtSoul web project.
const projectId = '9fdc97f91c02d46a28ca9d185a9e58f2';

const BASE_SEPOLIA_CHAIN_ID = 84532;
const BASE_SEPOLIA_CAIP_ID = 'eip155:84532';
const BASE_SEPOLIA_RPC_URL = 'https://sepolia.base.org';
// Mainnet entries are negotiation-only compatibility routes for mobile
// WalletConnect. ArtSoul operations and every write remain Base Sepolia-only.
const networks = [baseSepolia, base, mainnet];
const customRpcUrls = {
    [BASE_SEPOLIA_CAIP_ID]: [{ url: BASE_SEPOLIA_RPC_URL }]
};

const SUPPORTED_NETWORKS = {
    84532: {
        appKitNetwork: baseSepolia,
        chainId: 84532,
        hexChainId: '0x14a34',
        chainName: 'Base Sepolia',
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: [BASE_SEPOLIA_RPC_URL],
        blockExplorerUrls: ['https://sepolia.basescan.org']
    }
};

// metadata.url MUST match the actual origin the dApp is served from.
// A hardcoded url that differs from window.location.origin makes WalletConnect
// log "Local configuration ignored" and — critically on mobile — breaks the
// deep-link return from the wallet app (MetaMask), leaving the modal stuck on
// an eternal loading spinner. Derive it from the live origin instead.
const appOrigin = (typeof window !== 'undefined' && window.location?.origin)
    ? window.location.origin
    : 'https://artsoul.vercel.app';
const appReturnUrl = (() => {
    try {
        const returnUrl = new URL(window.location.href);
        returnUrl.hash = '';
        return returnUrl.toString();
    } catch {
        return appOrigin;
    }
})();
const metadata = {
    name: 'ArtSoul Marketplace',
    description: 'Decentralized Art Marketplace',
    url: appOrigin,
    icons: [`${appOrigin}/ARTSOULlogo-clean.png`],
    // Tell WalletConnect where to send the user back after approval. Preserve
    // the current artwork/profile route instead of dropping the user at /.
    redirect: {
        universal: appReturnUrl
    }
};

// Network display names and currencies
const networkMap = {
    84532: { name: 'Base Sepolia', currency: 'ETH' }
};

// The core path shares the exact production metadata (including
// redirect.universal) so wallets can return the user to this browser tab.
configureCoreWallet({
    projectId,
    metadata,
    log: (step, detail) => walletDebugLog(step, detail)
});

// ============================================
// STATE
// ============================================

let modal = null;
let wagmiAdapter = null;
let currentNetwork = null;
let currentBalance = '0.00';
let lastProcessedAddress = null;
let lastProcessedChainId = null;
let isAuthenticating = false;
let lastConfirmedWalletAt = 0;
let activeNetworkSwitchChainId = null;
let networkModalIntentUntil = 0;
let connectModalIntentUntil = 0;
let activeWalletProvider = null;
let walletResumeTimer = null;
let walletResumeListenersBound = false;
let activeMobileConnect = false;
let latestAppKitAccountSnapshot = null;
let appKitAccountRevision = 0;
let mobileConnectStartRevision = 0;
let mobileConnectInitialAccountKey = '';
let deferMobileAuthenticationThisTurn = false;
const walletResumeWaiters = new Set();
const boundRuntimeProviders = new WeakSet();
const WALLET_HYDRATION_TIMEOUT = 8000;
// Hard fail-open: the wallet UI must never sit on "Restoring wallet..." forever.
// If nothing has settled the state within this short window (e.g. a provider
// read stalls, or AppKit never emits an account on desktop), force the settled
// state so the header shows Connect Wallet. A wallet that connects later still
// flips to connected. Kept below WALLET_HYDRATION_TIMEOUT so it always wins.
const WALLET_SETTLE_FAILOPEN_TIMEOUT = 4000;
const POST_CONNECT_DISCONNECT_GUARD = 1200;
const WALLET_CONNECT_TIMEOUT_DESKTOP = 45000;
const WALLET_CONNECT_TIMEOUT_MOBILE = 90000;
const APPKIT_MODAL_OPEN_TIMEOUT = 10000;
const MOBILE_MODAL_CLOSED_GRACE = 8000;
const MOBILE_RETURN_SETTLEMENT_WINDOW = 30000;
const WALLET_CONFIRMATION_INTERVAL = 400;
const MOBILE_PROVIDER_REQUEST_TIMEOUT = 5000;
const MOBILE_NETWORK_SWITCH_TIMEOUT = 15000;
// Initial mobile connect only: the one add/switch cycle is a courtesy, not a
// gate — WalletConnect network switching on iOS is unreliable, so the sheet
// must not hang long before accepting the session on its actual chain.
const MOBILE_CONNECT_SWITCH_TIMEOUT = 8000;
const NETWORK_CONFIRMATION_TIMEOUT = 10000;
const NETWORK_CONFIRMATION_INTERVAL = 300;
const NETWORK_MODAL_INTENT_WINDOW = 120000;
const MODAL_CLOSE_RETRY_DELAY = 400;
const WALLET_STORAGE_VERSION_KEY = 'artsoul_wallet_storage_version';
const WALLET_STORAGE_VERSION = 'appkit-1.8.21-compatible-session-v2';
const FEATURED_WALLETS = {
    base: 'fd20dc426fb37566d803205b19bbc1d4096b248ac04548e3cfb6b3a38bd033aa',
    metamask: 'c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96',
    rabby: '18388be9ac2d02726dbac9777c96efaac06d744b2f6d580fccdd4127a6d01fd1'
};
let lastDispatchedWalletStateKey = null;
let lastAcceptedMobileAccountKey = null;
let lastObservedAppKitAccountKey = null;
let modalClosePromise = null;
let modalCloseRetryTimer = null;
let mobileSessionFinalizePromise = null;
let mobileSessionFinalizeKey = '';
let activeConnectAttempt = null;
let connectAttemptSequence = 0;
let lastSelectedWallet = null;
let lastWalletConnectUri = null;
let mobileRetryCleanupRequired = false;
let walletTransportRestartPromise = null;
// Mobile core-path session restore (external browsers). The persisted
// WalletConnect session is the source of truth for "connected"; these track
// the in-flight restore so no timer or protected action decides
// "disconnected" while it is still running. Both stay null on desktop and in
// injected wallet browsers.
let coreSessionRestoreTask = null;
let coreSessionRestoreCompletion = null;
let coreSessionRestoreSettled = false;
// Per-attempt cap and retries for the restore: the esm.sh import +
// EthereumProvider.init() can fail transiently on mobile networks; a failed
// restore must not be mistaken for "no session".
const CORE_RESTORE_ATTEMPT_TIMEOUT = 12000;
const CORE_RESTORE_MAX_ATTEMPTS = 3;
// A core 'disconnect' delivered while the browser is backgrounded (iOS kills
// the relay socket) is re-checked on return instead of wiping state blind.
let pendingCoreDisconnectProvider = null;
const walletConnectDiagnosticClients = new WeakSet();
const walletConnectDiagnosticRelayers = new WeakSet();
const walletConnectUriProviders = new WeakSet();
let walletDebugSequence = 0;
const walletDebugEntries = [];
const walletDebugStartedAt = Date.now();
let walletDebugDiagnosticsBound = false;
let lastWalletDebugModalStateKey = '';
window.artsoulWalletHydrating = true;
window.artsoulWalletStateSettled = false;
window.artsoulSettledWalletState = null;

function walletDebugEnabled() {
    try {
        const params = new URLSearchParams(window.location.search);
        const hashParams = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
        const disabled = ['walletdebug', 'walletDebug'].some((key) => (
            params.get(key) === '0' || hashParams.get(key) === '0'
        ));
        if (disabled) {
            localStorage.removeItem('artsoul_wallet_debug');
            return false;
        }
        const requested = ['walletdebug', 'walletDebug'].some((key) => (
            params.get(key) === '1' || hashParams.get(key) === '1'
        ));
        if (requested) localStorage.setItem('artsoul_wallet_debug', '1');
        return requested || localStorage.getItem('artsoul_wallet_debug') === '1';
    } catch {
        return false;
    }
}

function sanitizeWalletDebugValue(value, key = '') {
    if (value === null || value === undefined) return value;
    if (/signature|private|secret|token/i.test(key) || /^projectid$/i.test(key)) return '[redacted]';
    if (typeof value === 'string') {
        return value.replace(/0x[a-fA-F0-9]{40}/g, (address) => maskWalletAddress(address));
    }
    if (Array.isArray(value)) return value.slice(0, 8).map((item) => sanitizeWalletDebugValue(item));
    if (typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value)
                .slice(0, 24)
                .map(([entryKey, entryValue]) => [entryKey, sanitizeWalletDebugValue(entryValue, entryKey)])
        );
    }
    return value;
}

function describeWalletDebugError(error) {
    return {
        name: error?.name || 'Error',
        code: error?.code ?? null,
        message: error?.message || String(error),
        stack: String(error?.stack || '').split('\n').slice(0, 5).join(' | ') || null
    };
}

function walletDebugLog(step, detail = null) {
    if (!walletDebugEnabled()) return;

    const payload = {
        sequence: ++walletDebugSequence,
        elapsedMs: Date.now() - walletDebugStartedAt,
        step,
        detail: sanitizeWalletDebugValue(detail),
        attemptId: activeConnectAttempt?.id || null,
        visibility: document.visibilityState,
        focused: document.hasFocus?.() ?? null,
        online: navigator.onLine,
        time: new Date().toISOString()
    };
    walletDebugEntries.push(payload);
    if (walletDebugEntries.length > 300) walletDebugEntries.shift();
    console.log('[ArtSoulWalletDebug]', payload);

    let panel = document.getElementById('artsoul-wallet-debug');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'artsoul-wallet-debug';
        panel.setAttribute('aria-live', 'polite');
        panel.style.cssText = [
            'position:fixed',
            'left:10px',
            'right:10px',
            'bottom:10px',
            'z-index:2147483647',
            'max-height:42vh',
            'overflow:auto',
            'padding:10px',
            'font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
            'color:var(--c-text)',
            'background:var(--c-surface)',
            'border:1px solid var(--c-border)',
            'border-radius:8px',
            'box-shadow:0 0 18px var(--c-glow, transparent)',
            'white-space:pre-wrap'
        ].join(';');
        const heading = document.createElement('div');
        heading.textContent = 'ARTSOUL WALLET DEBUG • screenshot this panel after the failure';
        heading.style.cssText = 'position:sticky;top:0;padding:4px 0 8px;font-weight:700;color:var(--c-accent);background:var(--c-surface);z-index:1';
        panel.appendChild(heading);
        document.documentElement.appendChild(panel);
    }

    const line = document.createElement('div');
    line.textContent = `${payload.time} ${step}${payload.detail ? ` ${JSON.stringify(payload.detail)}` : ''}`;
    panel.appendChild(line);
    panel.scrollTop = panel.scrollHeight;
}

function bindWalletDebugDiagnostics() {
    if (!walletDebugEnabled() || walletDebugDiagnosticsBound) return;
    walletDebugDiagnosticsBound = true;
    const snapshot = (eventName, detail = null) => walletDebugLog(eventName, {
        ...(detail || {}),
        account: getWalletDebugSnapshot()
    });
    window.addEventListener('error', (event) => {
        walletDebugLog('window error', describeWalletDebugError(event.error || event.message));
    });
    window.addEventListener('unhandledrejection', (event) => {
        walletDebugLog('unhandled rejection', describeWalletDebugError(event.reason));
    });
    window.addEventListener('pageshow', (event) => snapshot('pageshow', { persisted: event.persisted }));
    window.addEventListener('pagehide', (event) => snapshot('pagehide', { persisted: event.persisted }));
    window.addEventListener('blur', () => snapshot('window blur'));
    window.addEventListener('online', () => snapshot('browser online'));
    window.addEventListener('offline', () => snapshot('browser offline'));
    walletDebugLog('SDK version', { component: 'AppKit', version: '1.8.21' });
    walletDebugLog('SDK version', { component: 'AppKit Networks', version: '1.8.21' });
    walletDebugLog('SDK version', { component: 'Wagmi Adapter', version: '1.8.21' });
    walletDebugLog('debug environment', {
        origin: window.location.origin,
        path: window.location.pathname,
        appKitVersion: '1.8.21',
        expectedChainId: BASE_SEPOLIA_CHAIN_ID,
        metadataUrl: appOrigin,
        projectIdPresent: Boolean(projectId),
        projectIdFingerprint: `${projectId.slice(0, 4)}...${projectId.slice(-4)}`,
        effectiveType: navigator.connection?.effectiveType || null,
        userAgent: navigator.userAgent
    });
}

window.ArtSoulWalletDebug = {
    enable() {
        localStorage.setItem('artsoul_wallet_debug', '1');
        walletDebugLog('debug enabled');
    },
    disable() {
        localStorage.removeItem('artsoul_wallet_debug');
        document.getElementById('artsoul-wallet-debug')?.remove();
    },
    log: walletDebugLog,
    snapshot() {
        return walletDebugEntries.map((entry) => ({ ...entry }));
    }
};

bindWalletDebugDiagnostics();

function parseChainId(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return null;
        const caipMatch = trimmed.match(/^eip155:(\d+)(?::|$)/i);
        if (caipMatch) return parseInt(caipMatch[1], 10);
        return trimmed.startsWith('0x') ? parseInt(trimmed, 16) : parseInt(trimmed, 10);
    }
    return null;
}

function getStateChainId(state) {
    if (state === null || state === undefined) return null;
    if (typeof state !== 'object') return parseChainId(state);

    const candidates = [
        state.chainId,
        state.caipAddress,
        state.chain?.id,
        state.chain?.chainId,
        state.selectedNetworkId
    ];
    for (const candidate of candidates) {
        const chainId = parseChainId(candidate);
        if (chainId) return chainId;
    }
    return null;
}

function normalizeChainId(...states) {
    for (const state of states) {
        const chainId = getStateChainId(state);
        if (chainId) return chainId;
    }

    // Preserve injected-provider precedence for desktop extensions and wallet
    // in-app browsers. External mobile WalletConnect must not inherit a chain
    // from an unrelated browser provider.
    if (!isMobileDevice() || isInjectedWalletBrowser()) {
        const injectedChainId = parseChainId(window.ethereum?.chainId || window.ethereum?.networkVersion);
        if (injectedChainId) return injectedChainId;
    }

    try {
        const modalChainId = parseChainId(modal?.getChainId?.() || window.web3Modal?.getChainId?.());
        if (modalChainId) return modalChainId;
    } catch (error) {
        console.warn('Unable to read AppKit chain id:', error);
    }

    try {
        const appKitProvider = modal?.getWalletProvider?.() || window.web3Modal?.getWalletProvider?.();
        if (appKitProvider && typeof appKitProvider.then !== 'function') {
            const providerChainId = parseChainId(appKitProvider.chainId || appKitProvider.networkVersion);
            if (providerChainId) return providerChainId;
        }
    } catch (error) {
        console.warn('Unable to read AppKit provider chain id:', error);
    }

    try {
        const modalState = modal?.getState?.() || window.web3Modal?.getState?.();
        const modalChainId = parseChainId(modalState?.chainId);
        if (modalChainId) return modalChainId;

        const selectedModalChainId = parseChainId(modalState?.selectedNetworkId);
        if (selectedModalChainId) return selectedModalChainId;
    } catch (error) {
        console.warn('Unable to read AppKit selected network state:', error);
    }

    const storedChainId = parseChainId(window.currentChainId || localStorage.getItem('artsoul_chain_id'));
    if (storedChainId) return storedChainId;

    return null;
}

function setCurrentChainId(chainId) {
    if (chainId === null || chainId === undefined || chainId === '') {
        window.currentChainId = null;
        localStorage.removeItem('artsoul_chain_id');
        return null;
    }

    const normalizedChainId = normalizeChainId(chainId);
    window.currentChainId = normalizedChainId;
    if (normalizedChainId) {
        localStorage.setItem('artsoul_chain_id', String(normalizedChainId));
    } else {
        localStorage.removeItem('artsoul_chain_id');
    }
    return normalizedChainId;
}

window.getCurrentChainId = (...states) => normalizeChainId(...states);

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeWalletAddress(value) {
    return value ? String(value).toLowerCase() : '';
}

function maskWalletAddress(value) {
    const address = normalizeWalletAddress(value);
    return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : null;
}

function getSupportedNetworkTarget(chainId) {
    const normalizedChainId = parseChainId(chainId);
    return normalizedChainId ? SUPPORTED_NETWORKS[normalizedChainId] || null : null;
}

function getWalletErrorCode(error) {
    return error?.code ?? error?.data?.code ?? error?.cause?.code ?? error?.error?.code ?? null;
}

function isUnknownChainError(error) {
    const code = getWalletErrorCode(error);
    const message = `${error?.message || ''} ${error?.data?.message || ''}`.toLowerCase();
    return code === 4902 ||
        code === '4902' ||
        message.includes('unrecognized chain') ||
        message.includes('unknown chain') ||
        message.includes('not been added') ||
        message.includes('not added');
}

function isPendingRequestError(error) {
    const code = getWalletErrorCode(error);
    const message = `${error?.message || ''} ${error?.data?.message || ''}`.toLowerCase();
    return code === -32002 ||
        code === '-32002' ||
        message.includes('already pending') ||
        message.includes('request of type') ||
        message.includes('previous request');
}

async function getAppKitWalletProvider() {
    try {
        const provider = await (modal?.getWalletProvider?.() || window.web3Modal?.getWalletProvider?.());
        bindRuntimeProviderEvents(provider, 'appkit wallet provider');
        bindWalletConnectDiagnostics(provider, 'appkit wallet provider');
        return provider;
    } catch (error) {
        console.warn('Unable to get AppKit wallet provider:', error);
        return null;
    }
}

async function requestProviderAccounts(provider) {
    if (!provider?.request) return [];

    try {
        const accounts = await provider.request({ method: 'eth_accounts' });
        const normalizedAccounts = (Array.isArray(accounts) ? accounts : [])
            .map(normalizeWalletAddress)
            .filter(Boolean);
        const selectedAddress = normalizeWalletAddress(provider.selectedAddress);
        if (selectedAddress && normalizedAccounts.includes(selectedAddress)) {
            return [selectedAddress, ...normalizedAccounts.filter((address) => address !== selectedAddress)];
        }
        return normalizedAccounts;
    } catch (error) {
        console.warn('Unable to read provider accounts:', error);
        return [];
    }
}

async function getWalletProviderCandidates({ allowInjectedFallback = true } = {}) {
    const appKitProvider = await getAppKitWalletProvider();
    const providers = [activeWalletProvider, appKitProvider];
    if (allowInjectedFallback) providers.push(window.ethereum);
    return [...new Set(providers.filter(Boolean))];
}

async function getProviderForWallet(walletAddress) {
    const normalizedWallet = normalizeWalletAddress(walletAddress);
    if (!normalizedWallet) return null;

    const providers = await getWalletProviderCandidates();
    for (const provider of providers) {
        const accounts = await requestProviderAccounts(provider);
        if (accounts[0] === normalizedWallet) {
            activeWalletProvider = provider;
            return provider;
        }
    }

    return null;
}

async function reconcileActiveWalletFromProviders(source = 'provider reconciliation', options = {}) {
    const providers = await getWalletProviderCandidates(options);

    for (const provider of providers) {
        const accounts = await requestProviderAccounts(provider);
        if (!accounts.length) continue;

        activeWalletProvider = provider;
        await handleProviderAccountsChanged(accounts, source, provider);
        const chainId = await requestProviderChainId(provider);
        if (chainId) await handleProviderChainConfirmed(chainId, source);

        return {
            address: accounts[0],
            chainId: chainId || normalizeChainId(),
            isConnected: true,
            provider
        };
    }

    return null;
}

async function getAppKitWalletProviderWithin(timeoutMs = 2500) {
    const providerPromise = getAppKitWalletProvider();
    return Promise.race([
        providerPromise,
        sleep(timeoutMs).then(() => null)
    ]);
}

async function requestProviderValueWithin(provider, method, params = [], timeoutMs = 2500) {
    if (!provider?.request) return null;
    const outcome = await Promise.race([
        Promise.resolve(provider.request({ method, params }))
            .then((value) => ({ value }))
            .catch((error) => ({ error })),
        sleep(timeoutMs).then(() => ({ timedOut: true }))
    ]);
    if (outcome?.error) throw outcome.error;
    return outcome?.timedOut ? null : outcome?.value;
}

function getAppKitAccountKey(account) {
    const address = normalizeWalletAddress(account?.address || account?.allAccounts?.[0]?.address);
    return address ? `${address}:${getStateChainId(account) || 'none'}` : '';
}

function appKitAccountSnapshotScore(account) {
    if (!account || typeof account !== 'object') return -1;
    const address = normalizeWalletAddress(account.address || account.allAccounts?.[0]?.address);
    const explicitlyDisconnected = account.status === 'disconnected' || account.isConnected === false;
    let score = address ? 100 : 0;
    if (address && !explicitlyDisconnected) score += 100;
    if (getStateChainId(account)) score += 20;
    if (account.caipAddress || account.selectedNetworkId) score += 5;
    return score;
}

function readAppKitAccountSnapshot() {
    try {
        const candidates = [
            modal?.getAccount?.(),
            window.web3Modal?.getAccount?.(),
            latestAppKitAccountSnapshot
        ].filter(Boolean);
        if (!candidates.length) return null;

        // getAccount() can remain a truthy but empty pre-approval object after
        // an external-browser deep-link round trip. Prefer the most complete
        // connected snapshot instead of allowing that stale object to mask the
        // fresh subscribeAccount event.
        return candidates.reduce((best, candidate) => (
            appKitAccountSnapshotScore(candidate) >= appKitAccountSnapshotScore(best)
                ? candidate
                : best
        ), null);
    } catch (error) {
        console.warn('Unable to read AppKit account session:', error);
        return latestAppKitAccountSnapshot;
    }
}

function getWalletDebugSnapshot(account = readAppKitAccountSnapshot()) {
    let modalState = null;
    try {
        modalState = modal?.getState?.() || window.web3Modal?.getState?.() || null;
    } catch {
        modalState = null;
    }

    const address = normalizeWalletAddress(account?.address || account?.allAccounts?.[0]?.address);
    const wagmi = readWagmiConnectorSnapshot();
    const walletConnect = readWalletConnectSnapshot();
    return {
        account: {
            address: maskWalletAddress(address),
            status: account?.status || null,
            isConnected: account?.isConnected ?? null,
            chainId: account?.chainId ?? null,
            caipAddress: account?.caipAddress || null,
            selectedNetworkId: account?.selectedNetworkId ?? null,
            resolvedChainId: getStateChainId(account),
            accountCount: Array.isArray(account?.allAccounts) ? account.allAccounts.length : null
        },
        modal: {
            open: modalState?.open ?? null,
            chainId: modalState?.chainId ?? null,
            selectedNetworkId: modalState?.selectedNetworkId ?? null
        },
        runtime: {
            currentWallet: maskWalletAddress(window.currentWalletAddress),
            currentChainId: parseChainId(window.currentChainId),
            storedChainId: parseChainId(localStorage.getItem('artsoul_chain_id')),
            accountRevision: appKitAccountRevision,
            activeMobileConnect
        },
        wagmi: {
            status: wagmi.status,
            current: wagmi.current,
            chainId: wagmi.chainId,
            address: wagmi.address,
            connectorId: wagmi.connectorId,
            connectorName: wagmi.connectorName,
            connectorRdns: wagmi.connectorRdns,
            connectionCount: wagmi.connectionCount,
            configuredConnectorCount: wagmi.configuredConnectorCount
        },
        walletConnect
    };
}

function isUserRejectedError(error) {
    const code = getWalletErrorCode(error);
    const message = `${error?.message || ''} ${error?.data?.message || ''}`.toLowerCase();
    return code === 4001 || code === '4001' || message.includes('user rejected') || message.includes('user denied');
}

function getFreshMobileAppKitWalletState(account = readAppKitAccountSnapshot(), attempt = activeConnectAttempt) {
    if (!activeMobileConnect) return null;

    const accountKey = getAppKitAccountKey(account);
    const hasFreshAccountEvent = appKitAccountRevision > mobileConnectStartRevision;
    const sessionChangedSinceConnect = Boolean(accountKey && accountKey !== mobileConnectInitialAccountKey);
    // A WalletConnect approval can land while the browser is suspended. AppKit
    // may then expose the restored session without emitting another account
    // event after focus. An explicit connect attempt may reuse that session, but
    // it still has to pass provider/network confirmation before UI finalization.
    if (!hasFreshAccountEvent && !sessionChangedSinceConnect && !attempt?.allowExistingSession) return null;

    const address = normalizeWalletAddress(account?.address || account?.allAccounts?.[0]?.address);
    const isConnected = Boolean(address) &&
        account?.isConnected !== false &&
        account?.status !== 'disconnected';
    if (!isConnected) return null;

    return {
        address,
        chainId: getStateChainId(account),
        isConnected: true,
        account
    };
}

async function readMobileProviderChainId(provider) {
    if (!provider?.request) return null;
    try {
        const chainId = await requestProviderValueWithin(
            provider,
            'eth_chainId',
            [],
            MOBILE_PROVIDER_REQUEST_TIMEOUT
        );
        return parseChainId(chainId || provider.chainId || provider.networkVersion);
    } catch (error) {
        walletDebugLog('mobile provider chain read failed', {
            code: getWalletErrorCode(error),
            message: error?.message || String(error)
        });
        return parseChainId(provider.chainId || provider.networkVersion);
    }
}

async function waitForMobileBaseSepolia(provider, switchOutcome, attempt, requireProviderChain = false, timeoutMs = MOBILE_NETWORK_SWITCH_TIMEOUT) {
    const deadline = createForegroundDeadline(timeoutMs);
    let lastReportedChainId = null;

    try {
        while (!deadline.hasExpired() && !attempt?.cancelled) {
            if (document.visibilityState !== 'visible') {
                await waitForWalletResumeOrDelay(WALLET_CONFIRMATION_INTERVAL);
                continue;
            }

            const providerChainId = await readMobileProviderChainId(provider);
            const appKitChainId = getStateChainId(readAppKitAccountSnapshot());
            const confirmedChainId = providerChainId || appKitChainId;
            if (confirmedChainId && confirmedChainId !== lastReportedChainId) {
                lastReportedChainId = confirmedChainId;
                walletDebugLog('mobile network switch observed chain', {
                    providerChainId,
                    appKitChainId
                });
            }
            const baseSepoliaConfirmed = requireProviderChain
                ? providerChainId === BASE_SEPOLIA_CHAIN_ID
                : providerChainId === BASE_SEPOLIA_CHAIN_ID || appKitChainId === BASE_SEPOLIA_CHAIN_ID;
            if (baseSepoliaConfirmed) {
                return BASE_SEPOLIA_CHAIN_ID;
            }

            const outcome = await Promise.race([
                switchOutcome,
                waitForWalletResumeOrDelay(WALLET_CONFIRMATION_INTERVAL).then(() => null)
            ]);
            if (outcome?.error && !isPendingRequestError(outcome.error)) throw outcome.error;
            if (outcome) await waitForWalletResumeOrDelay(WALLET_CONFIRMATION_INTERVAL);
        }

        return null;
    } finally {
        deadline.dispose();
    }
}

// acceptForeignChain (initial mobile connect): the address is what
// "connected" means — the one add/switch cycle still runs, but refusal,
// timeout or no response resolves to the session's actual chain instead of
// failing the attempt. The write guard (ensureArtSoulWriteNetwork) remains
// the sole Base Sepolia enforcement point, exactly like the restore path.
async function ensureExternalMobileBaseSepolia(walletState, source, attempt, preferredProvider = null, options = {}) {
    const { acceptForeignChain = false, switchTimeout = MOBILE_NETWORK_SWITCH_TIMEOUT } = options;
    while (document.visibilityState !== 'visible' && !attempt?.cancelled) {
        await waitForWalletResumeOrDelay(WALLET_CONFIRMATION_INTERVAL);
    }
    if (attempt?.cancelled) return null;

    const provider = preferredProvider || await getAppKitWalletProviderWithin(MOBILE_PROVIDER_REQUEST_TIMEOUT);
    if (attempt?.cancelled) return null;

    if (!provider?.request) {
        throw createWalletConnectError(
            'MOBILE_PROVIDER_UNAVAILABLE',
            'The wallet approved the request, but its session provider was not available. Please retry or use the wallet browser.'
        );
    }
    activeWalletProvider = provider;
    bindRuntimeProviderEvents(provider, preferredProvider ? 'mobile injected provider' : 'external mobile WalletConnect provider');

    let providerAddress = null;
    const accountDeadline = Date.now() + MOBILE_PROVIDER_REQUEST_TIMEOUT;
    while (!providerAddress && Date.now() < accountDeadline && !attempt?.cancelled) {
        const providerAccountsValue = await requestProviderValueWithin(
            provider,
            'eth_accounts',
            [],
            Math.min(1200, MOBILE_PROVIDER_REQUEST_TIMEOUT)
        );
        const providerAccounts = Array.isArray(providerAccountsValue) ? providerAccountsValue : [];
        providerAddress = normalizeWalletAddress(providerAccounts[0]);
        if (!providerAddress) await waitForWalletResumeOrDelay(250);
    }
    if (!providerAddress || providerAddress !== normalizeWalletAddress(walletState.address)) {
        throw createWalletConnectError(
            'MOBILE_ACCOUNT_UNCONFIRMED',
            'The wallet session did not confirm the selected account. Please retry the connection.'
        );
    }

    const providerChainId = await readMobileProviderChainId(provider);
    const appKitChainId = getStateChainId(walletState.account);
    const currentChainId = providerChainId;
    walletDebugLog('external mobile session chain resolved', {
        source,
        providerAvailable: true,
        address: maskWalletAddress(providerAddress),
        providerChainId,
        appKitChainId,
        currentChainId
    });

    if (currentChainId === BASE_SEPOLIA_CHAIN_ID) {
        return { ...walletState, address: providerAddress, chainId: BASE_SEPOLIA_CHAIN_ID, provider };
    }
    const acceptOnActualChain = (reason) => {
        walletDebugLog('mobile connect accepted on foreign chain', {
            source,
            chainId: currentChainId,
            reason
        });
        return { ...walletState, address: providerAddress, chainId: currentChainId, provider, baseSepoliaConfirmed: false };
    };
    if (attempt?.networkSwitchRequested) {
        if (acceptForeignChain) return acceptOnActualChain('switch already requested this attempt');
        throw createWalletConnectError(
            'BASE_SEPOLIA_REQUIRED',
            'Your wallet is still on another network. Select Base Sepolia and retry.'
        );
    }
    if (attempt) attempt.networkSwitchRequested = true;

    const target = getSupportedNetworkTarget(BASE_SEPOLIA_CHAIN_ID);
    walletDebugLog('external mobile Base Sepolia switch requested', {
        source,
        fromChainId: currentChainId,
        toChainId: BASE_SEPOLIA_CHAIN_ID,
        via: preferredProvider ? 'injected provider' : 'WalletConnect provider'
    });

    const switchOutcome = Promise.resolve()
        .then(() => addThenSwitchEthereumChain(provider, target))
        .then(() => ({ complete: true }))
        .catch((error) => ({ error }));

    let confirmedChainId = null;
    try {
        confirmedChainId = await waitForMobileBaseSepolia(
            provider,
            switchOutcome,
            attempt,
            true,
            switchTimeout
        );
    } catch (error) {
        if (isUserRejectedError(error)) {
            if (acceptForeignChain) return acceptOnActualChain('switch declined by user');
            throw createWalletConnectError(
                'BASE_SEPOLIA_SWITCH_REJECTED',
                'Network switch was declined. This action requires Base Sepolia.'
            );
        }
        if (acceptForeignChain) {
            walletDebugLog('mobile Base Sepolia switch errored; accepting session', describeWalletDebugError(error));
            return acceptOnActualChain('switch request errored');
        }
        throw error;
    }
    if (confirmedChainId !== BASE_SEPOLIA_CHAIN_ID) {
        walletDebugLog('external mobile Base Sepolia switch not confirmed', {
            source,
            cancelled: Boolean(attempt?.cancelled)
        });
        if (acceptForeignChain) return acceptOnActualChain('switch not confirmed in time');
        throw createWalletConnectError(
            'BASE_SEPOLIA_REQUIRED',
            'The wallet did not switch to Base Sepolia. Select Base Sepolia in the wallet and retry.'
        );
    }

    walletDebugLog('external mobile Base Sepolia confirmed', { source });
    return { ...walletState, address: providerAddress, chainId: BASE_SEPOLIA_CHAIN_ID, provider };
}

function isIOSDevice() {
    return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function readWagmiConnectorSnapshot() {
    try {
        const config = wagmiAdapter?.wagmiConfig;
        const state = config?.state;
        const current = state?.current || null;
        const connections = state?.connections;
        const connection = current && typeof connections?.get === 'function'
            ? connections.get(current)
            : null;
        const configuredConnectors = Array.isArray(config?.connectors) ? config.connectors : [];
        const connector = connection?.connector || configuredConnectors.find((candidate) => (
            String(candidate?.id || '').toLowerCase().includes('walletconnect')
        )) || null;
        const address = normalizeWalletAddress(connection?.accounts?.[0]);
        return {
            status: state?.status || null,
            current,
            chainId: parseChainId(connection?.chainId || state?.chainId),
            address: maskWalletAddress(address),
            rawAddress: address || null,
            connectorId: connector?.id || null,
            connectorName: connector?.name || null,
            connectorRdns: connector?.rdns || connector?._internal?.rdns || null,
            connectionCount: typeof connections?.size === 'number' ? connections.size : null,
            configuredConnectorCount: configuredConnectors.length,
            connector
        };
    } catch (error) {
        return {
            status: 'unavailable',
            error: error?.message || String(error),
            rawAddress: null,
            connector: null
        };
    }
}

function getWalletConnectClient(provider) {
    return provider?.signer?.client || provider?.client || provider?.provider?.signer?.client || null;
}

function getWalletConnectRelayer(provider) {
    const client = getWalletConnectClient(provider);
    return client?.core?.relayer || provider?.signer?.client?.core?.relayer || null;
}

function summarizeWalletConnectNamespaces(value = {}) {
    if (!value || typeof value !== 'object') return null;
    return Object.fromEntries(Object.entries(value).map(([namespace, config]) => [namespace, {
        chains: Array.isArray(config?.chains) ? config.chains : [],
        methods: Array.isArray(config?.methods) ? config.methods : [],
        events: Array.isArray(config?.events) ? config.events : []
    }]));
}

function readWalletConnectMessageMethod(message) {
    if (!message) return null;
    if (typeof message === 'object') {
        return message.method || message.params?.request?.method || message.payload?.method || null;
    }
    try {
        const parsed = JSON.parse(message);
        return readWalletConnectMessageMethod(parsed);
    } catch {
        return null;
    }
}

function bindWalletConnectUriCapture(provider) {
    if (!provider || typeof provider !== 'object' || walletConnectUriProviders.has(provider)) return;
    walletConnectUriProviders.add(provider);
    const capture = (uri) => {
        const value = typeof uri === 'string' ? uri : findWalletConnectUri(uri);
        if (!value) return;
        lastWalletConnectUri = value;
        walletDebugLog('WalletConnect display URI captured', { uriAvailable: true });
    };
    provider.on?.('display_uri', capture);
    provider.signer?.on?.('display_uri', capture);
}

function bindWalletConnectDiagnostics(provider, source = 'WalletConnect provider') {
    bindWalletConnectUriCapture(provider);
    if (!walletDebugEnabled() || !provider) return;
    const client = getWalletConnectClient(provider);
    const relayer = getWalletConnectRelayer(provider);

    if (client && !walletConnectDiagnosticClients.has(client)) {
        walletConnectDiagnosticClients.add(client);
        walletDebugLog('WalletConnect provider negotiation config', {
            source,
            requiredNamespaces: summarizeWalletConnectNamespaces(provider?.namespaces || provider?.requiredNamespaces),
            optionalNamespaces: summarizeWalletConnectNamespaces(provider?.optionalNamespaces),
            chains: networks.map((network) => network.caipNetworkId || `eip155:${network.id}`)
        });
        const originalConnect = typeof client.connect === 'function' ? client.connect.bind(client) : null;
        if (originalConnect) {
            try {
                client.connect = (proposal = {}) => {
                    walletDebugLog('WalletConnect proposal before publish', {
                        source,
                        requiredNamespaces: summarizeWalletConnectNamespaces(proposal.requiredNamespaces),
                        optionalNamespaces: summarizeWalletConnectNamespaces(proposal.optionalNamespaces),
                        chains: networks.map((network) => network.caipNetworkId || `eip155:${network.id}`),
                        methods: proposal.methods || null,
                        events: proposal.events || null
                    });
                    return originalConnect(proposal);
                };
            } catch (error) {
                walletDebugLog('WalletConnect proposal hook unavailable', describeWalletDebugError(error));
            }
        }

        const lifecycleEvents = [
            'proposal_expire',
            'session_proposal',
            'session_connect',
            'session_settle',
            'session_delete',
            'session_expire',
            'session_event'
        ];
        lifecycleEvents.forEach((eventName) => {
            client.on?.(eventName, (event) => {
                walletDebugLog(`WalletConnect ${eventName}`, {
                    source,
                    topic: event?.topic || event?.params?.topic || null,
                    method: event?.method || event?.params?.request?.method || null,
                    error: event?.error ? describeWalletDebugError(event.error) : null,
                    reason: event?.reason || event?.params?.reason || null
                });
            });
        });
    }

    if (relayer && !walletConnectDiagnosticRelayers.has(relayer)) {
        walletConnectDiagnosticRelayers.add(relayer);
        const events = relayer.events || relayer;
        events.on?.('message', (event) => {
            walletDebugLog('WalletConnect relay message', {
                source,
                topic: event?.topic || event?.params?.topic || null,
                method: readWalletConnectMessageMethod(event?.message || event?.payload || event),
                encrypted: !readWalletConnectMessageMethod(event?.message || event?.payload || event)
            });
        });
        events.on?.('error', (error) => {
            walletDebugLog('WalletConnect relay error', {
                source,
                error: describeWalletDebugError(error)
            });
        });
    }
}

async function restartWalletConnectTransport(source = 'browser return') {
    // Restart during active mobile connects (v23 behavior) AND whenever a
    // core session exists — its relay socket dies in the background on iOS
    // and must be reopened before state is re-read.
    if ((!activeMobileConnect && !isCoreSessionActive()) || isInjectedWalletBrowser()) return false;
    if (walletTransportRestartPromise) return walletTransportRestartPromise;

    walletTransportRestartPromise = (async () => {
        const wagmi = readWagmiConnectorSnapshot();
        const providers = [...new Set([
            await getWagmiConnectorProvider(wagmi),
            activeWalletProvider,
            await getAppKitWalletProviderWithin(1500)
        ].filter(Boolean))];
        const relayers = [...new Set(providers.map(getWalletConnectRelayer).filter(Boolean))];
        if (!relayers.length) {
            walletDebugLog('WalletConnect transport restart unavailable', {
                source,
                reason: 'provider or relayer absent',
                wagmiStatus: wagmi.status,
                connectorId: wagmi.connectorId
            });
            return false;
        }

        let restarted = false;
        for (const provider of providers) bindWalletConnectDiagnostics(provider, source);
        for (const relayer of relayers) {
            try {
                if (typeof relayer.restartTransport === 'function') {
                    await Promise.race([Promise.resolve(relayer.restartTransport()), sleep(4000)]);
                    restarted = true;
                } else if (typeof relayer.transportClose === 'function' && typeof relayer.transportOpen === 'function') {
                    await Promise.race([Promise.resolve(relayer.transportClose()), sleep(1500)]);
                    await Promise.race([Promise.resolve(relayer.transportOpen()), sleep(4000)]);
                    restarted = true;
                }
            } catch (error) {
                walletDebugLog('WalletConnect transport restart failed', {
                    source,
                    error: describeWalletDebugError(error)
                });
            }
        }
        walletDebugLog('WalletConnect transport restart completed', { source, restarted });
        return restarted;
    })().finally(() => {
        walletTransportRestartPromise = null;
    });

    return walletTransportRestartPromise;
}

async function bindConfiguredWalletConnectDiagnostics() {
    const connectors = wagmiAdapter?.wagmiConfig?.connectors || [];
    for (const connector of connectors) {
        const identity = `${connector?.id || ''} ${connector?.name || ''} ${connector?.type || ''}`.toLowerCase();
        if (!identity.includes('walletconnect')) continue;
        try {
            const provider = await connector.getProvider?.();
            bindWalletConnectDiagnostics(provider, 'configured WalletConnect connector');
        } catch (error) {
            walletDebugLog('configured WalletConnect diagnostic binding failed', {
                connectorId: connector?.id || null,
                error: describeWalletDebugError(error)
            });
        }
    }
}

function getWalletConnectSessions(provider = activeWalletProvider) {
    const client = getWalletConnectClient(provider);
    try {
        const sessions = client?.session?.getAll?.();
        if (Array.isArray(sessions)) return sessions;
    } catch {
        // Diagnostic access only. Provider validation remains authoritative.
    }
    return provider?.session ? [provider.session] : [];
}

function getWalletConnectPairings(provider = activeWalletProvider) {
    const client = getWalletConnectClient(provider);
    try {
        const pairings = client?.pairing?.getAll?.();
        return Array.isArray(pairings) ? pairings : [];
    } catch {
        return [];
    }
}

function readWalletConnectSnapshot(provider = activeWalletProvider) {
    const sessions = getWalletConnectSessions(provider);
    const pairings = getWalletConnectPairings(provider);
    const sessionAccounts = sessions.flatMap((session) => (
        Object.values(session?.namespaces || {}).flatMap((namespace) => namespace?.accounts || [])
    ));
    return {
        providerAvailable: Boolean(provider?.request),
        sessionCount: sessions.length,
        pairingCount: pairings.length,
        connectedPairingCount: pairings.filter((pairing) => pairing?.active !== false).length,
        sessionAccounts: sessionAccounts.slice(0, 4).map((account) => sanitizeWalletDebugValue(account))
    };
}

function getWalletConnectSessionWalletState(provider = activeWalletProvider) {
    for (const session of getWalletConnectSessions(provider)) {
        const accounts = Object.values(session?.namespaces || {})
            .flatMap((namespace) => namespace?.accounts || []);
        for (const account of accounts) {
            const match = String(account).match(/^eip155:(\d+):(0x[a-fA-F0-9]{40})$/);
            if (!match) continue;
            return {
                address: normalizeWalletAddress(match[2]),
                chainId: parseInt(match[1], 10),
                isConnected: true,
                account: {
                    address: normalizeWalletAddress(match[2]),
                    chainId: parseInt(match[1], 10),
                    caipAddress: account,
                    status: 'connected',
                    isConnected: true
                },
                provider
            };
        }
    }
    return null;
}

async function getWagmiConnectorProvider(snapshot = readWagmiConnectorSnapshot()) {
    try {
        const provider = await snapshot?.connector?.getProvider?.();
        bindWalletConnectDiagnostics(provider, 'wagmi connector provider');
        return provider;
    } catch (error) {
        walletDebugLog('wagmi connector provider unavailable', {
            connectorId: snapshot?.connectorId || null,
            reason: error?.message || String(error)
        });
        return null;
    }
}

async function acceptMobileAppKitWalletState(
    account,
    source = 'mobile AppKit session',
    attempt = activeConnectAttempt,
    preferredProvider = null
) {
    const walletState = getFreshMobileAppKitWalletState(account, attempt);
    if (!walletState || attempt?.cancelled) return null;

    const initialKey = `${walletState.address}:${walletState.chainId || 'none'}:${appKitAccountRevision}`;
    if (mobileSessionFinalizePromise && mobileSessionFinalizeKey === initialKey) {
        return mobileSessionFinalizePromise;
    }

    mobileSessionFinalizeKey = initialKey;
    mobileSessionFinalizePromise = (async () => {
        let acceptedState = null;
        try {
            acceptedState = await ensureExternalMobileBaseSepolia(walletState, source, attempt, preferredProvider);
        } catch (error) {
            if (attempt && !attempt.cancelled) attempt.failure = error;
            clearModalIntent();
            void safeCloseModal('mobile wallet validation failed', { silent: true });
            walletDebugLog('mobile wallet final failure', {
                source,
                code: error?.code || null,
                message: error?.message || String(error),
                walletId: lastSelectedWallet?.id || null,
                walletName: lastSelectedWallet?.name || null
            });
            notifyWalletResume('mobile wallet validation failed');
            return null;
        }
        if (!acceptedState || attempt?.cancelled) return null;

        const { address, chainId, provider } = acceptedState;
        const accountKey = `${address}:${chainId}`;
        if (accountKey === lastAcceptedMobileAccountKey) return acceptedState;
        lastAcceptedMobileAccountKey = accountKey;
        lastProcessedAddress = address;
        lastProcessedChainId = chainId;
        lastConfirmedWalletAt = Date.now();
        if (provider) activeWalletProvider = provider;
        window.currentWalletAddress = address;
        localStorage.setItem('artsoul_wallet', address);
        setCurrentChainId(chainId);

        // Do not expose a connected UI until both account and Base Sepolia have
        // been confirmed from the active provider.
        dispatchWalletStateChanged({ address, chainId, isConnected: true });
        updateNavButtons({ address, chainId });
        updateNetworkBadge({ address, chainId });
        removeMobileWalletRecovery();
        mobileRetryCleanupRequired = false;

        Promise.resolve(signOutMismatchedSession(address)).catch((error) => {
            console.warn('Stale session cleanup after mobile connect failed:', error);
        });

        clearModalIntent();
        safeCloseModal('mobile wallet connected');
        scheduleModalCloseRetries('mobile wallet connected');
        walletDebugLog('mobile wallet connection finalized', {
            source,
            address: maskWalletAddress(address),
            chainId
        });
        return acceptedState;
    })().finally(() => {
        if (mobileSessionFinalizeKey === initialKey) {
            mobileSessionFinalizePromise = null;
            mobileSessionFinalizeKey = '';
        }
    });

    return mobileSessionFinalizePromise;
}

async function reconcileMobileAppKitSession(source = 'mobile session reconciliation', attempt = activeConnectAttempt) {
    return acceptMobileAppKitWalletState(readAppKitAccountSnapshot(), source, attempt);
}

async function reconcileMobileConnectionSources(source = 'mobile connection reconciliation', attempt = activeConnectAttempt) {
    const wagmi = readWagmiConnectorSnapshot();
    const wagmiProvider = await getWagmiConnectorProvider(wagmi);
    if (wagmiProvider?.request) {
        activeWalletProvider = wagmiProvider;
        bindRuntimeProviderEvents(wagmiProvider, 'wagmi mobile connector');
    }

    const appKitAccepted = await acceptMobileAppKitWalletState(
        readAppKitAccountSnapshot(),
        `${source}: AppKit`,
        attempt,
        wagmiProvider
    );
    if (appKitAccepted?.address || attempt?.cancelled || attempt?.failure) return appKitAccepted;

    if (wagmi.rawAddress) {
        const wagmiAccepted = await acceptMobileAppKitWalletState({
            address: wagmi.rawAddress,
            chainId: wagmi.chainId,
            caipAddress: wagmi.chainId ? `eip155:${wagmi.chainId}:${wagmi.rawAddress}` : null,
            status: wagmi.status === 'disconnected' ? 'disconnected' : 'connected',
            isConnected: wagmi.status !== 'disconnected'
        }, `${source}: Wagmi`, attempt, wagmiProvider);
        if (wagmiAccepted?.address || attempt?.cancelled || attempt?.failure) return wagmiAccepted;
    }

    const walletConnectState = getWalletConnectSessionWalletState(wagmiProvider || activeWalletProvider);
    if (walletConnectState?.address) {
        return acceptMobileAppKitWalletState(
            walletConnectState.account,
            `${source}: WalletConnect session`,
            attempt,
            walletConnectState.provider
        );
    }

    walletDebugLog('mobile connection sources not confirmed', {
        source,
        appKit: getWalletDebugSnapshot().account,
        wagmi: {
            status: wagmi.status,
            chainId: wagmi.chainId,
            address: wagmi.address,
            connectorId: wagmi.connectorId,
            connectorName: wagmi.connectorName,
            connectorRdns: wagmi.connectorRdns
        },
        walletConnect: readWalletConnectSnapshot(wagmiProvider || activeWalletProvider)
    });
    return null;
}

function scheduleWalletReconciliation(source, delay = 150, options = {}) {
    if (walletResumeTimer) clearTimeout(walletResumeTimer);
    walletResumeTimer = setTimeout(async () => {
        walletResumeTimer = null;
        walletDebugLog('wallet state reconciliation', {
            source,
            snapshot: getWalletDebugSnapshot()
        });
        if (activeMobileConnect && !isInjectedWalletBrowser()) {
            await reconcileMobileConnectionSources(source, activeConnectAttempt);
            return;
        }
        await reconcileActiveWalletFromProviders(source, options);
    }, delay);
}

async function processWalletResume(source) {
    if (activeConnectAttempt?.handoffObserved && document.visibilityState === 'visible') {
        activeConnectAttempt.returnedAt ||= Date.now();
        walletDebugLog('manual wallet return observed', {
            source,
            returnedAt: activeConnectAttempt.returnedAt
        });
        await restartWalletConnectTransport(source);
        await logProviderTruthAfterMobileReturn(source);
    } else if (document.visibilityState === 'visible' && isCoreSessionActive()) {
        // A restored core session loses its relay socket whenever the mobile
        // browser goes to the background. Reopen it on every return so the
        // session keeps working without any user-visible disconnect.
        // (restartWalletConnectTransport is a no-op outside the core path.)
        await restartWalletConnectTransport(source);
    }
    if (document.visibilityState === 'visible') {
        await recheckDeferredCoreDisconnect(source);
    }
    walletDebugLog('browser resume signal', {
        source,
        snapshot: getWalletDebugSnapshot()
    });
    const waiters = [...walletResumeWaiters];
    walletResumeWaiters.clear();
    waiters.forEach((resolve) => resolve(source));
    scheduleWalletReconciliation(source, 0);
}

function notifyWalletResume(source) {
    void processWalletResume(source);
}

function markMobileWalletHandoff(source) {
    if (!activeMobileConnect || !activeConnectAttempt) return;
    activeConnectAttempt.handoffObserved = true;
    activeConnectAttempt.handoffStartedAt ||= Date.now();
    walletDebugLog('mobile wallet handoff observed', {
        source,
        walletId: lastSelectedWallet?.id || null,
        walletName: lastSelectedWallet?.name || null,
        walletRdns: lastSelectedWallet?.rdns || null,
        nativeLink: lastSelectedWallet?.nativeLink || null,
        universalLink: lastSelectedWallet?.universalLink || null
    });
}

async function logProviderTruthAfterMobileReturn(source) {
    if (!walletDebugEnabled()) return;
    const wagmi = readWagmiConnectorSnapshot();
    const wagmiProvider = await getWagmiConnectorProvider(wagmi);
    const providers = [...new Set([
        wagmiProvider,
        activeWalletProvider,
        await getAppKitWalletProviderWithin(MOBILE_PROVIDER_REQUEST_TIMEOUT)
    ].filter(Boolean))];
    if (!providers.length) {
        walletDebugLog('manual return provider absent', {
            source,
            wagmiStatus: wagmi.status,
            connectorId: wagmi.connectorId,
            connectorName: wagmi.connectorName,
            walletConnect: readWalletConnectSnapshot()
        });
        return;
    }

    for (const provider of providers) {
        const accounts = await requestProviderValueWithin(
            provider,
            'eth_accounts',
            [],
            MOBILE_PROVIDER_REQUEST_TIMEOUT
        ).catch((error) => ({ error }));
        const chainId = await requestProviderValueWithin(
            provider,
            'eth_chainId',
            [],
            MOBILE_PROVIDER_REQUEST_TIMEOUT
        ).catch((error) => ({ error }));
        walletDebugLog('manual return provider truth', {
            source,
            accounts: Array.isArray(accounts) ? accounts.map(maskWalletAddress) : null,
            accountsError: accounts?.error?.message || null,
            chainId: chainId?.error ? null : parseChainId(chainId),
            chainError: chainId?.error?.message || null,
            walletConnect: readWalletConnectSnapshot(provider)
        });
    }
}

function waitForWalletResumeOrDelay(delay) {
    return new Promise((resolve) => {
        let settled = false;
        let timer = null;
        const finish = (source = null) => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            walletResumeWaiters.delete(finish);
            resolve(source);
        };

        timer = setTimeout(() => finish(), delay);
        walletResumeWaiters.add(finish);
    });
}

function bindWalletResumeListeners() {
    if (walletResumeListenersBound) return;
    walletResumeListenersBound = true;

    window.addEventListener('pageshow', () => notifyWalletResume('pageshow'));
    window.addEventListener('focus', () => notifyWalletResume('window focus'));
    window.addEventListener('blur', () => markMobileWalletHandoff('window blur'));
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            walletDebugLog('visibility changed', {
                state: document.visibilityState,
                snapshot: getWalletDebugSnapshot()
            });
            markMobileWalletHandoff('visibility hidden');
        } else if (document.visibilityState === 'visible') {
            walletDebugLog('visibility changed', { state: document.visibilityState });
            notifyWalletResume('visibility return');
        }
    });
}

async function waitForConfirmedDesktopWallet(timeoutMs) {
    const startedAt = Date.now();
    let modalWasOpen = false;
    let modalClosedAt = null;

    while (Date.now() - startedAt < timeoutMs) {
        const restored = await reconcileActiveWalletFromProviders('connect confirmation');
        if (restored?.address) return restored;

        const modalIsOpen = Boolean(modal?.getState?.()?.open || window.web3Modal?.getState?.()?.open);
        if (modalIsOpen) {
            modalWasOpen = true;
            modalClosedAt = null;
        } else if (modalWasOpen && document.visibilityState === 'visible') {
            modalClosedAt ||= Date.now();
            if (Date.now() - modalClosedAt > 5000) return null;
        }

        await sleep(WALLET_CONFIRMATION_INTERVAL);
    }

    return null;
}

function createForegroundDeadline(timeoutMs) {
    let remainingMs = timeoutMs;
    let visibleSince = document.visibilityState === 'visible' ? Date.now() : null;

    const updateRemaining = () => {
        if (visibleSince === null) return;
        const now = Date.now();
        remainingMs = Math.max(0, remainingMs - (now - visibleSince));
        visibleSince = now;
    };

    const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
            visibleSince = Date.now();
        } else {
            updateRemaining();
            visibleSince = null;
        }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return {
        hasExpired() {
            if (document.visibilityState !== 'visible') return false;
            updateRemaining();
            return remainingMs <= 0;
        },
        remaining() {
            if (document.visibilityState === 'visible') updateRemaining();
            return remainingMs;
        },
        dispose() {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        }
    };
}

async function waitForConfirmedMobileWallet(timeoutMs, attempt = activeConnectAttempt) {
    const deadline = createForegroundDeadline(timeoutMs);
    let lastSnapshotKey = '';
    let modalWasOpen = Boolean(attempt?.modalOpened);
    let modalClosedAt = null;

    try {
        while (!deadline.hasExpired() && !attempt?.cancelled && !attempt?.failure) {
            if (document.visibilityState !== 'visible') {
                await waitForWalletResumeOrDelay(WALLET_CONFIRMATION_INTERVAL);
                continue;
            }

            const snapshot = getWalletDebugSnapshot();
            const modalOpen = Boolean(snapshot?.modal?.open);
            let pendingFailure = null;
            if (modalOpen) {
                modalWasOpen = true;
                modalClosedAt = null;
            } else if (modalWasOpen) {
                modalClosedAt ||= Date.now();
                if (!attempt?.handoffObserved && Date.now() - modalClosedAt >= MOBILE_MODAL_CLOSED_GRACE) {
                    pendingFailure = createWalletConnectError(
                        'MOBILE_MODAL_CLOSED',
                        'Wallet selection closed before a connection was confirmed. Please retry or use your wallet browser.'
                    );
                }
            }
            if (
                attempt?.handoffObserved &&
                attempt?.returnedAt &&
                Date.now() - attempt.returnedAt >= MOBILE_RETURN_SETTLEMENT_WINDOW
            ) {
                pendingFailure = createWalletConnectError(
                    'MOBILE_SESSION_UNCONFIRMED',
                    'The wallet did not return a confirmed session. Please retry or open ArtSoul in your wallet browser.'
                );
            }
            if (pendingFailure) {
                const finalRestored = await reconcileMobileConnectionSources(
                    'mobile bounded final confirmation',
                    attempt
                );
                if (finalRestored?.address) return finalRestored;
                if (!attempt.failure) attempt.failure = pendingFailure;
                walletDebugLog('mobile connection bounded wait ended', {
                        code: attempt.failure?.code || pendingFailure.code,
                        graceMs: MOBILE_MODAL_CLOSED_GRACE,
                        returnWindowMs: MOBILE_RETURN_SETTLEMENT_WINDOW,
                        handoffObserved: Boolean(attempt?.handoffObserved),
                        snapshot
                    });
                break;
            }
            const snapshotKey = JSON.stringify(snapshot);
            if (snapshotKey !== lastSnapshotKey) {
                lastSnapshotKey = snapshotKey;
                walletDebugLog('mobile confirmation state', {
                    remainingMs: deadline.remaining(),
                    snapshot
                });
            }

            const restored = await reconcileMobileConnectionSources('mobile connect confirmation', attempt);
            if (restored?.address) return restored;

            await waitForWalletResumeOrDelay(WALLET_CONFIRMATION_INTERVAL);
        }

        // Approval and the browser visibility event can arrive in either order.
        // Re-check provider/session truth once more before presenting a timeout.
        const restored = attempt?.cancelled || attempt?.failure
            ? null
            : await reconcileMobileConnectionSources('mobile connect final confirmation', attempt);
        if (restored?.address) return restored;

        walletDebugLog('mobile wallet confirmation expired', {
            foregroundTimeoutMs: timeoutMs,
            remainingMs: deadline.remaining(),
            cancelled: Boolean(attempt?.cancelled),
            failureCode: attempt?.failure?.code || null,
            snapshot: getWalletDebugSnapshot()
        });
        return null;
    } finally {
        deadline.dispose();
    }
}

async function waitForConfirmedWallet(timeoutMs, options = {}) {
    return options.mobile
        ? waitForConfirmedMobileWallet(timeoutMs, options.attempt)
        : waitForConfirmedDesktopWallet(timeoutMs);
}

async function requestInjectedMobileAccounts() {
    const deadline = createForegroundDeadline(WALLET_CONNECT_TIMEOUT_MOBILE);
    const requestOutcome = Promise.resolve(window.ethereum.request({ method: 'eth_requestAccounts' }))
        .then((accounts) => ({ accounts }))
        .catch((error) => ({ error }));

    try {
        while (!deadline.hasExpired()) {
            if (document.visibilityState !== 'visible') {
                await waitForWalletResumeOrDelay(WALLET_CONFIRMATION_INTERVAL);
                continue;
            }

            const outcome = await Promise.race([
                requestOutcome,
                waitForWalletResumeOrDelay(WALLET_CONFIRMATION_INTERVAL).then(() => null)
            ]);
            if (outcome?.error) throw outcome.error;
            if (outcome?.accounts) return outcome.accounts;

            const restoredAccounts = await requestProviderAccounts(window.ethereum);
            if (restoredAccounts.length) return restoredAccounts;
        }

        const restoredAccounts = await requestProviderAccounts(window.ethereum);
        if (restoredAccounts.length) return restoredAccounts;
        throw new Error('Injected wallet connection timed out');
    } finally {
        deadline.dispose();
    }
}

async function getSwitchProvider() {
    const appKitProvider = await getAppKitWalletProvider();
    return appKitProvider || window.ethereum || null;
}

function markNetworkModalIntent(reason = 'network selector') {
    console.log(`Network modal intent: ${reason}`);
    networkModalIntentUntil = Date.now() + NETWORK_MODAL_INTENT_WINDOW;
}

function markConnectModalIntent(reason = 'wallet connect') {
    console.log(`Connect modal intent: ${reason}`);
    connectModalIntentUntil = Date.now() + NETWORK_MODAL_INTENT_WINDOW;
}

function clearModalIntent() {
    networkModalIntentUntil = 0;
    connectModalIntentUntil = 0;
}

function hasNetworkModalIntent() {
    const now = Date.now();
    return Boolean(
        activeNetworkSwitchChainId ||
        activeMobileConnect ||
        now < networkModalIntentUntil ||
        now < connectModalIntentUntil
    );
}

async function requestProviderChainId(provider) {
    if (!provider) return null;

    try {
        if (provider.request) {
            const chainId = await provider.request({ method: 'eth_chainId' });
            const parsedChainId = parseChainId(chainId);
            if (parsedChainId) return parsedChainId;
        }
    } catch (error) {
        console.warn('Unable to request provider chain id:', error);
    }

    return parseChainId(provider.chainId || provider.networkVersion);
}

async function getProviderTruthChainId(preferredProvider = null) {
    const appKitProvider = preferredProvider || await getAppKitWalletProvider();
    const appKitProviderChainId = await requestProviderChainId(appKitProvider);
    if (appKitProviderChainId) return appKitProviderChainId;

    try {
        const appKitChainId = parseChainId(modal?.getChainId?.() || window.web3Modal?.getChainId?.());
        if (appKitChainId) return appKitChainId;
    } catch (error) {
        console.warn('Unable to read AppKit confirmed chain id:', error);
    }

    const injectedChainId = await requestProviderChainId(window.ethereum);
    if (injectedChainId) return injectedChainId;

    return null;
}

async function waitForProviderChainId(expectedChainId, timeout = NETWORK_CONFIRMATION_TIMEOUT, preferredProvider = null) {
    const startedAt = Date.now();

    while (Date.now() - startedAt <= timeout) {
        const actualChainId = await getProviderTruthChainId(preferredProvider);
        if (actualChainId === expectedChainId) return actualChainId;
        await sleep(NETWORK_CONFIRMATION_INTERVAL);
    }

    return getProviderTruthChainId(preferredProvider);
}

async function safeCloseModal(reason = 'modal cleanup', options = {}) {
    if (modalClosePromise) return modalClosePromise;

    const activeModals = [...new Set([modal, window.web3Modal].filter(Boolean))];
    const modalStates = activeModals.map((activeModal) => {
        try {
            return activeModal.getState?.()?.open;
        } catch {
            return undefined;
        }
    });
    if (modalStates.length && modalStates.every((isOpen) => isOpen === false)) return false;

    modalClosePromise = (async () => {
        for (const activeModal of activeModals) {
            const closeMethod = typeof activeModal.close === 'function'
                ? activeModal.close
                : activeModal.closeModal;
            if (typeof closeMethod !== 'function') continue;

            try {
                if (!options.silent) console.log(`Closing AppKit modal: ${reason}`);
                await Promise.race([
                    Promise.resolve(closeMethod.call(activeModal)),
                    sleep(1200)
                ]);
                return true;
            } catch (error) {
                console.warn('AppKit modal close skipped:', error);
            }
        }

        return false;
    })().finally(() => {
        modalClosePromise = null;
    });

    return modalClosePromise;
}

function scheduleModalCloseRetries(reason = 'modal cleanup') {
    if (modalCloseRetryTimer) return;
    modalCloseRetryTimer = setTimeout(() => {
        modalCloseRetryTimer = null;
        safeCloseModal(`${reason} retry`, { silent: true });
    }, MODAL_CLOSE_RETRY_DELAY);
}

async function closeNetworkModalAfterConfirmedChain(chainId) {
    const normalizedChainId = parseChainId(chainId);
    if (!normalizedChainId || !getSupportedNetworkTarget(normalizedChainId)) return false;
    if (!hasNetworkModalIntent()) return false;

    setCurrentChainId(normalizedChainId);
    applyConfirmedNetwork(normalizedChainId);

    await safeCloseModal('provider chain confirmed');
    scheduleModalCloseRetries('provider chain confirmed');

    clearModalIntent();
    return true;
}

async function handleProviderChainConfirmed(chainId, source = 'provider') {
    const normalizedChainId = setCurrentChainId(chainId);
    if (!normalizedChainId) return null;

    console.log(`Provider chain confirmed from ${source}:`, normalizedChainId);

    if (window.currentWalletAddress) {
        updateNetworkBadge({
            address: window.currentWalletAddress,
            chainId: normalizedChainId
        });
        updateNavButtons({
            address: window.currentWalletAddress,
            chainId: normalizedChainId
        });
        dispatchWalletStateChanged({
            address: window.currentWalletAddress,
            chainId: normalizedChainId,
            isConnected: true
        });
    }

    await closeNetworkModalAfterConfirmedChain(normalizedChainId);
    return normalizedChainId;
}

async function handleProviderAccountsChanged(accounts, source = 'provider', provider = null) {
    const list = Array.isArray(accounts) ? accounts : (accounts ? [accounts] : []);
    const nextAddress = normalizeWalletAddress(list[0]) || null;
    console.log(`Provider accountsChanged from ${source}:`, maskWalletAddress(nextAddress) || 'none');
    walletDebugLog('accountsChanged', { source, address: maskWalletAddress(nextAddress) });

    // All accounts revoked at the provider (wallet locked / disconnected).
    if (!nextAddress) {
        if (!lastProcessedAddress) return;
        // Mobile core path: while the core session record is alive, NO empty
        // accountsChanged may wipe it. AppKit/injected providers know nothing
        // about the core session; and the core provider ITSELF emits
        // chain-filtered empty accounts (the SDK's setAccounts keeps only
        // accounts matching the current chainId) whenever the wallet's
        // chainChanged lands on a network without a namespace account entry.
        // A genuine core end (session_delete / classified disconnect) removes
        // the session record first, which makes getConnectedCoreProvider()
        // null and lets the wipe proceed.
        const coreProvider = getConnectedCoreProvider();
        if (coreProvider) {
            walletDebugLog('empty accountsChanged ignored; core session is authoritative', {
                source,
                fromCoreProvider: provider === coreProvider
            });
            return;
        }
        const explicitDisconnectInProgress = sessionStorage.getItem('artsoul_disconnecting');
        const recentlyConfirmed = Date.now() - lastConfirmedWalletAt < POST_CONNECT_DISCONNECT_GUARD;
        if (!explicitDisconnectInProgress && recentlyConfirmed) return;

        lastProcessedAddress = null;
        lastProcessedChainId = null;
        activeWalletProvider = null;
        window.currentWalletAddress = null;
        localStorage.removeItem('artsoul_wallet');
        try {
            await window.SupabaseAuth?.signOut?.();
        } catch (error) {
            console.warn('Sign-out after accounts cleared failed:', error);
        }
        updateNavButtons(null);
        updateNetworkBadge(null);
        dispatchWalletStateChanged({ address: null, chainId: null, isConnected: false });
        walletDebugLog('wallet disconnected by provider', { source });
        return;
    }

    if (nextAddress === lastProcessedAddress) {
        if (provider) activeWalletProvider = provider;
        return;
    }

    // Active address changed → clear any session tied to the previous address.
    // Always check the backend SIWE session; lastProcessedAddress can be empty
    // after reload while the server session still belongs to a previous wallet.
    await signOutMismatchedSession(nextAddress);

    const chainId = normalizeChainId();
    lastProcessedAddress = nextAddress;
    lastProcessedChainId = chainId;
    lastConfirmedWalletAt = Date.now();
    if (provider) activeWalletProvider = provider;
    window.currentWalletAddress = nextAddress;
    localStorage.setItem('artsoul_wallet', nextAddress);

    updateNavButtons({ address: nextAddress, chainId });
    updateNetworkBadge({ address: nextAddress, chainId });
    dispatchWalletStateChanged({ address: nextAddress, chainId, isConnected: true });
    walletDebugLog('wallet active address accepted', { source, address: maskWalletAddress(nextAddress), chainId });
}

function bindRuntimeProviderEvents(provider, source = 'provider') {
    if (!provider || typeof provider !== 'object') return;

    try {
        if (boundRuntimeProviders.has(provider)) return;
        boundRuntimeProviders.add(provider);
    } catch (error) {
        console.warn('Provider event binding skipped:', error);
        return;
    }

    const chainHandler = (chainId) => {
        handleProviderChainConfirmed(chainId, source);
    };

    // Single global account listener → one app-wide event that the header,
    // detail and profile views all react to (no per-page provider listeners).
    const accountsHandler = (accounts) => {
        handleProviderAccountsChanged(accounts, source, provider);
    };

    provider.on?.('chainChanged', chainHandler);
    provider.on?.('networkChanged', chainHandler);
    provider.on?.('accountsChanged', accountsHandler);
    walletDebugLog('provider listeners bound', { source });
}

async function addEthereumChain(provider, target) {
    if (!provider?.request) throw new Error('Wallet provider is not available');

    await provider.request({
        method: 'wallet_addEthereumChain',
        params: [{
            chainId: target.hexChainId,
            chainName: target.chainName,
            nativeCurrency: target.nativeCurrency,
            rpcUrls: target.rpcUrls,
            blockExplorerUrls: target.blockExplorerUrls
        }]
    });
}

async function switchEthereumChain(provider, target) {
    if (!provider?.request) throw new Error('Wallet provider is not available');

    try {
        await provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: target.hexChainId }]
        });
    } catch (error) {
        if (!isUnknownChainError(error)) throw error;
        await addEthereumChain(provider, target);
        await provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: target.hexChainId }]
        });
    }
}

async function addThenSwitchEthereumChain(provider, target) {
    if (!provider?.request) throw new Error('Wallet provider is not available');

    try {
        walletDebugLog('Base Sepolia add request started', { chainId: target.chainId });
        await addEthereumChain(provider, target);
        walletDebugLog('Base Sepolia add request resolved', { chainId: target.chainId });
    } catch (error) {
        if (isUserRejectedError(error)) throw error;
        // Wallets differ when a chain already exists: some resolve and others
        // return an "already added" error. In either case, switching is the
        // authoritative next step.
        walletDebugLog('Base Sepolia add request non-fatal result', describeWalletDebugError(error));
    }

    await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: target.hexChainId }]
    });
}

function applyConfirmedNetwork(chainId) {
    const normalizedChainId = setCurrentChainId(chainId);
    if (!window.currentWalletAddress) return normalizedChainId;

    updateNetworkBadge({
        address: window.currentWalletAddress,
        chainId: normalizedChainId
    });

    updateNavButtons({
        address: window.currentWalletAddress,
        chainId: normalizedChainId
    });

    dispatchWalletStateChanged({
        address: window.currentWalletAddress,
        chainId: normalizedChainId,
        isConnected: true
    });

    return normalizedChainId;
}

function getAuthoritativeWalletState() {
    if (window.currentWalletAddress) {
        return {
            address: normalizeWalletAddress(window.currentWalletAddress),
            chainId: normalizeChainId(),
            isConnected: true
        };
    }

    try {
        const account = modal?.getAccount?.() || window.web3Modal?.getAccount?.();
        const accountAddress = account?.address || account?.allAccounts?.[0]?.address || null;
        const isDisconnected = account && (account.status === 'disconnected' || account.isConnected === false);
        const address = isDisconnected ? null : accountAddress || window.ethereum?.selectedAddress || null;
        const chainId = normalizeChainId(account);

        if (address) {
            return {
                address: address.toLowerCase(),
                chainId,
                isConnected: true
            };
        }

        if (isDisconnected) {
            return {
                address: null,
                chainId,
                isConnected: false
            };
        }
    } catch (error) {
        console.warn('Unable to read authoritative wallet state:', error);
    }

    return null;
}

function getProviderWalletState() {
    const providerAddress = window.ethereum?.selectedAddress || null;
    if (!providerAddress) return null;

    return {
        address: providerAddress.toLowerCase(),
        chainId: normalizeChainId(window.ethereum?.chainId),
        isConnected: true
    };
}

function getRestoredWalletState() {
    const providerState = getProviderWalletState();
    if (providerState?.isConnected && providerState.address) {
        return providerState;
    }

    const authoritativeState = getAuthoritativeWalletState();
    if (authoritativeState?.isConnected && authoritativeState.address) {
        return authoritativeState;
    }

    return authoritativeState;
}

function dispatchWalletStateChanged(state = {}, options = {}) {
    const address = state.address ? state.address.toLowerCase() : null;
    const hasExplicitEmptyChain = Object.prototype.hasOwnProperty.call(state, 'chainId') &&
        (state.chainId === null || state.chainId === undefined || state.chainId === '');
    const chainId = hasExplicitEmptyChain ? null : normalizeChainId(state.chainId ?? state);
    const isConnected = Boolean(address && state.isConnected !== false);
    const detail = { address, chainId, isConnected };
    let didSettleInitialState = false;

    // AppKit emits several empty account snapshots while restoring providers.
    // Do not expose those snapshots to the UI. The first connected state, or an
    // explicitly finalized guest state after reconciliation, opens the gate.
    if (!window.artsoulWalletStateSettled) {
        if (!isConnected && options.settled !== true) return false;

        window.artsoulWalletStateSettled = true;
        window.artsoulSettledWalletState = detail;
        didSettleInitialState = true;
    } else {
        window.artsoulSettledWalletState = detail;
    }

    const stateKey = `${address || 'guest'}:${chainId || 'none'}:${isConnected ? 'connected' : 'disconnected'}`;
    if (stateKey === lastDispatchedWalletStateKey) return false;
    lastDispatchedWalletStateKey = stateKey;

    window.dispatchEvent(new CustomEvent('artsoul:wallet-state-changed', {
        detail
    }));

    if (didSettleInitialState) {
        window.dispatchEvent(new CustomEvent('artsoul:wallet-state-settled', { detail }));
    }

    return true;
}

async function clearWalletConnectionCache() {
    const walletFragments = [
        'walletconnect',
        'wc@',
        'reown',
        'appkit',
        'wagmi',
        'WEB3_CONNECT_CACHED_PROVIDER'
    ];
    const preservedKeys = new Set([
        WALLET_STORAGE_VERSION_KEY,
        'artsoul_wallet_debug'
    ]);

    [localStorage, sessionStorage].forEach((storage) => {
        Object.keys(storage)
            .filter((key) => !preservedKeys.has(key))
            .filter((key) => walletFragments.some((fragment) => key.toLowerCase().includes(fragment.toLowerCase())))
            .forEach((key) => storage.removeItem(key));
    });

    localStorage.removeItem('artsoul_wallet');
    localStorage.removeItem('artsoul_auth_method');
    localStorage.removeItem('artsoul_chain_id');
    localStorage.removeItem('artsoul_header_identity');
    window.currentWalletAddress = null;
    window.currentChainId = null;
    lastProcessedAddress = null;
    lastProcessedChainId = null;

    if (indexedDB?.databases) {
        try {
            const databases = await indexedDB.databases();
            await Promise.all(
                databases
                    .filter((db) => db.name && walletFragments.some((fragment) => db.name.toLowerCase().includes(fragment.toLowerCase())))
                    .map((db) => new Promise((resolve) => {
                        const request = indexedDB.deleteDatabase(db.name);
                        request.onsuccess = request.onerror = request.onblocked = resolve;
                    }))
            );
        } catch (error) {
            console.warn('Wallet IndexedDB cleanup skipped:', error);
        }
    }
}

function hasConfirmedWalletAddress() {
    const address = normalizeWalletAddress(window.currentWalletAddress);
    return Boolean(address && lastProcessedAddress === address);
}

async function clearIncompleteWalletConnectState(reason = 'mobile retry') {
    if (hasConfirmedWalletAddress()) {
        walletDebugLog('incomplete WalletConnect cleanup skipped', {
            reason,
            confirmedAddressPresent: true
        });
        return false;
    }

    walletDebugLog('incomplete WalletConnect cleanup started', {
        reason,
        snapshot: getWalletDebugSnapshot()
    });
    await safeCloseModal(reason, { silent: true });

    const wagmi = readWagmiConnectorSnapshot();
    const wagmiProvider = await getWagmiConnectorProvider(wagmi);
    const providers = [...new Set([wagmiProvider, activeWalletProvider].filter(Boolean))];
    const cleanupTasks = [];
    for (const provider of providers) {
        const client = getWalletConnectClient(provider);
        for (const session of getWalletConnectSessions(provider)) {
            if (session?.topic && client?.session?.delete) {
                cleanupTasks.push(Promise.resolve().then(() => client.session.delete(session.topic, {
                    code: 6000,
                    message: 'Incomplete ArtSoul mobile connection retry'
                })));
            }
        }
        for (const pairing of getWalletConnectPairings(provider)) {
            if (pairing?.topic && client?.pairing?.delete) {
                cleanupTasks.push(Promise.resolve().then(() => client.pairing.delete(pairing.topic)));
            }
        }
        if (typeof provider?.disconnect === 'function') {
            cleanupTasks.push(Promise.resolve().then(() => provider.disconnect()));
        }
    }
    if (typeof wagmi.connector?.disconnect === 'function') {
        cleanupTasks.push(Promise.resolve().then(() => wagmi.connector.disconnect()));
    }
    if (typeof modal?.disconnect === 'function') {
        cleanupTasks.push(Promise.resolve().then(() => modal.disconnect()));
    }
    await Promise.race([
        Promise.allSettled(cleanupTasks),
        sleep(2500)
    ]);

    const sdkFragments = ['walletconnect', 'wc@', 'reown', 'appkit', 'wagmi'];
    [localStorage, sessionStorage].forEach((storage) => {
        Object.keys(storage)
            .filter((key) => key !== WALLET_STORAGE_VERSION_KEY && key !== 'artsoul_wallet_debug')
            .filter((key) => sdkFragments.some((fragment) => key.toLowerCase().includes(fragment)))
            .forEach((key) => storage.removeItem(key));
    });

    latestAppKitAccountSnapshot = null;
    activeWalletProvider = null;
    lastObservedAppKitAccountKey = null;
    mobileSessionFinalizePromise = null;
    mobileSessionFinalizeKey = '';
    mobileRetryCleanupRequired = false;
    walletDebugLog('incomplete WalletConnect cleanup completed', { reason });
    return true;
}

async function migrateWalletStorageOnce() {
    const currentVersion = localStorage.getItem(WALLET_STORAGE_VERSION_KEY);
    if (currentVersion === WALLET_STORAGE_VERSION) return false;

    walletDebugLog('wallet SDK storage migration started', {
        fromVersion: currentVersion || 'legacy',
        toVersion: WALLET_STORAGE_VERSION
    });
    const sdkFragments = ['walletconnect', 'wc@', 'reown', 'appkit', 'wagmi', 'WEB3_CONNECT_CACHED_PROVIDER'];
    const preservedKeys = new Set([WALLET_STORAGE_VERSION_KEY, 'artsoul_wallet_debug']);
    [localStorage, sessionStorage].forEach((storage) => {
        Object.keys(storage)
            .filter((key) => !preservedKeys.has(key))
            .filter((key) => sdkFragments.some((fragment) => key.toLowerCase().includes(fragment.toLowerCase())))
            .forEach((key) => storage.removeItem(key));
    });
    localStorage.removeItem('artsoul_wallet');
    localStorage.removeItem('artsoul_chain_id');
    window.currentWalletAddress = null;
    window.currentChainId = null;
    lastProcessedAddress = null;
    lastProcessedChainId = null;

    if (indexedDB?.databases) {
        try {
            const databases = await indexedDB.databases();
            await Promise.all(
                databases
                    .filter((db) => db.name && sdkFragments.some((fragment) => db.name.toLowerCase().includes(fragment.toLowerCase())))
                    .map((db) => new Promise((resolve) => {
                        const request = indexedDB.deleteDatabase(db.name);
                        request.onsuccess = request.onerror = request.onblocked = resolve;
                    }))
            );
        } catch (error) {
            walletDebugLog('wallet SDK IndexedDB migration skipped', describeWalletDebugError(error));
        }
    }
    localStorage.setItem(WALLET_STORAGE_VERSION_KEY, WALLET_STORAGE_VERSION);
    walletDebugLog('wallet SDK storage migration completed', {
        version: WALLET_STORAGE_VERSION
    });
    return true;
}

async function signOutMismatchedSession(newAddress) {
    // When the active wallet switches to a different address, any existing
    // SIWE/Supabase session still belongs to the OLD address. Clear it so the
    // next protected write re-authenticates as the wallet that is now active.
    const normalizedNew = newAddress ? newAddress.toLowerCase() : null;
    if (!normalizedNew) return false;
    let shouldClearSupabaseStorage = false;

    try {
        if (window.SupabaseAuth?.invalidateSessionForWalletMismatch) {
            const cleared = await window.SupabaseAuth.invalidateSessionForWalletMismatch(normalizedNew);
            if (cleared) {
                console.log('Cleared stale session belonging to a previous wallet address');
                walletDebugLog('stale SIWE session cleared', { nextAddress: normalizedNew });
            }
            return cleared;
        }

        const sessionWallet = (localStorage.getItem('artsoul_authenticated_wallet') || '').toLowerCase();
        if (sessionWallet && sessionWallet !== normalizedNew) {
            localStorage.removeItem('artsoul_authenticated_wallet');
            localStorage.removeItem('artsoul_auth_method');
            shouldClearSupabaseStorage = true;
            console.log('Cleared stale session belonging to a previous wallet address');
            walletDebugLog('stale local SIWE markers cleared', { nextAddress: normalizedNew });
        }
    } catch (error) {
        shouldClearSupabaseStorage = true;
        console.warn('Session sign-out on address switch failed:', error);
        walletDebugLog('stale SIWE session clear failed', { message: error?.message || String(error) });
    }

    if (!shouldClearSupabaseStorage) return false;

    try {
        Object.keys(localStorage).forEach((key) => {
            if (key.startsWith('sb-') || key.includes('supabase')) {
                localStorage.removeItem(key);
            }
        });
    } catch (error) {
        console.warn('Supabase storage cleanup on address switch skipped:', error);
    }

    return true;
}

// ============================================
// UI UPDATE FUNCTIONS
// ============================================

/**
 * Update navigation buttons based on wallet connection state
 * Shows "Get Started" when disconnected
 * Shows Avatar Dropdown when connected
 */
window.updateNavButtons = function updateNavButtons(state) {
    const navButtons = document.getElementById('navButtons');
    if (!navButtons) {
        if (!window._navButtonsRetries) window._navButtonsRetries = 0;
        if (window._navButtonsRetries < 20) {
            window._navButtonsRetries++;
            setTimeout(() => updateNavButtons(state), 100);
        }
        return;
    }

    window._navButtonsRetries = 0;

    const normalizedChainId = setCurrentChainId(state);
    const normalizedAddress = state?.address ? state.address.toLowerCase() : null;

    if (window.artsoulWalletStateSettled !== true) {
        window.AvatarDropdown?.renderInitializingState?.();
        return;
    }

    if (normalizedAddress) {
        localStorage.setItem('artsoul_wallet', normalizedAddress);
        window.currentWalletAddress = normalizedAddress;
    } else {
        localStorage.removeItem('artsoul_wallet');
        window.currentWalletAddress = null;
    }

    if (window.AvatarDropdown) {
        window.AvatarDropdown.sync(normalizedAddress, {
            chainId: normalizedChainId,
            confirmed: Boolean(normalizedAddress)
        });
    } else {
        setTimeout(() => updateNavButtons(state), 100);
    }
}

/**
 * Update network badge with current network and balance
 */
window.updateNetworkBadge = async function updateNetworkBadge(state) {
    setCurrentChainId(state);
    // Network badge removed - balance now shown in dropdown menu
    return;
}

/**
 * Render network badge HTML
 */
function renderNetworkBadge() {
    const networkBadgeContainer = document.getElementById('networkBadge');
    if (!networkBadgeContainer || !currentNetwork) return;

    networkBadgeContainer.innerHTML = `
        <div class="network-badge" onclick="window.openArtSoulNetworkSelector?.()">
            <span class="network-name">${currentNetwork.name}</span>
            <span class="balance-amount">${currentBalance} ${currentNetwork.currency}</span>
        </div>
    `;
}

// ============================================
// WALLET CONNECTION
// ============================================

function setConnectButtonPending(pending, { retryable = false } = {}) {
    const button = document.getElementById('connectBtn');
    if (!button) return;
    const label = button.querySelector('span');
    button.disabled = Boolean(pending && !retryable);
    button.setAttribute('aria-busy', String(Boolean(pending)));
    button.dataset.connectPending = pending ? 'true' : 'false';
    if (label) label.textContent = pending
        ? (retryable ? 'Connecting... Tap to retry' : 'Connecting...')
        : 'Connect Wallet';
}

function createWalletConnectError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function removeMobileWalletRecovery() {
    document.getElementById('artsoul-mobile-wallet-recovery')?.remove();
}

function getKnownWalletLaunchUrl() {
    const id = String(lastSelectedWallet?.id || '').toLowerCase();
    const name = String(lastSelectedWallet?.name || '').toLowerCase();
    if (id === FEATURED_WALLETS.metamask || name.includes('metamask')) {
        const dappPath = `${window.location.host}${window.location.pathname}${window.location.search}`;
        return `https://metamask.app.link/dapp/${dappPath}`;
    }
    if ((id === FEATURED_WALLETS.rabby || name.includes('rabby')) && !isIOSDevice()) return 'rabby://';
    return null;
}

async function openWalletBrowserFallback(statusElement) {
    const launchUrl = getKnownWalletLaunchUrl();
    if (launchUrl) {
        walletDebugLog('mobile wallet browser fallback opened', {
            walletId: lastSelectedWallet?.id || null,
            walletName: lastSelectedWallet?.name || null,
            directLinkAvailable: true
        });
        window.location.href = launchUrl;
        return;
    }

    try {
        await navigator.clipboard.writeText(window.location.href);
        statusElement.textContent = 'ArtSoul URL copied. Open your wallet browser, paste the URL, and select Base Sepolia.';
        walletDebugLog('mobile wallet browser fallback copied URL', {
            walletId: lastSelectedWallet?.id || null,
            walletName: lastSelectedWallet?.name || null,
            directLinkAvailable: false
        });
    } catch (error) {
        statusElement.textContent = 'Open this page inside your wallet browser and select Base Sepolia before retrying.';
        walletDebugLog('mobile wallet browser fallback copy failed', describeWalletDebugError(error));
    }
}

// Small heads-up after a connection is accepted on a foreign chain: the
// write guard will request Base Sepolia at action time.
function notifyForeignChainAccepted(chainId) {
    if (parseChainId(chainId) === BASE_SEPOLIA_CHAIN_ID) return;
    try {
        window.ErrorHandler?.showToast?.('Connected. Base Sepolia will be requested when you place a bid.', 'info');
    } catch {
        // The hint is best effort; the connection itself is already applied.
    }
}

function showMobileWalletRecovery(error) {
    removeMobileWalletRecovery();
    const panel = document.createElement('section');
    panel.id = 'artsoul-mobile-wallet-recovery';
    panel.setAttribute('role', 'alert');
    panel.style.cssText = [
        'position:fixed',
        'left:12px',
        'right:12px',
        'bottom:12px',
        'z-index:2147483646',
        'display:grid',
        'gap:10px',
        'padding:14px',
        'border:1px solid var(--c-border)',
        'border-radius:12px',
        'color:var(--c-text)',
        'background:var(--c-surface)',
        'box-shadow:0 0 18px var(--c-glow, transparent)'
    ].join(';');

    const title = document.createElement('strong');
    title.textContent = 'Wallet connection needs attention';
    const status = document.createElement('p');
    status.style.cssText = 'margin:0;color:var(--c-text-muted);font-size:0.9rem;line-height:1.45';
    status.textContent = error?.message || 'The wallet connection was not completed.';
    const instruction = document.createElement('p');
    instruction.style.cssText = 'margin:0;color:var(--c-text);font-size:0.85rem;line-height:1.4';
    const rabbyIOSUnavailable = error?.code === 'RABBY_IOS_UNAVAILABLE';
    instruction.textContent = rabbyIOSUnavailable
        ? 'Open Rabby, choose WalletConnect, paste the copied URI, or open ArtSoul in the Rabby browser.'
        : 'ArtSoul will add and select Base Sepolia after the wallet session connects.';
    const actions = document.createElement('div');
    actions.style.cssText = 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px';
    const makeButton = (label) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.style.cssText = [
            'min-height:44px',
            'padding:8px 10px',
            'border:1px solid var(--c-accent)',
            'border-radius:10px',
            'color:var(--c-text)',
            'background:var(--c-bg)',
            'font:inherit',
            'font-weight:700'
        ].join(';');
        return button;
    };
    const retryButton = makeButton('Retry');
    retryButton.addEventListener('click', () => {
        removeMobileWalletRecovery();
        void window.safeConnectWallet?.();
    });
    const walletBrowserButton = makeButton('Open in wallet browser');
    walletBrowserButton.addEventListener('click', () => void openWalletBrowserFallback(status));
    actions.append(retryButton);
    if (rabbyIOSUnavailable) {
        const copyLinkButton = makeButton('Copy link');
        copyLinkButton.addEventListener('click', async () => {
            if (!lastWalletConnectUri) {
                status.textContent = 'The WalletConnect URI is unavailable. Open ArtSoul inside the Rabby browser instead.';
                return;
            }
            try {
                await navigator.clipboard.writeText(lastWalletConnectUri);
                status.textContent = 'WalletConnect URI copied. Open Rabby, choose WalletConnect, and paste it.';
                walletDebugLog('Rabby WalletConnect URI copied', { uriAvailable: true });
            } catch (copyError) {
                status.textContent = 'Copy failed. Open ArtSoul inside the Rabby browser instead.';
                walletDebugLog('Rabby WalletConnect URI copy failed', describeWalletDebugError(copyError));
            }
        });
        actions.append(copyLinkButton);
    }
    actions.append(walletBrowserButton);
    panel.append(title, status, instruction, actions);
    document.documentElement.appendChild(panel);
}

async function openAppKitConnectModal(attempt) {
    walletDebugLog('modal open started', {
        walletId: lastSelectedWallet?.id || null,
        walletName: lastSelectedWallet?.name || null
    });
    let timeoutId = null;
    try {
        await Promise.race([
            Promise.resolve(window.web3Modal.open({ view: 'Connect' })),
            new Promise((_, reject) => {
                timeoutId = setTimeout(() => reject(createWalletConnectError(
                    'MODAL_OPEN_TIMEOUT',
                    'Wallet selection did not open. Please retry or use your wallet browser.'
                )), APPKIT_MODAL_OPEN_TIMEOUT);
            })
        ]);
        if (attempt) attempt.modalOpened = true;
        walletDebugLog('modal open resolved', {
            open: Boolean(window.web3Modal?.getState?.()?.open),
            deepLinkAvailable: Boolean(lastSelectedWallet?.deepLinkAvailable)
        });
    } catch (error) {
        walletDebugLog('modal open rejected', describeWalletDebugError(error));
        throw error;
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

// New production path for mobile external browsers: bare
// @walletconnect/ethereum-provider + the ArtSoul wallet sheet. Desktop and
// injected wallet browsers keep their existing flows.
async function connectExternalMobileCoreWallet(attempt) {
    walletDebugLog('core mobile connect started', { attemptId: attempt.id });
    let sheet = null;
    try {
        const connectPromise = connectCoreWallet({
            onDisplayUri: (uri) => {
                lastWalletConnectUri = uri;
                if (sheet) {
                    sheet.update(uri);
                    return;
                }
                sheet = showCoreWalletSheet({
                    uri,
                    isIOS: isIOSDevice(),
                    log: (step, detail) => walletDebugLog(step, detail),
                    onWalletOpened: (walletName) => {
                        lastSelectedWallet = {
                            id: null,
                            name: walletName,
                            rdns: null,
                            nativeLink: null,
                            universalLink: null,
                            deepLinkAvailable: true
                        };
                        markMobileWalletHandoff(`core sheet ${walletName}`);
                    },
                    onCancel: () => {
                        attempt.cancelled = true;
                        notifyWalletResume('core sheet cancelled');
                    }
                });
            }
        });

        const connected = await Promise.race([
            connectPromise,
            (async () => {
                const deadline = Date.now() + WALLET_CONNECT_TIMEOUT_MOBILE;
                while (Date.now() < deadline && !attempt.cancelled && !attempt.failure) {
                    await waitForWalletResumeOrDelay(WALLET_CONFIRMATION_INTERVAL);
                }
                return null;
            })()
        ]);
        if (attempt.cancelled) return null;
        if (attempt.failure) throw attempt.failure;
        if (!connected?.address) {
            throw createWalletConnectError(
                'WALLET_CONNECT_TIMEOUT',
                'Wallet connection was not confirmed. Please retry or open ArtSoul in your wallet browser.'
            );
        }

        const coreProvider = connected.provider;
        activeWalletProvider = coreProvider;
        bindRuntimeProviderEvents(coreProvider, 'core walletconnect provider');
        bindWalletConnectDiagnostics(coreProvider, 'core walletconnect provider');
        bindCoreProviderDisconnect(coreProvider);
        walletDebugLog('core session connected', {
            address: maskWalletAddress(connected.address),
            chainId: connected.chainId,
            restored: connected.restored
        });
        sheet?.setStatus('Wallet connected. Confirming the network...');

        // The wallet may follow up with chainChanged for its own active
        // network right after settle (observed 84532 -> 8453). Wait for that
        // signal before deciding whether the add/switch cycle is needed.
        const settleSource = await waitForWalletChainSettle(coreProvider, 2500);
        walletDebugLog('core chain settle window closed', { source: settleSource });
        if (attempt.cancelled) return null;

        const validated = await ensureExternalMobileBaseSepolia({
            address: connected.address,
            chainId: connected.chainId,
            account: { address: connected.address, chainId: connected.chainId }
        }, 'core walletconnect', attempt, coreProvider, {
            acceptForeignChain: true,
            switchTimeout: MOBILE_CONNECT_SWITCH_TIMEOUT
        });
        if (attempt.cancelled) return null;
        if (!validated?.address) {
            throw attempt.failure || createWalletConnectError(
                'MOBILE_ACCOUNT_UNCONFIRMED',
                'The wallet session did not confirm the selected account. Please retry the connection.'
            );
        }

        await handleProviderChainConfirmed(validated.chainId, 'core walletconnect');
        await handleProviderAccountsChanged([validated.address], 'core walletconnect', coreProvider);
        notifyForeignChainAccepted(validated.chainId);
        walletDebugLog('core mobile connect complete', {
            address: maskWalletAddress(validated.address),
            chainId: validated.chainId
        });
        return validated.address;
    } finally {
        sheet?.close();
    }
}

const boundCoreDisconnectProviders = new WeakSet();

// The relay WebSocket dies while the tab is backgrounded on iOS and surfaces
// as an EIP-1193 `disconnect` (commonly close code 1006). That is NOT the user
// ending the session — the WalletConnect session record still lives in storage
// and the socket reconnects. Only a genuine `session_delete` (user disconnected
// in the wallet) actually removes the session. Wiping wallet state + signing
// out on every transient socket blip is what made the wallet "randomly
// disconnect"; distinguish the two here.
function coreSessionStillLive(provider) {
    try {
        if (isCoreSessionActive()) return true;
        if (provider?.session) return true;
        if (getWalletConnectSessions(provider).length > 0) return true;
    } catch {
        // If we cannot prove the session is gone, err on keeping it.
        return true;
    }
    return false;
}

async function handleCoreProviderDisconnect(provider, payload) {
    const code = payload?.code ?? payload?.error?.code ?? payload?.reason?.code ?? null;
    if (coreSessionStillLive(provider)) {
        walletDebugLog('core disconnect treated as transient relay drop', {
            code,
            sessionAlive: true
        });
        // Reopen the relay socket so the live session keeps working; keep the
        // connected UI untouched.
        await restartWalletConnectTransport('core transient disconnect');
        return;
    }
    // Backgrounded browsers (iOS especially) deliver relay drops as disconnects
    // while the session record may be momentarily unreadable. Never wipe state
    // from the background — re-check after the transport restarts on return.
    if (document.visibilityState === 'hidden') {
        pendingCoreDisconnectProvider = provider;
        walletDebugLog('core disconnect deferred while backgrounded', { code });
        return;
    }
    walletDebugLog('core session ended (genuine disconnect)', { code });
    await handleProviderAccountsChanged([], 'core walletconnect disconnect', provider);
}

// Resolve a disconnect that arrived while backgrounded: restart the relay,
// then trust the persisted session record — wipe only when it is really gone.
async function recheckDeferredCoreDisconnect(source) {
    const provider = pendingCoreDisconnectProvider;
    if (!provider) return;
    pendingCoreDisconnectProvider = null;
    await restartWalletConnectTransport(`${source}: deferred core disconnect`);
    if (coreSessionStillLive(provider)) {
        walletDebugLog('deferred core disconnect resolved as transient', { source });
        return;
    }
    walletDebugLog('core session ended (genuine disconnect)', { source, deferred: true });
    await handleProviderAccountsChanged([], 'core walletconnect disconnect', provider);
}

function bindCoreProviderDisconnect(provider) {
    if (!provider?.on || boundCoreDisconnectProviders.has(provider)) return;
    boundCoreDisconnectProviders.add(provider);
    provider.on('disconnect', (payload) => {
        void handleCoreProviderDisconnect(provider, payload);
    });
    // A genuine end-of-session from the wallet side. By the time this fires the
    // session record is already removed from storage, so it is safe to wipe.
    provider.on?.('session_delete', () => {
        walletDebugLog('core session_delete event', {});
        void handleProviderAccountsChanged([], 'core walletconnect session_delete', provider);
    });
}

// Restore the persisted core session with retries. Every MPA navigation is a
// full page load that must re-import the WalletConnect SDK and reopen the
// relay, so a single flaky attempt is common on mobile networks. Only a clean
// "no session in storage" counts as disconnected; errors keep the last-known
// wallet hint so the next attempt or page load can still restore.
async function runCoreSessionRestore() {
    let outcome = { status: 'error', session: null };
    for (let attempt = 1; attempt <= CORE_RESTORE_MAX_ATTEMPTS; attempt++) {
        outcome = await Promise.race([
            restoreCoreSessionOutcome(),
            sleep(CORE_RESTORE_ATTEMPT_TIMEOUT).then(() => ({ status: 'error', session: null, timedOut: true }))
        ]);
        if (outcome.status !== 'error') return outcome;
        walletDebugLog('core session restore attempt failed', {
            attempt,
            timedOut: Boolean(outcome.timedOut),
            error: outcome.error ? describeWalletDebugError(outcome.error) : null
        });
        if (attempt < CORE_RESTORE_MAX_ATTEMPTS) await sleep(500 * attempt);
    }
    return outcome;
}

function findWalletConnectUri(value, depth = 0, seen = new WeakSet()) {
    if (depth > 5 || value === null || value === undefined) return null;
    if (typeof value === 'string') return value.startsWith('wc:') ? value : null;
    if (typeof value !== 'object') return null;
    if (seen.has(value)) return null;
    seen.add(value);
    for (const nested of Object.values(value)) {
        const uri = findWalletConnectUri(nested, depth + 1, seen);
        if (uri) return uri;
    }
    return null;
}

function handleAppKitEvent(event) {
    const data = event?.data || {};
    const properties = data?.properties || event?.properties || {};
    const wallet = properties?.wallet || data?.wallet || event?.wallet || {};
    const walletId = wallet?.id || properties?.wallet_id || properties?.walletId || data?.wallet_id || data?.walletId || null;
    const walletName = wallet?.name || properties?.wallet_name || properties?.walletName || data?.wallet_name || data?.walletName || null;
    const walletRdns = wallet?.rdns || properties?.wallet_rdn || properties?.walletRdns || data?.wallet_rdn || data?.walletRdns || null;
    const nativeLink = wallet?.mobile?.native || wallet?.mobile_link || wallet?.mobileLink ||
        properties?.mobile_native || properties?.mobileNative || properties?.mobile_link || properties?.mobileLink ||
        data?.mobile_native || data?.mobileNative || data?.mobile_link || data?.mobileLink || null;
    const universalLink = wallet?.mobile?.universal || wallet?.universal_link || wallet?.universalLink ||
        properties?.mobile_universal || properties?.mobileUniversal || properties?.universal_link || properties?.universalLink ||
        data?.mobile_universal || data?.mobileUniversal || data?.universal_link || data?.universalLink || null;
    const deepLinkAvailable = Boolean(nativeLink || universalLink);
    const eventType = event?.type || event?.event || data?.event || data?.type || 'unknown';
    const walletConnectUri = findWalletConnectUri(event);
    if (walletConnectUri) lastWalletConnectUri = walletConnectUri;
    if (walletId || walletName) {
        lastSelectedWallet = {
            id: walletId || lastSelectedWallet?.id || null,
            name: walletName || lastSelectedWallet?.name || null,
            rdns: walletRdns || lastSelectedWallet?.rdns || null,
            nativeLink: nativeLink || lastSelectedWallet?.nativeLink || null,
            universalLink: universalLink || lastSelectedWallet?.universalLink || null,
            deepLinkAvailable
        };
    }
    walletDebugLog('AppKit event', {
        type: eventType,
        walletId,
        walletName,
        walletRdns,
        nativeLink,
        universalLink,
        deepLinkAvailable,
        walletConnectUriAvailable: Boolean(walletConnectUri),
        error: event?.error?.message || data?.error?.message || properties?.error_message || null
    });

    const rabbySelected = walletId === FEATURED_WALLETS.rabby || String(walletName || '').toLowerCase().includes('rabby');
    if (activeMobileConnect && isIOSDevice() && rabbySelected && !universalLink && activeConnectAttempt && !activeConnectAttempt.failure) {
        activeConnectAttempt.failure = createWalletConnectError(
            'RABBY_IOS_UNAVAILABLE',
            'Rabby could not be opened on this device.'
        );
        mobileRetryCleanupRequired = true;
        walletDebugLog('Rabby iOS universal link unavailable', {
            walletId,
            walletName,
            nativeLink,
            universalLink
        });
        void safeCloseModal('Rabby iOS unavailable', { silent: true });
        notifyWalletResume('Rabby iOS unavailable');
    }
}

/**
 * Safe wallet connection with error handling
 * Prevents duplicate connection attempts
 */
window.safeConnectWallet = async () => {
    const mobileConnect = isMobileDevice();
    const injectedMobileConnect = mobileConnect && isInjectedWalletBrowser();
    const externalMobileConnect = mobileConnect && !injectedMobileConnect;

    // A core pairing is already waiting for the wallet: keep it. Regenerating
    // or deleting an active pairing mid-attempt is exactly the SDK race that
    // killed AppKit settlement — the sheet with the current URI stays up.
    if (externalMobileConnect && activeConnectAttempt && !activeConnectAttempt.cancelled && isCoreConnectInFlight()) {
        walletDebugLog('core connect already pending; keeping active pairing', {
            attemptId: activeConnectAttempt.id
        });
        return null;
    }

    removeMobileWalletRecovery();
    lastSelectedWallet = null;
    lastWalletConnectUri = null;

    if (mobileConnect && activeConnectAttempt && !activeConnectAttempt.cancelled) {
        walletDebugLog('connect button retry requested', {
            cancelledAttemptId: activeConnectAttempt.id,
            snapshot: getWalletDebugSnapshot()
        });
        activeConnectAttempt.cancelled = true;
        if (!externalMobileConnect) mobileRetryCleanupRequired = true;
        notifyWalletResume('connect retry');
        void safeCloseModal('mobile connect retry', { silent: true });
    }

    // The SDK-state wipe belongs to the AppKit mobile path only. The core
    // path keeps its provider storage; stale proposals expire on their own.
    if (mobileConnect && mobileRetryCleanupRequired && !externalMobileConnect) {
        await clearIncompleteWalletConnectState('before mobile retry');
    }

    const attempt = {
        id: ++connectAttemptSequence,
        cancelled: false,
        externalMobile: externalMobileConnect,
        allowExistingSession: externalMobileConnect,
        startedAt: Date.now()
    };
    activeConnectAttempt = attempt;
    setConnectButtonPending(true, { retryable: mobileConnect });
    walletDebugLog('connect button handler entered', {
        mobile: mobileConnect,
        injectedMobile: injectedMobileConnect,
        externalMobile: externalMobileConnect,
        snapshot: getWalletDebugSnapshot()
    });

        if (mobileConnect) {
            activeMobileConnect = true;
        lastAcceptedMobileAccountKey = null;
        mobileConnectStartRevision = appKitAccountRevision;
        mobileConnectInitialAccountKey = getAppKitAccountKey(readAppKitAccountSnapshot());
    }

    try {
        sessionStorage.removeItem('artsoul_disconnecting');
        markConnectModalIntent();
        if (injectedMobileConnect) {
            walletDebugLog('mobile injected connect start', {
                metaMask: Boolean(window.ethereum?.isMetaMask),
                rabby: Boolean(window.ethereum?.isRabby)
            });
            bindRuntimeProviderEvents(window.ethereum, 'mobile injected provider');
            const accounts = await requestInjectedMobileAccounts();
            const connectedAddress = normalizeWalletAddress(Array.isArray(accounts) ? accounts[0] : accounts);
            if (!connectedAddress) {
                throw createWalletConnectError(
                    'MOBILE_ACCOUNT_UNCONFIRMED',
                    'The wallet did not return an account. Please retry the connection.'
                );
            }
            const chainId = await requestProviderChainId(window.ethereum);
            const validated = await ensureExternalMobileBaseSepolia({
                address: connectedAddress,
                chainId,
                account: { address: connectedAddress, chainId }
            }, 'mobile injected provider', attempt, window.ethereum, {
                acceptForeignChain: true,
                switchTimeout: MOBILE_CONNECT_SWITCH_TIMEOUT
            });
            if (!validated) {
                throw attempt.failure || createWalletConnectError(
                    'MOBILE_ACCOUNT_UNCONFIRMED',
                    'The wallet session did not confirm the selected account. Please retry the connection.'
                );
            }
            await handleProviderChainConfirmed(validated.chainId, 'mobile injected provider');
            await handleProviderAccountsChanged([validated.address], 'mobile injected provider', window.ethereum);
            notifyForeignChainAccepted(validated.chainId);
            clearModalIntent();
            walletDebugLog('mobile injected connect complete', {
                address: maskWalletAddress(validated.address),
                chainId: validated.chainId
            });
            return validated.address;
        }

        if (externalMobileConnect) {
            const coreAddress = await connectExternalMobileCoreWallet(attempt);
            if (attempt.cancelled) return null;
            if (!coreAddress) {
                throw attempt.failure || createWalletConnectError(
                    'WALLET_CONNECT_TIMEOUT',
                    'Wallet connection was not confirmed. Please retry or open ArtSoul in your wallet browser.'
                );
            }
            clearModalIntent();
            // Same connect-only gesture rule as the AppKit mobile path: SIWE
            // waits for the next protected action.
            deferMobileAuthenticationThisTurn = true;
            setTimeout(() => {
                deferMobileAuthenticationThisTurn = false;
            }, 0);
            return coreAddress;
        }

        if (window.web3Modal) {
            await openAppKitConnectModal(attempt);

            walletDebugLog('waiting for wallet confirmation', { mobile: mobileConnect });
            const confirmed = await waitForConfirmedWallet(
                mobileConnect ? WALLET_CONNECT_TIMEOUT_MOBILE : WALLET_CONNECT_TIMEOUT_DESKTOP,
                { mobile: mobileConnect, attempt }
            );
            if (attempt.cancelled) return null;
            if (attempt.failure) throw attempt.failure;
            if (!confirmed?.address) {
                await safeCloseModal('wallet connect timeout');
                clearModalIntent();
                throw createWalletConnectError(
                    'WALLET_CONNECT_TIMEOUT',
                    'Wallet connection was not confirmed. Please retry or open ArtSoul in your wallet browser.'
                );
            }

            let finalized = confirmed;
            if (!mobileConnect && confirmed.chainId !== BASE_SEPOLIA_CHAIN_ID) {
                finalized = await ensureExternalMobileBaseSepolia(
                    {
                        address: confirmed.address,
                        chainId: confirmed.chainId,
                        account: { address: confirmed.address, chainId: confirmed.chainId }
                    },
                    'desktop post-connect network validation',
                    attempt,
                    confirmed.provider || await getAppKitWalletProviderWithin(MOBILE_PROVIDER_REQUEST_TIMEOUT)
                );
                if (!finalized?.address) {
                    throw attempt.failure || createWalletConnectError(
                        'BASE_SEPOLIA_REQUIRED',
                        'This connection requires Base Sepolia.'
                    );
                }
            }

            clearModalIntent();
            await safeCloseModal('wallet connected');
            walletDebugLog('wallet connection confirmed', {
                address: maskWalletAddress(finalized.address),
                chainId: finalized.chainId
            });
            if (mobileConnect) {
                // Let callers finish this user gesture as connect-only. The flag
                // survives promise continuations in this turn, then clears before
                // a later protected-action gesture can request normal SIWE.
                deferMobileAuthenticationThisTurn = true;
                setTimeout(() => {
                    deferMobileAuthenticationThisTurn = false;
                }, 0);
            }
            return finalized.address;
        } else {
            throw createWalletConnectError(
                'APPKIT_NOT_READY',
                'Wallet connection is still loading. Please retry in a moment.'
            );
        }
    } catch (err) {
        if (attempt.cancelled) {
            walletDebugLog('wallet connect attempt cancelled for retry', {
                attemptId: attempt.id,
                elapsedMs: Date.now() - attempt.startedAt
            });
            return null;
        }
        console.error('Connection error:', err);
        walletDebugLog('wallet connect final failure', {
            ...describeWalletDebugError(err),
            walletId: lastSelectedWallet?.id || null,
            walletName: lastSelectedWallet?.name || null,
            deepLinkAvailable: Boolean(lastSelectedWallet?.deepLinkAvailable)
        });

        // Handle "previous request still pending" error. A confirmed address
        // means a live session — a failed retry must never tear it down.
        if ((err.message?.includes('previous') || err.message?.includes('declined')) && !hasConfirmedWalletAddress()) {
            await clearWalletConnectionCache();
            updateNavButtons(null);
        }
        clearModalIntent();
        await safeCloseModal('wallet connect failed', { silent: true });
        if (mobileConnect) showMobileWalletRecovery(err);
        else alert(err?.message || 'Wallet connection was not completed. Please try again.');
        // Core-path retries must not wipe the provider's persisted state.
        if (mobileConnect && !externalMobileConnect && !hasConfirmedWalletAddress()) mobileRetryCleanupRequired = true;
        return null;
    } finally {
        walletDebugLog('connect button handler exited', {
            attemptId: attempt.id,
            cancelled: attempt.cancelled,
            elapsedMs: Date.now() - attempt.startedAt,
            snapshot: getWalletDebugSnapshot()
        });
        if (activeConnectAttempt === attempt) {
            activeConnectAttempt = null;
            activeMobileConnect = false;
            setConnectButtonPending(false);
        }
    }
};

let writeNetworkGuardPromise = null;
window.ensureArtSoulWriteNetwork = async () => {
    if (writeNetworkGuardPromise) return writeNetworkGuardPromise;

    writeNetworkGuardPromise = (async () => {
        const target = getSupportedNetworkTarget(BASE_SEPOLIA_CHAIN_ID);
        const provider = await getSwitchProvider();
        if (!provider?.request || !target) {
            throw createWalletConnectError(
                'BASE_SEPOLIA_REQUIRED',
                'This action requires Base Sepolia.'
            );
        }

        const currentChainId = await readMobileProviderChainId(provider);
        if (currentChainId !== BASE_SEPOLIA_CHAIN_ID) {
            walletDebugLog('write guard Base Sepolia switch requested', {
                fromChainId: currentChainId,
                toChainId: BASE_SEPOLIA_CHAIN_ID
            });
            try {
                await switchEthereumChain(provider, target);
            } catch (error) {
                walletDebugLog('write guard Base Sepolia switch failed', describeWalletDebugError(error));
                if (isUserRejectedError(error)) {
                    throw createWalletConnectError(
                        'BASE_SEPOLIA_SWITCH_REJECTED',
                        'Network switch was declined. This action requires Base Sepolia.'
                    );
                }
                throw createWalletConnectError(
                    'BASE_SEPOLIA_REQUIRED',
                    'This action requires Base Sepolia.'
                );
            }
        }

        const confirmedChainId = await waitForProviderChainId(
            BASE_SEPOLIA_CHAIN_ID,
            NETWORK_CONFIRMATION_TIMEOUT,
            provider
        );
        if (confirmedChainId !== BASE_SEPOLIA_CHAIN_ID) {
            throw createWalletConnectError(
                'BASE_SEPOLIA_REQUIRED',
                'This action requires Base Sepolia.'
            );
        }

        activeWalletProvider = provider;
        applyConfirmedNetwork(BASE_SEPOLIA_CHAIN_ID);
        walletDebugLog('write guard Base Sepolia confirmed', {
            chainId: BASE_SEPOLIA_CHAIN_ID
        });
        return true;
    })().finally(() => {
        writeNetworkGuardPromise = null;
    });

    return writeNetworkGuardPromise;
};

window.openArtSoulNetworkSelector = async () => {
    try {
        sessionStorage.removeItem('artsoul_disconnecting');
        const walletState = getRestoredWalletState();
        if (!walletState?.isConnected || !walletState.address) {
            alert('Please connect your wallet before switching networks.');
            return false;
        }
        if (window.AvatarDropdown?.openNetworkOptions) {
            window.AvatarDropdown.openNetworkOptions();
            return true;
        }

        // Fallback AppKit selector contains Base Sepolia only.
        markNetworkModalIntent();
        if (window.web3Modal?.open) await window.web3Modal.open({ view: 'Networks' });
        else alert('Please wait, wallet modal is still loading...');
        return true;
    } catch (error) {
        console.error('Failed to open network selector:', error);
        return false;
    }
};

window.switchArtSoulNetwork = async (chainId) => {
    const target = getSupportedNetworkTarget(chainId);
    if (!target) {
        alert('Unsupported network. Please choose Base Sepolia.');
        return false;
    }

    if (activeNetworkSwitchChainId === target.chainId) {
        console.log('Network switch already in progress:', target.chainName);
        return false;
    }

    activeNetworkSwitchChainId = target.chainId;

    try {
        const currentChainId = await getProviderTruthChainId();
        if (currentChainId === target.chainId) {
            await closeNetworkModalAfterConfirmedChain(target.chainId);
            return true;
        }

        let appKitError = null;
        if (window.web3Modal?.switchNetwork) {
            try {
                await window.web3Modal.switchNetwork(target.appKitNetwork);
                const confirmedChainId = await waitForProviderChainId(target.chainId, NETWORK_CONFIRMATION_TIMEOUT);
                if (confirmedChainId === target.chainId) {
                    await closeNetworkModalAfterConfirmedChain(target.chainId);
                    return true;
                }
            } catch (error) {
                appKitError = error;
                console.warn('AppKit network switch did not complete:', error);
            }
        }

        const provider = await getSwitchProvider();
        try {
            await switchEthereumChain(provider, target);
        } catch (error) {
            if (isPendingRequestError(error)) {
                alert('Please approve the pending network request in your wallet.');
                return false;
            }
            if (!isUnknownChainError(error)) throw error;
            await addEthereumChain(provider, target);
            await switchEthereumChain(provider, target);
        }

        const confirmedChainId = await waitForProviderChainId(target.chainId, NETWORK_CONFIRMATION_TIMEOUT, provider);
        if (confirmedChainId === target.chainId) {
            await closeNetworkModalAfterConfirmedChain(target.chainId);
            return true;
        }

        console.warn('Provider did not confirm requested network:', {
            requested: target.chainId,
            confirmed: confirmedChainId,
            appKitError
        });
        alert(`Network switch to ${target.chainName} was not confirmed. Please approve the request in your wallet and try again.`);
        return false;
    } catch (error) {
        console.error('Network switch failed:', error);
        alert(`Failed to switch network: ${error?.message || 'Unknown wallet error'}`);
        return false;
    } finally {
        activeNetworkSwitchChainId = null;
    }
};

/**
 * Reset wallet connection state
 * Clears all WalletConnect/AppKit cache
 */
window.resetWalletConnection = async () => {
    try {
        // Set disconnecting flag to prevent auto-reconnect
        sessionStorage.setItem('artsoul_disconnecting', 'true');
        clearModalIntent();

        try {
            await Promise.race([
                disconnectCoreWallet(),
                new Promise((resolve) => setTimeout(resolve, 2500))
            ]);
        } catch (coreDisconnectError) {
            console.warn('Core WalletConnect disconnect skipped:', coreDisconnectError);
        }

        if (window.web3Modal) {
            await safeCloseModal('disconnect start');
            try {
                await Promise.race([
                    window.web3Modal.disconnect(),
                    new Promise((resolve) => setTimeout(resolve, 2500))
                ]);
            } catch (disconnectError) {
                console.warn('AppKit disconnect skipped:', disconnectError);
            }
            await safeCloseModal('disconnect complete');
            scheduleModalCloseRetries('disconnect complete');
        }

        await clearWalletConnectionCache();
        updateNavButtons(null);
        updateNetworkBadge(null);
        dispatchWalletStateChanged({
            address: null,
            chainId: null,
            isConnected: false
        });

        // Check if we're already on index.html
        const isIndexPage = window.location.pathname.endsWith('index.html') ||
                            window.location.pathname === '/' ||
                            window.location.pathname.endsWith('/');

        if (isIndexPage) {
            // Already on index, just reload
            window.location.reload();
        } else {
            // Redirect to home page
            window.location.href = 'index.html';
        }
    } catch (error) {
        console.error('Reset failed:', error);
        // Force reload anyway
        window.location.reload();
    }
};

// ============================================
// AUTHENTICATION
// ============================================

/**
 * Lazy authentication - only authenticate when needed
 * Prevents disconnect issues from immediate signature requests
 */
window.ensureAuthenticated = async () => {
    // Check if wallet is connected
    let walletAddress = window.getCurrentWalletAddress?.();
    const connectedDuringThisRequest = !walletAddress;
    if (!walletAddress) {
        walletAddress = await window.safeConnectWallet?.();
        if (!walletAddress) return false;
    }

    // A protected action may be the first thing a visitor taps. On an external
    // mobile browser, finish that deep-link round trip as connect-only; asking
    // for SIWE immediately would launch a second wallet request whose response
    // can be lost when the browser is backgrounded. The next protected action
    // performs the normal SIWE flow with the already-connected session.
    if (
        isMobileDevice() &&
        !isInjectedWalletBrowser() &&
        (connectedDuringThisRequest || deferMobileAuthenticationThisTurn)
    ) {
        deferMobileAuthenticationThisTurn = false;
        walletDebugLog('SIWE deferred after external mobile wallet connect', {
            address: maskWalletAddress(walletAddress)
        });
        return false;
    }

    // Check if already authenticated for this exact wallet. A SIWE session
    // signed by a previous account must never authorize the new active account.
    if (window.SupabaseAuth) {
        await window.SupabaseAuth.invalidateSessionForWalletMismatch?.(walletAddress);
        const isAuth = await (
            window.SupabaseAuth.isAuthenticatedForWallet?.(walletAddress) ||
            window.SupabaseAuth.isAuthenticated?.(walletAddress)
        );
        if (isAuth) {
            console.log('Already authenticated for active wallet');
            walletDebugLog('SIWE session already valid', { address: walletAddress.toLowerCase() });
            return true;
        }
    }

    // Authenticate with signature
    try {
        console.log('🔐 Requesting signature for authentication...');

        walletDebugLog('SIWE signature requested', { address: maskWalletAddress(walletAddress) });

        // Sign only with the provider that currently controls the active address.
        const provider = await getProviderForWallet(walletAddress);
        if (!provider) throw new Error('The active wallet account is not available in the connected provider.');

        const authResult = await window.SupabaseAuth.authenticateWithWallet(
            walletAddress,
            provider
        );
        console.log('Authenticated:', authResult.user.id);
        walletDebugLog('SIWE signature verified', { address: maskWalletAddress(walletAddress) });
        return true;
    } catch (error) {
        console.error('Authentication failed:', error);
        walletDebugLog('SIWE signature failed', { message: error?.message || String(error) });
        alert('Authentication was not completed. You are connected and can browse, but protected actions need a wallet signature.');
        return false;
    }
};

/**
 * Get current wallet address
 */
window.getCurrentWalletAddress = () => {
    if (window.currentWalletAddress) {
        return normalizeWalletAddress(window.currentWalletAddress);
    }

    const authoritativeState = getAuthoritativeWalletState();
    if (authoritativeState?.isConnected && authoritativeState.address) {
        return authoritativeState.address.toLowerCase();
    }

    return window.currentWalletAddress || '';
};

window.getStoredWalletHint = () => {
    return localStorage.getItem('artsoul_wallet') || '';
};

// Resolve once the boot-time wallet hydration (including the async core
// WalletConnect session restore) has settled, so a page never decides
// "not connected" while a live session is still being restored. Bounded so a
// hung restore can never freeze a protected action.
function waitForWalletHydration(timeoutMs = WALLET_HYDRATION_TIMEOUT + 500) {
    if (!window.artsoulWalletHydrating) return Promise.resolve();
    return new Promise((resolve) => {
        const startedAt = Date.now();
        const check = () => {
            if (!window.artsoulWalletHydrating || Date.now() - startedAt >= timeoutMs) {
                resolve();
                return;
            }
            setTimeout(check, 60);
        };
        check();
    });
}

// Single entry point for every protected action ("place bid", "like",
// "upload", "buy", "withdraw", ...). Instead of telling the user to connect,
// the action calls this: it waits for hydration, returns the address if a
// session is already live, and otherwise opens the branded wallet modal and
// resolves with the connected address once approved. The caller stays on the
// same page and can continue its work — no redirect, no toast.
window.ensureWalletConnected = async () => {
    // Mobile core path: the persisted-session restore is the authority on
    // "connected". Protected actions wait for it to finish (it is bounded by
    // its own attempt caps) instead of deciding from the momentary UI state.
    if (coreSessionRestoreCompletion && !coreSessionRestoreSettled) {
        try {
            await coreSessionRestoreCompletion;
        } catch {
            // The completion handler logs its own failures.
        }
    }
    await waitForWalletHydration();
    const existing = window.getCurrentWalletAddress?.();
    if (existing) return existing;
    try {
        const connected = await window.safeConnectWallet?.();
        return normalizeWalletAddress(connected) || window.getCurrentWalletAddress?.() || '';
    } catch (error) {
        walletDebugLog('ensureWalletConnected failed', describeWalletDebugError(error));
        return window.getCurrentWalletAddress?.() || '';
    }
};

// ============================================
// DEVICE DETECTION
// ============================================

function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function isInjectedWalletBrowser() {
    const provider = window.ethereum;
    if (!provider?.request || !isMobileDevice()) return false;
    return true;
}

// ============================================
// APPKIT INITIALIZATION
// ============================================

async function initializeAppKit() {
    try {
        const isMobile = isMobileDevice();
        console.log(' Device type:', isMobile ? 'Mobile' : 'Desktop');
        walletDebugLog('appkit init start', {
            mobile: isMobile,
            injected: Boolean(window.ethereum?.request),
            injectedWalletBrowser: isInjectedWalletBrowser(),
            origin: window.location.origin
        });
        walletDebugLog('appkit configuration', {
            appKitVersion: '1.8.21',
            metadataUrl: metadata.url,
            redirectUniversal: metadata.redirect?.universal || null,
            defaultNetwork: BASE_SEPOLIA_CAIP_ID,
            configuredNetworks: networks.map((network) => ({
                id: network.id,
                caipNetworkId: network.caipNetworkId || `eip155:${network.id}`,
                chainNamespace: network.chainNamespace || 'eip155'
            })),
            operationalWriteChain: BASE_SEPOLIA_CAIP_ID,
            allowUnsupportedChain: true,
            projectIdPresent: Boolean(projectId),
            projectIdFingerprint: `${projectId.slice(0, 4)}...${projectId.slice(-4)}`
        });

        await migrateWalletStorageOnce();

        const explicitDisconnectRequested = sessionStorage.getItem('artsoul_disconnecting');
        if (explicitDisconnectRequested) {
            await clearWalletConnectionCache();
            sessionStorage.removeItem('artsoul_disconnecting');
        }

        // Mobile external browsers: kick off the core WalletConnect session
        // restore immediately. It re-imports the SDK and reopens the relay on
        // every page load (MPA), so it must run in parallel with the rest of
        // the boot; the fail-open/hydration timers below wait for it instead
        // of declaring "disconnected" while it is still in flight. After an
        // explicit disconnect the WalletConnect storage was just cleared, so
        // the restore settles as "none" almost instantly.
        if (isMobile && !isInjectedWalletBrowser()) {
            coreSessionRestoreTask = runCoreSessionRestore();
        }

        const storedWalletAtBoot = localStorage.getItem('artsoul_wallet');
        let walletHydrationPending = true;
        let walletHydrationTimer = null;
        window.artsoulWalletHydrating = true;

        const applyConfirmedWalletState = (walletState) => {
            const normalizedAddress = walletState.address.toLowerCase();
            const normalizedChainId = setCurrentChainId(walletState);
            finishWalletHydration();
            lastProcessedAddress = normalizedAddress;
            lastProcessedChainId = normalizedChainId;
            lastConfirmedWalletAt = Date.now();
            window.currentWalletAddress = normalizedAddress;
            localStorage.setItem('artsoul_wallet', normalizedAddress);
            updateNavButtons({ address: normalizedAddress, chainId: normalizedChainId });
            updateNetworkBadge({ address: normalizedAddress, chainId: normalizedChainId });
            dispatchWalletStateChanged({
                address: normalizedAddress,
                chainId: normalizedChainId,
                isConnected: true
            });
        };

        const clearStaleWalletState = async () => {
            const restoredWalletState = await reconcileActiveWalletFromProviders('wallet hydration timeout');
            if (restoredWalletState?.isConnected && restoredWalletState.address) {
                finishWalletHydration();
                return;
            }

            // Mobile core path: a live restored session outranks a failed
            // provider read (the relay may not be reopened yet). Confirm from
            // the session record instead of wiping it — chain-independently,
            // since provider.accounts is filtered by the current chainId.
            const coreProvider = getConnectedCoreProvider();
            const coreAddress = getCoreSessionAddress(coreProvider);
            if (coreAddress) {
                applyConfirmedWalletState({
                    address: coreAddress,
                    chainId: parseChainId(coreProvider.chainId)
                });
                return;
            }

            dispatchWalletStateChanged({
                address: null,
                chainId: null,
                isConnected: false
            }, { settled: true });
            finishWalletHydration();
            localStorage.removeItem('artsoul_wallet');
            window.currentWalletAddress = null;
            updateNavButtons(null);
            updateNetworkBadge(null);
        };

        const finishWalletHydration = () => {
            walletHydrationPending = false;
            window.artsoulWalletHydrating = false;
            if (walletHydrationTimer) {
                clearTimeout(walletHydrationTimer);
                walletHydrationTimer = null;
            }
        };

        walletHydrationTimer = setTimeout(() => {
            if (!walletHydrationPending) return;
            // Mobile core path: the persisted-session restore is the source of
            // truth. While it is still running (slow network, retry), do not
            // wipe the stored wallet — its completion handler settles the
            // state either way, and it is bounded by its own attempt caps.
            if (coreSessionRestoreCompletion && !coreSessionRestoreSettled) {
                void coreSessionRestoreCompletion.then(() => {
                    if (walletHydrationPending) clearStaleWalletState();
                });
                return;
            }
            clearStaleWalletState();
        }, WALLET_HYDRATION_TIMEOUT);

        // Independent hard fail-open. This does NOT await any provider reconcile
        // (which is what can stall the 8s path), and it does NOT clear hydration
        // — it only guarantees the UI settles so "Restoring wallet..." can never
        // persist. Desktop guests reach Connect Wallet quickly; an in-flight
        // connect or a wallet that settles later still updates the UI normally.
        setTimeout(() => {
            if (window.artsoulWalletStateSettled === true) return;
            // A connect is actively running (its own flow will settle the UI).
            if (activeMobileConnect || Date.now() < connectModalIntentUntil) return;
            // Mobile core path: the persisted-session restore is still in
            // flight — it settles the UI itself (connected or guest) and is
            // bounded by its own attempt caps, so failing open to guest here
            // would flash "Connect Wallet" over a live session on every page
            // load. Desktop never sets coreSessionRestoreTask and keeps the
            // exact fail-open behavior below.
            if (coreSessionRestoreTask && !coreSessionRestoreSettled) {
                walletDebugLog('fail-open deferred to core session restore', {});
                return;
            }
            try {
                // Injected (extension) truth first, then a live AppKit account
                // snapshot, so a genuinely-connected desktop user is never shown
                // guest by the fail-open.
                const providerState = getProviderWalletState();
                if (providerState?.isConnected && providerState.address) {
                    applyConfirmedWalletState(providerState);
                    return;
                }
                const snapshot = readAppKitAccountSnapshot();
                const snapshotAddress = normalizeWalletAddress(
                    snapshot?.address || snapshot?.allAccounts?.[0]?.address
                );
                const snapshotConnected = Boolean(snapshotAddress) &&
                    snapshot?.isConnected !== false &&
                    snapshot?.status !== 'disconnected';
                if (snapshotConnected) {
                    applyConfirmedWalletState({
                        address: snapshotAddress,
                        chainId: getStateChainId(snapshot)
                    });
                    return;
                }
            } catch (error) {
                walletDebugLog('fail-open provider check failed', describeWalletDebugError(error));
            }
            walletDebugLog('wallet state fail-open to guest', {
                storedWalletAtBoot: Boolean(storedWalletAtBoot)
            });
            dispatchWalletStateChanged({
                address: null,
                chainId: null,
                isConnected: false
            }, { settled: true });
            updateNavButtons(null);
        }, WALLET_SETTLE_FAILOPEN_TIMEOUT);

        // Create Wagmi adapter for better browser extension support
        wagmiAdapter = new WagmiAdapter({
            networks,
            projectId,
            customRpcUrls
        });

        const getThemeValue = (variableName, fallback) => {
            try {
                return getComputedStyle(document.documentElement).getPropertyValue(variableName).trim() || fallback;
            } catch {
                return fallback;
            }
        };
        const activeTheme = localStorage.getItem('artsoul_theme') === 'future' ? 'future' : 'classic';
        const fallbackAccent = getThemeValue(activeTheme === 'future' ? '--accent-future' : '--accent-classic', 'currentColor');
        const fallbackAccentMix = getThemeValue(activeTheme === 'future' ? '--neon-purple' : '--accent-classic', fallbackAccent);
        const config = {
            adapters: [wagmiAdapter],
            networks,
            defaultNetwork: baseSepolia,
            metadata,
            projectId,
            customRpcUrls,
            allowUnsupportedChain: true,
            enableNetworkSwitch: false,
            universalProviderConfigOverride: {
                events: { eip155: ['chainChanged', 'accountsChanged'] },
                rpcMap: { [BASE_SEPOLIA_CAIP_ID]: BASE_SEPOLIA_RPC_URL }
            },
            themeMode: 'dark',
            themeVariables: {
                '--w3m-accent': getThemeValue('--c-accent', fallbackAccent),
                '--w3m-color-mix': getThemeValue('--c-accent-2', fallbackAccentMix)
            },
            // Mobile wallet configuration
            enableWalletConnect: true,
            enableInjected: true,
            enableCoinbase: true,
            // Support both Base Account and legacy Coinbase EOA users. Do not
            // force the legacy-only connector path.
            coinbasePreference: 'all',
            enableEIP6963: true,
            enableAuthMode: false,
            allWallets: 'SHOW',
            debug: walletDebugEnabled(),
            features: {
                email: false,
                socials: []
            },
            // Prioritize these wallets without creating an allowlist. Every
            // other WalletGuide wallet remains available under All Wallets.
            featuredWalletIds: [
                FEATURED_WALLETS.base,
                FEATURED_WALLETS.metamask,
                FEATURED_WALLETS.rabby
            ]
        };

        console.log(' Using WagmiAdapter for browser extensions');

        modal = createAppKit(config);
        // Every page and contracts-integration reads the signing provider via
        // web3Modal.getWalletProvider(). When the core WalletConnect session
        // is active (mobile external browser), that call must return the core
        // provider so the whole site sees the connection exactly as today.
        const appKitGetWalletProvider = typeof modal.getWalletProvider === 'function'
            ? modal.getWalletProvider.bind(modal)
            : null;
        modal.getWalletProvider = async (...args) => {
            const coreProvider = getConnectedCoreProvider();
            if (coreProvider) return coreProvider;
            return appKitGetWalletProvider ? appKitGetWalletProvider(...args) : null;
        };
        window.web3Modal = modal;
        walletDebugLog('appkit modal created', { origin: appOrigin });
        void bindConfiguredWalletConnectDiagnostics();
        if (typeof modal.subscribeEvents === 'function') {
            modal.subscribeEvents(handleAppKitEvent);
        } else {
            walletDebugLog('AppKit event subscription unavailable');
        }

        // Core WalletConnect sessions persist in WalletConnect storage.
        // Restore them on load without a new pairing so a live mobile session
        // survives page reloads and navigation exactly like an injected
        // provider does. The completion promise is what the fail-open timer,
        // the hydration timer and protected actions wait on.
        if (coreSessionRestoreTask) {
            coreSessionRestoreCompletion = coreSessionRestoreTask.then((outcome) => {
                const restored = outcome.session;
                if (restored?.address) {
                    // Bind the session provider even if a fresh connect already
                    // confirmed an address, so transient relay drops on this
                    // provider stay classified instead of wiping state.
                    bindRuntimeProviderEvents(restored.provider, 'core walletconnect restore');
                    bindWalletConnectDiagnostics(restored.provider, 'core walletconnect restore');
                    bindCoreProviderDisconnect(restored.provider);
                    if (window.currentWalletAddress) return;
                    activeWalletProvider = restored.provider;
                    applyConfirmedWalletState({
                        address: restored.address,
                        chainId: restored.chainId
                    });
                    walletDebugLog('core session restored on boot', {
                        address: maskWalletAddress(restored.address),
                        chainId: restored.chainId
                    });
                    return;
                }

                if (window.currentWalletAddress) return;
                // Only a clean "no session in storage" proves the wallet is
                // disconnected; a restore error keeps the stored wallet hint so
                // the next page load renders optimistically and retries.
                if (outcome.status === 'none') {
                    localStorage.removeItem('artsoul_wallet');
                }
                if (walletHydrationPending) {
                    // The settled guest dispatch re-renders the header via the
                    // wallet-state-changed listener. A null nav-buttons update
                    // is deliberately NOT issued here: it would also erase the
                    // stored wallet hint, which must survive a restore *error*.
                    dispatchWalletStateChanged({
                        address: null,
                        chainId: null,
                        isConnected: false
                    }, { settled: true });
                    finishWalletHydration();
                }
            }).catch((error) => {
                walletDebugLog('core session boot restore failed', describeWalletDebugError(error));
            }).finally(() => {
                coreSessionRestoreSettled = true;
            });
        }

        // Accept only synchronous provider truth here. AppKit's cached account can
        // still point at the account that originally opened the connector.
        const initialWalletState = storedWalletAtBoot ? null : getProviderWalletState();
        if (initialWalletState?.isConnected) {
            applyConfirmedWalletState(initialWalletState);
        } else if (initialWalletState && !initialWalletState.isConnected) {
            console.log('Deferring initial disconnected account state during wallet hydration');
        }

        // Subscribe to account changes with detailed logging
        modal.subscribeAccount(async (account) => {
            latestAppKitAccountSnapshot = account || null;
            appKitAccountRevision++;
            const observedAddress = normalizeWalletAddress(account?.address || account?.allAccounts?.[0]?.address);
            const observedChainId = normalizeChainId(account);
            const observedConnected = Boolean(observedAddress) &&
                account?.isConnected !== false &&
                account?.status !== 'disconnected';
            const observedAccountKey = `${observedAddress || 'guest'}:${observedChainId || 'none'}:${observedConnected ? 'connected' : 'disconnected'}`;

            const isFreshMobileConnectEvent = activeMobileConnect && appKitAccountRevision > mobileConnectStartRevision;
            if (observedAccountKey === lastObservedAppKitAccountKey && !isFreshMobileConnectEvent) return;
            lastObservedAppKitAccountKey = observedAccountKey;

            walletDebugLog('appkit account update', {
                address: maskWalletAddress(observedAddress),
                status: account?.status || 'undefined',
                chainId: account?.chainId || null,
                caipAddress: account?.caipAddress || null,
                selectedNetworkId: account?.selectedNetworkId || null,
                resolvedChainId: getStateChainId(account),
                isConnected: account?.isConnected,
                revision: appKitAccountRevision,
                snapshot: getWalletDebugSnapshot(account)
            });

            // AppKit can emit transient disconnected while restoring a saved wallet.
            if (!observedAddress && walletHydrationPending) {
                console.log('Skipping transient disconnected state during wallet hydration');
                return;
            }

            if (!observedAddress) {
                // Mobile core path: AppKit has no connection to report — the
                // persisted WalletConnect session is the authority. Its own
                // classifier (handleCoreProviderDisconnect / session_delete)
                // ends it; an AppKit empty-account event landing after the
                // POST_CONNECT_DISCONNECT_GUARD window must never wipe a live
                // core session.
                if (isCoreSessionActive() || (coreSessionRestoreCompletion && !coreSessionRestoreSettled)) {
                    walletDebugLog('appkit empty account ignored; core session is authoritative', {
                        restoreSettled: coreSessionRestoreSettled
                    });
                    return;
                }
                const connectIntentActive = activeMobileConnect || Date.now() < connectModalIntentUntil;
                if (connectIntentActive) {
                    console.log('Skipping transient disconnected state during wallet hydration');
                    return;
                }

                const explicitDisconnectInProgress = sessionStorage.getItem('artsoul_disconnecting');
                const recentlyConfirmed = Date.now() - lastConfirmedWalletAt < POST_CONNECT_DISCONNECT_GUARD;
                if (lastProcessedAddress && !explicitDisconnectInProgress && recentlyConfirmed) {
                    console.log('Skipping transient empty account after confirmed wallet');
                    return;
                }

                if (!lastProcessedAddress && window.artsoulWalletStateSettled) {
                    return;
                }

                console.log('Initial disconnected account state');
                localStorage.removeItem('artsoul_wallet');
                window.currentWalletAddress = null;
                updateNavButtons(null);
                dispatchWalletStateChanged({
                    address: null,
                    chainId: null,
                    isConnected: false
                });
                return;
            }

            // AppKit frequently emits address changes with a missing/transient
            // status (especially on mobile after returning from the wallet app,
            // and on desktop account switches). Process the update whenever an
            // address is present and the account is not explicitly disconnected,
            // rather than waiting for status === 'connected' which can leave the
            // UI stale until a manual refresh.
            const accountIsConnected = Boolean(observedAddress) &&
                account?.isConnected !== false &&
                account?.status !== 'disconnected';

            if (accountIsConnected) {
                // External mobile browsers can suspend provider requests during
                // the wallet-app round trip. Finalize only after the provider
                // confirms both the address and Base Sepolia.
                if (activeMobileConnect && !isInjectedWalletBrowser()) {
                    const restored = await acceptMobileAppKitWalletState(
                        account,
                        'AppKit account update',
                        activeConnectAttempt
                    );
                    if (restored?.address) return;
                    if (activeConnectAttempt?.failure) return;
                    walletDebugLog('AppKit account waiting for approved mobile session', {
                        snapshot: getWalletDebugSnapshot(account)
                    });
                    return;
                }

                const eventAddress = observedAddress;
                const eventChainId = normalizeChainId(account);
                if (
                    eventAddress &&
                    eventAddress === lastProcessedAddress &&
                    (!eventChainId || !lastProcessedChainId || eventChainId === lastProcessedChainId)
                ) {
                    finishWalletHydration();
                    return;
                }

                // Prevent duplicate processing
                const provider = await getAppKitWalletProvider();
                const providerAccounts = await requestProviderAccounts(provider);
                const normalizedAddress = providerAccounts[0] || observedAddress;
                const providerChainId = await getProviderTruthChainId(provider);
                const normalizedChainId = setCurrentChainId(providerChainId || account);
                finishWalletHydration();
                if (lastProcessedAddress === normalizedAddress && lastProcessedChainId === normalizedChainId) {
                    console.log('⏭️ Skipping duplicate address');
                    return;
                }

                // Active address changed under us → drop any session tied to the
                // previous address before adopting the new one.
                await signOutMismatchedSession(normalizedAddress);

                lastProcessedAddress = normalizedAddress;
                lastProcessedChainId = normalizedChainId;
                lastConfirmedWalletAt = Date.now();
                if (provider) activeWalletProvider = provider;

                window.currentWalletAddress = normalizedAddress;
                localStorage.setItem('artsoul_wallet', normalizedAddress);

                // Update UI first
                updateNavButtons({ address: normalizedAddress, chainId: normalizedChainId });
                updateNetworkBadge({ address: normalizedAddress, chainId: normalizedChainId });
                dispatchWalletStateChanged({
                    address: normalizedAddress,
                    chainId: normalizedChainId,
                    isConnected: true
                });

                // Authentication is intentionally lazy.
                // Browsing stays guest-friendly; signatures are requested only for write actions.
                console.log('Wallet connected. Authentication deferred until a protected action.');
                if (normalizedChainId) {
                    closeNetworkModalAfterConfirmedChain(normalizedChainId);
                }

                // On mobile the connect modal can hang on an eternal loading
                // spinner after the user approves in the wallet app. The account
                // is connected by this point, so dismiss the modal explicitly.
                clearModalIntent();
                safeCloseModal('wallet connected');
                scheduleModalCloseRetries('wallet connected');
                walletDebugLog('wallet connected via appkit', {
                    address: maskWalletAddress(normalizedAddress),
                    chainId: normalizedChainId
                });

            } else if (account?.status === 'disconnected' && lastProcessedAddress) {
                // Same authority rule as the empty-account branch above: a live
                // core session outranks AppKit's own "disconnected" status.
                if (isCoreSessionActive() || (coreSessionRestoreCompletion && !coreSessionRestoreSettled)) {
                    walletDebugLog('appkit disconnected status ignored; core session is authoritative', {
                        restoreSettled: coreSessionRestoreSettled
                    });
                    return;
                }
                const explicitDisconnectInProgress = sessionStorage.getItem('artsoul_disconnecting');
                const recentlyConfirmed = Date.now() - lastConfirmedWalletAt < POST_CONNECT_DISCONNECT_GUARD;
                if (!explicitDisconnectInProgress && recentlyConfirmed) {
                    console.log('Skipping transient disconnected state after confirmed wallet');
                    return;
                }

                finishWalletHydration();
                console.log(' Wallet disconnected (was connected before)');
                lastProcessedAddress = null;
                lastProcessedChainId = null;
                activeWalletProvider = null;
                window.currentWalletAddress = null;

                // Clear all authentication data
                localStorage.removeItem('artsoul_wallet');
                localStorage.removeItem('artsoul_first_time');

                // Sign out from Supabase
                try {
                    if (window.SupabaseAuth) {
                        await window.SupabaseAuth.signOut();
                        console.log('Signed out from Supabase');
                    }
                } catch (error) {
                    console.error('Supabase signout failed:', error);
                }

                // Clear Supabase session from localStorage
                try {
                    const keys = Object.keys(localStorage);
                    keys.forEach(key => {
                        if (key.startsWith('sb-') || key.includes('supabase')) {
                            localStorage.removeItem(key);
                        }
                    });
                } catch (error) {
                    console.error('Failed to clear Supabase storage:', error);
                }

                // Update UI
                updateNavButtons(null);
                updateNetworkBadge(null);
                dispatchWalletStateChanged({
                    address: null,
                    chainId: null,
                    isConnected: false
                });

                if (window.location.pathname.includes('profile.html')) {
                    console.log('Profile wallet disconnected; staying in guest profile mode.');
                    return;
                }

                // Redirect to home if on profile page
                if (window.location.pathname.includes('profile.html')) {
                    console.log('🏠 Redirecting to home page...');
                    window.location.href = 'index.html';
                }
            }
        });

        // Subscribe to selected network requests, but confirm with provider chain before updating UI.
        let lastSelectedNetwork = parseChainId(modal.getState?.()?.selectedNetworkId);
        let hasSeenNetworkState = Boolean(lastSelectedNetwork);

        modal.subscribeState((state) => {
            const selectedChainId = parseChainId(state?.selectedNetworkId);
            const modalOpen = Boolean(state?.open || modal.getState?.()?.open);
            const modalView = String(state?.view || state?.openModalView || state?.selectedView || '').toLowerCase();
            const debugStateKey = `${modalOpen}:${modalView}:${selectedChainId || 'none'}`;
            if (debugStateKey !== lastWalletDebugModalStateKey) {
                lastWalletDebugModalStateKey = debugStateKey;
                walletDebugLog('appkit modal state', {
                    open: modalOpen,
                    view: modalView || null,
                    selectedNetworkId: selectedChainId,
                    snapshot: getWalletDebugSnapshot()
                });
            }
            const looksLikeNetworkModal = Boolean(selectedChainId || modalView.includes('network'));
            const hasUserIntent = hasNetworkModalIntent();

            if (modalOpen && !hasUserIntent && looksLikeNetworkModal) {
                if (selectedChainId) lastSelectedNetwork = selectedChainId;
                if (getSupportedNetworkTarget(selectedChainId)) {
                    console.log('Ignoring network modal state without user intent');
                }
                safeCloseModal('network modal without user intent');
                return;
            }

            if (!selectedChainId) return;

            if (!hasSeenNetworkState) {
                hasSeenNetworkState = true;
                lastSelectedNetwork = selectedChainId;
                return;
            }

            if (!hasUserIntent) {
                lastSelectedNetwork = selectedChainId;
                return;
            }

            if (selectedChainId === lastSelectedNetwork) return;
            lastSelectedNetwork = selectedChainId;
            if (!getSupportedNetworkTarget(selectedChainId)) return;
            if (!modalOpen) return;

            console.log(' Network selection requested:', selectedChainId);
            window.switchArtSoulNetwork?.(selectedChainId);
        });

            if (modal.subscribeProvider) {
                modal.subscribeProvider((providerState) => {
                    const provider = providerState?.walletProvider || providerState?.provider || providerState;
                    walletDebugLog('appkit provider update', {
                        providerAvailable: Boolean(provider?.request),
                        chainId: providerState?.chainId || providerState?.provider?.chainId || provider?.chainId || null,
                        snapshot: getWalletDebugSnapshot()
                    });
                    bindRuntimeProviderEvents(provider, 'appkit provider subscription');
                    bindWalletConnectDiagnostics(provider, 'appkit provider subscription');
                if (provider?.request) {
                    activeWalletProvider = provider;
                    scheduleWalletReconciliation('appkit provider available');
                }

                const providerChainId = parseChainId(
                    providerState?.chainId ||
                    providerState?.provider?.chainId ||
                    provider?.chainId ||
                    provider?.networkVersion
                );
                if (providerChainId) {
                    handleProviderChainConfirmed(providerChainId, 'appkit provider subscription');
                }
            });
        }

        bindRuntimeProviderEvents(window.ethereum, 'injected provider');
        bindWalletResumeListeners();

        const restoredProviderState = await reconcileActiveWalletFromProviders('appkit boot', {
            allowInjectedFallback: !storedWalletAtBoot
        });
        if (restoredProviderState?.address) {
            finishWalletHydration();
        } else if (!walletHydrationPending) {
            await clearStaleWalletState();
        } else {
            scheduleWalletReconciliation('delayed appkit hydration', 600, {
                allowInjectedFallback: false
            });
        }

        console.log('AppKit initialized');
    } catch (error) {
        console.error('AppKit init failed:', error);
        dispatchWalletStateChanged({
            address: null,
            chainId: null,
            isConnected: false
        }, { settled: true });
        updateNavButtons(null);
    }
}

// ============================================
// AUTO-INITIALIZE
// ============================================

async function handleSupabaseOAuthOnBoot() {
    if (!window.SupabaseAuth) return;

    const oauthResult = await window.SupabaseAuth.handleOAuthCallback();
    if (!oauthResult) return;

    console.log('OAuth callback handled:', oauthResult.provider);
    // OAuth profile metadata is identity context, not provider truth. The active
    // wallet is restored independently from the connected EIP-1193 provider.
}

function bootAppKit() {
    if (window.__artsoulAppKitBootPromise) return window.__artsoulAppKitBootPromise;

    window.__artsoulAppKitBootPromise = (async () => {
        try {
            await handleSupabaseOAuthOnBoot();
        } catch (error) {
            console.warn('OAuth bootstrap unavailable; continuing with wallet initialization:', error);
            walletDebugLog('OAuth bootstrap skipped', { message: error?.message || String(error) });
        }
        await initializeAppKit();
    })();

    return window.__artsoulAppKitBootPromise;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootAppKit);
} else {
    bootAppKit();
}

console.log('📦 AppKit module loaded');
