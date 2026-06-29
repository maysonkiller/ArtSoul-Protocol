import {
  readWalletSession,
  requireWallet,
  supabaseRest
} from './backend.js';

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
