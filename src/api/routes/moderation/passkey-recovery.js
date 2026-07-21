import { allowMethods, readWalletSession, sendError } from '../../backend.js';
import {
  isModerationPasskeyEnabled,
  recordAuthEventBestEffort
} from '../../moderation-passkey.js';

// Founder decision 2026-07-20: founder recovery is Safe-only. Until the
// Safe/EIP-1271 recovery integration exists, EVERY recovery attempt fails
// closed and is audit-recorded. There is intentionally no wallet-only,
// email, X, or Discord recovery path.
export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;

  try {
    if (!isModerationPasskeyEnabled()) {
      return res.status(404).json({ error: 'PASSKEY_DISABLED' });
    }

    const wallet = readWalletSession(req);
    await recordAuthEventBestEffort(wallet, 'recovery_denied', null, {
      reason: 'Safe-authorized recovery is not implemented yet'
    });

    res.status(403).json({
      error: 'RECOVERY_UNAVAILABLE',
      message: 'Passkey recovery requires the Safe-authorized recovery ceremony, which is not available yet.'
    });
  } catch (error) {
    sendError(res, error);
  }
}
