import {
  allowMethods,
  normalizeWallet,
  sendError,
  supabaseRest
} from '../../backend.js';

const PUBLIC_PROFILE_FIELDS = [
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
