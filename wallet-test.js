import { createAppKit } from 'https://esm.sh/@reown/appkit@1.8.21?bundle';
import { WagmiAdapter } from 'https://esm.sh/@reown/appkit-adapter-wagmi@1.8.21?bundle';
import { baseSepolia, base, mainnet } from 'https://esm.sh/@reown/appkit@1.8.21/networks?bundle';

// Public Reown project identifier for the verified ArtSoul web project.
const PROJECT_ID = '9fdc97f91c02d46a28ca9d185a9e58f2';
const EXPECTED_CHAIN_ID = 84532;
const BASE_SEPOLIA_CAIP_ID = 'eip155:84532';
const BASE_SEPOLIA_RPC_URL = 'https://sepolia.base.org';
const customRpcUrls = {
    [BASE_SEPOLIA_CAIP_ID]: [{ url: BASE_SEPOLIA_RPC_URL }]
};
const BASE_SEPOLIA_HEX_CHAIN_ID = '0x14a34';
const BASE_SEPOLIA_ADD_CHAIN_PARAMS = {
    chainId: BASE_SEPOLIA_HEX_CHAIN_ID,
    chainName: 'Base Sepolia',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: [BASE_SEPOLIA_RPC_URL],
    blockExplorerUrls: ['https://sepolia.basescan.org']
};
// WalletConnect explorer ids; same registry appkit-init.js uses for featuring.
const FEATURED_WALLET_IDS = [
    'c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96', // MetaMask
    '4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0', // Trust
    'fd20dc426fb37566d803205b19bbc1d4096b248ac04548e3cfb6b3a38bd033aa'  // Coinbase
];
const startedAt = Date.now();
const params = new URLSearchParams(window.location.search);
const layer = params.get('layer') || 'bare';
const variant = params.get('variant') === 'multi' ? 'multi' : 'single';
// Variant D always proposes Base Sepolia only, matching the intended prod config.
const networks = layer === 'appkit-modal' || variant !== 'multi'
    ? [baseSepolia]
    : [baseSepolia, base, mainnet];
const logElement = document.getElementById('walletTestLog');
const statusElement = document.getElementById('walletTestStatus');
const connectButton = document.getElementById('walletTestConnect');
let sequence = 0;
let modal = null;
let adapter = null;
let transportRestartPromise = null;
const diagnosticClients = new WeakSet();
const diagnosticRelayers = new WeakSet();

function maskAddress(value) {
    const address = String(value || '');
    return /^0x[a-f0-9]{40}$/i.test(address)
        ? `${address.slice(0, 6)}...${address.slice(-4)}`
        : address || null;
}

function parseChainId(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const text = String(value);
    const caipMatch = text.match(/^eip155:(\d+)/i);
    if (caipMatch) return Number(caipMatch[1]);
    return text.startsWith('0x') ? parseInt(text, 16) : parseInt(text, 10) || null;
}

function describeError(error) {
    return {
        name: error?.name || 'Error',
        code: error?.code ?? null,
        message: error?.message || String(error),
        stack: String(error?.stack || '').split('\n').slice(0, 4).join(' | ') || null
    };
}

function getWalletConnectClient(provider) {
    return provider?.signer?.client || provider?.client || provider?.provider?.signer?.client || null;
}

function getWalletConnectRelayer(provider) {
    return getWalletConnectClient(provider)?.core?.relayer || null;
}

function summarizeNamespaces(value = {}) {
    if (!value || typeof value !== 'object') return null;
    return Object.fromEntries(Object.entries(value).map(([namespace, config]) => [namespace, {
        chains: Array.isArray(config?.chains) ? config.chains : [],
        methods: Array.isArray(config?.methods) ? config.methods : [],
        events: Array.isArray(config?.events) ? config.events : []
    }]));
}

function relayMethod(message) {
    if (!message) return null;
    if (typeof message === 'object') return message.method || message.params?.request?.method || null;
    try {
        return relayMethod(JSON.parse(message));
    } catch {
        return null;
    }
}

