import { allowMethods, normalizeWallet, readWalletSession, sendError } from '../../backend.js';
import { getModerationAccess } from '../../moderation-access.js';
import { readProtocolAdminConfig } from '../../protocol-admin-config.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;
  res.setHeader('Cache-Control', 'private, no-store');

  try {
    const config = readProtocolAdminConfig();
    if (!config.requested && !config.passkeyEnabled) {
      return res.status(200).json({
        success: true,
        enabled: false,
        setupEnabled: false,
        authenticated: false,
        eligible: false,
        access: null
      });
    }
    if (!config.passkeyEnabled) {
      const error = new Error('Protocol Admin requires the moderation passkey feature.');
      error.code = 'PROTOCOL_ADMIN_PASSKEY_REQUIRED';
      error.statusCode = 503;
      throw error;
    }

    // A connected account can differ from the browser's still-valid SIWE
    // session. Compare the expected account without looking up caller input.
    const expectedWallet = req.query?.expectedWallet;
    if (expectedWallet !== undefined) {
      const normalized = typeof expectedWallet === 'string' ? normalizeWallet(expectedWallet) : '';
      if (!normalized) return res.status(400).json({ error: 'INVALID_WALLET', message: 'Choose a valid connected wallet.' });
      if (normalized !== readWalletSession(req)) {
        return res.status(200).json({
          success: true, enabled: config.enabled, setupEnabled: true,
          authenticated: false, eligible: false, access: null
        });
      }
    }

    // This endpoint is the sole menu-discovery surface. It may confirm an
    // active role for the wallet's existing SIWE session, but never returns
    // protected queue data and never substitutes for passkey step-up. Setup
    // can be available while the separate review queue remains disabled.
    const access = await getModerationAccess(req);
    return res.status(200).json({
      success: true,
      enabled: config.enabled,
      setupEnabled: true,
      authenticated: Boolean(access?.wallet),
      eligible: Boolean(access?.role),
      access: {
        role: access?.role || null,
        stepUpActive: access?.stepUpActive === true,
        passkeyRequired: access?.passkeyRequired === true
      }
    });
  } catch (error) {
    sendError(res, error);
  }
}
