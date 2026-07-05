// ============================================
// APPKIT INITIALIZATION MODULE
// Centralized Web3 wallet connection for ArtSoul
// ============================================

import { createAppKit } from 'https://esm.sh/@reown/appkit@1.7.11?bundle'
import { WagmiAdapter } from 'https://esm.sh/@reown/appkit-adapter-wagmi@1.7.11?bundle'
import { mainnet, base, sepolia, baseSepolia } from 'https://esm.sh/@reown/appkit/networks?bundle'

// ============================================
// CONFIGURATION
// ============================================

const projectId = 'f3a4411a5d6201d00fd86817d41b64e8';

// Custom Rialo network
const rialoPlayground = {
    id: 2025,
    name: 'Rialo',
    nativeCurrency: { name: 'RIA', symbol: 'RIA', decimals: 18 },
    rpcUrls: { default: { http: ['https://playground.rialo.io/rpc'] } },
    blockExplorers: { default: { name: 'Rialo Explorer', url: 'https://playground.rialo.io' } },
    testnet: true
};

// TESTNETS ONLY (for now)
// To enable mainnets: uncomment mainnet and base in the array below
const networks = [
    baseSepolia,          // Base testnet (default)
    // Ethereum Sepolia remains in SUPPORTED_NETWORKS for future activation,
    // but is intentionally omitted from selectable AppKit networks for now.
    // rialoPlayground,   // Future target: keep hidden until ArtSoul contracts support it
    // base,              // Base mainnet (uncomment when ready for production)
    // mainnet            // Ethereum mainnet (uncomment when ready for production)
];

