(function (global) {
    'use strict';

    const ENDPOINT = '/api/ai/analyze';

    async function ensureWalletAuthentication(promptAuthentication = true) {
        const isAuthenticated = await global.SupabaseAuth?.isAuthenticated?.();
        if (isAuthenticated) return;

        if (!promptAuthentication) {
            throw new Error('AI value guidance is unavailable because wallet authorization is not active.');
        }

        const authenticated = await global.ensureAuthenticated?.();
        if (!authenticated) {
            throw new Error('Authorize your wallet before requesting AI value guidance.');
        }
    }

    async function request(payload, options = {}) {
        const walletAddress = payload?.creator || global.getCurrentWalletAddress?.();
        if (!walletAddress) {
            throw new Error('Connect your wallet before requesting AI value guidance.');
        }

        await ensureWalletAuthentication(options.promptAuthentication !== false);

        const response = await fetch(ENDPOINT, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            signal: options.signal,
            body: JSON.stringify({
                ...payload,
                creator: walletAddress,
                chain_id: payload?.chain_id || global.getCurrentChainId?.() || 84532
            })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.valuation) {
            throw new Error(data?.message || 'AI value guidance is temporarily unavailable. Please try again.');
        }

        return {
            valuation: {
                ...data.valuation,
                model: data.model || 'gemini-2.5-flash-lite',
                guidance_only: true,
                generated_at: new Date().toISOString()
            },
            logged: Boolean(data.valuation_logged)
        };
    }

    global.ArtSoulAIValuation = Object.freeze({ ENDPOINT, request });
})(window);
