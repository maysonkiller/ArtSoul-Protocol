import { allowMethods, normalizeWallet, requireWallet, sendError, supabaseRest } from '../backend.js';
import { publicOrigin, readBoundedJson, serviceError } from '../launch-services.js';
import { readSavedConfig } from '../saved-config.js';
import { readWithNftOwnershipResponse } from '../nft-ownership.js';
import { readVisibleArtworkCard } from './public/artworks.js';

const PAGE_SIZE = 20;
const LOOKUP_SIZE = 200;
const MAX_PROTOCOL_ID = 2n ** 256n;
const fail = (code, message, status = 400) => serviceError(code, message, status);
function protocolId(value) {
  return typeof value === 'string' && /^[1-9][0-9]{0,77}$/.test(value) && BigInt(value) < MAX_PROTOCOL_ID ? value : '';
}
function cursor(value) {
  return typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
}
function identity(body) {
  const chain = typeof body.chain_id === 'string' || typeof body.chain_id === 'number' ? Number(body.chain_id) : 0;
  const core = typeof body.core_address === 'string' ? normalizeWallet(body.core_address) : '';
  const id = protocolId(body.artwork_id);
  if (!Number.isSafeInteger(chain) || chain <= 0 || !core || /^0x0{40}$/.test(core) || !id) {
    throw fail('INVALID_SAVED_ARTWORK', 'Choose a valid artwork.');
  }
  return { chain, core, id };
}
function currentDeployment(row, config) {
  return Number(row.chain_id) === config.chainId && row.core_address === config.coreAddress;
}

// Read only current existence and public visibility, without staff exceptions.
// Never trust the cached feed's visibility when returning a private Saved page.
async function visibleArtworkIds(ids, chain) {
  if (!ids.length) return new Set();
  const filter = `chain_id=eq.${chain}&artwork_id=in.(${ids.join(',')})`;
  const [artworks, visibility] = await Promise.all([
    supabaseRest(`v41_artworks?select=artwork_id::text&${filter}&limit=${ids.length}`),
    supabaseRest(`artwork_moderation_visibility?select=artwork_id::text,hidden&${filter}&limit=${ids.length}`)
  ]);
  if (!Array.isArray(artworks) || !Array.isArray(visibility) ||
      artworks.some(row => !ids.includes(row.artwork_id)) ||
      visibility.some(row => !ids.includes(row.artwork_id) || typeof row.hidden !== 'boolean')) {
    throw new Error('Invalid artwork visibility');
  }
  const hidden = new Set(visibility.filter(row => row.hidden).map(row => row.artwork_id));
  return new Set(artworks.map(row => row.artwork_id).filter(id => !hidden.has(id)));
}

