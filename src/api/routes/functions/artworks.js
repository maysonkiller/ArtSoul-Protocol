import { allowMethods, sendError, supabaseRest } from '../../backend.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;

  try {
    const data = await supabaseRest('artworks?select=*,ai_valuations(*)&order=created_at.desc&limit=200');
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=240');
    return res.status(200).json(data || []);
  } catch (error) {
    return sendError(res, error);
  }
}
