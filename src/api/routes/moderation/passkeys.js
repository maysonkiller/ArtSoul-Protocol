import { allowMethods, readJson, sendError, supabaseRest } from '../../backend.js';
import {
  clearModerationSession,
  findWalletCredentials,
  readModerationSession,
  recordAuthEvent,
  requirePasskeyRouteContext,
  verifyModerationStepUp
} from '../../moderation-passkey.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['GET', 'POST'])) return;

  try {
    const { wallet } = await requirePasskeyRouteContext(req);

    if (req.method === 'GET') {
      const credentials = await findWalletCredentials(wallet, { includeRevoked: true });
      return res.status(200).json({
        success: true,
        credentials: credentials.map(credential => ({
          credential_id: credential.credential_id,
          label: credential.label,
          enrolled_via: credential.enrolled_via,
          created_at: credential.created_at,
          last_used_at: credential.last_used_at,
          revoked_at: credential.revoked_at
        }))
      });
    }

    // POST: self-revocation, only after a valid step-up.
    const stepUp = await verifyModerationStepUp(req, wallet);
    if (!stepUp.valid) {
      return res.status(403).json({
        error: stepUp.code,
        message: 'A valid passkey step-up is required to revoke a passkey.'
      });
    }

    const body = await readJson(req);
    const credentialId = String(body?.credential_id || '');
    if (body?.action !== 'revoke' || !credentialId) {
      return res.status(400).json({ error: 'INVALID_REVOCATION_PAYLOAD' });
    }

    const rows = await supabaseRest(
      `artsoul_staff_passkeys?credential_id=eq.${encodeURIComponent(credentialId)}` +
        `&wallet_address=eq.${encodeURIComponent(wallet)}` +
        '&revoked_at=is.null',
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: {
          revoked_at: new Date().toISOString(),
          revoked_by: wallet
        }
      }
    );
    if (!rows || rows.length !== 1) {
      return res.status(404).json({ error: 'CREDENTIAL_NOT_FOUND' });
    }

    await recordAuthEvent(wallet, 'passkey_revoked', credentialId, { revoked_by: wallet });

    // Revoking the credential behind the CURRENT step-up ends that session.
    const current = readModerationSession(req);
    if (current?.credentialId === credentialId) {
      clearModerationSession(res);
    }

    res.status(200).json({ success: true });
  } catch (error) {
    sendError(res, error);
  }
}
