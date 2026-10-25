import { allowMethods, normalizeWallet, requireWallet, sendError, supabaseRest, getPublicStorageUrl } from '../backend.js';
import { publicOrigin, readBoundedJson, serviceError } from '../launch-services.js';
import { readProfileLayoutConfig } from '../profile-layout-config.js';
import { readVisibleArtworkCards } from './public/artworks.js';
import { defaultProfileLayout, validateProfileLayout, layoutArtworks, canFeatureArtwork } from '../../features/profile/profile-layout.js';

const fail = (code, message, status = 400) => serviceError(code, message, status);
const validRevision = value => Number.isInteger(value) && value >= 0 && value <= 2147483647;
const current = (item, config) => item.chain_id === config.chainId && item.core_address === config.coreAddress;

export function profileCoverPath(wallet, url) {
  if (url === null) return null;
  const prefix = getPublicStorageUrl('artworks', `profile-covers/${wallet}/`);
  // getPublicStorageUrl removes the trailing slash from a path.
  const base = `${prefix}/`;
  const filename = typeof url === 'string' && url.startsWith(base) ? url.slice(base.length) : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|gif)$/.test(filename)) {
    throw fail('INVALID_PROFILE_COVER', 'Choose a cover uploaded for this profile.');
  }
  return `profile-covers/${wallet}/${filename}`;
}

async function readLayout(wallet) {
  const rows = await supabaseRest(`profile_layouts?wallet_address=eq.${wallet}&select=revision,layout&limit=1`);
  if (!Array.isArray(rows) || rows.length > 1) throw new Error('Invalid layout read');
  if (!rows.length) return { wallet, revision: 0, layout: defaultProfileLayout() };
  if (!validRevision(rows[0].revision) || rows[0].revision === 0) throw new Error('Invalid layout revision');
  const layout = validateProfileLayout(rows[0].layout);
  // Do not render a stored foreign/external cover, even if data was altered out of band.
  profileCoverPath(wallet, layout.cover_url);
  return { wallet, revision: rows[0].revision, layout };
}

async function visibleSelections(wallet, layout, config) {
  const ids = layoutArtworks(layout).filter(item => current(item, config)).map(item => item.artwork_id);
  if (!ids.length) return [];
  const cards = await readVisibleArtworkCards(config.chainId, ids, config.coreAddress);
  if (!Array.isArray(cards) || cards.length > ids.length ||
      cards.some(card => !card || !ids.includes(card.artwork_id) || card.chain_id !== config.chainId) ||
      new Set(cards.map(card => card.artwork_id)).size !== cards.length) {
    throw new Error('Invalid selected cards');
  }
  return cards.filter(card => canFeatureArtwork(card, wallet, config.selectionPolicy));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!allowMethods(req, res, ['GET', 'PUT'])) return;
  try {
    const config = readProfileLayoutConfig();
    if (!config.enabled) throw fail('PROFILE_LAYOUT_DISABLED', 'Profile customization has not been activated.', 503);
    if (req.method === 'GET') {
      const wallet = normalizeWallet(req.query?.address);
      if (!wallet || /^0x0{40}$/.test(wallet) || Object.keys(req.query || {}).some(key => !['address', 'view', 'route'].includes(key)) ||
          (req.query?.view !== undefined && req.query.view !== 'artworks')) throw fail('INVALID_PROFILE_LAYOUT_QUERY', 'Choose a valid profile.');
      const saved = await readLayout(wallet);
      return res.status(200).json(req.query?.view === 'artworks'
        ? { wallet, revision: saved.revision, cards: await visibleSelections(wallet, saved.layout, config) } : saved);
    }
    const wallet = requireWallet(req);
    const expected = req.headers?.['x-artsoul-wallet'];
    if (typeof expected !== 'string' || expected.toLowerCase() !== wallet) throw fail('SESSION_WALLET_MISMATCH', 'Sign in with this profile wallet before saving.', 401);
    const origins = new Set([publicOrigin(), ...String(process.env.API_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)]);
    if (req.headers?.origin && !origins.has(req.headers.origin)) throw fail('INVALID_ORIGIN', 'Open ArtSoul to customize your profile.', 401);
    if (!/^application\/json(?:;|$)/i.test(req.headers?.['content-type'] || '')) throw fail('JSON_REQUIRED', 'Use a JSON request.', 415);
    const body = await readBoundedJson(req, 16384);
    if (Object.keys(body).length !== 2 || !Object.hasOwn(body, 'layout') || !validRevision(body.expected_revision) || body.expected_revision === 2147483647) {
      throw fail('INVALID_PROFILE_LAYOUT', 'Choose a valid layout revision.');
    }
    const layout = validateProfileLayout(body.layout);
    const selected = layoutArtworks(layout);
    if (selected.some(item => !current(item, config))) throw fail('PROFILE_LAYOUT_DEPLOYMENT_MISMATCH', 'Choose works from the current ArtSoul deployment.', 409);
    const cards = await visibleSelections(wallet, layout, config);
    if (new Set(cards.map(card => String(card.artwork_id))).size !== selected.length) {
      throw fail('PROFILE_ARTWORK_UNAVAILABLE', 'A selected work is unavailable for this profile. Remove it and save again.', 409);
    }
    // Cover images are retired. Preserve historical data without fetching an
    // invisible image or accepting a new cover through an older client.
    const previous = await readLayout(wallet);
    if (previous.revision !== body.expected_revision) throw fail('LAYOUT_CONFLICT', 'This layout changed in another tab. Reload its latest version before saving.', 409);
    if (layout.cover_url !== previous.layout.cover_url) throw fail('PROFILE_COVER_RETIRED', 'Profile cover images are no longer supported. Reload the profile editor.', 410);
    const saved = await supabaseRest('rpc/save_profile_layout', { method: 'POST',
      body: { p_wallet_address: wallet, p_expected_revision: body.expected_revision, p_layout: layout } });
    if (saved?.saved === false) throw fail('LAYOUT_CONFLICT', 'This layout changed in another tab. Reload its latest version before saving.', 409);
    if (saved?.wallet !== wallet || !validRevision(saved.revision) || saved.revision !== body.expected_revision + 1) throw new Error('Invalid layout acknowledgement');
    const confirmedLayout = validateProfileLayout(saved.layout);
    if (JSON.stringify(confirmedLayout) !== JSON.stringify(layout)) throw new Error('Layout acknowledgement changed the request');
    return res.status(200).json({ wallet, revision: saved.revision, layout: confirmedLayout });
  } catch (error) {
    if (!['UNAUTHENTICATED', 'SESSION_WALLET_MISMATCH', 'PROFILE_LAYOUT_DISABLED', 'INVALID_PROFILE_LAYOUT_QUERY',
      'INVALID_ORIGIN', 'JSON_REQUIRED', 'BODY_TOO_LARGE', 'INVALID_JSON', 'INVALID_PROFILE_LAYOUT', 'INVALID_PROFILE_COVER',
      'PROFILE_COVER_RETIRED', 'PROFILE_LAYOUT_DEPLOYMENT_MISMATCH', 'PROFILE_ARTWORK_UNAVAILABLE', 'LAYOUT_CONFLICT'].includes(error?.code)) {
      error = fail('PROFILE_LAYOUT_UNAVAILABLE', 'Profile customization is temporarily unavailable. Please try again.', 503);
    }
    sendError(res, error);
  }
}
