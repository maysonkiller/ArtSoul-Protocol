import crypto from 'node:crypto';
import {
  allowMethods,
  clearOAuthState,
  readJson,
  readOAuthState,
  requireWallet,
  setOAuthState,
  supabaseRest
} from '../backend.js';

const PROVIDERS = new Set(['discord', 'twitter']);

function env(names, label) {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  const error = new Error(`${label} is not configured`);
  error.code = 'OAUTH_CONFIGURATION_ERROR';
  error.statusCode = 500;
  throw error;
}

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function requestOrigin(req) {
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const host = forwardedHost || String(req.headers.host || '').trim();
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || (process.env.NODE_ENV === 'production' ? 'https' : 'http');
  if (!/^[a-z0-9.-]+(?::\d+)?$/i.test(host) || !['http', 'https'].includes(protocol)) {
    throw Object.assign(new Error('OAuth request origin is invalid'), { code: 'INVALID_OAUTH_ORIGIN', statusCode: 400 });
  }

  const origin = `${protocol}://${host}`;
  const allowedOrigins = new Set(
    String(process.env.OAUTH_ALLOWED_ORIGINS || '')
      .split(',')
      .map(value => value.trim().replace(/\/$/, ''))
      .filter(Boolean)
  );
  allowedOrigins.add('https://artsoul.vercel.app');
  if (process.env.VERCEL_URL) allowedOrigins.add(`https://${process.env.VERCEL_URL}`);
  if (process.env.VERCEL_BRANCH_URL) allowedOrigins.add(`https://${process.env.VERCEL_BRANCH_URL}`);
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    allowedOrigins.add(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`);
  }
  if (process.env.NODE_ENV !== 'production') {
    allowedOrigins.add('http://localhost:3000');
    allowedOrigins.add('http://127.0.0.1:3000');
  }

  if (!allowedOrigins.has(origin)) {
    throw Object.assign(new Error('OAuth is not enabled for this origin'), { code: 'OAUTH_ORIGIN_NOT_ALLOWED', statusCode: 400 });
  }
  return origin;
}

function callbackUri(req, provider) {
  return `${requestOrigin(req)}/api/oauth/callback/${provider}`;
}

function providerConfig(provider) {
  if (provider === 'discord') {
    return {
      clientId: env(['DISCORD_CLIENT_ID', 'NEXT_PUBLIC_DISCORD_CLIENT_ID'], 'DISCORD_CLIENT_ID'),
      clientSecret: env(['DISCORD_CLIENT_SECRET'], 'DISCORD_CLIENT_SECRET')
    };
  }
  return {
    clientId: env(['X_CLIENT_ID', 'TWITTER_CLIENT_ID', 'NEXT_PUBLIC_X_CLIENT_ID'], 'X_CLIENT_ID'),
    clientSecret: env(['X_CLIENT_SECRET', 'TWITTER_CLIENT_SECRET'], 'X_CLIENT_SECRET')
  };
}

function redirectProfile(res, provider, status, error = '') {
  const query = new URLSearchParams({ oauth_status: status, provider });
  if (error) query.set('oauth_error', error);
  res.statusCode = 302;
  res.setHeader('Location', `/profile.html?${query}`);
  res.end();
}

async function parseProviderResponse(response, fallback) {
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!response.ok) {
    const error = new Error(data.error_description || data.detail || data.error || fallback);
    error.code = 'OAUTH_PROVIDER_ERROR';
    throw error;
  }
  return data;
}

async function exchangeDiscord(code, redirectUri) {
  const config = providerConfig('discord');
  const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri
    })
  });
  const token = await parseProviderResponse(tokenResponse, 'Discord token exchange failed');
  const userResponse = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${token.access_token}` }
  });
  const user = await parseProviderResponse(userResponse, 'Discord profile lookup failed');
  const discriminator = user.discriminator && user.discriminator !== '0' ? `#${user.discriminator}` : '';
  return {
    discord_id: user.id,
    discord_username: `${user.global_name || user.username}${discriminator}`
  };
}

async function exchangeTwitter(code, redirectUri, codeVerifier) {
  const config = providerConfig('twitter');
  const tokenResponse = await fetch('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier
    })
  });
  const token = await parseProviderResponse(tokenResponse, 'X token exchange failed');
  const userResponse = await fetch('https://api.x.com/2/users/me', {
    headers: { Authorization: `Bearer ${token.access_token}` }
  });
  const payload = await parseProviderResponse(userResponse, 'X profile lookup failed');
  if (!payload.data?.id || !payload.data?.username) {
    throw new Error('X did not return an account identity');
  }
  return {
    twitter_id: payload.data.id,
    twitter_username: payload.data.username,
    twitter_handle: `@${payload.data.username}`
  };
}

