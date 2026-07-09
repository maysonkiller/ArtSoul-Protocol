// ============================================
// ARTSOUL CORE WALLETCONNECT PATH
// Mobile external browsers connect through the bare
// @walletconnect/ethereum-provider — the exact configuration proven to
// settle on iOS where the AppKit modal/connector layer fails. AppKit
// remains the desktop and injected-provider path.
// ============================================

const WC_ETHEREUM_PROVIDER_VERSION = '2.23.10';
const WC_ETHEREUM_PROVIDER_URL = `https://esm.sh/@walletconnect/ethereum-provider@${WC_ETHEREUM_PROVIDER_VERSION}?bundle`;
const QR_MODULE_URL = 'https://esm.sh/qrcode@1.5.4?bundle';

const BASE_SEPOLIA_CHAIN_ID = 84532;
const BASE_SEPOLIA_RPC_URL = 'https://sepolia.base.org';
// Optional chains let wallets without Base Sepolia added still settle the
// session; ArtSoul switches them to Base Sepolia right after connect.
const OPTIONAL_CHAIN_IDS = [8453, 1];
const SHEET_ID = 'artsoul-core-wallet-sheet';

let settings = { projectId: null, metadata: null, log: null };
let providerInstance = null;
let providerInitPromise = null;
let connectInFlight = null;
let rejectionGuardBound = false;

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
    return Boolean(connectInFlight);
}

export function isCoreSessionActive() {
    return Boolean(providerInstance?.session);
}