async function readSaved(req, wallet, config, responseScope) {
  const requested = req.query?.artwork_ids;
  if (requested !== undefined) {
    if (req.query?.before !== undefined || typeof requested !== 'string') throw fail('INVALID_SAVED_LOOKUP', 'Choose a valid saved artwork lookup.');
    const { chain, core } = identity({ chain_id: req.query.chain_id, core_address: req.query.core_address, artwork_id: '1' });
    if (chain !== config.chainId || core !== config.coreAddress) throw fail('SAVED_DEPLOYMENT_MISMATCH', 'This artwork belongs to another deployment.', 409);
    const values = requested.split(',');
    if (!values.length || values.length > LOOKUP_SIZE || values.some(id => !protocolId(id))) throw fail('INVALID_SAVED_LOOKUP', 'Choose a valid saved artwork lookup.');
    const ids = [...new Set(values)];
    const rows = await supabaseRest(`saved_artworks?wallet_address=eq.${wallet}&chain_id=eq.${config.chainId}&core_address=eq.${config.coreAddress}` +
      `&artwork_id=in.(${ids.join(',')})&select=artwork_id::text&limit=${LOOKUP_SIZE}`);
    if (!Array.isArray(rows) || rows.length > ids.length || rows.some(row => !ids.includes(row.artwork_id))) throw new Error('Invalid saved lookup');
    return { wallet, chainId: config.chainId, coreAddress: config.coreAddress, artworkIds: [...new Set(rows.map(row => row.artwork_id))] };
  }
  const before = req.query?.before;
  if (before !== undefined && !cursor(before)) throw fail('INVALID_SAVED_CURSOR', 'Choose a valid saved artwork page.');
  const rows = await supabaseRest(`saved_artworks?wallet_address=eq.${wallet}` +
    '&select=id::text,wallet_address,chain_id::text,core_address,artwork_id::text,created_at' +
    `&order=id.desc&limit=${PAGE_SIZE + 1}${before ? `&id=lt.${before}` : ''}`);
  if (!Array.isArray(rows) || rows.length > PAGE_SIZE + 1 || rows.some((row, i) =>
    row.wallet_address !== wallet || !cursor(row.id) || !protocolId(row.artwork_id) ||
    !Number.isSafeInteger(Number(row.chain_id)) || Number(row.chain_id) <= 0 ||
    normalizeWallet(row.core_address) !== row.core_address || /^0x0{40}$/.test(row.core_address) ||
    !Number.isFinite(Date.parse(row.created_at)) || (before && BigInt(row.id) >= BigInt(before)) ||
    (i > 0 && BigInt(row.id) >= BigInt(rows[i - 1].id)))) throw new Error('Invalid saved page');
  const page = rows.slice(0, PAGE_SIZE);
  const activeIds = [...new Set(page.filter(row => currentDeployment(row, config)).map(row => row.artwork_id))];
  const visible = await visibleArtworkIds(activeIds, config.chainId);
  const items = [];
  // A page is bounded to twenty rows; cap simultaneous exact projections at four.
  for (let offset = 0; offset < page.length; offset += 4) {
    items.push(...await Promise.all(page.slice(offset, offset + 4).map(async row => ({
      chain_id: Number(row.chain_id), core_address: row.core_address, artwork_id: row.artwork_id,
      created_at: row.created_at,
      artwork: currentDeployment(row, config) && visible.has(row.artwork_id)
        ? await readVisibleArtworkCard(config.chainId, row.artwork_id, responseScope) : null
    }))));
  }
  return { wallet, items, nextCursor: rows.length > PAGE_SIZE ? page.at(-1).id : null };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!allowMethods(req, res, ['GET', 'PUT'])) return;
  try {
    const wallet = requireWallet(req);
    const expected = req.headers?.['x-artsoul-wallet'];
    if (typeof expected !== 'string' || expected.toLowerCase() !== wallet) throw fail('SESSION_WALLET_MISMATCH', 'Sign in with your connected wallet to use Saved.', 401);
    const config = readSavedConfig();
    if (!config.enabled) throw fail('SAVED_DISABLED', 'Saved has not been activated.', 503);
    if (req.method === 'GET') {
      const requireSavedConfig = () => {
        if (JSON.stringify(readSavedConfig()) !== JSON.stringify(config)) throw new Error('Saved configuration changed');
      };
      const read = async responseScope => {
        requireSavedConfig();
        const data = await readSaved(req, wallet, config, responseScope);
        requireSavedConfig();
        return data;
      };
      // The membership lookup has no lifecycle projection to qualify.
      const data = req.query?.artwork_ids !== undefined ? await read() : await readWithNftOwnershipResponse(read);
      requireSavedConfig();
      return res.status(200).json(data);
    }
    const origins = new Set([publicOrigin(), ...String(process.env.API_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)]);
    if (req.headers?.origin && !origins.has(req.headers.origin)) throw fail('INVALID_ORIGIN', 'Open ArtSoul to update Saved.', 401);
    if (!/^application\/json(?:;|$)/i.test(req.headers?.['content-type'] || '')) throw fail('JSON_REQUIRED', 'Use a JSON request.', 415);
    const body = await readBoundedJson(req, 2048);
    if (typeof body.saved !== 'boolean' || Object.keys(body).some(key => !['chain_id', 'core_address', 'artwork_id', 'saved'].includes(key))) {
      throw fail('INVALID_SAVED_ARTWORK', 'Choose a valid artwork and save action.');
    }
    const { chain, core, id } = identity(body);
    if (body.saved) {
      if (chain !== config.chainId || core !== config.coreAddress) throw fail('SAVED_DEPLOYMENT_MISMATCH', 'This artwork belongs to another deployment.', 409);
      if (!(await visibleArtworkIds([id], chain)).has(id)) throw fail('ARTWORK_UNAVAILABLE', 'This artwork is not publicly available.', 404);
      await supabaseRest('saved_artworks?on_conflict=wallet_address,chain_id,core_address,artwork_id', {
        method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: [{ wallet_address: wallet, chain_id: chain, core_address: core, artwork_id: id }]
      });
    } else {
      // Removing an old deployment or hidden artwork needs no public hydration.
      await supabaseRest(`saved_artworks?wallet_address=eq.${wallet}&chain_id=eq.${chain}&core_address=eq.${core}&artwork_id=eq.${id}`, { method: 'DELETE' });
    }
    return res.status(200).json({ wallet, saved: body.saved });
  } catch (error) {
    if (!['UNAUTHENTICATED', 'SESSION_WALLET_MISMATCH', 'SAVED_DISABLED', 'INVALID_SAVED_LOOKUP', 'INVALID_SAVED_CURSOR',
      'INVALID_SAVED_ARTWORK', 'SAVED_DEPLOYMENT_MISMATCH', 'ARTWORK_UNAVAILABLE', 'INVALID_ORIGIN', 'JSON_REQUIRED',
      'BODY_TOO_LARGE', 'INVALID_JSON'].includes(error?.code)) {
      error = fail('SAVED_UNAVAILABLE', 'Saved is temporarily unavailable. Please try again.', 503);
    }
    sendError(res, error);
  }
}
