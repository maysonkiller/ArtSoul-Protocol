import { allowMethods, sendError, supabaseRest } from '../../backend.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;

  try {
    const data = await supabaseRest('artworks?select=*,ai_valuations(*)&order=created_at.desc');
    return res.status(200).json(data || []);
  } catch (error) {
    return sendError(res, error);
  }
}
