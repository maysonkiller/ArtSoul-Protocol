import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { allowMethods, readJson, sendError, supabaseRest } from '../../backend.js';
import {
  MODERATION_SESSION_TTL_SECONDS,
  consumeChallenge,
  recordAuthEvent,
  recordAuthEventBestEffort,
  parseStoredTransports,
  requirePasskeyRouteContext,
  setModerationSession
} from '../../moderation-passkey.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;

  try {
    const { config, wallet } = await requirePasskeyRouteContext(req);

    const body = await readJson(req);
    const response = body?.response;
    const credentialId = String(response?.id || '');
    if (!response || typeof response !== 'object' || !credentialId) {
      return res.status(400).json({ error: 'INVALID_AUTHENTICATION_PAYLOAD' });
    }

    // The asserted credential must belong to THIS wallet and be non-revoked.
    const rows = await supabaseRest(
      `artsoul_staff_passkeys?credential_id=eq.${encodeURIComponent(credentialId)}` +
        `&wallet_address=eq.${encodeURIComponent(wallet)}` +
        '&revoked_at=is.null' +
        '&select=id,credential_id,public_key,sign_count,transports&limit=1'
    );
    const stored = rows?.[0];
    if (!stored) {
      await recordAuthEventBestEffort(wallet, 'passkey_auth_failure', credentialId, {
        phase: 'authentication',
        reason: 'unknown, foreign, or revoked credential'
      });
      return res.status(403).json({ error: 'CREDENTIAL_NOT_ELIGIBLE' });
    }

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: async (challenge) => consumeChallenge(challenge, wallet, 'authentication'),
        expectedOrigin: config.origin,
        expectedRPID: config.rpId,
        requireUserVerification: true,
        credential: {
          id: stored.credential_id,
          publicKey: new Uint8Array(Buffer.from(stored.public_key, 'base64url')),
          counter: Number(stored.sign_count) || 0,
          transports: parseStoredTransports(stored.transports)
        }
      });
    } catch (error) {
      await recordAuthEventBestEffort(wallet, 'passkey_auth_failure', credentialId, {
        phase: 'authentication',
        reason: String(error?.message || 'verification failed').slice(0, 200)
      });
      return res.status(401).json({ error: 'AUTHENTICATION_NOT_VERIFIED' });
    }

    if (!verification.verified) {
      await recordAuthEventBestEffort(wallet, 'passkey_auth_failure', credentialId, {
        phase: 'authentication',
        reason: 'not verified'
      });
      return res.status(401).json({ error: 'AUTHENTICATION_NOT_VERIFIED' });
    }

    await supabaseRest(
      `artsoul_staff_passkeys?id=eq.${encodeURIComponent(stored.id)}`,
      {
        method: 'PATCH',
        body: {
          sign_count: verification.authenticationInfo.newCounter,
          last_used_at: new Date().toISOString()
        }
      }
    );

    await recordAuthEvent(wallet, 'passkey_auth_success', credentialId, null);
    setModerationSession(res, wallet, credentialId);

    res.status(200).json({
      success: true,
      expires_in_seconds: MODERATION_SESSION_TTL_SECONDS
    });
  } catch (error) {
    sendError(res, error);
  }
}