function bindWalletConnectDiagnostics(provider, source = 'isolation provider') {
    if (!provider) return;
    const client = getWalletConnectClient(provider);
    const relayer = getWalletConnectRelayer(provider);
    if (client && !diagnosticClients.has(client)) {
        diagnosticClients.add(client);
        log('WalletConnect provider config', {
            source,
            requiredNamespaces: summarizeNamespaces(provider.namespaces || provider.requiredNamespaces),
            optionalNamespaces: summarizeNamespaces(provider.optionalNamespaces),
            chains: networks.map((network) => network.caipNetworkId || `eip155:${network.id}`)
        });
        const originalConnect = typeof client.connect === 'function' ? client.connect.bind(client) : null;
        if (originalConnect) {
            try {
                client.connect = (proposal = {}) => {
                    log('proposal before publish', {
                        requiredNamespaces: summarizeNamespaces(proposal.requiredNamespaces),
                        optionalNamespaces: summarizeNamespaces(proposal.optionalNamespaces),
                        chains: networks.map((network) => network.caipNetworkId || `eip155:${network.id}`),
                        methods: proposal.methods || null,
                        events: proposal.events || null
                    });
                    return originalConnect(proposal);
                };
            } catch (error) {
                log('proposal hook unavailable', describeError(error));
            }
        }
        [
            'proposal_expire',
            'session_proposal',
            'session_connect',
            'session_settle',
            'session_delete',
            'session_expire',
            'session_event'
        ].forEach((eventName) => client.on?.(eventName, (event) => log(eventName, {
            topic: event?.topic || event?.params?.topic || null,
            method: event?.method || event?.params?.request?.method || null,
            reason: event?.reason || event?.params?.reason || null,
            error: event?.error ? describeError(event.error) : null
        })));
    }
    if (relayer && !diagnosticRelayers.has(relayer)) {
        diagnosticRelayers.add(relayer);
        const events = relayer.events || relayer;
        events.on?.('message', (event) => log('relay inbound', {
            topic: event?.topic || event?.params?.topic || null,
            method: relayMethod(event?.message || event?.payload || event),
            encrypted: !relayMethod(event?.message || event?.payload || event)
        }));
        events.on?.('error', (error) => log('relay error', describeError(error)));
    }
}

async function getWalletConnectProvider() {
    const connectors = adapter?.wagmiConfig?.connectors || [];
    const connector = connectors.find((candidate) => (
        `${candidate?.id || ''} ${candidate?.name || ''}`.toLowerCase().includes('walletconnect')
    ));
    try {
        return await connector?.getProvider?.() || await modal?.getWalletProvider?.() || null;
    } catch (error) {
        log('provider lookup failed', describeError(error));
        return null;
    }
}

async function restartRelayTransport(source) {
    if (transportRestartPromise) return transportRestartPromise;
    transportRestartPromise = (async () => {
        const provider = await getWalletConnectProvider();
        bindWalletConnectDiagnostics(provider, source);
        const relayer = getWalletConnectRelayer(provider);
        if (!relayer) {
            log('relay restart unavailable', { source, reason: 'provider or relayer absent' });
            return false;
        }
        try {
            if (typeof relayer.restartTransport === 'function') {
                await relayer.restartTransport();
            } else if (typeof relayer.transportClose === 'function' && typeof relayer.transportOpen === 'function') {
                await relayer.transportClose();
                await relayer.transportOpen();
            } else {
                log('relay restart unavailable', { source, reason: 'restart methods absent' });
                return false;
            }
            log('relay restart complete', { source });
            return true;
        } catch (error) {
            log('relay restart failed', { source, error: describeError(error) });
            return false;
        }
    })().finally(() => {
        transportRestartPromise = null;
    });
    return transportRestartPromise;
}

function safeDetail(detail) {
    if (!detail || typeof detail !== 'object') return detail ?? null;
    return Object.fromEntries(Object.entries(detail).map(([key, value]) => {
        if (/token|signature|secret/i.test(key) || /^projectid$/i.test(key)) return [key, '[redacted]'];
        if (/address/i.test(key)) return [key, maskAddress(value)];
        if (value instanceof Error) return [key, describeError(value)];
        return [key, value];
    }));
}

function log(step, detail = null) {
    const elapsed = Date.now() - startedAt;
    const payload = {
        n: ++sequence,
        ms: elapsed,
        step,
        visibility: document.visibilityState,
        focus: document.hasFocus(),
        detail: safeDetail(detail)
    };
    const line = `#${payload.n} +${payload.ms}ms [${payload.visibility}/${payload.focus ? 'focus' : 'blur'}] ${step}` +
        (payload.detail ? `\n  ${JSON.stringify(payload.detail)}` : '');
    logElement.textContent += `${line}\n`;
    logElement.scrollTop = logElement.scrollHeight;
    console.log('[WalletIsolationTest]', payload);
}

