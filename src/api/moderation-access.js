import {
  readWalletSession,
  requireWallet,
  supabaseRest
} from './backend.js';
import {
  isModerationPasskeyEnabled,
  verifyModerationStepUp
} from './moderation-passkey.js';

const MODERATION_ROLES = new Set(['admin', 'moderator', 'team']);

function hasText(value) {
  return Boolean(String(value || '').trim());
}

function accessError(message, code, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

export async function getModerationAccess(req, options = {}) {
  const strict = options.strict === true;
  const wallet = strict ? requireWallet(req) : readWalletSession(req);

  if (!wallet) {
    return {
      wallet: null,
      role: null,
      canModerate: false,
      missingFactors: ['wallet']
    };
  }

  let roleRows;
  let profileRows;
  try {
    [roleRows, profileRows] = await Promise.all([
      supabaseRest(
        `artsoul_staff_roles?wallet_address=eq.${encodeURIComponent(wallet)}&active=eq.true&select=role&limit=1`
      ),
      supabaseRest(
        `profiles?wallet_address=eq.${encodeURIComponent(wallet)}&select=wallet_address,twitter_id,twitter_handle,twitter_username,discord_id,discord_username&limit=1`
      )
    ]);
  } catch (error) {
    if (strict) {
      throw accessError(
        'Moderation role registry is unavailable',
        'MODERATION_ROLE_REGISTRY_UNAVAILABLE',
        503
      );
    }

    return {
      wallet,
      role: null,
      canModerate: false,
      missingFactors: ['role_registry']
    };
  }

  const role = String(roleRows?.[0]?.role || '').toLowerCase();
  const profile = profileRows?.[0] || null;

  // A8a (founder decision 2026-07-20): with the passkey flag enabled,
  // moderation requires an active staff role + a valid SIWE session + a
  // valid 15-minute passkey step-up. X/Discord handles and IDs are profile
  // and eligibility data ONLY — they never participate in this
  // authorization decision. Missing configuration fails closed.
  if (isModerationPasskeyEnabled()) {
    let stepUp;
    try {
      stepUp = await verifyModerationStepUp(req, wallet);
    } catch (error) {
      if (strict) throw error;
      return {
        wallet,
        role: MODERATION_ROLES.has(role) ? role : null,
        canModerate: false,
        passkeyRequired: true,
        missingFactors: ['passkey_configuration']
      };
    }

    if (strict && !MODERATION_ROLES.has(role)) {
      throw accessError('Administrative access required', 'ADMIN_REQUIRED', 403);
    }
    if (strict && !stepUp.valid) {
      throw accessError(
        'A passkey step-up is required for moderation access',
        stepUp.code || 'STEP_UP_REQUIRED',
        403
      );
    }

    return {
      wallet,
      role: MODERATION_ROLES.has(role) ? role : null,
      canModerate: MODERATION_ROLES.has(role) && stepUp.valid,
      passkeyRequired: true,
      stepUpActive: stepUp.valid,
      missingFactors: stepUp.valid ? [] : ['passkey_step_up']
    };
  }

  // TEMPORARY LEGACY BEHAVIOR (flag disabled): the profile/X/Discord factor
  // path below predates the A8a decision and is scheduled for removal when
  // ARTSOUL_MODERATION_PASSKEY_ENABLED is activated. It is kept only so
  // current production moderators are not locked out before founder
  // passkey enrollment. Social identifiers are NOT authentication factors.
  const factors = {
    profile: Boolean(profile),
    x: Boolean(profile && (
      hasText(profile.twitter_id) ||
      hasText(profile.twitter_handle) ||
      hasText(profile.twitter_username)
    )),
    discord: Boolean(profile && (
      hasText(profile.discord_id) ||
      hasText(profile.discord_username)
    )),
    wallet: true
  };
  const missingFactors = Object.entries(factors)
    .filter(([, present]) => !present)
    .map(([factor]) => factor);
  const canModerate = MODERATION_ROLES.has(role) && missingFactors.length === 0;

  if (strict && !MODERATION_ROLES.has(role)) {
    throw accessError('Administrative access required', 'ADMIN_REQUIRED', 403);
  }

  if (strict && missingFactors.length > 0) {
    throw accessError(
      'Complete your ArtSoul profile, X, and Discord connections before moderating',
      'MODERATOR_FACTORS_REQUIRED',
      403
    );
  }

  return {
    wallet,
    role: MODERATION_ROLES.has(role) ? role : null,
    canModerate,
    missingFactors
  };
}
