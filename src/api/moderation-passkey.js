import crypto from 'node:crypto';
import { parseCookies, requireWallet, serializeCookie, supabaseRest } from './backend.js';

// A8a moderation passkey step-up foundation.
//
// Founder decisions 2026-07-20:
// - the moderation step-up session lasts EXACTLY 15 minutes;
// - X/Discord handles and IDs are profile/eligibility data only and never
//   participate in authentication;
// - founder recovery is Safe-only and fails closed until that integration
//   exists;
// - no wallet-only enrollment: every enrollment consumes a one-time grant.
//
// Everything here is inert while ARTSOUL_MODERATION_PASSKEY_ENABLED is not
// exactly "true". When the flag is on, missing configuration fails closed:
// the RP ID and allowed origin are NEVER inferred from a request Host
// header, and the moderation-session secret is separate from SESSION_SECRET.

export const MODERATION_SESSION_COOKIE = 'artsoul_mod_session';
export const MODERATION_SESSION_TTL_SECONDS = 15 * 60;
// Challenge lifetime mirrors the existing SIWE nonce TTL (tunable).
export const WEBAUTHN_CHALLENGE_TTL_MS = 5 * 60 * 1000;

const STAFF_MODERATION_ROLES = new Set(['admin', 'moderator', 'team']);

export function parseStoredTransports(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function isModerationPasskeyEnabled() {
  return String(process.env.ARTSOUL_MODERATION_PASSKEY_ENABLED || '').trim() === 'true';
}

function configError(message) {
  const error = new Error(message);
  error.statusCode = 503;
  error.code = 'MODERATION_PASSKEY_MISCONFIGURED';
  return error;
}

function accessError(message, code, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

export function getWebAuthnConfig() {
  const rpId = String(process.env.ARTSOUL_WEBAUTHN_RP_ID || '').trim();
  const origin = String(process.env.ARTSOUL_WEBAUTHN_ALLOWED_ORIGIN || '').trim();
  const rpName = String(process.env.ARTSOUL_WEBAUTHN_RP_NAME || '').trim();
  const sessionSecret = String(process.env.ARTSOUL_MODERATION_SESSION_SECRET || '').trim();

  if (!rpId || !origin || !rpName || !sessionSecret) {
    throw configError(
      'Moderation passkey step-up is enabled but not fully configured. Access is denied.'
    );
  }

  return { rpId, origin, rpName };
}

function moderationSessionSecret() {
  const secret = String(process.env.ARTSOUL_MODERATION_SESSION_SECRET || '').trim();
  if (!secret) {
    throw configError(
      'Moderation passkey step-up is enabled but not fully configured. Access is denied.'
    );
  }
  return secret;
}

function signModerationPayload(payload) {
  return crypto
    .createHmac('sha256', moderationSessionSecret())
    .update(payload)
    .digest('base64url');
}

export function setModerationSession(res, wallet, credentialId) {
  const payload = Buffer.from(JSON.stringify({
    wallet,
    credential_id: credentialId,
    exp: Math.floor(Date.now() / 1000) + MODERATION_SESSION_TTL_SECONDS
  })).toString('base64url');
  const signature = signModerationPayload(payload);
  res.setHeader('Set-Cookie', serializeCookie(MODERATION_SESSION_COOKIE, `${payload}.${signature}`, {
    maxAge: MODERATION_SESSION_TTL_SECONDS,
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax'
  }));
}

export function clearModerationSession(res) {
  res.setHeader('Set-Cookie', serializeCookie(MODERATION_SESSION_COOKIE, '', {
    maxAge: 0,
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax'
  }));
}

export function readModerationSession(req) {
  const cookies = parseCookies(req.headers?.cookie || '');
  const token = cookies[MODERATION_SESSION_COOKIE];
  if (!token) return null;

  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = signModerationPayload(payload);
  if (Buffer.byteLength(signature) !== Buffer.byteLength(expected)) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.wallet || !data.credential_id || !data.exp) return null;
    if (data.exp < Math.floor(Date.now() / 1000)) return null;
    return { wallet: String(data.wallet).toLowerCase(), credentialId: String(data.credential_id) };
  } catch {
    return null;
  }
}

