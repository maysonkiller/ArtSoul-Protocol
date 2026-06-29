import {
  allowMethods,
  normalizeChainId,
  readJson,
  sendError,
  supabaseRest
} from '../../backend.js';
import { getModerationAccess } from '../../moderation-access.js';

function protocolId(value) {
  const text = String(value || '').trim();
  return /^\d{1,78}$/.test(text) && text !== '0' ? text : '';
}

function visibilityQuery(chainId, artworkId) {
  return `artwork_moderation_visibility?chain_id=eq.${chainId}&artwork_id=eq.${encodeURIComponent(artworkId)}&select=chain_id,artwork_id,hidden,hidden_reason,hidden_by,hidden_at,updated_at&limit=1`;
}

function badRequest(message, code) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  return error;
}

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['GET', 'POST'])) return;

  try {
    const access = await getModerationAccess(req, { strict: true });

    if (req.method === 'GET' && String(req.query?.view || '').toLowerCase() === 'hidden') {
      const rows = await supabaseRest(
        'artwork_moderation_visibility?hidden=eq.true&select=chain_id,artwork_id,hidden,hidden_reason,hidden_by,hidden_at,updated_at&order=updated_at.desc&limit=200'
      );
      return res.status(200).json({ success: true, access, data: rows || [] });
    }

    if (req.method === 'GET') {
      const chainId = normalizeChainId(req.query?.chain_id);
      const artworkId = protocolId(req.query?.artwork_id);
      if (!artworkId) throw badRequest('Valid artwork_id is required', 'INVALID_ARTWORK_ID');

      const rows = await supabaseRest(visibilityQuery(chainId, artworkId));
      return res.status(200).json({
        success: true,
        access,
        data: rows?.[0] || {
          chain_id: chainId,
          artwork_id: artworkId,
          hidden: false,
          hidden_reason: null,
          hidden_by: null,
          hidden_at: null,
          updated_at: null
        }
      });
    }

    const body = await readJson(req);
    const chainId = normalizeChainId(body.chain_id);
    const artworkId = protocolId(body.artwork_id);
    const hidden = body.hidden;
    const reason = String(body.reason || '').trim().slice(0, 500);

    if (!artworkId) throw badRequest('Valid artwork_id is required', 'INVALID_ARTWORK_ID');
    if (typeof hidden !== 'boolean') throw badRequest('hidden must be a boolean', 'INVALID_HIDDEN_STATE');
    if (hidden && !reason) throw badRequest('Reason is required to hide artwork', 'MISSING_REASON');

    const rows = await supabaseRest('rpc/set_artwork_moderation_visibility', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: {
        p_chain_id: chainId,
        p_artwork_id: artworkId,
        p_hidden: hidden,
        p_reason: hidden ? reason : null,
        p_actor_wallet: access.wallet
      }
    });

    return res.status(200).json({
      success: true,
      access,
      data: rows?.[0] || {
        chain_id: chainId,
        artwork_id: artworkId,
        hidden,
        hidden_reason: hidden ? reason : null,
        hidden_by: hidden ? access.wallet : null
      }
    });
  } catch (error) {
    sendError(res, error);
  }
}
