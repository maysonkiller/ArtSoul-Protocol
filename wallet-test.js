const PROJECT_ID = '9fdc97f91c02d46a28ca9d185a9e58f2';
const EXPECTED_CHAIN_ID = 84532;
const startedAt = Date.now();
const params = new URLSearchParams(window.location.search);
const layer = params.get('layer') || 'bare';
const requestedVariant = params.get('variant') || 'legacy-redirect';
const variant = ['legacy-redirect', 'aligned', 'no-redirect', 'latest'].includes(requestedVariant)
    ? requestedVariant
    : 'legacy-redirect';
const logElement = document.getElementById('walletTestLog');
const statusElement = document.getElementById('walletTestStatus');
const connectButton = document.getElementById('walletTestConnect');
let sequence = 0;
let modal = null;
let connectAttempt = 0;
let activeAppKitVersion = layer === 'bare' ? (variant === 'latest' ? '1.8.21' : '1.7.11') : 'ArtSoul wrapper';
let activeNetworksVersion = variant === 'legacy-redirect' ? 'unversioned' : activeAppKitVersion;
let activeRedirectIncluded = layer === 'bare'
    ? variant === 'legacy-redirect' || variant === 'aligned'
    : true;
const NativeWebSocket = window.WebSocket;
const nativeFetch = window.fetch.bind(window);
const nativeConsoleWarn = console.warn.bind(console);
const nativeConsoleError = console.error.bind(console);

function maskAddress(value) {
    const address = String(value || '');
    return /^0x[a-f0-9]{40}$/i.test(address) ? `${address.slice(0, 6)}...${address.slice(-4)}` : address || null;
}

