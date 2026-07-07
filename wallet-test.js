import { createAppKit } from 'https://esm.sh/@reown/appkit@1.8.21?bundle';
import { WagmiAdapter } from 'https://esm.sh/@reown/appkit-adapter-wagmi@1.8.21?bundle';
import { baseSepolia } from 'https://esm.sh/@reown/appkit@1.8.21/networks?bundle';

// Public Reown project identifier for the verified ArtSoul web project.
const PROJECT_ID = '9fdc97f91c02d46a28ca9d185a9e58f2';
const EXPECTED_CHAIN_ID = 84532;
const BASE_SEPOLIA_CAIP_ID = 'eip155:84532';
const BASE_SEPOLIA_RPC_URL = 'https://sepolia.base.org';
const customRpcUrls = {
    [BASE_SEPOLIA_CAIP_ID]: [{ url: BASE_SEPOLIA_RPC_URL }]
};
const startedAt = Date.now();
const params = new URLSearchParams(window.location.search);
const layer = params.get('layer') || 'bare';
const logElement = document.getElementById('walletTestLog');
const statusElement = document.getElementById('walletTestStatus');
const connectButton = document.getElementById('walletTestConnect');
let sequence = 0;
let modal = null;

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
    statusElement.textContent = [
        `Layer: ${layer}`,
        `Origin: ${window.location.origin}`,
        `Account: ${maskAddress(snapshot.address) || 'none'}`,
        `Chain: ${snapshot.resolvedChainId || 'unknown'}${chainOkay ? ' (Base Sepolia)' : ''}`
    ].join('\n');
}

function bindLifecycleLogs() {
    document.addEventListener('visibilitychange', () => {
        log('visibilitychange', accountSnapshot());
        updateStatus();
    });
    window.addEventListener('focus', () => {
        log('window focus', accountSnapshot());
        updateStatus();
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
        projectIdFingerprint: `${PROJECT_ID.slice(0, 4)}...${PROJECT_ID.slice(-4)}`
    });
    const networks = [baseSepolia];
    const adapter = new WagmiAdapter({ networks, projectId: PROJECT_ID, customRpcUrls });
    log('WagmiAdapter created', { networks: networks.map((network) => network.id) });

    modal = createAppKit({
        adapters: [adapter],
        networks,
        defaultNetwork: baseSepolia,
        projectId: PROJECT_ID,
        customRpcUrls,
        allowUnsupportedChain: false,
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

    modal.subscribeAccount((account) => {
        log('subscribeAccount', accountSnapshot(account));
        updateStatus(account);
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

    connectButton.addEventListener('click', async () => {
        log('Connect click entered', accountSnapshot());
        connectButton.disabled = true;
        connectButton.textContent = 'Opening AppKit...';
        const retryGuard = window.setTimeout(() => {
            connectButton.disabled = false;
            connectButton.textContent = 'Retry bare AppKit';
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
            connectButton.textContent = 'Connect with bare AppKit';
            log('Connect click exited', accountSnapshot());
        }
    });
    updateStatus();
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
    await import('/appkit-init.js?v=21');
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
    if (layer === 'wrapper') await initializeArtSoulLayer(false);
    else if (layer === 'auth') await initializeArtSoulLayer(true);
    else await initializeBareLayer();
} catch (error) {
    log('initialization failed', describeError(error));
    statusElement.textContent = `Initialization failed: ${error?.message || error}`;
}