function accountSnapshot(account = modal?.getAccount?.()) {
    const address = account?.address || account?.allAccounts?.[0]?.address || null;
    const modalState = modal?.getState?.() || {};
    return {
        address,
        status: account?.status || null,
        isConnected: account?.isConnected ?? null,
        chainId: account?.chainId ?? null,
        caipAddress: account?.caipAddress || null,
        selectedNetworkId: account?.selectedNetworkId ?? modalState.selectedNetworkId ?? null,
        resolvedChainId: parseChainId(
            account?.chainId || account?.caipAddress || account?.selectedNetworkId || modalState.selectedNetworkId
        ),
        modalOpen: modalState.open ?? null,
        modalView: modalState.view || modalState.openModalView || null
    };
}

function updateStatus(account = modal?.getAccount?.()) {
    const snapshot = accountSnapshot(account);
    const chainOkay = snapshot.resolvedChainId === EXPECTED_CHAIN_ID;
    const variantLabel = layer === 'appkit-modal'
        ? 'D official AppKit modal (createAppKit + open)'
        : (variant === 'multi' ? 'B multi-network proposal' : 'A Base Sepolia only');
    statusElement.textContent = [
        `Layer: ${layer}`,
        `Variant: ${variantLabel}`,
        `Networks: ${networks.map((network) => network.caipNetworkId || `eip155:${network.id}`).join(', ')}`,
        'allowUnsupportedChain: true',
        `Origin: ${window.location.origin}`,
        `Account: ${maskAddress(snapshot.address) || 'none'}`,
        `Chain: ${snapshot.resolvedChainId || 'unknown'}${chainOkay ? ' (Base Sepolia)' : ''}`
    ].join('\n');
}

function bindLifecycleLogs() {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            log('visibilitychange visible');
            void restartRelayTransport('visibility return').then(() => {
                log('post-restart account state', accountSnapshot());
                updateStatus();
            });
        } else {
            log('visibilitychange hidden', accountSnapshot());
            updateStatus();
        }
    });
    window.addEventListener('focus', () => {
        log('window focus');
        void restartRelayTransport('window focus').then(() => {
            log('post-restart account state', accountSnapshot());
            updateStatus();
        });
    });
    window.addEventListener('blur', () => log('window blur', accountSnapshot()));
    window.addEventListener('pageshow', (event) => log('pageshow', { persisted: event.persisted }));
    window.addEventListener('pagehide', (event) => log('pagehide', { persisted: event.persisted }));
    window.addEventListener('online', () => log('browser online'));
    window.addEventListener('offline', () => log('browser offline'));
    window.addEventListener('error', (event) => log('window error', describeError(event.error || event.message)));
    window.addEventListener('unhandledrejection', (event) => log('unhandled rejection', describeError(event.reason)));
}

async function initializeBareLayer() {
    log('bare imports ready', {
        appKitVersion: '1.8.21',
        networksVersion: '1.8.21',
        wagmiAdapterVersion: '1.8.21',
        expectedChainId: EXPECTED_CHAIN_ID,
        metadataUrl: window.location.origin,
        projectIdPresent: Boolean(PROJECT_ID),
        projectIdFingerprint: `${PROJECT_ID.slice(0, 4)}...${PROJECT_ID.slice(-4)}`,
        variant,
        configuredNetworks: networks.map((network) => ({
            id: network.id,
            caipNetworkId: network.caipNetworkId || `eip155:${network.id}`,
            chainNamespace: network.chainNamespace || 'eip155'
        }))
    });
    adapter = new WagmiAdapter({ networks, projectId: PROJECT_ID, customRpcUrls });
    log('WagmiAdapter created', { networks: networks.map((network) => network.id) });

    modal = createAppKit({
        adapters: [adapter],
        networks,
        defaultNetwork: baseSepolia,
        projectId: PROJECT_ID,
        customRpcUrls,
        allowUnsupportedChain: true,
        enableNetworkSwitch: false,
        universalProviderConfigOverride: {
            events: { eip155: ['chainChanged', 'accountsChanged'] },
            rpcMap: { [BASE_SEPOLIA_CAIP_ID]: BASE_SEPOLIA_RPC_URL }
        },
        metadata: {
            name: 'ArtSoul Wallet Test',
            description: 'Isolated WalletConnect diagnostic',
            url: window.location.origin,
            icons: [`${window.location.origin}/ARTSOULlogo-clean.png`],
            redirect: { universal: window.location.href.split('#')[0] }
        },
        themeMode: 'dark',
        enableWalletConnect: true,
        enableInjected: true,
        allWallets: 'SHOW',
        enableAuthMode: false,
        features: { email: false, socials: [] }
    });
    log('bare AppKit created', accountSnapshot());

    wireModalSubscriptionsAndConnect({
        connectLabel: 'Connect with bare AppKit',
        openingLabel: 'Opening AppKit...',
        retryLabel: 'Retry bare AppKit'
    });
}

