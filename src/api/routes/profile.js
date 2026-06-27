import {
  allowMethods,
  readJson,
  requireWallet,
  sendError,
  supabaseRest
} from '../backend.js';

const PROFILE_FIELDS = ['username', 'bio', 'twitter_handle', 'discord_username', 'avatar_url'];

function cleanProfile(body) {
  return PROFILE_FIELDS.reduce((profile, field) => {
    if (body[field] !== undefined) {
      profile[field] = typeof body[field] === 'string' ? body[field].trim() : body[field];
    }
    return profile;
  }, {});
}

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

    res.status(200).json({ success: true, profile: rows?.[0] || { wallet_address: wallet, ...profile } });
  } catch (error) {
    sendError(res, error);
  }
}
