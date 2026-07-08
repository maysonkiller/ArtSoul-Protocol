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
// ARTSOUL WALLET SHEET
// Lightweight ArtSoul-styled chooser replacing the AppKit modal on the
// mobile external-browser path. Theme colors come only from var(--c-*).
// ============================================

export function removeCoreWalletSheet() {
    document.getElementById(SHEET_ID)?.remove();
}

export function showCoreWalletSheet({ uri, isIOS, onWalletOpened, onCancel, log } = {}) {
    removeCoreWalletSheet();
    const sheetLog = (step, detail) => {
        try {
            (log || settings.log)?.(step, detail);
        } catch {
            // Diagnostics only.
        }
    };
    let currentUri = uri || '';

    const sheet = document.createElement('section');
    sheet.id = SHEET_ID;
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', 'Connect your wallet');
    sheet.style.cssText = [
        'position:fixed',
        'left:12px',
        'right:12px',
        'bottom:12px',
        'z-index:2147483646',
        'display:grid',
        'gap:10px',
        'padding:16px',
        'border:1px solid var(--c-border)',
        'border-radius:14px',
        'color:var(--c-text)',
        'background:var(--c-surface)',
        'box-shadow:0 0 18px var(--c-glow, transparent)'
    ].join(';');

    const title = document.createElement('strong');
    title.textContent = 'Connect your wallet';
    const status = document.createElement('p');
    status.style.cssText = 'margin:0;color:var(--c-text-muted);font-size:0.88rem;line-height:1.45';
    status.textContent = 'Choose a wallet. Approve the connection there, then return to this browser.';

    const makeButton = (label) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.style.cssText = [
            'min-height:46px',
            'padding:9px 10px',
            'border:1px solid var(--c-accent)',
            'border-radius:10px',
            'color:var(--c-text)',
            'background:var(--c-bg)',
            'font:inherit',
            'font-weight:700'
        ].join(';');
        return button;
    };

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

    const metamaskButton = makeButton('MetaMask');
    metamaskButton.addEventListener('click', () => {
        if (!currentUri) {
            status.textContent = 'The connection link is not ready yet. Wait a moment and retry.';
            return;
        }
        status.textContent = 'Opening MetaMask... Approve the connection there and come back.';
        sheetLog('core sheet MetaMask opened', {});
        try {
            onWalletOpened?.('MetaMask');
        } catch {
            // Callback is diagnostics only.
        }
        window.location.href = `https://metamask.app.link/wc?uri=${encodeURIComponent(currentUri)}`;
    });

    const rabbyButton = makeButton('Rabby');
    rabbyButton.addEventListener('click', async () => {
        if (isIOS) {
            // Rabby's iOS deep link is broken in the WalletConnect registry.
            // Hand the URI over manually instead of a dead link.
            await copyUri('Link copied. Open Rabby, tap WalletConnect, and paste it.');
            sheetLog('core sheet Rabby iOS copy path', {});
            return;
        }
        if (!currentUri) {
            status.textContent = 'The connection link is not ready yet. Wait a moment and retry.';
            return;
        }
        status.textContent = 'Opening Rabby... Approve the connection there and come back.';
        sheetLog('core sheet Rabby opened', {});
        try {
            onWalletOpened?.('Rabby');
        } catch {
            // Callback is diagnostics only.
        }
        window.location.href = `rabby://wc?uri=${encodeURIComponent(currentUri)}`;
    });

    const otherButton = makeButton('Other wallet');
    const copyButton = makeButton('Copy link');
    copyButton.addEventListener('click', () => {
        void copyUri('Link copied. Open your wallet, choose WalletConnect, and paste it.');
    });

    const cancelButton = makeButton('Cancel');
    cancelButton.style.borderColor = 'var(--c-border)';
    cancelButton.addEventListener('click', () => {
        sheetLog('core sheet cancelled', {});
        close();
        try {
            onCancel?.();
        } catch {
            // Callback is diagnostics only.
        }
    });

    const qrPanel = document.createElement('div');
    qrPanel.hidden = true;
    qrPanel.style.cssText = 'display:grid;justify-items:center;gap:8px';
    const qrCanvas = document.createElement('canvas');
    qrCanvas.style.cssText = 'background:#ffffff;border-radius:10px;padding:8px;max-width:100%';
    const qrHint = document.createElement('p');
    qrHint.style.cssText = 'margin:0;color:var(--c-text-muted);font-size:0.8rem;text-align:center';
    qrHint.textContent = 'Scan with any WalletConnect-compatible wallet, or copy the link.';
    qrPanel.append(qrCanvas, qrHint);

    let qrRendered = false;
    const renderQr = async () => {
        if (!currentUri) {
            status.textContent = 'The connection link is not ready yet. Wait a moment and retry.';
            return;
        }
        qrPanel.hidden = false;
        if (qrRendered) return;
        try {
            const qrModule = await import(QR_MODULE_URL);
            const QRCode = qrModule.default || qrModule;
            await QRCode.toCanvas(qrCanvas, currentUri, { width: 220, margin: 1 });
            qrRendered = true;
            sheetLog('core sheet QR rendered', {});
        } catch (error) {
            qrCanvas.hidden = true;
            qrHint.textContent = 'QR is unavailable. Use Copy link and paste it into your wallet.';
            sheetLog('core sheet QR render failed', describeCoreError(error));
        }
    };
    otherButton.addEventListener('click', () => void renderQr());

    const manualUriInput = document.createElement('input');
    manualUriInput.type = 'text';
    manualUriInput.readOnly = true;
    manualUriInput.hidden = true;
    manualUriInput.setAttribute('aria-label', 'WalletConnect link');
    manualUriInput.style.cssText = [
        'width:100%',
        'min-height:40px',
        'padding:8px',
        'border:1px solid var(--c-border)',
        'border-radius:8px',
        'color:var(--c-text)',
        'background:var(--c-bg)',
        'font:0.75rem/1.3 ui-monospace, monospace'
    ].join(';');

    const actions = document.createElement('div');
    actions.style.cssText = 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px';
    actions.append(metamaskButton, rabbyButton, otherButton, copyButton);

    sheet.append(title, status, actions, qrPanel, manualUriInput, cancelButton);
    document.documentElement.appendChild(sheet);
    sheetLog('core sheet shown', { uriAvailable: Boolean(currentUri), isIOS: Boolean(isIOS) });

    function close() {
        sheet.remove();
    }

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
            if (!qrPanel.hidden) void renderQr();
        }
    };
}
