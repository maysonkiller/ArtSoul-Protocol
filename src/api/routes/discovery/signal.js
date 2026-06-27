import {
  allowMethods,
  normalizeChainId,
  readJson,
  requireWallet,
  sendError,
  supabaseRest,
  validateArtworkId
} from '../../backend.js';

const ALLOWED_SIGNALS = new Set(['like', 'would_buy', 'watching']);

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;

  try {
    const wallet = requireWallet(req);
    const body = await readJson(req);
    const artworkId = validateArtworkId(body.artwork_id);
    const chainId = normalizeChainId(body.chain_id);
    const signalType = String(body.signal_type || '').trim();

    if (!artworkId) {
      return res.status(400).json({ error: 'INVALID_ARTWORK_ID' });
    }
    if (!ALLOWED_SIGNALS.has(signalType)) {
      return res.status(400).json({ error: 'INVALID_SIGNAL_TYPE' });
    }

    const existing = await supabaseRest(
      `artwork_social_signals?chain_id=eq.${chainId}` +
      `&artwork_id=eq.${encodeURIComponent(artworkId)}` +
      `&wallet_address=eq.${encodeURIComponent(wallet)}` +
      `&signal_type=eq.${encodeURIComponent(signalType)}` +
      '&select=chain_id,artwork_id,wallet_address,signal_type&limit=1'
    );
    if (existing && existing.length > 0) {
      return res.status(200).json({
        success: true,
        alreadyRecorded: true,
        signal: existing[0]
      });
    }

    const rows = await supabaseRest('artwork_social_signals?on_conflict=chain_id,artwork_id,wallet_address,signal_type', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: [{
        chain_id: chainId,
        artwork_id: artworkId,
        wallet_address: wallet,
        signal_type: signalType,
        updated_at: new Date().toISOString()
      }]
    });

    res.status(200).json({
      success: true,
      alreadyRecorded: false,
      signal: rows?.[0] || null
    });
  } catch (error) {
    sendError(res, error);
  }
}
