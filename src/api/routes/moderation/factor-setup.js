import crypto from 'node:crypto';
import { allowMethods, readJson, sendError, supabaseRest } from '../../backend.js';
import { findActiveStaffAuthorization, findWalletCredentials, requirePasskeyRouteContext,
  roleBoundSessionsEnabled, setModerationSession, MODERATION_SESSION_TTL_SECONDS } from '../../moderation-passkey.js';
import { FACTOR_ID, factorError, findSetupPermission, requireSetupPermission, requireFactorRequest } from '../../moderation-factor-setup.js';
import { generateTotpSecret, encryptTotpSecret, decryptTotpSecret, matchTotpStep } from '../../moderation-totp-crypto.js';

function exactFields(body, fields) {
  if (!body || Array.isArray(body) || Object.keys(body).sort().join('|') !== fields.sort().join('|')) throw factorError('INVALID_FACTOR_PAYLOAD', 400);
}
function validId(value) {
  if (typeof value !== 'string' || !FACTOR_ID.test(value)) throw factorError('INVALID_FACTOR_ID', 400);
  return value;
}
function totpKey() {
  const value = process.env.ARTSOUL_MODERATION_TOTP_KEY;
  const keyVersion = Number(process.env.ARTSOUL_MODERATION_TOTP_KEY_VERSION);
  if (typeof value !== 'string' || !/^[0-9a-fA-F]{64}$/.test(value) || !Number.isSafeInteger(keyVersion) || keyVersion < 1) {
    throw factorError('TOTP_NOT_CONFIGURED', 503);
  }
  return { key: Buffer.from(value, 'hex'), keyVersion };
}
function decryptFactor(factor) {
  const { key, keyVersion } = totpKey();
  try {
    if (Number(factor.key_version) !== keyVersion) throw factorError('TOTP_KEY_VERSION_UNAVAILABLE', 503);
    return decryptTotpSecret(factor.encrypted_secret, key, { wallet: factor.wallet_address, factorId: factor.id, keyVersion });
  } finally { key.fill(0); }
}
async function sameAuthorization(context) {
  const current = await findActiveStaffAuthorization(context.wallet);
  if (current?.authorizationVersion !== context.authorizationVersion) throw factorError('STAFF_AUTHORIZATION_CHANGED');
}
async function activeTotp(context) {
  const permissions = await supabaseRest(`artsoul_staff_setup_permissions?target_wallet=eq.${context.wallet}` +
    `&role_version=eq.${context.authorizationVersion}&factor_type=eq.totp&consumed_at=not.is.null&select=factor_reference&limit=2`);
  const id = permissions?.length === 1 ? permissions[0].factor_reference : null;
  if (!id || !FACTOR_ID.test(id)) return null;
  const rows = await supabaseRest(`artsoul_staff_totp_factors?id=eq.${id}&wallet_address=eq.${context.wallet}` +
    '&activated_at=not.is.null&revoked_at=is.null&select=id&limit=1');
  return rows?.length === 1 ? rows[0].id : null;
}
async function factorForAttempt(context, factorId, purpose) {
  validId(factorId);
  if (!['enrollment', 'authentication'].includes(purpose)) throw factorError('INVALID_FACTOR_PURPOSE', 400);
  const rows = await supabaseRest(`artsoul_staff_totp_factors?id=eq.${factorId}&wallet_address=eq.${context.wallet}&revoked_at=is.null&select=*&limit=1`);
  const factor = rows?.[0];
  if (!factor || Boolean(factor.activated_at) !== (purpose === 'authentication')) throw factorError('FACTOR_INELIGIBLE');
  const grants = await supabaseRest(`artsoul_staff_totp_grants?id=eq.${factor.grant_id}&target_wallet=eq.${context.wallet}` +
    `&role_version=eq.${context.authorizationVersion}&setup_permission_id=not.is.null&select=setup_permission_id&limit=1`);
  if (grants?.length !== 1) throw factorError('SETUP_PERMISSION_REQUIRED');
  if (purpose === 'enrollment') await requireSetupPermission(context.wallet, context.authorizationVersion, grants[0].setup_permission_id);
  else if (await activeTotp(context) !== factorId) throw factorError('FACTOR_INELIGIBLE');
  return factor;
}
function requireResult(result) {
  if (result === 'OK') return;
  throw factorError(result || 'FACTOR_VERIFICATION_FAILED', result === 'TOTP_THROTTLED' ? 429 : result === 'TOTP_POLICY_REQUIRED' ? 503 : 403);
}

