// Supabase Auth Integration for ArtSoul
// Handles wallet signature auth and social OAuth

let supabaseClient = null;
let authenticatedWallet = null; // Cache authenticated wallet to prevent repeated signature requests
let backendSessionCache = null;

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
    const previousWallet = authenticatedWallet;
    if (!normalizedWallet) {
        backendSessionCache = null;
        authenticatedWallet = null;
        localStorage.removeItem('artsoul_authenticated_wallet');
        if (previousWallet) window.dispatchEvent(new CustomEvent('artsoul:auth-state-changed'));
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
    if (previousWallet !== normalizedWallet) window.dispatchEvent(new CustomEvent('artsoul:auth-state-changed'));

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
    window.dispatchEvent(new CustomEvent('artsoul:auth-state-changed'));
}

async function initSupabase() {
    if (supabaseClient) return supabaseClient;

    if (typeof window.ArtSoulDB?.initSupabase !== 'function') {
        throw new Error('Shared ArtSoul Supabase client is unavailable');
    }

    supabaseClient = await window.ArtSoulDB.initSupabase();
    return supabaseClient;
}

const BACKEND_AUTH_PREFIXES = ['/api/auth', '/auth'];
const BACKEND_AUTH_ERROR_CODES = new Set([
    'INVALID_WALLET', 'INVALID_AUTH_PAYLOAD', 'INVALID_SIWE_MESSAGE', 'INVALID_SIGNATURE',
    'NONCE_NOT_IN_MESSAGE', 'INVALID_OR_EXPIRED_NONCE', 'MISSING_SESSION_SECRET',
    'MISSING_SUPABASE_URL', 'MISSING_SERVICE_ROLE_KEY', 'SIWE_NONCES_TABLE_MISSING',
    'SUPABASE_SERVICE_ROLE_AUTH_FAILED', 'SUPABASE_INSERT_FAILED', 'SUPABASE_UPDATE_FAILED',
    'SUPABASE_QUERY_FAILED', 'SUPABASE_REQUEST_FAILED', 'INTERNAL_ERROR', 'REQUEST_FAILED', 'METHOD_NOT_ALLOWED'
]);
const AUTH_DIAGNOSTIC_ERROR_CODES = new Set([
    ...BACKEND_AUTH_ERROR_CODES,
    'ACTION_REJECTED', 'NETWORK_ERROR', 'TIMEOUT', 'CORE_SIGN_CLIENT_UNAVAILABLE'
]);

function logAuthOperationFailure(stage, error) {
    try {
        const rawCode = error?.code ?? error?.data?.code ?? error?.cause?.code ?? error?.error?.code;
        const numericCode = typeof rawCode === 'string' && /^-?\d{1,7}$/.test(rawCode)
            ? Number(rawCode) : rawCode;
        const code = Number.isSafeInteger(numericCode) ? numericCode
            : AUTH_DIAGNOSTIC_ERROR_CODES.has(rawCode) ? rawCode : null;
        const rawName = error?.name;
        const rawStatus = error?.status;
        const name = ['Error', 'TypeError', 'AbortError', 'TimeoutError', 'NetworkError', 'SyntaxError'].includes(rawName)
            ? rawName : 'Error';
        const status = Number.isInteger(rawStatus) && rawStatus >= 100 && rawStatus <= 599
            ? rawStatus : null;
        let kind = 'other';
        const message = name === 'TypeError' ? error?.message : null;
        if (typeof message === 'string') {
            if (['Load failed', 'Failed to fetch', 'Network request failed'].includes(message)) kind = 'network-fetch';
            else if (/Cannot read propert|undefined is not an object/.test(message)) kind = 'property-access';
        }
        window.ArtSoulWalletDebug?.log('SIWE auth operation failed', { stage, name, code, status, kind });
    } catch {
        // Optional diagnostics must never replace the original rejection.
    }
}

