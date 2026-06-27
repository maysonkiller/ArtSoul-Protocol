import { allowMethods, clearWalletSession } from '../../backend.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;

  clearWalletSession(res);
  res.status(200).json({ success: true });
}
