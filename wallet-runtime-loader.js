// Keep the wallet SDK out of every page's static module graph.
//
// Public browsing needs no provider. The shared header already paints its last
// confirmed visual identity without trusting it for authorization, so AppKit
// can start after the page entry has mounted and the browser has had one paint.
// Wallet actions still have a bounded path to the exact same runtime through
// the small async proxies below; AppKit replaces each proxy when it evaluates.

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
    const start = () => {
        loadWalletRuntime().catch(error => {
            console.warn('Wallet runtime unavailable:', error);
        });
    };

    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => setTimeout(start, 0));
    } else {
        setTimeout(start, 0);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startAfterFirstPaint, { once: true });
} else {
    startAfterFirstPaint();
}
