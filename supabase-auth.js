// Supabase Auth Integration for ArtSoul
// Handles wallet signature auth and social OAuth

let supabaseClient = null;
let authenticatedWallet = null; // Cache authenticated wallet to prevent repeated signature requests
let backendSessionCache = null;
let publicConfigPromise = null;

async function loadSupabasePublicConfig() {
    if (window.ArtSoulPublicConfig?.load) {
        return window.ArtSoulPublicConfig.load();
    }

    if (window.ArtSoulPublicConfigData) {
        return window.ArtSoulPublicConfigData;
    }

    if (!publicConfigPromise) {
        publicConfigPromise = fetch('/api/public/config', {
            method: 'GET',
            credentials: 'omit'
        }).then(async response => {
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
            return data;
        });
    }

    return publicConfigPromise;
}

function normalizeWalletAddress(value) {
    return value ? String(value).toLowerCase() : '';
}

function getActiveWalletAddress() {
    return normalizeWalletAddress(
        window.getCurrentWalletAddress?.() ||
        window.currentWalletAddress
    );
}

function setBackendSession(wallet) {
    const normalizedWallet = normalizeWalletAddress(wallet);
    if (!normalizedWallet) {
        backendSessionCache = null;
        authenticatedWallet = null;
        localStorage.removeItem('artsoul_authenticated_wallet');
        return null;
    }

    backendSessionCache = {
        user: {
            id: `wallet_${normalizedWallet}`,
            user_metadata: {
                wallet_address: normalizedWallet,
                auth_method: 'siwe'
            }
        },
        walletAddress: normalizedWallet,
        backend: true
    };
    authenticatedWallet = normalizedWallet;
    localStorage.setItem('artsoul_authenticated_wallet', normalizedWallet);
    localStorage.setItem('artsoul_auth_method', 'siwe');

    return backendSessionCache;
}

function clearBackendSessionCache({ preserveActiveWallet = true } = {}) {
    backendSessionCache = null;
    authenticatedWallet = null;
    localStorage.removeItem('artsoul_authenticated_wallet');
    localStorage.removeItem('artsoul_auth_method');

    if (!preserveActiveWallet) {
        localStorage.removeItem('artsoul_wallet');
    }
}

async function initSupabase() {
    if (supabaseClient) return supabaseClient;

    const config = await loadSupabasePublicConfig();
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    supabaseClient = createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: {
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: true
        }
    });

    console.log(' Supabase Auth initialized');
    return supabaseClient;
}

const BACKEND_AUTH_PREFIXES = ['/api/auth', '/auth'];

async function fetchBackendAuth(path, options = {}) {
    let lastError = null;

    for (const prefix of BACKEND_AUTH_PREFIXES) {
        try {
            const response = await fetch(`${prefix}${path}`, {
                ...options,
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    ...(options.headers || {})
                }
            });

            const shouldTryFallback = response.status === 404 ||
                (prefix === '/api/auth' && response.status === 401);
            if (shouldTryFallback) {
                lastError = new Error('Auth endpoint not found');
                continue;
            }

            const text = await response.text();
            const data = text ? JSON.parse(text) : {};
            if (!response.ok) {
                const error = new Error(data.message || data.error || 'Authentication request failed');
                error.status = response.status;
                throw error;
            }
            return data;
        } catch (error) {
            lastError = error;
            break;
        }
    }

    throw lastError || new Error('Authentication backend unavailable');
}

async function getBackendSession() {
    try {
        const session = await fetchBackendAuth('/session', { method: 'GET' });
        if (session?.authenticated && session.wallet) {
            return setBackendSession(session.wallet);
        }
    } catch (error) {
        console.warn('Backend session check unavailable:', error.message);
    }

    clearBackendSessionCache();
    return null;
}

async function getActiveChainId(provider) {
    try {
        const rawChainId = await provider?.request?.({ method: 'eth_chainId' });
        if (typeof rawChainId === 'string' && rawChainId.startsWith('0x')) {
            return parseInt(rawChainId, 16);
        }
        return Number(rawChainId) || 84532;
    } catch {
        return 84532;
    }
}

function buildSiweMessage(walletAddress, nonce, chainId) {
    return [
        `${window.location.host} wants you to sign in with your Ethereum account:`,
        walletAddress.toLowerCase(),
        '',
        'Sign in to ArtSoul.',
        '',
        `URI: ${window.location.origin}`,
        'Version: 1',
        `Chain ID: ${chainId || 84532}`,
        `Nonce: ${nonce}`,
        `Issued At: ${new Date().toISOString()}`
    ].join('\n');
}