async function fetchBackendAuth(path, options = {}) {
    let lastError = null;

    for (const prefix of BACKEND_AUTH_PREFIXES) {
        const response = await fetch(`${prefix}${path}`, {
            ...options,
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers || {})
            }
        });

        if (response.status === 404) {
            lastError = new Error('Auth endpoint not found');
            continue;
        }

        const text = await response.text();
        const data = text ? JSON.parse(text) : {};
        if (!response.ok) {
            const error = new Error(data.message || data.error || 'Authentication request failed');
            error.status = response.status;
            if (BACKEND_AUTH_ERROR_CODES.has(data.error)) error.code = data.error;
            throw error;
        }
        return data;
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

async function requestWalletProvider(provider, request) {
    if (typeof window.requestArtSoulWalletProvider === 'function') {
        return window.requestArtSoulWalletProvider(provider, request);
    }
    if (!provider?.request) throw new Error('No wallet provider available');
    return provider.request(request);
}

async function getActiveChainId(provider) {
    const rawChainId = await requestWalletProvider(provider, { method: 'eth_chainId' });
    const chainId = typeof rawChainId === 'string' && rawChainId.startsWith('0x')
        ? parseInt(rawChainId, 16)
        : Number(rawChainId);
    if (!Number.isFinite(chainId) || chainId <= 0) {
        throw new Error('The wallet did not return an active network.');
    }
    return chainId;
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

function utf8ToHex(value) {
    const bytes = new TextEncoder().encode(String(value));
    return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

// ============================================
// WALLET SIGNATURE AUTHENTICATION
// ============================================

/**
 * Authenticate user with wallet signature
 * Creates a backend SIWE session with wallet address as user ID
 */
async function authenticateWithWallet(walletAddress, provider) {
    let stage = 'validation';
    try {
        const normalizedWallet = normalizeWalletAddress(walletAddress);
        const activeProvider = provider || window.ethereum;

        if (!normalizedWallet) {
            throw new Error('No wallet address provided for authentication');
        }

        if (!activeProvider?.request) {
            throw new Error('No wallet provider available for authentication');
        }

        stage = 'provider-accounts';
        const providerAccounts = await requestWalletProvider(activeProvider, { method: 'eth_accounts' });
        const providerWallets = (Array.isArray(providerAccounts) ? providerAccounts : [])
            .map(normalizeWalletAddress);
        const selectedProviderWallet = normalizeWalletAddress(activeProvider.selectedAddress);
        const providerActiveWallet = selectedProviderWallet && providerWallets.includes(selectedProviderWallet)
            ? selectedProviderWallet
            : providerWallets[0];
        if (providerActiveWallet !== normalizedWallet) {
            throw new Error('The selected wallet account changed. Please try the protected action again.');
        }

        stage = 'session-check';
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

        stage = 'nonce';
        const { nonce } = await fetchBackendAuth(`/nonce?wallet=${encodeURIComponent(normalizedWallet)}`, {
            method: 'GET'
        });
        stage = 'chain-id';
        const chainId = await getActiveChainId(activeProvider);
        const message = buildSiweMessage(normalizedWallet, nonce, chainId);

        console.log(' Requesting SIWE signature from wallet...');
        let signature;

        stage = 'signature';
        if (activeProvider && activeProvider.request) {
            signature = await requestWalletProvider(activeProvider, {
                method: 'personal_sign',
                params: [utf8ToHex(message), normalizedWallet]
            });
        } else if (window.ethereum) {
            signature = await window.ethereum.request({
                method: 'personal_sign',
                params: [utf8ToHex(message), normalizedWallet]
            });
        } else {
            throw new Error('No wallet provider available');
        }

        stage = 'verify';
        const verified = await fetchBackendAuth('/verify', {
            method: 'POST',
            body: JSON.stringify({
                message,
                signature,
                address: normalizedWallet,
                nonce
            })
        });

        stage = 'account-check';
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
        stage = 'session-store';
        return setBackendSession(verifiedWallet);
    } catch (error) {
        logAuthOperationFailure(stage, error);
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

        // Do not block AppKit/page hydration on Supabase when this is a normal
        // page load. Only initialize auth when an OAuth callback is present.
        const supabase = await initSupabase();

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
