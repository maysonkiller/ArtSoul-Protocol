import { allowMethods, readJson, sendError } from '../../backend.js';
import {
  clearModerationSession,
  findWalletCredentials,
  readModerationSession,
  requirePasskeyRouteContext,
  revokeCredentialRpc,
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

    // Atomic revoke with last-key protection and audit inside the RPC.
    const result = await revokeCredentialRpc({ wallet, credentialId, revokedBy: wallet });
    if (result === 'LAST_ACTIVE_CREDENTIAL') {
      return res.status(409).json({
        error: 'LAST_ACTIVE_CREDENTIAL',
        message: 'You cannot revoke your last active passkey. Enroll another passkey first.'
      });
    }
    if (result === 'CREDENTIAL_NOT_FOUND') {
      return res.status(404).json({ error: 'CREDENTIAL_NOT_FOUND' });
    }
    if (result !== 'OK') {
      return res.status(400).json({ error: result || 'REVOCATION_FAILED' });
    }

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
