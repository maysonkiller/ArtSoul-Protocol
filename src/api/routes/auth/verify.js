import { verifyMessage } from 'ethers';
import {
  allowMethods,
  isAddress,
  normalizeWallet,
  readJson,
  sendError,
  setWalletSession,
  supabaseRest,
  validateSiweMessage
} from '../../backend.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;

  try {
    const { message, signature, address, nonce } = await readJson(req);
    const wallet = normalizeWallet(address);
    if (!message || !signature || !nonce || !wallet || !isAddress(wallet)) {
      return res.status(400).json({ error: 'INVALID_AUTH_PAYLOAD' });
    }

    validateSiweMessage(req, { message, wallet, nonce });

    const recovered = verifyMessage(message, signature).toLowerCase();
    if (recovered !== wallet) {
      return res.status(401).json({ error: 'INVALID_SIGNATURE' });
    }
    if (!message.includes(nonce)) {
      return res.status(401).json({ error: 'NONCE_NOT_IN_MESSAGE' });
    }

    const rows = await supabaseRest(
      `siwe_nonces?nonce=eq.${encodeURIComponent(nonce)}&wallet=eq.${wallet}&used=eq.false&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: { used: true }
      }
    );
    if (!rows || rows.length === 0) {
      return res.status(401).json({ error: 'INVALID_OR_EXPIRED_NONCE' });
    }

    setWalletSession(res, wallet);
    res.status(200).json({ success: true, wallet });
  } catch (error) {
    sendError(res, error);
  }
}