// ============================================
// WALLET SIGNATURE AUTHENTICATION
// ============================================

/**
 * Authenticate user with wallet signature
 * Creates a backend SIWE session with wallet address as user ID
 */
async function authenticateWithWallet(walletAddress, provider) {
    try {
        const normalizedWallet = normalizeWalletAddress(walletAddress);
        const activeProvider = provider || window.ethereum;

        if (!normalizedWallet) {
            throw new Error('No wallet address provided for authentication');
        }

        if (!activeProvider?.request) {
            throw new Error('No wallet provider available for authentication');
        }

        const providerAccounts = await activeProvider.request({ method: 'eth_accounts' });
        const providerWallets = (Array.isArray(providerAccounts) ? providerAccounts : [])
            .map(normalizeWalletAddress);
        const selectedProviderWallet = normalizeWalletAddress(activeProvider.selectedAddress);
        const providerActiveWallet = selectedProviderWallet && providerWallets.includes(selectedProviderWallet)
            ? selectedProviderWallet
            : providerWallets[0];
        if (providerActiveWallet !== normalizedWallet) {
            throw new Error('The selected wallet account changed. Please try the protected action again.');
        }

        await invalidateSessionForWalletMismatch(normalizedWallet);

        if (authenticatedWallet?.toLowerCase() === normalizedWallet && backendSessionCache) {
            console.log(' Already authenticated with backend SIWE session');
            return backendSessionCache;
        }

        const existingSession = await getBackendSession();
        if (existingSession?.walletAddress?.toLowerCase() === normalizedWallet) {
            console.log(' Existing backend SIWE session restored');
            return existingSession;
        }

        const { nonce } = await fetchBackendAuth(`/nonce?wallet=${encodeURIComponent(normalizedWallet)}`, {
            method: 'GET'
        });
        const chainId = await getActiveChainId(activeProvider);
        const message = buildSiweMessage(normalizedWallet, nonce, chainId);

        console.log(' Requesting SIWE signature from wallet...');
        let signature;

        if (activeProvider && activeProvider.request) {
            signature = await activeProvider.request({
                method: 'personal_sign',
                params: [message, normalizedWallet]
            });
        } else if (window.ethereum) {
            signature = await window.ethereum.request({
                method: 'personal_sign',
                params: [message, normalizedWallet]
            });
        } else {
            throw new Error('No wallet provider available');
        }

        const verified = await fetchBackendAuth('/verify', {
            method: 'POST',
            body: JSON.stringify({
                message,
                signature,
                address: normalizedWallet,
                nonce
            })
        });

        const verifiedWallet = normalizeWalletAddress(verified.wallet || normalizedWallet);
        const activeWalletAfterSignature = getActiveWalletAddress();
        if (activeWalletAfterSignature !== verifiedWallet) {
            try {
                await fetchBackendAuth('/logout', { method: 'POST' });
            } catch (logoutError) {
                console.warn('Stale SIWE session cleanup failed:', logoutError.message);
            }
            clearBackendSessionCache();
            throw new Error('The active wallet changed during sign-in. Please try again with the current account.');
        }
        return setBackendSession(verifiedWallet);
    } catch (error) {
        console.error(' Backend SIWE auth failed:', error);
        throw error;
    }
}
// ============================================
// SOCIAL OAUTH AUTHENTICATION
// ============================================

/**
 * Authenticate with social provider (Google, Twitter)
 * Uses Supabase OAuth flow
 */
async function authenticateWithSocial(provider) {
    const supabase = await initSupabase();

    try {
        console.log(`🔐 Starting ${provider} OAuth...`);

        const redirectUrl = new URL(window.location.href);
        redirectUrl.search = '';
        redirectUrl.hash = '';

        const { data, error } = await supabase.auth.signInWithOAuth({
            provider: provider,
            options: {
                redirectTo: redirectUrl.toString(),
                skipBrowserRedirect: false
            }
        });

        if (error) throw error;

        console.log(` ${provider} OAuth initiated`);
        return data;

    } catch (error) {
        console.error(` ${provider} OAuth failed:`, error);
        throw error;
    }
}

/**
 * Handle OAuth callback after redirect
 */