async function saveLinkedProfile(wallet, updates) {
  const existing = await supabaseRest(
    `profiles?wallet_address=eq.${encodeURIComponent(wallet)}&select=wallet_address&limit=1`
  );
  const now = new Date().toISOString();
  const rows = existing?.length
    ? await supabaseRest(`profiles?wallet_address=eq.${encodeURIComponent(wallet)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: { ...updates, updated_at: now }
      })
    : await supabaseRest('profiles?on_conflict=wallet_address', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: [{ wallet_address: wallet, ...updates, updated_at: now }]
      });
  if (!rows?.[0]) throw new Error('The linked account could not be saved');
  return rows[0];
}

export async function oauthStartHandler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;

  try {
    const wallet = requireWallet(req);
    const body = await readJson(req);
    const provider = String(body.provider || '').toLowerCase();
    if (!PROVIDERS.has(provider)) {
      return res.status(400).json({ error: 'INVALID_PROVIDER', message: 'Choose Discord or X.' });
    }

    const redirectUri = callbackUri(req, provider);
    const state = base64url(crypto.randomBytes(32));
    const config = providerConfig(provider);
    const oauthState = { provider, state, wallet, redirectUri };
    let authorizationUrl;

    if (provider === 'discord') {
      authorizationUrl = new URL('https://discord.com/oauth2/authorize');
      authorizationUrl.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'identify',
        state,
        prompt: 'consent'
      });
    } else {
      const codeVerifier = base64url(crypto.randomBytes(64));
      const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
      oauthState.codeVerifier = codeVerifier;
      authorizationUrl = new URL('https://twitter.com/i/oauth2/authorize');
      authorizationUrl.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'tweet.read users.read',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256'
      });
    }

    setOAuthState(res, oauthState);
    res.status(200).json({
      success: true,
      authorizationUrl: authorizationUrl.toString(),
      redirectUri
    });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({
      error: error.code || 'OAUTH_START_FAILED',
      message: status === 500 ? 'Social linking is not configured on the server.' : error.message
    });
  }
}

export function createOAuthCallbackHandler(provider) {
  return async function oauthCallbackHandler(req, res) {
    if (!allowMethods(req, res, ['GET'])) return;
    const oauthState = readOAuthState(req);

    try {
      const wallet = requireWallet(req);
      const returnedState = String(req.query.state || '');
      const code = String(req.query.code || '');
      if (!oauthState || oauthState.provider !== provider || oauthState.state !== returnedState) {
        throw Object.assign(new Error('OAuth state validation failed'), { publicCode: 'state_mismatch' });
      }
      if (req.query.error) {
        throw Object.assign(new Error('Provider authorization was cancelled'), { publicCode: 'provider_cancelled' });
      }
      if (oauthState.wallet !== wallet) {
        throw Object.assign(new Error('The active wallet changed during linking'), { publicCode: 'wallet_changed' });
      }
      if (!code) {
        throw Object.assign(new Error('Provider did not return an authorization code'), { publicCode: 'missing_code' });
      }

      const redirectUri = callbackUri(req, provider);
      if (redirectUri !== oauthState.redirectUri) {
        throw Object.assign(new Error('OAuth callback origin changed'), { publicCode: 'callback_mismatch' });
      }
      const updates = provider === 'discord'
        ? await exchangeDiscord(code, redirectUri)
        : await exchangeTwitter(code, redirectUri, oauthState.codeVerifier);
      await saveLinkedProfile(wallet, updates);

      clearOAuthState(res);
      redirectProfile(res, provider, 'success');
    } catch (error) {
      console.error(`[OAuth:${provider}] callback failed:`, error);
      clearOAuthState(res);
      const publicCode = error.publicCode || (error.code === 'UNAUTHENTICATED' ? 'session_expired' : 'provider_exchange_failed');
      redirectProfile(res, provider, 'error', publicCode);
    }
  };
}

export async function oauthUnlinkHandler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;

  try {
    const wallet = requireWallet(req);
    const body = await readJson(req);
    const provider = String(body.provider || '').toLowerCase();
    if (!PROVIDERS.has(provider)) {
      return res.status(400).json({ error: 'INVALID_PROVIDER', message: 'Choose Discord or X.' });
    }

    const updates = provider === 'discord'
      ? { discord_id: null, discord_username: null }
      : { twitter_id: null, twitter_username: null, twitter_handle: null };
    const rows = await supabaseRest(`profiles?wallet_address=eq.${encodeURIComponent(wallet)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: { ...updates, updated_at: new Date().toISOString() }
    });
    res.status(200).json({ success: true, profile: rows?.[0] || { wallet_address: wallet, ...updates } });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({
      error: error.code || 'OAUTH_UNLINK_FAILED',
      message: status === 500 ? 'The linked account could not be removed.' : error.message
    });
  }
}
