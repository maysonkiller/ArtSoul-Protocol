import {
  allowMethods,
  normalizeWallet,
  sendError,
  supabaseRest
} from '../../backend.js';

// The exact set the public profile page consumes, and nothing else. This list
// is a behavioural contract rather than a detail of this route: it is the whole
// answer ArtSoulDB.getProfile() gives every caller.
//
// `id` and `created_at` are not decorative. handleSaveProfile branches on `id`
// to take the update path instead of the create/upsert fallback, and the
// discovery service scores account age from `created_at`, so dropping either
// silently changes what the product does. Private provider identifiers -
// twitter_id, discord_id, discord_avatar - stay out, with every other column no
// public surface reads.
const PUBLIC_PROFILE_FIELDS = [
  'id',
  'created_at',
  'wallet_address',
  'username',
  'bio',
  'avatar_url',
  'twitter_handle',
  'twitter_username',
  'discord_username'
].join(',');

export default async function publicProfileHandler(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;

  try {
    const wallet = normalizeWallet(req.query?.address || req.query?.wallet_address);
    if (!wallet) {
      const error = new Error('A valid wallet address is required.');
      error.statusCode = 400;
      error.code = 'INVALID_WALLET_ADDRESS';
      throw error;
    }

    const rows = await supabaseRest(
      `profiles?wallet_address=eq.${encodeURIComponent(wallet)}&select=${PUBLIC_PROFILE_FIELDS}&limit=1`
    );

    // Profile edits must be visible immediately after save. The speedup comes
    // from starting this narrow request in the document head, not stale caching.
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json({
      success: true,
      profile: rows?.[0] || null
    });
  } catch (error) {
    return sendError(res, error);
  }
}