function wireModalSubscriptionsAndConnect({ connectLabel, openingLabel, retryLabel, onAccount = null }) {
    void getWalletConnectProvider().then((provider) => {
        bindWalletConnectDiagnostics(provider, 'configured isolation connector');
    });

    modal.subscribeAccount((account) => {
        log('subscribeAccount', accountSnapshot(account));
        updateStatus(account);
        onAccount?.(account);
    });
    modal.subscribeState((state) => log('subscribeState', {
        open: state?.open ?? null,
        view: state?.view || state?.openModalView || null,
        selectedNetworkId: state?.selectedNetworkId ?? null
    }));
    modal.subscribeProvider?.((providerState) => log('subscribeProvider', {
        providerAvailable: Boolean(providerState?.walletProvider?.request || providerState?.provider?.request || providerState?.request),
        chainId: providerState?.chainId || providerState?.provider?.chainId || providerState?.walletProvider?.chainId || null
    }));
    modal.subscribeProvider?.((providerState) => {
        const provider = providerState?.walletProvider || providerState?.provider || providerState;
        bindWalletConnectDiagnostics(provider, 'isolation provider subscription');
    });

    connectButton.textContent = connectLabel;
    connectButton.addEventListener('click', async () => {
        log('Connect click entered', accountSnapshot());
        connectButton.disabled = true;
        connectButton.textContent = openingLabel;
        const retryGuard = window.setTimeout(() => {
            connectButton.disabled = false;
            connectButton.textContent = retryLabel;
            log('modal.open still pending; button made retryable', accountSnapshot());
        }, 10000);
        try {
            await modal.open({ view: 'Connect' });
            log('modal.open resolved', accountSnapshot());
        } catch (error) {
            log('modal.open rejected', describeError(error));
        } finally {
            window.clearTimeout(retryGuard);
            connectButton.disabled = false;
            connectButton.textContent = connectLabel;
            log('Connect click exited', accountSnapshot());
        }
    });
    updateStatus();
}

