// Keep the wallet SDK out of every page's static module graph.
//
// Public browsing needs no provider. The shared header already paints its last
// confirmed visual identity without trusting it for authorization, so AppKit
// can start after the page entry has mounted and the browser has had one paint.
// Wallet actions still have a bounded path to the exact same runtime through
// the small async proxies below; AppKit replaces each proxy when it evaluates.

// Long enough that a visible page always starts on its own frame first, short
// enough that a hidden tab is not left without a wallet runtime.
const WALLET_RUNTIME_START_FALLBACK_MS = 1500;

let runtimePromise = null;
let runtimeReady = false;

async function waitForWalletRuntimeBoot() {
    if (document.readyState === 'loading') {
        await new Promise(resolve => {
            document.addEventListener('DOMContentLoaded', resolve, { once: true });
        });
    }

    const bootPromise = window.__artsoulAppKitBootPromise;
    if (!bootPromise || typeof bootPromise.then !== 'function') {
        throw new Error('Wallet runtime boot did not start.');
    }
    await bootPromise;
}

function loadWalletRuntime() {
    if (!runtimePromise) {
        runtimePromise = import('./appkit-init.js?v=54')
            .then(async module => {
                await waitForWalletRuntimeBoot();
                runtimeReady = true;
                window.dispatchEvent(new CustomEvent('artsoul:wallet-runtime-ready'));
                return module;
            })
            .catch(error => {
                runtimePromise = null;
                runtimeReady = false;
                throw error;
            });
    }
    return runtimePromise;
}

const installAsyncProxy = name => {
    if (typeof window[name] === 'function') return;
    const proxy = async (...args) => {
        await loadWalletRuntime();
        const implementation = window[name];
        if (typeof implementation !== 'function' || implementation === proxy) {
            throw new Error(`Wallet runtime did not provide ${name}.`);
        }
        return implementation(...args);
    };
    window[name] = proxy;
};

[
    'safeConnectWallet',
    'ensureWalletConnected',
    'ensureAuthenticated',
    'ensureArtSoulWriteNetwork',
    'switchArtSoulNetwork',
    'requestArtSoulWalletProvider',
    'resetWalletConnection'
].forEach(installAsyncProxy);

window.ArtSoulWalletRuntime = Object.freeze({
    load: loadWalletRuntime,
    isLoading: () => Boolean(runtimePromise && !runtimeReady),
    isReady: () => runtimeReady
});

function startAfterFirstPaint() {
    let started = false;
    const start = () => {
        if (started) return;
        started = true;
        loadWalletRuntime().catch(error => {
            console.warn('Wallet runtime unavailable:', error);
        });
    };

    // requestAnimationFrame is the right signal - it fires after the browser has
    // had a frame, which is the whole point of deferring the SDK. But a frame is
    // exactly what a background tab never produces, and a page opened in one and
    // read later would then sit with no wallet runtime at all: a restored session
    // would not reconnect, and anything asking whether a wallet is present would
    // be told no. So the frame is raced against a short timer, and whichever
    // arrives first starts the import once.
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => setTimeout(start, 0));
    }
    setTimeout(start, WALLET_RUNTIME_START_FALLBACK_MS);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startAfterFirstPaint, { once: true });
} else {
    startAfterFirstPaint();
}
