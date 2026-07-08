import { allowMethods, sendError, supabaseRest } from '../../backend.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;

  try {
    const data = await supabaseRest('auctions?select=*,artworks(*)&status=eq.active&order=endTime.asc');
    return res.status(200).json(data || []);
  } catch (error) {
    return sendError(res, error);
  }
}
