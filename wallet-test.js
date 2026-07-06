const PROJECT_ID = '9fdc97f91c02d46a28ca9d185a9e58f2';
const EXPECTED_CHAIN_ID = 84532;
const startedAt = Date.now();
const params = new URLSearchParams(window.location.search);
const layer = params.get('layer') || 'bare';
const requestedVariant = params.get('variant') || 'legacy-redirect';
const variant = ['legacy-redirect', 'aligned', 'no-redirect', 'latest', 'core-manual'].includes(requestedVariant)
    ? requestedVariant
    : 'legacy-redirect';
const logElement = document.getElementById('walletTestLog');
const statusElement = document.getElementById('walletTestStatus');
const connectButton = document.getElementById('walletTestConnect');
const manualPanel = document.getElementById('walletManualPanel');
const manualStatus = document.getElementById('walletManualStatus');
const manualQr = document.getElementById('walletManualQr');
const copyUriButton = document.getElementById('walletCopyUri');
const openMetaMaskLink = document.getElementById('walletOpenMetaMask');
let sequence = 0;
let modal = null;
let manualProvider = null;
let manualPairingUri = null;
let manualAccount = null;
let manualChainId = EXPECTED_CHAIN_ID;
let connectAttempt = 0;
let socketSequence = 0;
let activeAppKitVersion = layer === 'bare'
    ? variant === 'latest'
        ? '1.8.21'
        : variant === 'core-manual'
            ? 'none (EthereumProvider 2.23.10)'
            : '1.7.11'
    : 'ArtSoul wrapper';