function parseChainId(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const text = String(value);
    const caip = text.match(/^eip155:(\d+)/i);
    if (caip) return Number(caip[1]);
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

function sanitize(detail) {
    if (!detail || typeof detail !== 'object') return detail ?? null;
    return Object.fromEntries(Object.entries(detail).map(([key, value]) => {
        if (/token|signature|secret/i.test(key) || /^projectid$/i.test(key)) return [key, '[redacted]'];
        if (/address/i.test(key)) return [key, maskAddress(value)];
        if (value instanceof Error) return [key, describeError(value)];
        return [key, value];
    }));
}

function log(step, detail = null) {
    const line = `#${++sequence} +${Date.now() - startedAt}ms [${document.visibilityState}/${document.hasFocus() ? 'focus' : 'blur'}] ${step}` +
        (detail ? `\n  ${JSON.stringify(sanitize(detail))}` : '');
    logElement.textContent += `${line}\n`;
    logElement.scrollTop = logElement.scrollHeight;
    console.log('[WalletIsolationTest]', step, sanitize(detail));
}

function describeNetworkUrl(value) {
    try {
        const url = new URL(String(value));
        return `${url.protocol}//${url.host}${url.pathname}`;
    } catch {
        return String(value || '').split('?')[0];
    }
}

function isDiagnosticNetwork(value) {
    return /walletconnect|reown|web3modal|w3m|esm\.sh/i.test(String(value || ''));
}

function instrumentTransport() {
    const formatConsoleValue = (value) => {
        const text = value instanceof Error
            ? `${value.name}: ${value.message}`
            : typeof value === 'string'
                ? value
                : (() => { try { return JSON.stringify(value); } catch { return String(value); } })();
        return text
            .replace(/wc:[^\s"']+/gi, 'wc:[redacted]')
            .replace(/([?&](?:projectId|symKey|relay-protocol)=[^&\s"']+)/gi, '?[redacted]');
    };
    console.warn = (...values) => {
        nativeConsoleWarn(...values);
        log('SDK console.warn', { message: values.map(formatConsoleValue).join(' ').slice(0, 1200) });
    };
    console.error = (...values) => {
        nativeConsoleError(...values);
        log('SDK console.error', { message: values.map(formatConsoleValue).join(' ').slice(0, 1200) });
    };

    window.fetch = async (input, init) => {
        const rawUrl = typeof input === 'string' ? input : input?.url;
        const shouldLog = isDiagnosticNetwork(rawUrl);
        if (shouldLog) log('HTTP request', { url: describeNetworkUrl(rawUrl), method: init?.method || 'GET' });
        try {
            const response = await nativeFetch(input, init);
            if (shouldLog) log('HTTP response', { url: describeNetworkUrl(rawUrl), status: response.status, ok: response.ok });
            return response;
        } catch (error) {
            if (shouldLog) log('HTTP error', { url: describeNetworkUrl(rawUrl), error: describeError(error) });
            throw error;
        }
    };

    class DiagnosticWebSocket extends NativeWebSocket {
        constructor(url, protocols) {
            if (protocols === undefined) super(url);
            else super(url, protocols);
            const safeUrl = describeNetworkUrl(url);
            log('WebSocket created', { url: safeUrl });
            this.addEventListener('open', () => log('WebSocket open', { url: safeUrl }));
            this.addEventListener('error', () => log('WebSocket error', { url: safeUrl, readyState: this.readyState }));
            this.addEventListener('close', (event) => log('WebSocket close', {
                url: safeUrl,
                code: event.code,
                reason: event.reason || null,
                wasClean: event.wasClean
            }));
        }
    }
    window.WebSocket = DiagnosticWebSocket;
}

async function logSessionMarkers(label) {
    const summarizeKeys = (storage) => {
        const matching = Object.keys(storage).filter((key) => /wallet|wc@|walletconnect|w3m|appkit/i.test(key));
        return {
            count: matching.length,
            prefixes: [...new Set(matching.map((key) => key.split(':').slice(0, 3).join(':')).slice(0, 8))]
        };
    };
    const localMarkers = summarizeKeys(localStorage);
    const sessionMarkers = summarizeKeys(sessionStorage);
    let databases = [];
    try {
        databases = typeof indexedDB.databases === 'function'
            ? (await indexedDB.databases()).map((database) => database.name).filter((name) => /wallet|wc|w3m|appkit/i.test(name || ''))
            : [];
    } catch (error) {
        log('storage marker read failed', describeError(error));
    }
    log(label, { localMarkers, sessionMarkers, indexedDbNames: databases, account: snapshot() });
}

function scheduleSessionChecks(attemptId) {
    [10000, 30000, 60000].forEach((delay) => {
        setTimeout(() => {
            if (attemptId !== connectAttempt) return;
            void logSessionMarkers(`session check +${delay / 1000}s`);
        }, delay);
    });
}

function snapshot(account = modal?.getAccount?.()) {
    const state = modal?.getState?.() || {};
    const address = account?.address || account?.allAccounts?.[0]?.address || null;
    return {
        address: maskAddress(address),
        status: account?.status || null,
        isConnected: account?.isConnected ?? null,
        chainId: account?.chainId ?? null,
        caipAddress: String(account?.caipAddress || '').replace(/0x[a-f0-9]{40}/gi, (value) => maskAddress(value)) || null,
        selectedNetworkId: account?.selectedNetworkId ?? state.selectedNetworkId ?? null,
        resolvedChainId: parseChainId(account?.chainId || account?.caipAddress || account?.selectedNetworkId || state.selectedNetworkId),
        modalOpen: state.open ?? null,
        modalView: state.view || state.openModalView || null
    };
}

function updateStatus(account) {
    const current = snapshot(account);
    statusElement.textContent = [
        `Layer: ${layer}`,
        `Variant: ${variant}`,
        `AppKit: ${activeAppKitVersion}`,
        `Networks: ${activeNetworksVersion}`,
        `redirectIncluded: ${activeRedirectIncluded}`,
        `Origin: ${window.location.origin}`,
        'Project: 9fdc...58f2',
        `Account: ${maskAddress(current.address) || 'none'}`,
        `Chain: ${current.resolvedChainId || 'unknown'}${current.resolvedChainId === EXPECTED_CHAIN_ID ? ' (Base Sepolia)' : ''}`
    ].join('\n');
}

function markActiveVariant() {
    document.querySelectorAll('[data-wallet-variant]').forEach((link) => {
        if (link.dataset.walletVariant === variant && layer === 'bare') link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
    });
}

function bindLifecycle() {
    document.addEventListener('visibilitychange', () => { log('visibilitychange', snapshot()); updateStatus(); });
    window.addEventListener('focus', () => { log('window focus', snapshot()); updateStatus(); });
    window.addEventListener('blur', () => log('window blur', snapshot()));
    window.addEventListener('pageshow', (event) => log('pageshow', { persisted: event.persisted }));
    window.addEventListener('pagehide', (event) => log('pagehide', { persisted: event.persisted }));
    window.addEventListener('online', () => log('browser online'));
    window.addEventListener('offline', () => log('browser offline'));
    window.addEventListener('error', (event) => log('window error', describeError(event.error || event.message)));
    window.addEventListener('unhandledrejection', (event) => log('unhandled rejection', describeError(event.reason)));
}

function subscribeToModal() {
    modal?.subscribeAccount?.((account) => { log('subscribeAccount', snapshot(account)); updateStatus(account); });
    modal?.subscribeState?.((state) => log('subscribeState', {
        open: state?.open ?? null,
        view: state?.view || state?.openModalView || null,
        selectedNetworkId: state?.selectedNetworkId ?? null
    }));
    modal?.subscribeProvider?.((providerState) => log('subscribeProvider', {
        providerAvailable: Boolean(providerState?.walletProvider?.request || providerState?.provider?.request || providerState?.request),
        chainId: providerState?.chainId || providerState?.provider?.chainId || providerState?.walletProvider?.chainId || null
    }));
    if (typeof modal?.subscribeEvents === 'function') {
        modal.subscribeEvents((event) => log('AppKit event', {
            type: event?.type || event?.event || event?.name || 'unknown',
            category: event?.data?.event || event?.data?.type || null
        }));
    } else {
        log('AppKit event subscription unavailable');
    }
}

async function loadBareModules() {
    const version = variant === 'latest' ? '1.8.21' : '1.7.11';
    const networksVersion = variant === 'legacy-redirect' ? 'unversioned' : version;
    const networksUrl = networksVersion === 'unversioned'
        ? 'https://esm.sh/@reown/appkit/networks?bundle'
        : `https://esm.sh/@reown/appkit@${networksVersion}/networks?bundle`;
    activeAppKitVersion = version;
    activeNetworksVersion = networksVersion;
    log('loading bare AppKit modules', { version, networksVersion, variant });
    const [appKitModule, adapterModule, networkModule] = await Promise.all([
        import(`https://esm.sh/@reown/appkit@${version}?bundle`),
        import(`https://esm.sh/@reown/appkit-adapter-wagmi@${version}?bundle`),
        import(networksUrl)
    ]);
    return {
        createAppKit: appKitModule.createAppKit,
        WagmiAdapter: adapterModule.WagmiAdapter,
        baseSepolia: networkModule.baseSepolia
    };
}

async function initializeBare() {
    const { createAppKit, WagmiAdapter, baseSepolia } = await loadBareModules();
    const networks = [baseSepolia];
    const includeRedirect = variant === 'legacy-redirect' || variant === 'aligned';
    activeRedirectIncluded = includeRedirect;
    const metadata = {
        name: 'ArtSoul Wallet Test',
        description: 'Isolated WalletConnect diagnostic',
        url: window.location.origin,
        icons: [`${window.location.origin}/ARTSOULlogo-clean.png`]
    };
    if (includeRedirect) metadata.redirect = { universal: window.location.href.split('#')[0] };
    log('bare init', {
        appKitVersion: activeAppKitVersion,
        variant,
        expectedChainId: EXPECTED_CHAIN_ID,
        metadataUrl: metadata.url,
        redirectIncluded: includeRedirect,
        projectIdFingerprint: '9fdc...58f2'
    });
    const adapter = new WagmiAdapter({ networks, projectId: PROJECT_ID });
    modal = createAppKit({
        adapters: [adapter], networks, defaultNetwork: baseSepolia, projectId: PROJECT_ID,
        metadata,
        themeMode: 'dark', enableWalletConnect: true, enableInjected: true, enableAuthMode: false, debug: true,
        features: { email: false, socials: [] }
    });
    log('bare AppKit created', snapshot());
    subscribeToModal();
    connectButton.addEventListener('click', async () => {
        const attemptId = ++connectAttempt;
        log('Connect click entered', { attemptId, account: snapshot() });
        void logSessionMarkers('session markers before connect');
        scheduleSessionChecks(attemptId);
        connectButton.disabled = true;
        const retryGuard = setTimeout(() => {
            connectButton.disabled = false;
            connectButton.textContent = 'Retry bare AppKit';
            log('modal.open pending; retry enabled', snapshot());
        }, 10000);
        try {
            await modal.open({ view: 'Connect' });
            log('modal.open resolved', snapshot());
        } catch (error) {
            log('modal.open rejected', describeError(error));
        } finally {
            clearTimeout(retryGuard);
            connectButton.disabled = false;
            connectButton.textContent = 'Connect with bare AppKit';
        }
    });
    updateStatus();
}

async function initializeWrapper(withAuth) {
    activeAppKitVersion = 'ArtSoul wrapper 1.7.11';
    activeNetworksVersion = 'unversioned';
    if (withAuth) {
        log('loading supabase-client module');
        await import('/supabase-client.js?wallettest=1');
        log('loading supabase-auth module');
        await import('/supabase-auth.js?wallettest=1');
    }
    log('loading ArtSoul appkit wrapper', { withAuth });
    await import('/appkit-init.js?v=19');
    modal = window.web3Modal;
    log('ArtSoul wrapper loaded', { modalAvailable: Boolean(modal), safeConnectAvailable: typeof window.safeConnectWallet === 'function' });
    subscribeToModal();
    connectButton.textContent = withAuth ? 'Connect with wrapper + auth' : 'Connect with ArtSoul wrapper';
    connectButton.addEventListener('click', async () => {
        log('ArtSoul Connect entered', snapshot());
        try {
            const address = await window.safeConnectWallet?.();
            log('ArtSoul Connect resolved', { address, chainId: window.getCurrentChainId?.() || null });
        } catch (error) {
            log('ArtSoul Connect rejected', describeError(error));
        }
    });
    updateStatus();
}

bindLifecycle();
instrumentTransport();
markActiveVariant();
updateStatus();
log('test page boot', { layer, variant, origin: window.location.origin, online: navigator.onLine, effectiveType: navigator.connection?.effectiveType || null, userAgent: navigator.userAgent });
try {
    if (layer === 'wrapper') await initializeWrapper(false);
    else if (layer === 'auth') await initializeWrapper(true);
    else await initializeBare();
} catch (error) {
    log('initialization failed', describeError(error));
    statusElement.textContent = `Initialization failed: ${error?.message || error}`;
}