// Inactive until the shared setup migration, reviewed policy and UI are released.
// No email/social factor, client timestamp or caller-supplied matched step is trusted.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!allowMethods(req, res, ['GET', 'POST'])) return;
  try {
    if (!roleBoundSessionsEnabled()) throw factorError('FACTOR_SETUP_DISABLED', 404);
    const context = await requirePasskeyRouteContext(req);
    const body = req.method === 'GET' ? req.query : await readJson(req);
    requireFactorRequest(req, body, context);
    const { wallet, authorizationVersion } = context;
    if (req.method === 'GET') {
      const [permission, credentials, totpId] = await Promise.all([
        findSetupPermission(wallet, authorizationVersion), findWalletCredentials(wallet, { authorizationVersion }), activeTotp(context)
      ]);
      let totpAvailable = false;
      try { const config = totpKey(); config.key.fill(0); totpAvailable = true; } catch { /* Passkeys remain available. */ }
      await sameAuthorization(context);
      return res.status(200).json({ success: true, setup: permission ? { id: permission.id, expiresAt: permission.expires_at } : null,
        passkeyAvailable: credentials.length > 0, totpFactorId: totpId, totpAvailable });
    }
    if (body.operation === 'totp-setup') {
      exactFields(body, ['operation', 'expectedWallet', 'permissionId']);
      const permission = await requireSetupPermission(wallet, authorizationVersion, body.permissionId);
      const { key, keyVersion } = totpKey();
      const factorId = crypto.randomUUID();
      let envelope;
      try { envelope = encryptTotpSecret(generateTotpSecret(), key, { wallet, factorId, keyVersion }); }
      finally { key.fill(0); }
      const factor = await supabaseRest('rpc/a8g_begin_totp_setup', { method: 'POST', body: {
        p_wallet: wallet, p_permission_id: permission.id, p_factor_id: factorId, p_envelope: envelope
      } });
      if (factor?.wallet_address !== wallet || factor.activated_at || factor.revoked_at) throw factorError('FACTOR_INELIGIBLE');
      const secret = decryptFactor(factor);
      await sameAuthorization(context);
      await requireSetupPermission(wallet, authorizationVersion, permission.id);
      const issuer = 'ArtSoul';
      const uri = `otpauth://totp/${encodeURIComponent(`${issuer}:${wallet}`)}?` + new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
      return res.status(200).json({ success: true, factorId: factor.id, secret, uri, expiresAt: permission.expires_at });
    }
    if (body.operation === 'totp-begin') {
      exactFields(body, ['operation', 'expectedWallet', 'factorId', 'purpose']);
      await factorForAttempt(context, body.factorId, body.purpose);
      const rows = await supabaseRest('rpc/a8e_begin_totp_attempt', { method: 'POST', body: {
        p_wallet: wallet, p_factor_id: body.factorId, p_purpose: body.purpose
      } });
      const result = rows?.[0];
      requireResult(result?.result);
      return res.status(200).json({ success: true, attemptId: result.attempt_id });
    }
    if (body.operation !== 'totp-verify') throw factorError('INVALID_FACTOR_OPERATION', 400);
    exactFields(body, ['operation', 'expectedWallet', 'attemptId', 'code']);
    const rows = await supabaseRest(`artsoul_staff_totp_attempts?id=eq.${validId(body.attemptId)}&wallet_address=eq.${wallet}` +
      `&role_version=eq.${authorizationVersion}&consumed_at=is.null&expires_at=gt.${encodeURIComponent(new Date().toISOString())}` +
      '&select=id,factor_id,purpose&limit=1');
    const attempt = rows?.[0];
    if (!attempt) throw factorError('TOTP_ATTEMPT_UNAVAILABLE');
    // The reservation is durable before any secret is decrypted/code is tested.
    const factor = await factorForAttempt(context, attempt.factor_id, attempt.purpose);
    const matchedStep = matchTotpStep(decryptFactor(factor), body.code, Math.floor(Date.now() / 1000));
    const result = await supabaseRest('rpc/a8e_complete_totp_attempt', { method: 'POST', body: {
      p_wallet: wallet, p_attempt_id: attempt.id, p_matched_step: matchedStep
    } });
    requireResult(result);
    await sameAuthorization(context);
    if (await activeTotp(context) !== factor.id) throw factorError('FACTOR_INELIGIBLE');
    setModerationSession(res, wallet, factor.id, authorizationVersion, 'totp');
    return res.status(200).json({ success: true, expires_in_seconds: MODERATION_SESSION_TTL_SECONDS });
  } catch (error) { sendError(res, error); }
}
