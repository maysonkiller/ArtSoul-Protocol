import { allowMethods, readWalletSession } from '../../backend.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;

  const wallet = readWalletSession(req);
  res.status(200).json({
    authenticated: Boolean(wallet),
    wallet: wallet || null
  });
}
