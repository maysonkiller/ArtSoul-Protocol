import {
  allowMethods,
  normalizeChainId,
  readJson,
  requireWallet,
  sendError,
  supabaseRest,
  validateArtworkId
} from '../../backend.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;

  try {
    const wallet = requireWallet(req);
    const body = await readJson(req);
    const artworkId = validateArtworkId(body.artwork_id);
    const chainId = normalizeChainId(body.chain_id);
    if (!artworkId) {
      return res.status(400).json({ error: 'INVALID_ARTWORK_ID' });
    }

    const existing = await supabaseRest(
      `votes?artwork_id=eq.${encodeURIComponent(artworkId)}&voter_address=eq.${wallet}&select=id&limit=1`
    );
    if (existing && existing.length > 0) {
      return res.status(200).json({ success: true, alreadyRecorded: true, chain_id: chainId });
    }

    const rows = await supabaseRest('votes', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: [{
        artwork_id: artworkId,
        voter_address: wallet,
        vote_type: 'like',
        created_at: new Date().toISOString()
      }]
    });

    res.status(200).json({ success: true, alreadyRecorded: false, chain_id: chainId, vote: rows?.[0] || null });
  } catch (error) {
    sendError(res, error);
  }
}