export function getConnectedCoreProvider() {
    return providerInstance?.session ? providerInstance : null;
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

export async function getCoreEthereumProvider() {
    if (providerInstance) return providerInstance;
    if (!providerInitPromise) {
        providerInitPromise = (async () => {
            bindStaleTopicRejectionGuard();
            coreLog('core provider module import started', { version: WC_ETHEREUM_PROVIDER_VERSION });
            const module = await import(WC_ETHEREUM_PROVIDER_URL);
            const EthereumProvider = module.EthereumProvider || module.default;
            // Provider defaults keep the standard optional method set, which
            // includes wallet_addEthereumChain and wallet_switchEthereumChain.
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

// EthereumProvider persists its session in IndexedDB. On page load an
// existing session is restored without a new pairing.
export async function restoreCoreSession() {
    try {
        const instance = await getCoreEthereumProvider();
        if (!instance.session) return null;
        const address = (instance.accounts || []).filter(Boolean)[0] || null;
        if (!address) return null;
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
        return restored;
    } catch (error) {
        coreLog('core session restore failed', describeCoreError(error));
        return null;
    }
}

// One pairing URI per attempt. The URI is emitted once by connect() and is
// NEVER regenerated on focus, visibilitychange, or re-render — callers keep
// the URI they were handed for the whole attempt.
export async function connectCoreWallet({ onDisplayUri } = {}) {
    const instance = await getCoreEthereumProvider();

    if (instance.session) {
        const address = (instance.accounts || []).filter(Boolean)[0] || null;
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

    if (connectInFlight) {
        // A previous attempt was abandoned (timeout/cancel). Its proposal
        // expires on its own; deleting live topics mid-flight is the SDK race
        // that kills settlement, so never clean it up manually.
        connectInFlight.promise.catch(() => {});
        coreLog('stale core connect abandoned', { startedAt: connectInFlight.startedAt });
        connectInFlight = null;
    }

    const startedAt = Date.now();
    const handleDisplayUri = (uri) => {
        coreLog('core pairing uri issued', { elapsedMs: Date.now() - startedAt });
        try {
            onDisplayUri?.(uri);
        } catch (error) {
            coreLog('core display_uri handler failed', describeCoreError(error));
        }
    };
    instance.on('display_uri', handleDisplayUri);

    let entry = null;
    const promise = (async () => {
        try {
            await instance.connect();
            const address = (instance.accounts || []).filter(Boolean)[0] || null;
            const result = {
                provider: instance,
                address,
                chainId: parseCoreChainId(instance.chainId),
                restored: false
            };
            coreLog('core connect settled', {
                elapsedMs: Date.now() - startedAt,
                chainId: result.chainId,
                namespaceChains: instance.session?.namespaces?.eip155?.chains || null,
                namespaceMethods: instance.session?.namespaces?.eip155?.methods || null
            });
            return result;
        } finally {
            try {
                instance.removeListener?.('display_uri', handleDisplayUri);
            } catch {
                // Listener cleanup is best effort.
            }
            if (connectInFlight === entry) connectInFlight = null;
        }
    })();
    entry = { promise, startedAt };
    connectInFlight = entry;
    return promise;
}

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

// After settlement the wallet may follow up with chainChanged for its own
// active network (observed 84532 -> 8453 ~0.5s after settle). Wait for that
// signal before deciding whether an add/switch cycle is needed.
export function waitForWalletChainSettle(instance, timeoutMs = 2500) {
    return new Promise((resolve) => {
        let settled = false;
        let timer = null;
        const finish = (source) => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            try {
                instance?.removeListener?.('chainChanged', onChainChanged);
            } catch {
                // Best effort cleanup.
            }
            resolve(source);
        };
        const onChainChanged = () => finish('chainChanged');
        timer = setTimeout(() => finish('timeout'), timeoutMs);
        try {
            instance?.on?.('chainChanged', onChainChanged);
        } catch {
            finish('listener-unavailable');
        }
    });
}

// ============================================
// ARTSOUL WALLET MODAL
// Branded bottom-sheet wallet chooser (OpenSea/Zora-class) that replaces the
// AppKit modal on the mobile external-browser path. Every wallet row carries
// the correct iOS/Android deep link for the CURRENT pairing URI; wallets with
// no reliable link fall back to an honest copy-and-paste flow. Theme colors
// come only from var(--c-*); the slide-up animation is Future-theme only.
// ============================================

const SHEET_STYLE_ID = 'artsoul-core-wallet-sheet-style';

// One entry per wallet. `ios`/`android` are the deep-link prefixes the pairing
// URI is appended to (URL-encoded). `null` on a platform means no reliable link
// exists there (e.g. Rabby's iOS universal link is broken in the WalletConnect
// registry) — that platform uses the copy-and-paste path instead of a dead link.
const CORE_WALLETS = [
    {
        id: 'metamask',
        name: 'MetaMask',
        mono: 'M',
        tint: 'linear-gradient(135deg,#f6851b,#e2761b)',
        // Proven in production on both iOS and Android.
        ios: 'https://metamask.app.link/wc?uri=',
        android: 'https://metamask.app.link/wc?uri='
    },
    {
        id: 'trust',
        name: 'Trust Wallet',
        mono: 'T',
        tint: 'linear-gradient(135deg,#3375bb,#1a55a3)',
        ios: 'https://link.trustwallet.com/wc?uri=',
        android: 'https://link.trustwallet.com/wc?uri='
    },
    {
        id: 'coinbase',
        name: 'Coinbase Wallet',
        mono: 'C',
        tint: 'linear-gradient(135deg,#1b62ff,#0a46e4)',
        ios: 'https://go.cb-w.com/wc?uri=',
        android: 'https://go.cb-w.com/wc?uri='
    },
    {
        id: 'rainbow',
        name: 'Rainbow',
        mono: 'R',
        tint: 'linear-gradient(135deg,#ff5c00,#8754c9 55%,#00aaff)',
        ios: 'https://rnbwapp.com/wc?uri=',
        android: 'https://rnbwapp.com/wc?uri='
    },
    {
        id: 'zerion',
        name: 'Zerion',
        mono: 'Z',
        tint: 'linear-gradient(135deg,#2962ef,#1f2fd4)',
        ios: 'https://wallet.zerion.io/wc?uri=',
        android: 'https://wallet.zerion.io/wc?uri='
    },
    {
        id: 'rabby',
        name: 'Rabby',
        mono: 'R',
        tint: 'linear-gradient(135deg,#8697ff,#5e6bff)',
        // Rabby's iOS universal link is broken in the WalletConnect registry;
        // fall back to copy-and-paste there instead of a link that dead-ends.
        ios: null,
        android: 'rabby://wc?uri='
    },
    {
        id: 'okx',
        name: 'OKX Wallet',
        mono: 'O',
        tint: 'linear-gradient(135deg,#3a3a3a,#000000)',
        ios: 'okx://wallet/wc?uri=',
        android: 'okx://wallet/wc?uri='
    }
];

// Build the deep link for the current pairing URI, or null when this platform
// has no reliable link and must use the copy path.
function buildWalletDeepLink(wallet, isIOS, uri) {
    if (!uri) return null;
    const prefix = isIOS ? wallet.ios : wallet.android;
    if (!prefix) return null;
    return `${prefix}${encodeURIComponent(uri)}`;
}

function ensureSheetStyles() {
    if (document.getElementById(SHEET_STYLE_ID)) return;
    // The slide-up animation is Future-theme only (Classic = no animation).
    const isFuture = (() => {
        try {
            if (document.documentElement.classList.contains('future') ||
                document.body?.classList.contains('future')) return true;
            return localStorage.getItem('artsoul_theme') === 'future';
        } catch {
            return false;
        }
    })();
    const style = document.createElement('style');
    style.id = SHEET_STYLE_ID;
    style.textContent = `
#${SHEET_ID}-backdrop{position:fixed;inset:0;z-index:2147483645;background:rgba(0,0,0,0.55);backdrop-filter:blur(2px);}
#${SHEET_ID}{position:fixed;left:0;right:0;bottom:0;z-index:2147483646;color:var(--c-text);
  background:var(--c-surface);border-top:1px solid var(--c-border);
  border-radius:20px 20px 0 0;box-shadow:0 -8px 40px rgba(0,0,0,0.45);
  padding:14px 16px calc(16px + env(safe-area-inset-bottom,0px));
  max-height:88vh;overflow:auto;-webkit-overflow-scrolling:touch;}
${isFuture ? `#${SHEET_ID}{animation:artsoulSheetUp .26s cubic-bezier(.16,1,.3,1);}
@keyframes artsoulSheetUp{from{transform:translateY(100%);}to{transform:translateY(0);}}` : ''}
#${SHEET_ID} .as-grip{width:38px;height:4px;border-radius:999px;background:var(--c-border);margin:2px auto 12px;}
#${SHEET_ID} .as-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:4px;}
#${SHEET_ID} .as-title{font-size:1.12rem;font-weight:800;letter-spacing:.2px;}
#${SHEET_ID} .as-close{width:34px;height:34px;border-radius:999px;border:1px solid var(--c-border);
  background:var(--c-bg);color:var(--c-text);font-size:1.1rem;line-height:1;cursor:pointer;flex:0 0 auto;}
#${SHEET_ID} .as-status{margin:2px 0 12px;color:var(--c-text-muted);font-size:.86rem;line-height:1.45;}
#${SHEET_ID} .as-list{display:grid;gap:8px;}
#${SHEET_ID} .as-row{display:flex;align-items:center;gap:12px;width:100%;text-align:left;
  min-height:58px;padding:9px 12px;border:1px solid var(--c-border);border-radius:14px;
  background:var(--c-bg);color:var(--c-text);font:inherit;cursor:pointer;transition:border-color .15s ease,transform .06s ease;}
#${SHEET_ID} .as-row:active{transform:scale(.985);}
#${SHEET_ID} .as-row:hover{border-color:var(--c-accent);}
#${SHEET_ID} .as-ic{width:38px;height:38px;border-radius:11px;flex:0 0 auto;display:flex;
  align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:1.05rem;
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.12);}
#${SHEET_ID} .as-name{font-weight:700;font-size:1rem;flex:1 1 auto;}
#${SHEET_ID} .as-hint{color:var(--c-text-muted);font-size:.72rem;font-weight:600;}
#${SHEET_ID} .as-chev{color:var(--c-text-muted);font-size:1.1rem;flex:0 0 auto;}
#${SHEET_ID} .as-other{margin-top:2px;}
#${SHEET_ID} .as-qr{display:none;justify-items:center;gap:10px;padding:14px 4px 2px;}
#${SHEET_ID} .as-qr.open{display:grid;}
#${SHEET_ID} .as-qr canvas{background:#fff;border-radius:12px;padding:10px;max-width:100%;}
#${SHEET_ID} .as-qr-hint{margin:0;color:var(--c-text-muted);font-size:.78rem;text-align:center;line-height:1.4;}
#${SHEET_ID} .as-copy{width:100%;min-height:46px;margin-top:4px;border:1px solid var(--c-accent);
  border-radius:12px;background:var(--c-bg);color:var(--c-text);font:inherit;font-weight:700;cursor:pointer;}
#${SHEET_ID} .as-uri{width:100%;min-height:42px;margin-top:8px;padding:9px;border:1px solid var(--c-border);
  border-radius:10px;color:var(--c-text);background:var(--c-bg);font:0.72rem/1.35 ui-monospace,monospace;}
`;
    document.head.appendChild(style);
}

export function removeCoreWalletSheet() {
    document.getElementById(SHEET_ID)?.remove();
    document.getElementById(`${SHEET_ID}-backdrop`)?.remove();
}

export function showCoreWalletSheet({ uri, isIOS, onWalletOpened, onCancel, log } = {}) {
    removeCoreWalletSheet();
    ensureSheetStyles();
    const sheetLog = (step, detail) => {
        try {
            (log || settings.log)?.(step, detail);
        } catch {
            // Diagnostics only.
        }
    };
    let currentUri = uri || '';

    const backdrop = document.createElement('div');
    backdrop.id = `${SHEET_ID}-backdrop`;

    const sheet = document.createElement('section');
    sheet.id = SHEET_ID;
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', 'Connect Wallet');

    const grip = document.createElement('div');
    grip.className = 'as-grip';

    const head = document.createElement('div');
    head.className = 'as-head';
    const title = document.createElement('div');
    title.className = 'as-title';
    title.textContent = 'Connect Wallet';
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'as-close';
    closeButton.setAttribute('aria-label', 'Close');
    closeButton.textContent = '✕';
    head.append(title, closeButton);

    const status = document.createElement('p');
    status.className = 'as-status';
    status.textContent = 'Choose your wallet. Approve the connection there, then return to this browser.';

    const manualUriInput = document.createElement('input');
    manualUriInput.type = 'text';
    manualUriInput.readOnly = true;
    manualUriInput.hidden = true;
    manualUriInput.className = 'as-uri';
    manualUriInput.setAttribute('aria-label', 'WalletConnect link');

    const copyUri = async (message) => {
        if (!currentUri) {
            status.textContent = 'The connection link is not ready yet. Wait a moment and retry.';
            return false;
        }
        try {
            await navigator.clipboard.writeText(currentUri);
            status.textContent = message;
            sheetLog('core sheet uri copied', {});
            return true;
        } catch (error) {
            manualUriInput.value = currentUri;
            manualUriInput.hidden = false;
            manualUriInput.select?.();
            status.textContent = 'Copy failed. Select and copy the link below manually.';
            sheetLog('core sheet uri copy failed', describeCoreError(error));
            return false;
        }
    };

    const openWallet = (wallet) => {
        if (!currentUri) {
            status.textContent = 'The connection link is not ready yet. Wait a moment and retry.';
            return;
        }
        const link = buildWalletDeepLink(wallet, Boolean(isIOS), currentUri);
        if (!link) {
            // No reliable deep link on this platform (e.g. Rabby on iOS). Be
            // honest: copy the link and tell the user to paste it in the wallet.
            void copyUri(`Link copied. Open ${wallet.name} and paste it into WalletConnect.`);
            sheetLog('core sheet manual copy path', { wallet: wallet.id, isIOS: Boolean(isIOS) });
            return;
        }
        status.textContent = `Opening ${wallet.name}… approve the connection there and come back.`;
        sheetLog('core sheet wallet opened', { wallet: wallet.id });
        try {
            onWalletOpened?.(wallet.name);
        } catch {
            // Callback is diagnostics only.
        }
        window.location.href = link;
    };

    const list = document.createElement('div');
    list.className = 'as-list';
    for (const wallet of CORE_WALLETS) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'as-row';
        const icon = document.createElement('span');
        icon.className = 'as-ic';
        icon.style.backgroundImage = wallet.tint;
        icon.textContent = wallet.mono;
        icon.setAttribute('aria-hidden', 'true');
        const name = document.createElement('span');
        name.className = 'as-name';
        name.textContent = wallet.name;
        row.append(icon, name);
        // Flag the platforms where we hand over via copy-and-paste.
        if (!buildWalletDeepLink(wallet, Boolean(isIOS), 'x')) {
            const hint = document.createElement('span');
            hint.className = 'as-hint';
            hint.textContent = 'Copy link';
            row.append(hint);
        } else {
            const chev = document.createElement('span');
            chev.className = 'as-chev';
            chev.textContent = '›';
            chev.setAttribute('aria-hidden', 'true');
            row.append(chev);
        }
        row.addEventListener('click', () => openWallet(wallet));
        list.append(row);
    }

    // "Other wallets" — QR (desktop-style render) + copy link for any
    // WalletConnect-compatible wallet not in the list above.
    const otherRow = document.createElement('button');
    otherRow.type = 'button';
    otherRow.className = 'as-row as-other';
    const otherIcon = document.createElement('span');
    otherIcon.className = 'as-ic';
    otherIcon.style.backgroundImage = 'linear-gradient(135deg,var(--c-accent),var(--c-accent-2,var(--c-accent)))';
    otherIcon.textContent = '⊕';
    otherIcon.setAttribute('aria-hidden', 'true');
    const otherName = document.createElement('span');
    otherName.className = 'as-name';
    otherName.textContent = 'Other wallets (QR / link)';
    const otherChev = document.createElement('span');
    otherChev.className = 'as-chev';
    otherChev.textContent = '›';
    otherRow.append(otherIcon, otherName, otherChev);
    list.append(otherRow);

    const qrPanel = document.createElement('div');
    qrPanel.className = 'as-qr';
    const qrCanvas = document.createElement('canvas');
    const qrHint = document.createElement('p');
    qrHint.className = 'as-qr-hint';
    qrHint.textContent = 'Scan with any WalletConnect-compatible wallet, or copy the link below.';
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'as-copy';
    copyButton.textContent = 'Copy connection link';
    copyButton.addEventListener('click', () => {
        void copyUri('Link copied. Open your wallet, choose WalletConnect, and paste it.');
    });
    qrPanel.append(qrCanvas, qrHint, copyButton);

    let qrRendered = false;
    const renderQr = async () => {
        if (!currentUri) {
            status.textContent = 'The connection link is not ready yet. Wait a moment and retry.';
            return;
        }
        if (qrRendered) return;
        try {
            const qrModule = await import(QR_MODULE_URL);
            const QRCode = qrModule.default || qrModule;
            await QRCode.toCanvas(qrCanvas, currentUri, { width: 232, margin: 1 });
            qrRendered = true;
            sheetLog('core sheet QR rendered', {});
        } catch (error) {
            qrCanvas.hidden = true;
            qrHint.textContent = 'QR is unavailable. Use Copy connection link and paste it into your wallet.';
            sheetLog('core sheet QR render failed', describeCoreError(error));
        }
    };
    otherRow.addEventListener('click', () => {
        const willOpen = !qrPanel.classList.contains('open');
        qrPanel.classList.toggle('open', willOpen);
        otherChev.style.transform = willOpen ? 'rotate(90deg)' : '';
        if (willOpen) void renderQr();
    });

    function close() {
        removeCoreWalletSheet();
    }
    const cancel = () => {
        sheetLog('core sheet cancelled', {});
        close();
        try {
            onCancel?.();
        } catch {
            // Callback is diagnostics only.
        }
    };
    closeButton.addEventListener('click', cancel);
    backdrop.addEventListener('click', cancel);

    sheet.append(grip, head, status, list, qrPanel, manualUriInput);
    document.documentElement.append(backdrop, sheet);
    sheetLog('core sheet shown', { uriAvailable: Boolean(currentUri), isIOS: Boolean(isIOS) });

    return {
        close,
        setStatus(text) {
            status.textContent = text;
        },
        update(nextUri) {
            // Only ever called with the URI of the CURRENT attempt — the sheet
            // itself never asks the provider for a new pairing.
            currentUri = nextUri || currentUri;
            qrRendered = false;
            if (qrPanel.classList.contains('open')) void renderQr();
        }
    };
}
