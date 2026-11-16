import {
  allowMethods,
  readJson,
  requireWallet,
  sendError,
  supabaseRest
} from '../backend.js';
import { cleanProfile, publicProfile, PUBLIC_PROFILE_FIELDS, PUBLIC_PROFILE_SOURCE, PUBLIC_PROFILE_SELECT } from '../profile-fields.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!allowMethods(req, res, ['GET', 'PUT'])) return;

  try {
    const wallet = requireWallet(req);
    // Another tab can replace the shared session cookie while this draft is open.
    const intendedWallet = req.headers?.['x-artsoul-wallet'];
    if (typeof intendedWallet !== 'string' || intendedWallet.toLowerCase() !== wallet) {
      return res.status(401).json({
        error: 'SESSION_WALLET_MISMATCH',
        message: 'Sign in with the wallet for this profile, then save again.'
      });
    }
    if (req.method === 'GET') {
      const rows = await supabaseRest(
        `profiles?wallet_address=eq.${encodeURIComponent(wallet)}&select=${[...PUBLIC_PROFILE_FIELDS, 'twitter_id', 'discord_id'].join(',')}&limit=1`
      );
      // Only the verified owner can read originals for editing. The serializer
      // still omits emails, roles and raw OAuth provider IDs.
      return res.status(200).json({ success: true, profile: publicProfile(rows?.[0]) });
    }
    const body = await readJson(req);
    const profile = cleanProfile(body);

    if (profile.username) {
      const existing = await supabaseRest(
        `profiles?username=eq.${encodeURIComponent(profile.username)}&select=wallet_address&limit=1`
      );
      const owner = existing?.[0]?.wallet_address?.toLowerCase();
      if (owner && owner !== wallet) {
        return res.status(409).json({ error: 'USERNAME_TAKEN', message: 'Username already taken' });
      }
    }

    const now = new Date().toISOString();
    await supabaseRest('profiles?on_conflict=wallet_address', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: [{ wallet_address: wallet, ...profile, updated_at: now }]
    });

    const rows = await supabaseRest(`${PUBLIC_PROFILE_SOURCE}?wallet_address=eq.${encodeURIComponent(wallet)}&select=${PUBLIC_PROFILE_SELECT}&limit=1`);
    if (!rows?.[0]) throw new Error('Saved profile could not be read. Please retry.');
    res.status(200).json({ success: true, profile: publicProfile(rows[0]) });
  } catch (error) {
    sendError(res, error);
  }
}
