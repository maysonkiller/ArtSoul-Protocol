// Editable public links are not provider identities. Only OAuth writes IDs and
// canonical provider names; IDs are used server-side and never published.
export const PUBLIC_PROFILE_FIELDS = ['id', 'created_at', 'wallet_address', 'username', 'bio', 'avatar_url', 'twitter_handle', 'twitter_username', 'discord_username'];

export function publicProfile(row) {
  if (!row) return null;
  const profile = Object.fromEntries(PUBLIC_PROFILE_FIELDS.filter(key => key in row).map(key => [key, row[key]]));
  profile.twitter_connected = typeof row.twitter_id === 'string' && row.twitter_id.trim().length > 0;
  profile.discord_connected = typeof row.discord_id === 'string' && row.discord_id.trim().length > 0;
  return profile;
}

export function cleanProfile(body = {}) {
  const profile = {};
  for (const field of ['username', 'bio', 'avatar_url']) {
    if (body[field] !== undefined) profile[field] = typeof body[field] === 'string' ? body[field].trim() : body[field];
  }
  if (body.public_twitter_handle !== undefined) {
    // Keep the existing column as a self-reported link, separate from the
    // OAuth-owned twitter_username and twitter_id. No migration is needed.
    const input = String(body.public_twitter_handle || '').trim();
    const handle = input.replace(/^https:\/\/(?:www\.)?(?:x|twitter)\.com\//i, '').replace(/^@/, '').replace(/\/$/, '');
    if (handle && !/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
      throw Object.assign(new Error('Enter an X username or a https://x.com profile link.'), { statusCode: 400, code: 'INVALID_PUBLIC_LINK' });
    }
    profile.twitter_handle = handle ? `@${handle}` : null;
  }
  return profile;
}
