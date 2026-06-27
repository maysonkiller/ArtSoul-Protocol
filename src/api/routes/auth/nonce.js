import crypto from 'node:crypto';
import { allowMethods, isAddress, normalizeWallet, sendError, supabaseRest } from '../../backend.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;

  try {
    const wallet = normalizeWallet(req.query.wallet);
    if (!wallet || !isAddress(wallet)) {
      return res.status(400).json({ error: 'INVALID_WALLET' });
    }

    const nonce = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await supabaseRest('siwe_nonces', {
      method: 'POST',
      body: [{ nonce, wallet, expires_at: expiresAt, used: false }]
    });

    res.status(200).json({ nonce });
  } catch (error) {
    sendError(res, error);
  }
}