// Variant D: the FULL official Reown AppKit modal (createAppKit + open), the
// way production would ship it. Isolated from appkit-init.js and the core
// path. Networks propose Base Sepolia only, without the strict
// chains/defaultChain universalProviderConfigOverride that used to break the
// mobile modal flow; sessions settling on another chain get one
// add/switch cycle to 84532 after settle.
async function initializeAppKitModalLayer() {
    let chainCycleKey = null;

    const ensureBaseSepoliaAfterSettle = async (account) => {
        const snapshot = accountSnapshot(account);
        if (!snapshot.address || snapshot.isConnected === false) {
            chainCycleKey = null;
            return;
        }
        if (snapshot.resolvedChainId === null) return;
        if (snapshot.resolvedChainId === EXPECTED_CHAIN_ID) {
            log('settled chain confirmed', { chainId: snapshot.resolvedChainId, baseSepolia: true });
            return;
        }
        const attemptKey = `${snapshot.address}:${snapshot.resolvedChainId}`;
        if (chainCycleKey === attemptKey) return;
        chainCycleKey = attemptKey;
        const provider = await modal?.getWalletProvider?.().catch(() => null) || await getWalletConnectProvider();
        if (!provider?.request) {
            log('Base Sepolia cycle skipped', { reason: 'no wallet provider with request' });
            return;
        }
        log('Base Sepolia add/switch cycle started', { fromChainId: snapshot.resolvedChainId });
        try {
            try {
                await provider.request({
                    method: 'wallet_addEthereumChain',
                    params: [BASE_SEPOLIA_ADD_CHAIN_PARAMS]
                });
                log('wallet_addEthereumChain resolved');
            } catch (error) {
                // Wallets differ when the chain already exists: some resolve,
                // others reject. Switching is the authoritative next step.
                log('wallet_addEthereumChain non-fatal result', describeError(error));
            }
            await provider.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: BASE_SEPOLIA_HEX_CHAIN_ID }]
            });
            log('wallet_switchEthereumChain resolved');
        } catch (error) {
            log('Base Sepolia add/switch cycle failed', describeError(error));
        }
        const finalChainId = parseChainId(provider.chainId) ?? accountSnapshot().resolvedChainId;
        log('post-cycle chain state', { chainId: finalChainId, baseSepolia: finalChainId === EXPECTED_CHAIN_ID });
        updateStatus();
    };

    log('appkit-modal imports ready', {
        appKitVersion: '1.8.21',
        wagmiAdapterVersion: '1.8.21',
        expectedChainId: EXPECTED_CHAIN_ID,
        metadataUrl: window.location.origin,
        redirectUniversal: window.location.href.split('#')[0],
        projectIdPresent: Boolean(PROJECT_ID),
        projectIdFingerprint: `${PROJECT_ID.slice(0, 4)}...${PROJECT_ID.slice(-4)}`,
        featuredWallets: ['MetaMask', 'Trust', 'Coinbase'],
        strictProviderOverride: false,
        allowUnsupportedChain: true,
        relayRestartOnReturn: true,
        configuredNetworks: networks.map((network) => ({
            id: network.id,
            caipNetworkId: network.caipNetworkId || `eip155:${network.id}`,
            chainNamespace: network.chainNamespace || 'eip155'
        }))
    });
    adapter = new WagmiAdapter({ networks, projectId: PROJECT_ID, customRpcUrls });
    log('WagmiAdapter created', { networks: networks.map((network) => network.id) });

    modal = createAppKit({
        adapters: [adapter],
        networks,
        defaultNetwork: baseSepolia,
        projectId: PROJECT_ID,
        customRpcUrls,
        allowUnsupportedChain: true,
        enableNetworkSwitch: false,
        // Deliberately NO strict chains/defaultChain override here — only the
        // soft events/rpcMap hints. The strict override was one of the three
        // root causes of the mobile modal settlement failures.
        universalProviderConfigOverride: {
            events: { eip155: ['chainChanged', 'accountsChanged'] },
            rpcMap: { [BASE_SEPOLIA_CAIP_ID]: BASE_SEPOLIA_RPC_URL }
        },
        metadata: {
            name: 'ArtSoul Wallet Test',
            description: 'Isolated official AppKit modal diagnostic',
            url: window.location.origin,
            icons: [`${window.location.origin}/ARTSOULlogo-clean.png`],
            redirect: { universal: window.location.href.split('#')[0] }
        },
        themeMode: 'dark',
        enableWalletConnect: true,
        enableInjected: true,
        enableCoinbase: true,
        coinbasePreference: 'all',
        enableEIP6963: true,
        enableAuthMode: false,
        allWallets: 'SHOW',
        features: { email: false, socials: [] },
        featuredWalletIds: FEATURED_WALLET_IDS
    });
    log('official AppKit modal created', accountSnapshot());

    wireModalSubscriptionsAndConnect({
        connectLabel: 'Connect with official AppKit modal',
        openingLabel: 'Opening official modal...',
        retryLabel: 'Retry official modal',
        onAccount: (account) => void ensureBaseSepoliaAfterSettle(account)
    });
}

