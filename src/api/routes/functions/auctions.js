import { allowMethods, sendError, supabaseRest } from '../../backend.js';

const replacement = '/api/public/artworks?view=auctions&chain_id=84532';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;

  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Link', `<${replacement}>; rel="successor-version"`);
  try {
    const rows = await supabaseRest('auctions?select=id&status=eq.active&limit=1');
    if (!Array.isArray(rows)) throw new Error('Invalid legacy auction response');
    if (!rows.length) return res.status(200).json([]);
    // An archived auction UUID cannot identify a round in the indexed contract.
    return res.status(410).json({
      error: 'LEGACY_AUCTIONS_RETIRED',
      message: 'Use the public artwork feed for active Base Sepolia auctions. Its data array contains artwork_id, auction_id and chain_id.',
      replacement
    });
  } catch (error) {
    return sendError(res, error);
  }
}
