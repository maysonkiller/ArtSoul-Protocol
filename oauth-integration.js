// OAuth Integration for Discord and Twitter
// Starts and completes server-side OAuth account linking.

class OAuthIntegration {
    constructor() {
        this.providerLabels = { discord: 'Discord', twitter: 'X' };
    }

    async readResponse(response, fallback) {
        const text = await response.text();
        let data = {};
        try {
            data = text ? JSON.parse(text) : {};
        } catch {
            data = {};
        }
        if (!response.ok) {
            throw new Error(data.message || fallback);
        }
        return data;
    }

    async start(provider, walletAddress) {
        if (!walletAddress) {
            throw new Error(`Connect your wallet before linking ${this.providerLabels[provider]}.`);
        }
        const authenticated = await window.ensureAuthenticated?.();
        if (!authenticated) {
            throw new Error('Wallet authentication is required before linking a social account.');
        }

        const response = await fetch('/api/oauth/start', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider })
        });
        const result = await this.readResponse(response, `Could not start ${this.providerLabels[provider]} linking.`);
        if (!result.authorizationUrl) {
            throw new Error(`Could not start ${this.providerLabels[provider]} linking.`);
        }
        window.location.assign(result.authorizationUrl);
    }

    async connectDiscord(walletAddress) {
        return this.start('discord', walletAddress);
    }

    async connectTwitter(walletAddress) {
        return this.start('twitter', walletAddress);
    }

    async handleCallback() {
        const urlParams = new URLSearchParams(window.location.search);
        const status = urlParams.get('oauth_status');
        const provider = urlParams.get('provider');
        if (!status || !provider) return null;

        const errorCode = urlParams.get('oauth_error') || '';
        window.history.replaceState({}, document.title, window.location.pathname);
        if (status === 'success') {
            return { provider, success: true };
        }

        const messages = {
            provider_cancelled: `${this.providerLabels[provider] || 'Social'} linking was cancelled.`,
            state_mismatch: 'Social linking expired or failed its security check. Please try again.',
            wallet_changed: 'The active wallet changed during linking. Reconnect the original wallet and try again.',
            session_expired: 'Your wallet session expired during linking. Please try again.',
            callback_mismatch: 'The OAuth callback URL does not match this deployment.',
            provider_exchange_failed: `${this.providerLabels[provider] || 'Social'} could not complete account linking. Check the app callback settings and try again.`
        };
        return {
            provider,
            success: false,
            error: errorCode,
            message: messages[errorCode] || 'Social account linking failed. Please try again.'
        };
    }

    async disconnect(provider, walletAddress) {
        if (!walletAddress) {
            throw new Error('Connect your wallet before removing a linked account.');
        }
        const authenticated = await window.ensureAuthenticated?.();
        if (!authenticated) {
            throw new Error('Wallet authentication is required before removing a linked account.');
        }
        const response = await fetch('/api/oauth/unlink', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider })
        });
        return this.readResponse(response, `Could not remove the linked ${this.providerLabels[provider]} account.`);
    }
}

// Export for use in profile.html
window.OAuthIntegration = new OAuthIntegration();