// Mirrors the production mobile external-browser path one-to-one: the exact
// module, provider version, chain configuration, and statically pinned
// official WalletConnect modal (showQrModal: false) that appkit-init.js
// uses. Only the logging wrapper differs.
async function initializeCoreLayer() {
    const core = await import('/wallet-core-connect.js?v=10');
    core.configureCoreWallet({
        projectId: PROJECT_ID,
        // Mirrors production: the mobile external path carries NO redirect —
        // on iOS a universal link can only open a NEW tab, so the user must
        // return to THIS tab manually for the pending connect to settle.
        metadata: {
            name: 'ArtSoul Marketplace',
            description: 'Decentralized Art Marketplace',
            url: window.location.origin,
            icons: [`${window.location.origin}/ARTSOULlogo-clean.png`]
        },
        log: (step, detail) => log(step, detail)
    });

    const updateCoreStatus = (address, chainId) => {
        statusElement.textContent = [
            'Layer: core (production mobile path)',
            'Provider: @walletconnect/ethereum-provider 2.23.10 + pinned official WC modal 2.7.0',
            `Chains: eip155:${EXPECTED_CHAIN_ID} required; 8453, 1 optional`,
            `Origin: ${window.location.origin}`,
            `Account: ${maskAddress(address) || 'none'}`,
            `Chain: ${chainId || 'unknown'}${chainId === EXPECTED_CHAIN_ID ? ' (Base Sepolia)' : ''}`
        ].join('\n');
    };
    updateCoreStatus(null, null);

    const restored = await core.restoreCoreSession();
    if (restored?.address) {
        log('core session restored on load', {
            address: maskAddress(restored.address),
            chainId: restored.chainId
        });
        updateCoreStatus(restored.address, restored.chainId);
        restored.provider.on?.('chainChanged', (chainId) => {
            updateCoreStatus(restored.address, core.parseCoreChainId(chainId));
        });
    }

    connectButton.textContent = 'Connect with core path';
    connectButton.addEventListener('click', async () => {
        log('core connect click entered');
        connectButton.disabled = true;
        try {
            // The official WalletConnect modal handles wallet choice, deep
            // links and QR. No chain settle window, no custom timeout.
            const connected = await core.connectCoreWallet();
            log('core connect resolved', {
                address: maskAddress(connected.address),
                chainId: connected.chainId,
                restored: connected.restored
            });
            updateCoreStatus(connected.address, connected.chainId);
            connected.provider.on?.('chainChanged', (chainId) => {
                updateCoreStatus(connected.address, core.parseCoreChainId(chainId));
            });
        } catch (error) {
            log('core connect rejected', describeError(error));
        } finally {
            connectButton.disabled = false;
            connectButton.textContent = 'Connect with core path';
        }
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        const provider = core.getConnectedCoreProvider();
        const relayer = provider?.signer?.client?.core?.relayer || null;
        if (!relayer) return;
        void Promise.resolve(
            typeof relayer.restartTransport === 'function'
                ? relayer.restartTransport()
                : Promise.resolve()
        ).then(() => log('core relay restarted on visibility return'))
            .catch((error) => log('core relay restart failed', describeError(error)));
    });
}

async function initializeArtSoulLayer(withAuth) {
    if (withAuth) {
        log('layer module requested', { src: '/supabase-client.js' });
        await import('/supabase-client.js?wallettest=1');
        log('layer module loaded', { src: '/supabase-client.js' });
        log('layer module requested', { src: '/supabase-auth.js' });
        await import('/supabase-auth.js?wallettest=1');
        log('layer module loaded', { src: '/supabase-auth.js' });
    }
    log('ArtSoul appkit wrapper import requested', { withAuth });
    await import('/appkit-init.js?v=35');
    log('ArtSoul appkit wrapper imported', {
        modalAvailable: Boolean(window.web3Modal),
        safeConnectAvailable: typeof window.safeConnectWallet === 'function'
    });
    connectButton.textContent = withAuth ? 'Connect with wrapper + auth' : 'Connect with ArtSoul wrapper';
    connectButton.addEventListener('click', async () => {
        log('ArtSoul Connect click entered');
        try {
            const address = await window.safeConnectWallet?.();
            log('ArtSoul Connect resolved', {
                address,
                chainId: window.getCurrentChainId?.() || null,
                debug: window.ArtSoulWalletDebug?.snapshot?.().slice(-3) || []
            });
        } catch (error) {
            log('ArtSoul Connect rejected', describeError(error));
        }
    });
    updateStatus();
}

bindLifecycleLogs();
log('test page boot', {
    layer,
    origin: window.location.origin,
    href: window.location.href,
    online: navigator.onLine,
    effectiveType: navigator.connection?.effectiveType || null,
    userAgent: navigator.userAgent
});

try {
    if (layer === 'core') await initializeCoreLayer();
    else if (layer === 'appkit-modal') await initializeAppKitModalLayer();
    else if (layer === 'wrapper') await initializeArtSoulLayer(false);
    else if (layer === 'auth') await initializeArtSoulLayer(true);
    else await initializeBareLayer();
} catch (error) {
    log('initialization failed', describeError(error));
    statusElement.textContent = `Initialization failed: ${error?.message || error}`;
}
