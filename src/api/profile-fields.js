// Editable public links are not provider identities. Only OAuth writes IDs and
// canonical provider names. Raw provider-ID fields are omitted; the verified
// Discord numeric identity appears only in the requested public profile URL.
export const PUBLIC_PROFILE_FIELDS = ['id', 'created_at', 'wallet_address', 'username', 'bio', 'avatar_url', 'twitter_handle', 'twitter_username', 'discord_username'];
// This service-only view masks reviewed content atomically with the profile read.
// Intake may be disabled independently; existing decisions must still apply.
const reviewed = process.env.ARTSOUL_PROFILE_IDENTITY_REVIEWS_ENABLED === 'true';
export const PUBLIC_PROFILE_SOURCE = reviewed ? 'reviewed_profile_content' : 'public_profile_content';
export const PUBLIC_PROFILE_SELECT = [...PUBLIC_PROFILE_FIELDS, 'twitter_id', 'discord_id', 'profile_content_hidden',
  ...(reviewed ? ['profile_identity_verified'] : [])].join(',');

export function publicProfile(row) {
  if (!row) return null;
  const profile = Object.fromEntries(PUBLIC_PROFILE_FIELDS.filter(key => key in row).map(key => [key, row[key]]));
  if ('profile_content_hidden' in row) profile.profile_content_hidden = row.profile_content_hidden === true;
  if (reviewed && row.profile_identity_verified === true && row.profile_content_hidden === false && row.username) profile.profile_identity_verified = true;
  profile.twitter_connected = typeof row.twitter_id === 'string' && row.twitter_id.trim().length > 0;
  profile.discord_connected = typeof row.discord_id === 'string' && row.discord_id.trim().length > 0;
  profile.discord_profile_url = typeof row.discord_id === 'string' && /^\d{1,20}$/.test(row.discord_id)
    ? `https://discord.com/users/${row.discord_id}` : null;
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
