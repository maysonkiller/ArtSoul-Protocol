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

    // A list of routes is worth nothing if the first one can hold the caller
    // forever. The 2026-08-21 endpoint answered - badly - so the loop moved on;
    // a node that accepts the socket and then says nothing never would, and the
    // second and third routes would never be tried at all. Every attempt is
    // bounded, so falling through is guaranteed rather than hoped for.
    const RPC_TIMEOUT_MS = 8000;
    // The probe only asks whether anything is home, so it waits far less than a
    // real call. The budget covers the WHOLE probe, and it is shared out so that
    // the first route cannot spend it all: given the whole remaining budget, one
    // hanging endpoint reaches the deadline alone and the two healthy routes
    // behind it are never dialled - the exact failure this list exists to
    // survive. Each route gets an equal share of what is left, and a route that
    // answers quickly hands its unused time to the ones after it.
    const PROBE_BUDGET_MS = 3000;
    // Before the wallet provider is built nobody is reading an error message;
    // they are waiting for a modal. That path passes a shorter budget.
    const PROBE_INIT_BUDGET_MS = 900;
    const CHAIN_ID = 84532;

    /**
     * One attempt at one route, bounded. Returns the JSON-RPC result or throws
     * an error carrying what actually went wrong - a timeout, an HTTP status, or
     * a JSON-RPC error object - because the publish classifier decides what to
     * tell the person from that evidence and must not have to guess.
     */
    async function attempt(url, method, params, timeoutMs) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
                signal: controller.signal
            });
            if (!response.ok) {
                const error = new Error(`${url} returned ${response.status}`);
                error.transport = 'http';
                error.status = response.status;
                error.url = url;
                throw error;
            }
            const payload = await response.json();
            if (payload.error) {
                const error = new Error(payload.error.message || `${url} refused ${method}`);
                error.transport = 'jsonrpc';
                error.rpcError = payload.error;
                error.url = url;
                throw error;
            }
            return payload.result;
        } catch (rawError) {
            if (rawError?.name === 'AbortError') {
                const error = new Error(`${url} did not answer ${method} within ${timeoutMs}ms`);
                error.transport = 'timeout';
                error.timeoutMs = timeoutMs;
                error.url = url;
                throw error;
            }
            if (!rawError?.transport) {
                // fetch itself refused: DNS, TLS, connection, offline.
                rawError.transport = 'network';
                rawError.url = url;
            }
            throw rawError;
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * Try each route in turn and return the first answer. A route that fails is
     * not an error worth showing anyone: the next one is tried, and only when
     * all of them are gone does the caller learn nothing came back.
     */
    async function rpc(method, params) {
        let lastError = null;
        for (const url of RPC_URLS) {
            try {
                return await attempt(url, method, params, RPC_TIMEOUT_MS);
            } catch (error) {
                lastError = error;
            }
        }
        throw lastError || new Error(`No Base Sepolia route answered ${method}`);
    }

    /**
     * Is any route to Base Sepolia answering, right now?
     *
     * Two callers, one question. The publish classifier uses "no route answered"
     * to upgrade an ambiguous failure to an outage - never the reverse, because
     * one endpoint answering `eth_chainId` says nothing about what the wallet's
     * own endpoint did. And the wallet provider uses it to pick the single url
     * WalletConnect will accept.
     *
     * Eligibility is Base Sepolia, checked: an endpoint that answers with some
     * other chain is worse than one that does not answer at all.
     *
     * Never throws. An unresolved probe is its own answer.
     */
    async function probe(options) {
        const budgetMs = Number(options && options.budgetMs) > 0
            ? Number(options.budgetMs)
            : PROBE_BUDGET_MS;
        const attempts = [];
        const deadline = Date.now() + budgetMs;

        for (let index = 0; index < RPC_URLS.length; index += 1) {
            const url = RPC_URLS[index];
            const remaining = deadline - Date.now();
            if (remaining <= 0) {
                attempts.push({ url, ok: false, transport: 'skipped' });
                continue;
            }
            const share = Math.max(1, Math.floor(remaining / (RPC_URLS.length - index)));
            try {
                const chainIdHex = await attempt(url, 'eth_chainId', [], share);
                if (Number(chainIdHex) !== CHAIN_ID) {
                    attempts.push({ url, ok: false, transport: 'wrong-chain', chainIdHex });
                    continue;
                }
                attempts.push({ url, ok: true });
                return { reachable: true, url, chainIdHex, attempts };
            } catch (error) {
                attempts.push({ url, ok: false, transport: error?.transport || 'unknown' });
            }
        }
        return { reachable: false, url: null, chainIdHex: null, attempts };
    }

    window.ArtSoulBaseSepolia = Object.freeze({
        chainId: CHAIN_ID,
        rpcUrls: Object.freeze(RPC_URLS.slice()),
        rpcTimeoutMs: RPC_TIMEOUT_MS,
        probeBudgetMs: PROBE_BUDGET_MS,
        probeInitBudgetMs: PROBE_INIT_BUDGET_MS,
        rpc,
        probe
    });
})();
