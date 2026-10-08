import { normalizeWallet, supabaseRest } from './backend.js';
import { roleBoundSessionsEnabled, WEBAUTHN_CHALLENGE_TTL_MS } from './moderation-passkey.js';

export const FACTOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function factorError(code, statusCode = 403) {
  return Object.assign(new Error(code), { code, statusCode });
}

// Bind asynchronous wallet UI requests to the SIWE account that initiated them.
export function requireFactorRequest(req, body, context) {
  if (!roleBoundSessionsEnabled()) throw factorError('FACTOR_SETUP_DISABLED', 404);
  if (typeof body?.expectedWallet !== 'string' || normalizeWallet(body.expectedWallet) !== context.wallet) {
    throw factorError('FACTOR_WALLET_MISMATCH');
  }
  if (req.method === 'POST' && req.headers?.origin !== context.config.origin) throw factorError('FACTOR_ORIGIN_MISMATCH');
}

export async function findSetupPermission(wallet, authorizationVersion, permissionId) {
  if (!Number.isSafeInteger(authorizationVersion) || authorizationVersion < 1) throw factorError('STAFF_AUTHORIZATION_REQUIRED');
  if (permissionId !== undefined && (typeof permissionId !== 'string' || !FACTOR_ID.test(permissionId))) throw factorError('INVALID_SETUP_PERMISSION', 400);
  const rows = await supabaseRest(
    `artsoul_staff_setup_permissions?target_wallet=eq.${wallet}&role_version=eq.${authorizationVersion}` +
    (permissionId === undefined ? '' : `&id=eq.${permissionId}`) +
    '&consumed_at=is.null&select=id,target_wallet,role_version,issued_at,expires_at,consumed_at&limit=2'
  );
  const permission = rows?.length === 1 ? rows[0] : null;
  const now = Date.now();
  return permission && permission.target_wallet === wallet && Number(permission.role_version) === authorizationVersion &&
    !permission.consumed_at && Date.parse(permission.issued_at) <= now && Date.parse(permission.expires_at) > now ? permission : null;
}

export async function requireSetupPermission(wallet, version, id) {
  if (id === undefined) throw factorError('INVALID_SETUP_PERMISSION', 400);
  const permission = await findSetupPermission(wallet, version, id);
  if (!permission) throw factorError('SETUP_PERMISSION_REQUIRED');
  return permission;
}

export async function storeSetupChallenge(challenge, context, permission) {
  await supabaseRest('artsoul_webauthn_challenges', { method: 'POST', body: [{
    challenge, wallet_address: context.wallet, purpose: 'registration',
    setup_permission_id: permission.id, authorization_version: context.authorizationVersion,
    expires_at: new Date(Math.min(Date.now() + WEBAUTHN_CHALLENGE_TTL_MS, Date.parse(permission.expires_at))).toISOString()
  }] });
}

export async function validateSetupChallenge(challenge, context, permissionId) {
  const rows = await supabaseRest(
    `artsoul_webauthn_challenges?challenge=eq.${encodeURIComponent(challenge)}&wallet_address=eq.${context.wallet}` +
    `&purpose=eq.registration&setup_permission_id=eq.${permissionId}&authorization_version=eq.${context.authorizationVersion}` +
    `&consumed_at=is.null&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=challenge&limit=1`
  );
  return rows?.length === 1;
}

export async function completePasskeySetup(params) {
  return await supabaseRest('rpc/a8g_complete_passkey_setup', { method: 'POST', body: {
    p_wallet: params.wallet, p_permission_id: params.permissionId, p_challenge: params.challenge,
    p_credential_id: params.credentialId, p_public_key: params.publicKey, p_sign_count: params.signCount,
    p_transports: params.transports, p_aaguid: params.aaguid, p_label: params.label
  } });
}