async function handleOAuthCallback() {
    const supabase = await initSupabase();

    try {
        // Check if we're in OAuth callback. Supabase may return either
        // implicit-flow hash tokens or a PKCE ?code= callback.
        const urlParams = new URLSearchParams(window.location.search);
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const code = urlParams.get('code') || hashParams.get('code');
        const accessToken = hashParams.get('access_token');
        const oauthError = urlParams.get('error') || hashParams.get('error');
        const oauthErrorDescription = urlParams.get('error_description') || hashParams.get('error_description');

        if (oauthError) {
            throw new Error(oauthErrorDescription || oauthError);
        }

        if (!code && !accessToken) return null;

        let session = null;

        if (code && typeof supabase.auth.exchangeCodeForSession === 'function') {
            const { data, error } = await supabase.auth.exchangeCodeForSession(code);
            if (error) {
                const { data: existingData, error: sessionError } = await supabase.auth.getSession();
                if (sessionError || !existingData?.session) throw error;
                session = existingData.session;
            } else {
                session = data?.session || null;
            }
        }

        for (let attempt = 0; !session && attempt < 12; attempt++) {
            const { data: { session: currentSession }, error } = await supabase.auth.getSession();
            if (error) throw error;
            if (currentSession) {
                session = currentSession;
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 150));
        }

        if (session) {
            console.log(' OAuth session restored:', session.user.id);
            localStorage.setItem('artsoul_auth_method', 'social');

            // Clean URL
            window.history.replaceState({}, document.title, window.location.pathname);

            return {
                user: session.user,
                session: session,
                provider: session.user.app_metadata.provider
            };
        }

        return null;

    } catch (error) {
        console.error(' OAuth callback failed:', error);
        return null;
    }
}

// ============================================
// SESSION MANAGEMENT
// ============================================

/**
 * Get current authenticated session
 */
async function getCurrentSession() {
    const backendSession = await getBackendSession();
    if (backendSession) return backendSession;

    return null;
}

/**
 * Get current user
 */
async function getCurrentUser() {
    const supabase = await initSupabase();

    const { data: { user }, error } = await supabase.auth.getUser();

    if (error) {
        console.error('Error getting user:', error);
        return null;
    }

    return user;
}

/**
 * Sign out
 */
async function signOut() {
    try {
        await fetchBackendAuth('/logout', { method: 'POST' });
    } catch (error) {
        console.warn('Backend logout unavailable:', error.message);
    }

    if (supabaseClient) {
        const { error } = await supabaseClient.auth.signOut();

        if (error) {
            console.error('Error signing out:', error);
            throw error;
        }
    }

    clearBackendSessionCache({ preserveActiveWallet: false });

    console.log(' Signed out');
}

async function invalidateSessionForWalletMismatch(walletAddress) {
    const normalizedWallet = normalizeWalletAddress(walletAddress);
    const cachedWallet = normalizeWalletAddress(authenticatedWallet || localStorage.getItem('artsoul_authenticated_wallet'));
    let sessionWallet = normalizeWalletAddress(backendSessionCache?.walletAddress || cachedWallet);

    if (!sessionWallet) {
        try {
            const session = await fetchBackendAuth('/session', { method: 'GET' });
            sessionWallet = normalizeWalletAddress(session?.wallet);
        } catch {
            sessionWallet = '';
        }
    }

    if (!sessionWallet || !normalizedWallet || sessionWallet === normalizedWallet) {
        return false;
    }

    try {
        await fetchBackendAuth('/logout', { method: 'POST' });
    } catch (error) {
        console.warn('Backend logout for stale SIWE session unavailable:', error.message);
    }

    clearBackendSessionCache();
    return true;
}

/**
 * Check if user is authenticated
 */
async function isAuthenticated(walletAddress = null) {
    const normalizedWallet = normalizeWalletAddress(walletAddress || getActiveWalletAddress());
    const session = await getCurrentSession();
    if (!session) return false;

    const sessionWallet = normalizeWalletAddress(session.walletAddress || session.user?.user_metadata?.wallet_address);
    return normalizedWallet ? sessionWallet === normalizedWallet : Boolean(sessionWallet);
}

async function isAuthenticatedForWallet(walletAddress) {
    return isAuthenticated(walletAddress);
}

function getAuthenticatedWallet() {
    return normalizeWalletAddress(authenticatedWallet || localStorage.getItem('artsoul_authenticated_wallet'));
}

/**
 * Get wallet address from session or localStorage
 */
function getWalletAddress() {
    return getActiveWalletAddress();
}

// ============================================
// EXPORTS
// ============================================

window.SupabaseAuth = {
    initSupabase,
    authenticateWithWallet,
    authenticateWithSocial,
    handleOAuthCallback,
    getCurrentSession,
    getCurrentUser,
    signOut,
    invalidateSessionForWalletMismatch,
    isAuthenticated,
    isAuthenticatedForWallet,
    getAuthenticatedWallet,
    getWalletAddress
};

console.log('🔐 Supabase Auth module loaded');