let activeNetworksVersion = variant === 'legacy-redirect'
    ? 'unversioned'
    : variant === 'core-manual'
        ? 'Base Sepolia 84532'
        : activeAppKitVersion;
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
            const socketId = ++socketSequence;
            const safeUrl = describeNetworkUrl(url);
            let sentFrames = 0;
            let receivedFrames = 0;
            const frameSize = (value) => value?.byteLength ?? value?.size ?? String(value ?? '').length;
            const nativeSend = this.send.bind(this);
            this.send = (data) => {
                sentFrames += 1;
                log('WebSocket send', { socketId, frame: sentFrames, bytes: frameSize(data), readyState: this.readyState });
                return nativeSend(data);
            };
            log('WebSocket created', { socketId, url: safeUrl });
            this.addEventListener('open', () => log('WebSocket open', { socketId, url: safeUrl }));
            this.addEventListener('message', (event) => {
                receivedFrames += 1;
                log('WebSocket message', { socketId, frame: receivedFrames, bytes: frameSize(event.data) });
            });
            this.addEventListener('error', () => log('WebSocket error', { socketId, url: safeUrl, readyState: this.readyState }));
            this.addEventListener('close', (event) => log('WebSocket close', {
                socketId,
                url: safeUrl,
                code: event.code,
                reason: event.reason || null,
                wasClean: event.wasClean,
                sentFrames,
                receivedFrames
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
    if (variant === 'core-manual') {
        return {
            address: maskAddress(manualAccount),
            status: manualAccount ? 'connected' : 'disconnected',
            isConnected: Boolean(manualAccount),
            chainId: manualAccount ? manualChainId : null,
            caipAddress: manualAccount ? `eip155:${manualChainId}:${maskAddress(manualAccount)}` : null,
            selectedNetworkId: `eip155:${manualChainId}`,
            resolvedChainId: manualChainId,
            modalOpen: false,
            modalView: 'manual-uri'
        };
    }
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

async function presentManualPairingUri(uri) {
    manualPairingUri = uri;
    const topic = String(uri).match(/^wc:([^@]+)/i)?.[1] || '';
    manualStatus.textContent = `Private pairing URI ready (${topic.slice(0, 8)}...). Use one method below.`;
    copyUriButton.disabled = false;
    openMetaMaskLink.href = `https://metamask.app.link/wc?uri=${encodeURIComponent(uri)}`;
    openMetaMaskLink.setAttribute('aria-disabled', 'false');
    log('manual display_uri ready', { topicFingerprint: topic.slice(0, 8), uriLength: String(uri).length });
    try {
        const qrModule = await import('https://esm.sh/qrcode@1.5.4?bundle');
        const qrCode = qrModule.default || qrModule;
        const pageStyle = getComputedStyle(document.body);
        const toHex = (color) => {
            if (color.startsWith('#')) return color;
            const channels = color.match(/[\d.]+/g)?.slice(0, 4).map(Number);
            if (!channels || channels.length < 3) return null;
            const rgb = channels.slice(0, 3).map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0')).join('');
            const alpha = channels.length === 4 ? Math.round(channels[3] * 255).toString(16).padStart(2, '0') : '';
            return `#${rgb}${alpha}`;
        };
        const dark = toHex(pageStyle.color);
        const light = toHex(pageStyle.backgroundColor);
        const qrOptions = {
            width: Math.min(280, Math.max(220, window.innerWidth - 80)),
            margin: 2,
            errorCorrectionLevel: 'M'
        };
        if (dark && light) qrOptions.color = { dark, light };
        await qrCode.toCanvas(manualQr, uri, qrOptions);
        manualQr.classList.add('is-ready');
        log('manual QR rendered locally', { width: manualQr.width, height: manualQr.height });
    } catch (error) {
        log('manual QR render failed', describeError(error));
        manualStatus.textContent += ' QR rendering failed; Copy URI and Open MetaMask remain available.';
    }
}

function bindManualControls() {
    copyUriButton.addEventListener('click', async () => {
        if (!manualPairingUri) return;
        try {
            await navigator.clipboard.writeText(manualPairingUri);
            copyUriButton.textContent = 'Private URI copied';
            log('manual pairing URI copied', { uriLength: manualPairingUri.length });
        } catch (error) {
            log('manual pairing URI copy failed', describeError(error));
            copyUriButton.textContent = 'Copy failed';
        }
    });
    openMetaMaskLink.addEventListener('click', () => {
        if (!manualPairingUri) return;
        log('manual MetaMask universal link opened', { uriLength: manualPairingUri.length });
    });
}

async function initializeCoreManual() {
    activeAppKitVersion = 'none (EthereumProvider 2.23.10)';
    activeNetworksVersion = 'Base Sepolia 84532';
    activeRedirectIncluded = false;
    manualPanel.hidden = false;
    connectButton.textContent = 'Create manual pairing URI';
    updateStatus();
    log('loading WalletConnect EthereumProvider', {
        providerVersion: '2.23.10',
        expectedChainId: EXPECTED_CHAIN_ID,
        metadataUrl: window.location.origin,
        projectIdFingerprint: '9fdc...58f2'
    });
    const providerModule = await import('https://esm.sh/@walletconnect/ethereum-provider@2.23.10?bundle');
    const EthereumProvider = providerModule.EthereumProvider || providerModule.default?.EthereumProvider || providerModule.default;
    manualProvider = await EthereumProvider.init({
        projectId: PROJECT_ID,
        chains: [EXPECTED_CHAIN_ID],
        showQrModal: false,
        metadata: {
            name: 'ArtSoul Wallet Test',
            description: 'Isolated WalletConnect manual pairing diagnostic',
            url: window.location.origin,
            icons: [`${window.location.origin}/ARTSOULlogo-clean.png`]
        }
    });
    log('WalletConnect EthereumProvider created', snapshot());
    manualProvider.on('display_uri', (uri) => void presentManualPairingUri(uri));
    manualProvider.on('connect', (event) => log('manual provider connect event', {
        chainId: event?.chainId || manualProvider.chainId || null
    }));
    manualProvider.on('accountsChanged', (accounts) => {
        manualAccount = accounts?.[0] || null;
        log('manual accountsChanged', { address: manualAccount });
        updateStatus();
    });
    manualProvider.on('chainChanged', (chainId) => {
        manualChainId = parseChainId(chainId) || EXPECTED_CHAIN_ID;
        log('manual chainChanged', { chainId: manualChainId });
        updateStatus();
    });
    manualProvider.on('session_event', (event) => log('manual session_event', {
        name: event?.params?.event?.name || event?.name || 'unknown'
    }));
    manualProvider.on('disconnect', (error) => {
        manualAccount = null;
        log('manual provider disconnect', error ? describeError(error) : null);
        updateStatus();
    });
    bindManualControls();
    connectButton.addEventListener('click', async () => {
        if (connectAttempt > 0 && !manualAccount) {
            window.location.reload();
            return;
        }
        const attemptId = ++connectAttempt;
        log('manual connect entered', { attemptId, account: snapshot() });
        void logSessionMarkers('manual session markers before connect');
        scheduleSessionChecks(attemptId);
        connectButton.disabled = true;
        connectButton.textContent = 'Waiting for WalletConnect session';
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Manual WalletConnect session timed out after 120 seconds')), 120000));
        try {
            await Promise.race([manualProvider.connect(), timeout]);
            manualAccount = manualProvider.accounts?.[0] || null;
            manualChainId = parseChainId(manualProvider.chainId) || EXPECTED_CHAIN_ID;
            log('manual connect resolved', snapshot());
            updateStatus();
        } catch (error) {
            log('manual connect rejected or timed out', describeError(error));
        } finally {
            connectButton.disabled = Boolean(manualAccount);
            connectButton.textContent = manualAccount ? 'WalletConnect session established' : 'Reload page to retry';
        }
    });
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
    else if (variant === 'core-manual') await initializeCoreManual();
    else await initializeBare();
} catch (error) {
    log('initialization failed', describeError(error));
    statusElement.textContent = `Initialization failed: ${error?.message || error}`;
}
