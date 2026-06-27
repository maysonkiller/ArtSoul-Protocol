// OAuth Integration for Discord and Twitter
// Handles OAuth flow with PKCE for security

class OAuthIntegration {
    constructor() {
        this.publicConfig = null;
        this.discordClientId = '1498799956536852480';
        this.twitterClientId = 'YVNmTUVHcE5Sb1hVbnp3NUFFNUs6MTpjaQ';
    }

    async loadPublicConfig() {
        if (this.publicConfig) {
            return this.publicConfig;
        }

        if (window.ArtSoulPublicConfig?.load) {
            this.publicConfig = await window.ArtSoulPublicConfig.load();
            return this.publicConfig;
        }

        const response = await fetch('/api/public/config', {
            method: 'GET',
            credentials: 'omit'
        });
        const text = await response.text();
        const data = text ? JSON.parse(text) : {};
        if (!response.ok) {
            throw new Error(data.message || data.error || 'Public Supabase configuration unavailable');
        }
        if (!data.supabaseUrl || !data.supabaseAnonKey) {
            throw new Error('Public Supabase configuration is incomplete');
        }
        window.ArtSoulPublicConfigData = data;
        window.SUPABASE_ANON_KEY = data.supabaseAnonKey;
        this.publicConfig = data;
        return data;
    }

    getRedirectUri() {
        const profileUrl = new URL('profile.html', window.location.href);
        profileUrl.search = '';
        profileUrl.hash = '';
        return profileUrl.toString();
    }

    // Generate random string for PKCE
    generateRandomString(length) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
        let result = '';
        const randomValues = new Uint8Array(length);
        crypto.getRandomValues(randomValues);
        randomValues.forEach(v => result += chars[v % chars.length]);
        return result;
    }

    // Generate code challenge for PKCE
    async generateCodeChallenge(codeVerifier) {
        const encoder = new TextEncoder();
        const data = encoder.encode(codeVerifier);
        const hash = await crypto.subtle.digest('SHA-256', data);
        return btoa(String.fromCharCode(...new Uint8Array(hash)))
            .replace(/=/g, '')
            .replace(/\+/g, '-')
            .replace(/\//g, '_');
    }

    // Connect Discord
    async connectDiscord(walletAddress) {
        if (!walletAddress) {
            alert('Connect wallet before linking Discord');
            return;
        }

        const state = walletAddress;
        const scope = 'identify email';
        const redirectUri = this.getRedirectUri();

        const authUrl = `https://discord.com/api/oauth2/authorize?` +
            `client_id=${this.discordClientId}&` +
            `redirect_uri=${encodeURIComponent(redirectUri)}&` +
            `response_type=code&` +
            `scope=${encodeURIComponent(scope)}&` +
            `state=${encodeURIComponent(state)}`;

        // Store provider for callback
        localStorage.setItem('oauth_provider', 'discord');
        localStorage.setItem('oauth_wallet', walletAddress);
        localStorage.setItem('oauth_redirect_uri', redirectUri);

        window.location.href = authUrl;
    }

    // Connect Twitter
    async connectTwitter(walletAddress) {
        if (!walletAddress) {
            alert('Connect wallet before linking X');
            return;
        }

        const state = walletAddress;
        const codeVerifier = this.generateRandomString(128);
        const codeChallenge = await this.generateCodeChallenge(codeVerifier);
        const redirectUri = this.getRedirectUri();

        // Store code verifier for callback
        localStorage.setItem('twitter_code_verifier', codeVerifier);
        localStorage.setItem('oauth_provider', 'twitter');
        localStorage.setItem('oauth_wallet', walletAddress);
        localStorage.setItem('oauth_redirect_uri', redirectUri);

        const scope = 'tweet.read users.read offline.access';
        const authUrl = `https://twitter.com/i/oauth2/authorize?` +
            `client_id=${this.twitterClientId}&` +
            `redirect_uri=${encodeURIComponent(redirectUri)}&` +
            `response_type=code&` +
            `scope=${encodeURIComponent(scope)}&` +
            `state=${encodeURIComponent(state)}&` +
            `code_challenge=${codeChallenge}&` +
            `code_challenge_method=S256`;

        window.location.href = authUrl;
    }

    // Handle OAuth callback
    async handleCallback() {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        const state = urlParams.get('state');
        const provider = localStorage.getItem('oauth_provider');
        const walletAddress = state || localStorage.getItem('oauth_wallet') || '';
        const redirectUri = localStorage.getItem('oauth_redirect_uri') || this.getRedirectUri();

        if (!code || !provider) return null;

        try {
            let result;
            if (provider === 'discord') {
                result = await this.handleDiscordCallback(code, walletAddress, redirectUri);
            } else if (provider === 'twitter') {
                const codeVerifier = localStorage.getItem('twitter_code_verifier');
                result = await this.handleTwitterCallback(code, walletAddress, codeVerifier, redirectUri);
            }

            // Clean up
            localStorage.removeItem('oauth_provider');
            localStorage.removeItem('oauth_wallet');
            localStorage.removeItem('oauth_redirect_uri');
            localStorage.removeItem('twitter_code_verifier');
            if (walletAddress) {
                localStorage.setItem('artsoul_wallet', walletAddress.toLowerCase());
                window.currentWalletAddress = walletAddress.toLowerCase();
            }

            // Remove query params from URL
            window.history.replaceState({}, document.title, window.location.pathname);

            return {
                ...(result || {}),
                provider,
                walletAddress
            };
        } catch (error) {
            console.error('OAuth callback error:', error);
            alert(`Failed to connect ${provider}: ${error.message}`);
            return null;
        }
    }

    async handleDiscordCallback(code, state, redirectUri) {
        const config = await this.loadPublicConfig();
        const response = await fetch(`${config.supabaseUrl}/functions/v1/discord-oauth`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': config.supabaseAnonKey,
                'Authorization': `Bearer ${config.supabaseAnonKey}`,
            },
            body: JSON.stringify({ code, state, redirect_uri: redirectUri }),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to connect Discord');
        }

        return await response.json();
    }

    async handleTwitterCallback(code, state, codeVerifier, redirectUri) {
        const config = await this.loadPublicConfig();
        const response = await fetch(`${config.supabaseUrl}/functions/v1/twitter-oauth`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': config.supabaseAnonKey,
                'Authorization': `Bearer ${config.supabaseAnonKey}`,
            },
            body: JSON.stringify({ code, state, code_verifier: codeVerifier, redirect_uri: redirectUri }),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to connect Twitter');
        }

        return await response.json();
    }

    // Disconnect provider
    async disconnect(provider, walletAddress) {
        if (!window.ArtSoulDB) return;

        const updates = {};
        if (provider === 'discord') {
            updates.discord_id = null;
            updates.discord_username = null;
            updates.discord_avatar = null;
        } else if (provider === 'twitter') {
            updates.twitter_id = null;
            updates.twitter_username = null;
            updates.twitter_handle = null;
        }

        await window.ArtSoulDB.updateProfile(walletAddress, updates);
    }
}

// Export for use in profile.html
window.OAuthIntegration = new OAuthIntegration();
