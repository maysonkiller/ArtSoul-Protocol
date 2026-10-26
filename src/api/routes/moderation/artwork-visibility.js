import {
  allowMethods,
  normalizeChainId,
  readJson,
  sendError,
  supabaseRest
} from '../../backend.js';
import { getModerationAccess, canReadStaffWallets, redactOtherStaffWallets } from '../../moderation-access.js';
import { requireProtocolAdminEnabled } from '../../protocol-admin-config.js';
import { catalogArtworkId } from '../../admin-artwork-catalog.js';

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
  res.setHeader('Cache-Control', 'private, no-store');
  if (!allowMethods(req, res, ['GET', 'POST'])) return;

  try {
    // The legacy read probe remains non-disclosing for unverified callers.
    // Staff writes belong to the enabled Admin workspace only.
    if (req.method === 'POST') requireProtocolAdminEnabled();
    const access = await getModerationAccess(req, { strict: req.method === 'POST' });

    if (req.method === 'GET' && !access.canModerate) {
      return res.status(200).json({ success: true, access, data: null });
    }

    if (req.method === 'GET' && String(req.query?.view || '').toLowerCase() === 'hidden') {
      const rows = await supabaseRest(
        'artwork_moderation_visibility?hidden=eq.true&select=chain_id,artwork_id,hidden,hidden_reason,hidden_by,hidden_at,updated_at&order=updated_at.desc&limit=200'
      );
      const current = await getModerationAccess(req, {strict: true});
      return res.status(200).json({ success: true, access: current,
        data: redactOtherStaffWallets(rows, 'hidden_by', current, await canReadStaffWallets(current)) });
    }

    if (req.method === 'GET') {
      const chainId = normalizeChainId(req.query?.chain_id);
      const artworkId = protocolId(req.query?.artwork_id);
      if (!artworkId) throw badRequest('Valid artwork_id is required', 'INVALID_ARTWORK_ID');

      const rows = await supabaseRest(visibilityQuery(chainId, artworkId));
      const current = await getModerationAccess(req, {strict: true});
      const visible = redactOtherStaffWallets(rows, 'hidden_by', current, await canReadStaffWallets(current));
      return res.status(200).json({
        success: true,
        access: current,
        data: visible[0] || {
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
    const artworkId = catalogArtworkId(String(body.artwork_id || ''));
    const hidden = body.hidden;
    const reason = String(body.reason || '').trim();
    const expected = body.expected_updated_at;

    if (!artworkId) throw badRequest('Valid artwork_id is required', 'INVALID_ARTWORK_ID');
    if (chainId !== 84532) throw badRequest('Choose the active artwork network.', 'INVALID_CHAIN');
    if (typeof hidden !== 'boolean') throw badRequest('hidden must be a boolean', 'INVALID_HIDDEN_STATE');
    if (!reason || reason.length > 500) throw badRequest('A review reason of 1–500 characters is required.', 'MISSING_REASON');
    if (expected !== null && (typeof expected !== 'string' || !Number.isFinite(Date.parse(expected)))) {
      throw badRequest('Refresh the artwork before recording a visibility decision.', 'INVALID_VISIBILITY_VERSION');
    }

    const rows = await supabaseRest('rpc/review_artwork_visibility', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: {
        p_chain_id: chainId,
        p_artwork_id: artworkId,
        p_hidden: hidden,
        p_reason: reason,
        p_actor_wallet: access.wallet,
        p_expected_updated_at: expected
      }
    });
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.hidden !== hidden) {
      throw new Error('The visibility decision was not recorded. Refresh before retrying.');
    }

    return res.status(200).json({
      success: true,
      access,
      data: redactOtherStaffWallets(rows, 'hidden_by', access, false)[0] || {
        chain_id: chainId,
        artwork_id: artworkId,
        hidden,
        hidden_reason: hidden ? reason : null,
        hidden_by: hidden ? access.wallet : null
      }
    });
  } catch (error) {
    const detail = String(error?.details?.message || error?.message || '');
    const mapped = [
      ['ARTWORK_ACTIVE_REPORTS','Resolve the active artwork reports before restoring visibility.',409],
      ['VISIBILITY_REVIEW_CONFLICT','This artwork changed. Refresh it before making a decision.',409],
      ['VISIBILITY_ALREADY_SET','This visibility decision is already recorded. Refresh the artwork.',409],
      ['ARTWORK_NOT_FOUND','The artwork no longer exists in the current index.',404],
      ['ADMIN_REQUIRED','This wallet no longer has an active staff role.',403]
    ].find(([code]) => detail.includes(code));
    if (mapped) { error.code=mapped[0]; error.message=mapped[1]; error.statusCode=mapped[2]; }
    sendError(res, error);
  }
}
