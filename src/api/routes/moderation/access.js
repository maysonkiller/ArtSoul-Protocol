import { allowMethods, sendError } from '../../backend.js';
import { getModerationAccess } from '../../moderation-access.js';
import { readProtocolAdminConfig } from '../../protocol-admin-config.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;

  try {
    const config = readProtocolAdminConfig();
    if (!config.requested) {
      return res.status(200).json({
        success: true,
        enabled: false,
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

    // This endpoint is the sole menu-discovery surface. It may confirm an
    // active role for the wallet's existing SIWE session, but never returns
    // protected queue data and never substitutes for passkey step-up.
    const access = await getModerationAccess(req);
    return res.status(200).json({
      success: true,
      enabled: true,
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