const SUPPORTED_NETWORKS = {
    84532: {
        appKitNetwork: baseSepolia,
        chainId: 84532,
        hexChainId: '0x14a34',
        chainName: 'Base Sepolia',
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: ['https://sepolia.base.org'],
        blockExplorerUrls: ['https://sepolia.basescan.org']
    },
    11155111: {
        appKitNetwork: sepolia,
        chainId: 11155111,
        hexChainId: '0xaa36a7',
        chainName: 'Ethereum Sepolia',
        nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'],
        blockExplorerUrls: ['https://sepolia.etherscan.io']
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
    // Testnets
    84532: { name: 'Base Sepolia', currency: 'ETH' },
    11155111: { name: 'Ethereum Sepolia', currency: 'ETH' },
    2025: { name: 'Rialo', currency: 'RIA' },
    // Mainnets (for future use)
    8453: { name: 'Base', currency: 'ETH' },
    1: { name: 'Ethereum', currency: 'ETH' }
};

// ============================================
// STATE
// ============================================

let modal = null;
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
const POST_CONNECT_DISCONNECT_GUARD = 1200;
const WALLET_CONNECT_TIMEOUT_DESKTOP = 45000;
const WALLET_CONNECT_TIMEOUT_MOBILE = 240000;
const WALLET_CONFIRMATION_INTERVAL = 400;
const BASE_SEPOLIA_CHAIN_ID = 84532;
const MOBILE_PROVIDER_REQUEST_TIMEOUT = 2500;
const MOBILE_NETWORK_SWITCH_TIMEOUT = 120000;
const NETWORK_CONFIRMATION_TIMEOUT = 10000;
const NETWORK_CONFIRMATION_INTERVAL = 300;
const NETWORK_MODAL_INTENT_WINDOW = 120000;
const MODAL_CLOSE_RETRY_DELAY = 400;
let lastDispatchedWalletStateKey = null;
let lastAcceptedMobileAccountKey = null;
let lastObservedAppKitAccountKey = null;
let modalClosePromise = null;
let modalCloseRetryTimer = null;
let mobileSessionFinalizePromise = null;
let mobileSessionFinalizeKey = '';
let activeConnectAttempt = null;
let connectAttemptSequence = 0;
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
    window.addEventListener('online', () => snapshot('browser online'));
    window.addEventListener('offline', () => snapshot('browser offline'));
    walletDebugLog('debug environment', {
        origin: window.location.origin,
        path: window.location.pathname,
        appKitVersion: '1.7.11',
        expectedChainId: BASE_SEPOLIA_CHAIN_ID,
        metadataUrl: appOrigin,
        projectIdPresent: Boolean(projectId),
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
        }
    };
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

async function waitForMobileBaseSepolia(provider, switchOutcome, attempt, requireProviderChain = false) {
    const deadline = createForegroundDeadline(MOBILE_NETWORK_SWITCH_TIMEOUT);
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

async function ensureExternalMobileBaseSepolia(walletState, source, attempt) {
    const provider = await getAppKitWalletProviderWithin(MOBILE_PROVIDER_REQUEST_TIMEOUT);
    if (attempt?.cancelled) return null;

    if (provider) {
        activeWalletProvider = provider;
        bindRuntimeProviderEvents(provider, 'external mobile WalletConnect provider');
    }

    const providerChainId = await readMobileProviderChainId(provider);
    const appKitChainId = getStateChainId(walletState.account);
    const currentChainId = providerChainId || appKitChainId;
    walletDebugLog('external mobile session chain resolved', {
        source,
        providerAvailable: Boolean(provider),
        providerChainId,
        appKitChainId,
        currentChainId
    });

    if (currentChainId === BASE_SEPOLIA_CHAIN_ID) {
        return { ...walletState, chainId: BASE_SEPOLIA_CHAIN_ID, provider };
    }
    if (attempt?.networkSwitchRequested) return null;
    if (attempt) attempt.networkSwitchRequested = true;

    const target = getSupportedNetworkTarget(BASE_SEPOLIA_CHAIN_ID);
    walletDebugLog('external mobile Base Sepolia switch requested', {
        source,
        fromChainId: currentChainId,
        toChainId: BASE_SEPOLIA_CHAIN_ID,
        via: provider?.request ? 'wallet provider' : 'AppKit'
    });

    const switchOutcome = Promise.resolve()
        .then(() => {
            if (provider?.request) return switchEthereumChain(provider, target);
            if (window.web3Modal?.switchNetwork) return window.web3Modal.switchNetwork(target.appKitNetwork);
            throw new Error('Wallet provider is not ready for a network switch.');
        })
        .then(() => ({ complete: true }))
        .catch((error) => ({ error }));

    const confirmedChainId = await waitForMobileBaseSepolia(
        provider,
        switchOutcome,
        attempt,
        Boolean(providerChainId)
    );
    if (confirmedChainId !== BASE_SEPOLIA_CHAIN_ID) {
        walletDebugLog('external mobile Base Sepolia switch not confirmed', {
            source,
            cancelled: Boolean(attempt?.cancelled)
        });
        return null;
    }

    walletDebugLog('external mobile Base Sepolia confirmed', { source });
    return { ...walletState, chainId: BASE_SEPOLIA_CHAIN_ID, provider };
}

async function requestMobileBaseSepoliaAfterConnect(walletState, source, attempt) {
    if (walletState.chainId === BASE_SEPOLIA_CHAIN_ID || attempt?.cancelled) return walletState;

    while (document.visibilityState !== 'visible' && !attempt?.cancelled) {
        await waitForWalletResumeOrDelay(WALLET_CONFIRMATION_INTERVAL);
    }
    if (attempt?.cancelled || document.visibilityState !== 'visible') return null;

    // Let the approved WalletConnect session close the connect modal and render
    // first. A network switch is a separate wallet request and must never keep
    // the Connect button or AppKit modal in a pending state.
    await sleep(250);
    const confirmed = await ensureExternalMobileBaseSepolia(walletState, source, attempt);
    if (!confirmed || attempt?.cancelled) return null;

    const { address, chainId, provider } = confirmed;
    if (provider) activeWalletProvider = provider;
    lastProcessedChainId = chainId;
    setCurrentChainId(chainId);
    dispatchWalletStateChanged({ address, chainId, isConnected: true });
    updateNavButtons({ address, chainId });
    updateNetworkBadge({ address, chainId });
    walletDebugLog('mobile network finalized after connected UI', {
        source,
        address: maskWalletAddress(address),
        chainId
    });
    return confirmed;
}

async function acceptMobileAppKitWalletState(account, source = 'mobile AppKit session', attempt = activeConnectAttempt) {
    const walletState = getFreshMobileAppKitWalletState(account, attempt);
    if (!walletState || attempt?.cancelled) return null;

    const initialKey = `${walletState.address}:${walletState.chainId || 'none'}:${appKitAccountRevision}`;
    if (mobileSessionFinalizePromise && mobileSessionFinalizeKey === initialKey) {
        return mobileSessionFinalizePromise;
    }

    mobileSessionFinalizeKey = initialKey;
    mobileSessionFinalizePromise = (async () => {
        const provider = await getAppKitWalletProviderWithin(MOBILE_PROVIDER_REQUEST_TIMEOUT);
        if (attempt?.cancelled) return null;
        if (provider) {
            activeWalletProvider = provider;
            bindRuntimeProviderEvents(provider, 'external mobile WalletConnect provider');
        }

        const providerChainId = await readMobileProviderChainId(provider);
        const appKitChainId = getStateChainId(walletState.account);
        const chainId = providerChainId || appKitChainId || null;
        const acceptedState = { ...walletState, chainId, provider };
        const { address } = acceptedState;
        const accountKey = `${address}:${chainId || 'pending'}`;
        if (accountKey === lastAcceptedMobileAccountKey) return acceptedState;
        lastAcceptedMobileAccountKey = accountKey;
        lastProcessedAddress = address;
        lastProcessedChainId = chainId;
        lastConfirmedWalletAt = Date.now();
        if (provider) activeWalletProvider = provider;
        window.currentWalletAddress = address;
        localStorage.setItem('artsoul_wallet', address);
        if (chainId) setCurrentChainId(chainId);
        else setCurrentChainId(null);

        // The approved WalletConnect address is enough to finish Connect. Chain
        // confirmation/switching is handled as a second, non-blocking step so a
        // mobile deep-link round trip cannot leave the UI on an eternal spinner.
        dispatchWalletStateChanged({ address, chainId, isConnected: true });
        updateNavButtons({ address, chainId });
        updateNetworkBadge({ address, chainId });

        Promise.resolve(signOutMismatchedSession(address)).catch((error) => {
            console.warn('Stale session cleanup after mobile connect failed:', error);
        });

        clearModalIntent();
        safeCloseModal('mobile wallet connected');
        scheduleModalCloseRetries('mobile wallet connected');
        walletDebugLog('mobile wallet accepted before network finalization', {
            source,
            address: maskWalletAddress(address),
            chainId
        });

        void requestMobileBaseSepoliaAfterConnect(acceptedState, source, attempt).catch((error) => {
            walletDebugLog('mobile network finalization failed after connect', {
                source,
                message: error?.message || String(error)
            });
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

function scheduleWalletReconciliation(source, delay = 150, options = {}) {
    if (walletResumeTimer) clearTimeout(walletResumeTimer);
    walletResumeTimer = setTimeout(async () => {
        walletResumeTimer = null;
        walletDebugLog('wallet state reconciliation', {
            source,
            snapshot: getWalletDebugSnapshot()
        });
        if (activeMobileConnect && !isInjectedWalletBrowser()) {
            await reconcileMobileAppKitSession(source, activeConnectAttempt);
            return;
        }
        await reconcileActiveWalletFromProviders(source, options);
    }, delay);
}

function notifyWalletResume(source) {
    walletDebugLog('browser resume signal', {
        source,
        snapshot: getWalletDebugSnapshot()
    });
    const waiters = [...walletResumeWaiters];
    walletResumeWaiters.clear();
    waiters.forEach((resolve) => resolve(source));
    scheduleWalletReconciliation(source, 0);
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
    document.addEventListener('visibilitychange', () => {
        walletDebugLog('visibility changed', {
            state: document.visibilityState,
            snapshot: getWalletDebugSnapshot()
        });
        if (document.visibilityState === 'visible') {
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

    try {
        while (!deadline.hasExpired() && !attempt?.cancelled && !attempt?.failure) {
            if (document.visibilityState !== 'visible') {
                await waitForWalletResumeOrDelay(WALLET_CONFIRMATION_INTERVAL);
                continue;
            }

            const snapshot = getWalletDebugSnapshot();
            const snapshotKey = JSON.stringify(snapshot);
            if (snapshotKey !== lastSnapshotKey) {
                lastSnapshotKey = snapshotKey;
                walletDebugLog('mobile confirmation state', {
                    remainingMs: deadline.remaining(),
                    snapshot
                });
            }

            const restored = await reconcileMobileAppKitSession('mobile connect confirmation', attempt);
            if (restored?.address) return restored;

            await waitForWalletResumeOrDelay(WALLET_CONFIRMATION_INTERVAL);
        }

        // Approval and the browser visibility event can arrive in either order.
        // Re-check provider/session truth once more before presenting a timeout.
        const restored = attempt?.cancelled
            ? null
            : await reconcileMobileAppKitSession('mobile connect final confirmation', attempt);
        if (restored?.address) return restored;

        walletDebugLog('mobile wallet confirmation expired', {
            foregroundTimeoutMs: timeoutMs,
            remainingMs: deadline.remaining(),
            cancelled: Boolean(attempt?.cancelled),
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

    [localStorage, sessionStorage].forEach((storage) => {
        Object.keys(storage)
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

/**
 * Safe wallet connection with error handling
 * Prevents duplicate connection attempts
 */
window.safeConnectWallet = async () => {
    const mobileConnect = isMobileDevice();
    const injectedMobileConnect = mobileConnect && isInjectedWalletBrowser();
    const externalMobileConnect = mobileConnect && !injectedMobileConnect;

    if (externalMobileConnect && activeConnectAttempt && !activeConnectAttempt.cancelled) {
        walletDebugLog('connect button retry requested', {
            cancelledAttemptId: activeConnectAttempt.id,
            snapshot: getWalletDebugSnapshot()
        });
        activeConnectAttempt.cancelled = true;
        notifyWalletResume('connect retry');
        void safeCloseModal('mobile connect retry', { silent: true });
    }

    const attempt = {
        id: ++connectAttemptSequence,
        cancelled: false,
        externalMobile: externalMobileConnect,
        allowExistingSession: externalMobileConnect,
        startedAt: Date.now()
    };
    activeConnectAttempt = attempt;
    setConnectButtonPending(true, { retryable: externalMobileConnect });
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
            await handleProviderAccountsChanged(accounts, 'mobile injected provider', window.ethereum);
            const chainId = await requestProviderChainId(window.ethereum);
            if (chainId) await handleProviderChainConfirmed(chainId, 'mobile injected provider');
            clearModalIntent();
            const connectedAddress = normalizeWalletAddress(Array.isArray(accounts) ? accounts[0] : accounts);
            walletDebugLog('mobile injected connect complete', {
                address: maskWalletAddress(connectedAddress)
            });
            return connectedAddress || null;
        }

        if (window.web3Modal) {
            walletDebugLog('walletconnect/appkit modal open requested', { mobile: isMobileDevice() });
            let modalOpenError = null;
            Promise.resolve(window.web3Modal.open())
                .then(() => {
                    walletDebugLog('walletconnect/appkit modal open resolved', {
                        snapshot: getWalletDebugSnapshot()
                    });
                })
                .catch((error) => {
                    modalOpenError = error;
                    walletDebugLog('walletconnect/appkit modal open failed', {
                        code: getWalletErrorCode(error),
                        message: error?.message || String(error)
                    });
                });

            walletDebugLog('waiting for wallet confirmation', { mobile: mobileConnect });
            const confirmed = await waitForConfirmedWallet(
                mobileConnect ? WALLET_CONNECT_TIMEOUT_MOBILE : WALLET_CONNECT_TIMEOUT_DESKTOP,
                { mobile: mobileConnect, attempt }
            );
            if (attempt.cancelled) return null;
            if (attempt.failure) throw attempt.failure;
            if (modalOpenError) throw modalOpenError;
            if (!confirmed?.address) {
                await safeCloseModal('wallet connect timeout');
                clearModalIntent();
                throw new Error('Wallet connection timed out. Reopen your wallet and try again.');
            }

            clearModalIntent();
            await safeCloseModal('wallet connected');
            walletDebugLog('wallet connection confirmed', {
                address: maskWalletAddress(confirmed.address),
                chainId: confirmed.chainId
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
            return confirmed.address;
        } else {
            alert('Please wait, the app is still loading...');
            return null;
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
        walletDebugLog('wallet connect failed', describeWalletDebugError(err));

        // Handle "previous request still pending" error
        if (err.message?.includes('previous') || err.message?.includes('declined')) {
            await clearWalletConnectionCache();
            updateNavButtons(null);
        }
        alert(err?.message || 'Wallet connection was not completed. Please try again.');
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

        // Fallback AppKit selector contains Base Sepolia only. Ethereum Sepolia
        // remains implemented underneath but cannot be selected from the UI.
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
        alert('Unsupported network. Please choose Base Sepolia or Ethereum Sepolia.');
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
            appKitVersion: '1.7.11',
            metadataUrl: metadata.url,
            redirectUniversal: metadata.redirect?.universal || null,
            defaultNetwork: BASE_SEPOLIA_CHAIN_ID,
            configuredNetworks: networks.map((network) => network.id),
            projectIdPresent: Boolean(projectId)
        });

        const explicitDisconnectRequested = sessionStorage.getItem('artsoul_disconnecting');
        if (explicitDisconnectRequested) {
            await clearWalletConnectionCache();
            sessionStorage.removeItem('artsoul_disconnecting');
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
            clearStaleWalletState();
        }, WALLET_HYDRATION_TIMEOUT);

        // Create Wagmi adapter for better browser extension support
        const wagmiAdapter = new WagmiAdapter({
            networks,
            projectId
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
            themeMode: 'dark',
            themeVariables: {
                '--w3m-accent': getThemeValue('--c-accent', fallbackAccent),
                '--w3m-color-mix': getThemeValue('--c-accent-2', fallbackAccentMix)
            },
            // Mobile wallet configuration
            enableWalletConnect: true,
            enableInjected: true,
            enableCoinbase: true,
            enableEIP6963: true,
            enableAuthMode: false,
            features: {
                email: false,
                socials: []
            },
            // Featured wallets for mobile
            featuredWalletIds: [
                'c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96', // MetaMask
                'fd20dc426fb37566d803205b19bbc1d4096b248ac04548e3cfb6b3a38bd033aa', // Coinbase
                '4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0', // Trust Wallet
                '1ae92b26df02f0abca6304df07debccd18262fdf5fe82daa81593582dac9a369', // Rainbow
                'c03dfee351b6fcc421b4494ea33b9d4b92a984f87aa76d1663bb28705e95034a'  // Uniswap
            ]
        };

        console.log(' Using WagmiAdapter for browser extensions');

        modal = createAppKit(config);
        window.web3Modal = modal;
        walletDebugLog('appkit modal created', { origin: appOrigin });

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
                // the wallet-app round trip. Accept the approved AppKit session
                // first; Base Sepolia confirmation runs as a separate step.
                if (activeMobileConnect && !isInjectedWalletBrowser()) {
                    const restored = await acceptMobileAppKitWalletState(
                        account,
                        'AppKit account update',
                        activeConnectAttempt
                    );
                    if (restored?.address) return;
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