export async function findActiveStaffRole(wallet) {
  const rows = await supabaseRest(
    `artsoul_staff_roles?wallet_address=eq.${encodeURIComponent(wallet)}&active=eq.true&select=role&limit=1`
  );
  const role = String(rows?.[0]?.role || '').toLowerCase();
  return STAFF_MODERATION_ROLES.has(role) ? role : null;
}

export function requireActiveStaffRole(role) {
  if (!role) {
    throw accessError('Administrative access required', 'ADMIN_REQUIRED', 403);
  }
  return role;
}

export async function findWalletCredentials(wallet, { includeRevoked = false } = {}) {
  const revokedFilter = includeRevoked ? '' : '&revoked_at=is.null';
  return await supabaseRest(
    `artsoul_staff_passkeys?wallet_address=eq.${encodeURIComponent(wallet)}${revokedFilter}` +
      '&select=id,credential_id,public_key,sign_count,transports,label,enrolled_via,created_at,last_used_at,revoked_at' +
      '&order=created_at.asc'
  ) || [];
}

// One-time bearer enrollment token. The raw token is a base64url string of
// 32 CSPRNG bytes (>= 256 bits); ONLY its SHA-256 hash is ever persisted.
export function generateGrantToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashGrantToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken), 'utf8').digest('hex');
}

// Resolve an active (unconsumed, unrevoked, unexpired) grant by matching the
// SHA-256 hash of the presented raw token to the stored hash, scoped to the
// SIWE wallet. A stolen wallet without the token matches nothing.
export async function findGrantByToken(rawToken, wallet) {
  const token = String(rawToken || '');
  if (!token) return null;
  const rows = await supabaseRest(
    `artsoul_staff_enrollment_grants?target_wallet=eq.${encodeURIComponent(wallet)}` +
      `&token_hash=eq.${encodeURIComponent(hashGrantToken(token))}` +
      '&consumed_at=is.null&revoked_at=is.null' +
      `&expires_at=gt.${encodeURIComponent(new Date().toISOString())}` +
      '&select=id,target_wallet,purpose,expires_at&limit=1'
  );
  return rows?.[0] || null;
}

export async function storeRegistrationChallenge(challenge, wallet, grantId) {
  await supabaseRest('artsoul_webauthn_challenges', {
    method: 'POST',
    body: [{
      challenge,
      wallet_address: wallet,
      purpose: 'registration',
      grant_id: grantId,
      expires_at: new Date(Date.now() + WEBAUTHN_CHALLENGE_TTL_MS).toISOString()
    }]
  });
}

export async function storeAuthenticationChallenge(challenge, wallet) {
  await supabaseRest('artsoul_webauthn_challenges', {
    method: 'POST',
    body: [{
      challenge,
      wallet_address: wallet,
      purpose: 'authentication',
      expires_at: new Date(Date.now() + WEBAUTHN_CHALLENGE_TTL_MS).toISOString()
    }]
  });
}

// Read-only registration-challenge validator used by the SimpleWebAuthn
// expectedChallenge callback. It does NOT consume: consumption happens
// atomically inside a8a_complete_registration together with the grant and
// credential writes. Returns true only for an outstanding challenge bound to
// the exact grant id.
export async function validateRegistrationChallenge(challenge, wallet, grantId) {
  const rows = await supabaseRest(
    `artsoul_webauthn_challenges?challenge=eq.${encodeURIComponent(challenge)}` +
      `&wallet_address=eq.${encodeURIComponent(wallet)}` +
      '&purpose=eq.registration' +
      `&grant_id=eq.${encodeURIComponent(grantId)}` +
      '&consumed_at=is.null' +
      `&expires_at=gt.${encodeURIComponent(new Date().toISOString())}` +
      '&select=challenge&limit=1'
  );
  return Boolean(rows && rows.length === 1);
}

