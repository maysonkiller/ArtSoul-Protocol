import {
  allowMethods,
  readJson,
  requireWallet,
  sendError,
  supabaseRest
} from '../backend.js';
import { cleanProfile, publicProfile } from '../profile-fields.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['PUT'])) return;

  try {
    const wallet = requireWallet(req);
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
    const rows = await supabaseRest('profiles?on_conflict=wallet_address', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: [{ wallet_address: wallet, ...profile, updated_at: now }]
    });

    res.status(200).json({ success: true, profile: publicProfile(rows?.[0] || { wallet_address: wallet, ...profile }) });
  } catch (error) {
    sendError(res, error);
  }
}
