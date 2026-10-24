import { createHash } from 'node:crypto';
import { allowMethods, normalizeWallet, sendError, supabaseRest } from '../../backend.js';
import { PUBLIC_PROFILE_FIELDS, publicProfile } from '../../profile-fields.js';
import { readVisibleArtworkCards } from './artworks.js';

const CATEGORIES = ['artworks', 'auctions', 'artists'];
const validId = value => typeof value === 'string' && /^[1-9][0-9]{0,77}$/.test(value) && BigInt(value) < 2n ** 256n;
const invalid = () => Object.assign(new Error('Enter a valid search and category.'), { code: 'INVALID_SEARCH', statusCode: 400 });
const fingerprint = (query, category) => createHash('sha256').update(JSON.stringify([query, category])).digest('hex').slice(0, 24);

function parse(req) {
  const raw = req.query?.q;
  if (typeof raw !== 'string') throw invalid();
  const query = raw.trim().replace(/\s+/gu, ' ');
  const category = req.query?.category ?? 'all';
  if (!query || [...query].length > 100 || /[\u0000-\u001f\u007f]/u.test(query) ||
      !['all', ...CATEGORIES].includes(category)) throw invalid();
  const explicit = query.match(/^(?:#|artwork[: ]+)?([0-9]+)$/i);
  if (explicit ? !validId(explicit[1]) : [...query].length < 2) throw invalid();
  let before = null;
  if (req.query?.cursor !== undefined) {
    const value = req.query.cursor;
    if (category === 'all' || typeof value !== 'string' || value.length > 400 || !/^[A-Za-z0-9_-]+$/.test(value)) throw invalid();
    try {
      const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
      if (decoded.v !== 1 || decoded.q !== fingerprint(query, category) ||
          (category === 'artists' ? typeof decoded.k !== 'string' || !/^0x[0-9a-f]{40}$/.test(decoded.k) : !validId(decoded.k))) throw invalid();
      before = decoded.k;
    } catch { throw invalid(); }
  }
  return { query, category, before };
}

export default async function searchHandler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!allowMethods(req, res, ['GET'])) return;
  try {
    const input = parse(req);
    const core = normalizeWallet(process.env.ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA);
    if (process.env.ARTSOUL_SEARCH_ENABLED !== 'true' || !core || /^0x0{40}$/.test(core)) {
      throw Object.assign(new Error('Search is not available yet. Please try again later.'), { code: 'SEARCH_UNAVAILABLE', statusCode: 503 });
    }
    const limit = input.category === 'all' ? 5 : 20;
    const selected = input.category === 'all' ? CATEGORIES : [input.category];
    const pages = await Promise.all(selected.map(async category => {
      const rows = await supabaseRest('rpc/search_public_artworks', {
        method: 'POST', body: { p_query: input.query, p_category: category, p_core_address: core,
          p_before: input.before, p_limit: limit + 1 }
      });
      if (!Array.isArray(rows) || rows.length > limit + 1 || rows.some((row, index) =>
        (category === 'artists' ? !/^0x[0-9a-f]{40}$/.test(row.result_key) : !validId(row.result_key)) ||
        (index > 0 && (category === 'artists' ? row.result_key >= rows[index - 1].result_key :
          BigInt(row.result_key) >= BigInt(rows[index - 1].result_key))))) throw new Error('Invalid search response');
      return { category, keys: rows.slice(0, limit).map(row => row.result_key), hasMore: rows.length > limit };
    }));
    const artworkIds = [...new Set(pages.filter(page => page.category !== 'artists').flatMap(page => page.keys))];
    const artistIds = pages.find(page => page.category === 'artists')?.keys || [];
    const [cards, profiles] = await Promise.all([
      artworkIds.length ? readVisibleArtworkCards(84532, artworkIds, core) : [],
      artistIds.length ? supabaseRest(`profiles?wallet_address=in.(${artistIds.join(',')})&select=${[...PUBLIC_PROFILE_FIELDS, 'twitter_id', 'discord_id'].join(',')}&limit=${artistIds.length}`) : []
    ]);
    if (!Array.isArray(profiles) || profiles.some(profile => !artistIds.includes(profile.wallet_address))) throw new Error('Invalid search profiles');
    const byArtwork = new Map(cards.map(card => [card.artwork_id, card]));
    const byArtist = new Map(profiles.map(profile => [profile.wallet_address, publicProfile(profile)]));
    const groups = Object.fromEntries(CATEGORIES.map(category => [category, { items: [], hasMore: false }]));
    for (const page of pages) {
      groups[page.category] = { hasMore: page.hasMore, items: page.keys.map(key => page.category === 'artists'
        ? byArtist.get(key) || publicProfile({ wallet_address: key }) : byArtwork.get(key)).filter(item => item &&
          (page.category !== 'auctions' || (item.status === 'auction' && Date.parse(item.auction_end_time) > Date.now()))) };
    }
    const page = pages[0];
    const nextCursor = input.category !== 'all' && page.hasMore ? Buffer.from(JSON.stringify({
      v: 1, q: fingerprint(input.query, input.category), k: page.keys.at(-1)
    })).toString('base64url') : null;
    return res.status(200).json({ query: input.query, category: input.category, groups, nextCursor });
  } catch (error) {
    if (!['INVALID_SEARCH', 'SEARCH_UNAVAILABLE'].includes(error?.code)) {
      error = Object.assign(new Error('Search is temporarily unavailable. Please try again.'), { code: 'SEARCH_UNAVAILABLE', statusCode: 503 });
    }
    return sendError(res, error);
  }
}
