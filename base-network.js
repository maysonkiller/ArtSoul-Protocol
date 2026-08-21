/**
 * The one list of ways to reach Base Sepolia.
 *
 * There were two. appkit-init.js configures the wallet's chain and gained
 * fallback routes in A-70; the account menu reads the balance with its own
 * fetch, in a classic script that cannot import from a module, and still had a
 * single address. So when the public endpoint stopped answering, the balance
 * showed a bare ellipsis while everything else had somewhere else to go.
 *
 * A plain script with no imports, loaded before both consumers, so neither has
 * to know how the other reaches the chain.
 *
 * One chain: these are additional routes to 84532, never another network.
 */
(function () {
    'use strict';

    const RPC_URLS = [
        // The public endpoint stays first: it is the one Base documents, and on
        // 2026-08-21 it was also the one that answered `no backend is currently
        // healthy to serve traffic` for a sustained period.
        'https://sepolia.base.org',
        'https://base-sepolia-rpc.publicnode.com',
        'https://base-sepolia.drpc.org'
    ];

    /**
     * Try each route in turn and return the first answer. A route that fails is
     * not an error worth showing anyone: the next one is tried, and only when
     * all of them are gone does the caller learn nothing came back.
     */
    async function rpc(method, params) {
        let lastError = null;
        for (const url of RPC_URLS) {
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
                });
                if (!response.ok) throw new Error(`${url} returned ${response.status}`);
                const payload = await response.json();
                if (payload.error) throw new Error(payload.error.message || `${url} refused ${method}`);
                return payload.result;
            } catch (error) {
                lastError = error;
            }
        }
        throw lastError || new Error(`No Base Sepolia route answered ${method}`);
    }

    window.ArtSoulBaseSepolia = Object.freeze({
        chainId: 84532,
        rpcUrls: Object.freeze(RPC_URLS.slice()),
        rpc
    });
})();