// One-time consume for AUTHENTICATION challenges only (registration
// challenges are consumed atomically in the RPC). Mirrors the single-use
// SIWE nonce PATCH pattern.
export async function consumeAuthenticationChallenge(challenge, wallet) {
  const rows = await supabaseRest(
    `artsoul_webauthn_challenges?challenge=eq.${encodeURIComponent(challenge)}` +
      `&wallet_address=eq.${encodeURIComponent(wallet)}` +
      '&purpose=eq.authentication' +
      '&consumed_at=is.null' +
      `&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: { consumed_at: new Date().toISOString() }
    }
  );
  return Boolean(rows && rows.length === 1);
}

// ---------------------------------------------------------------------------
// Atomic RPC callers. Each maps to one SECURITY DEFINER function so the whole
// credential/grant/audit state transition is a single transaction.
// ---------------------------------------------------------------------------

async function callRpc(fn, body) {
  return await supabaseRest(`rpc/${fn}`, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body
  });
}

export async function issueEnrollmentGrantRpc({ targetWallet, purpose, issuedBy, tokenHash, expiresAt }) {
  return await callRpc('a8a_issue_enrollment_grant', {
    p_target_wallet: targetWallet,
    p_purpose: purpose,
    p_issued_by: issuedBy,
    p_token_hash: tokenHash,
    p_expires_at: expiresAt
  });
}

export async function completeRegistrationRpc(params) {
  const result = await callRpc('a8a_complete_registration', {
    p_grant_id: params.grantId,
    p_token_hash: params.tokenHash,
    p_wallet: params.wallet,
    p_purpose: params.purpose,
    p_challenge: params.challenge,
    p_credential_id: params.credentialId,
    p_public_key: params.publicKey,
    p_sign_count: params.signCount,
    p_transports: params.transports,
    p_aaguid: params.aaguid,
    p_label: params.label
  });
  return Array.isArray(result) ? result[0] : result;
}

export async function revokeCredentialRpc({ wallet, credentialId, revokedBy }) {
  const result = await callRpc('a8a_revoke_credential', {
    p_wallet: wallet,
    p_credential_id: credentialId,
    p_revoked_by: revokedBy
  });
  return Array.isArray(result) ? result[0] : result;
}

export async function completeAuthenticationRpc({ wallet, credentialId, newCounter }) {
  const result = await callRpc('a8a_complete_authentication', {
    p_wallet: wallet,
    p_credential_id: credentialId,
    p_new_counter: newCounter
  });
  return Array.isArray(result) ? result[0] : result;
}

// Audit writes are part of the protected operation: a failed audit insert
// fails the operation (fail closed) except where the caller explicitly
// treats it as best-effort on an already-failing path.
export async function recordAuthEvent(wallet, eventType, credentialId = null, details = null) {
  await supabaseRest('artsoul_staff_auth_events', {
    method: 'POST',
    body: [{
      wallet_address: wallet || null,
      event_type: eventType,
      credential_id: credentialId,
      details
    }]
  });
}

export async function recordAuthEventBestEffort(wallet, eventType, credentialId = null, details = null) {
  try {
    await recordAuthEvent(wallet, eventType, credentialId, details);
  } catch (error) {
    console.warn('Staff auth event write failed:', error?.message || error);
  }
}

// Shared preamble for every passkey route: the feature must be enabled,
// fully configured, and the caller must hold a SIWE session plus an active
// staff role. Disabled flag returns 404 so the feature is absent, not
// half-exposed.
export async function requirePasskeyRouteContext(req) {
  if (!isModerationPasskeyEnabled()) {
    throw accessError('Not found', 'PASSKEY_DISABLED', 404);
  }
  const config = getWebAuthnConfig();
  const wallet = requireWallet(req);
  const role = requireActiveStaffRole(await findActiveStaffRole(wallet));
  return { config, wallet, role };
}

// Verifies the 15-minute step-up for the ALREADY SIWE-authenticated wallet.
// Fails closed on: missing/expired/mismatched cookie, revoked or foreign
// credential, or missing configuration (throws).
export async function verifyModerationStepUp(req, sessionWallet) {
  getWebAuthnConfig();

  const stepUp = readModerationSession(req);
  if (!stepUp) {
    return { valid: false, code: 'STEP_UP_REQUIRED' };
  }
  if (!sessionWallet || stepUp.wallet !== String(sessionWallet).toLowerCase()) {
    return { valid: false, code: 'STEP_UP_WALLET_MISMATCH' };
  }

  const rows = await supabaseRest(
    `artsoul_staff_passkeys?credential_id=eq.${encodeURIComponent(stepUp.credentialId)}` +
      `&wallet_address=eq.${encodeURIComponent(stepUp.wallet)}` +
      '&revoked_at=is.null&select=credential_id&limit=1'
  );
  if (!rows || rows.length !== 1) {
    return { valid: false, code: 'CREDENTIAL_REVOKED' };
  }

  return { valid: true, credentialId: stepUp.credentialId };
}
