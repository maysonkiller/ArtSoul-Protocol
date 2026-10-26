import { supabaseRest } from './backend.js';
import { allowedArtworkUrl, readArtworkMetadata } from './safe-artwork-fetch.js';
import { getMediaType, getMediaUrl, getPosterUrl } from './routes/public/artworks.js';

export function catalogArtworkId(value) {
  return typeof value === 'string' && /^[1-9]\d{0,77}$/.test(value) && BigInt(value) < 2n ** 256n ? value : '';
}

export async function readAdminArtworkCatalog({ before = null, ids = null } = {}) {
  const rows = await supabaseRest('rpc/read_admin_artwork_catalog', {
    method: 'POST', body: { p_before: before, p_limit: ids ? ids.length : 26, p_ids: ids }
  });
  if (!Array.isArray(rows) || rows.length > (ids ? ids.length : 26)
      || new Set(rows.map(row => row.artwork_id)).size !== rows.length
      || rows.some(row => row.chain_id !== 84532 || !catalogArtworkId(row.artwork_id)
        || (ids && !ids.includes(row.artwork_id)) || typeof row.hidden !== 'boolean')) {
    throw new Error('Invalid admin artwork catalog response');
  }
  const hasMore = !ids && rows.length === 26;
  const page = hasMore ? rows.slice(0,25) : rows;
  const artworks = await Promise.all(page.map(async row => {
    // Indexed metadata must match the current registration in the RPC. A cold
    // catalog page may safely fetch its missing metadata, but a complaint queue
    // never starts up to 200 remote metadata reads just to render previews.
    const metadata = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? row.metadata : ids ? {} : await readArtworkMetadata(row.metadata_uri);
    const mediaType = getMediaType(metadata);
    const rawMedia = getMediaUrl(metadata, mediaType);
    const safeUrl = value => allowedArtworkUrl(value)?.href || '';
    const counts = {};
    for (const name of ['report_count','pending_count','actioned_count','donation_report_count']) {
      const count = Number(row[name]);
      if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid admin report count');
      counts[name] = count;
    }
    return {
      chain_id: 84532, artwork_id: row.artwork_id,
      title: String(metadata.name || metadata.title || row.title || `Artwork #${row.artwork_id}`).slice(0,512),
      media_type: mediaType, media_url: safeUrl(rawMedia), poster_url: safeUrl(getPosterUrl(metadata,rawMedia)),
      hidden: row.hidden, hidden_reason: row.hidden_reason || null,
      visibility_updated_at: row.visibility_updated_at || null, ...counts
    };
  }));
  return { artworks, next: hasMore ? page.at(-1).artwork_id : null };
}
