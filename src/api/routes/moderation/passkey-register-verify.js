import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { allowMethods, readJson, sendError } from '../../backend.js';
import {
  completeRegistrationRpc,
  findGrantByToken,
  hashGrantToken,
  recordAuthEventBestEffort,
  requirePasskeyRouteContext,
  validateRegistrationChallenge
} from '../../moderation-passkey.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;

  try {
    const { config, wallet } = await requirePasskeyRouteContext(req);

    const body = await readJson(req);
    const rawToken = body?.token;
    const response = body?.response;
    if (!response || typeof response !== 'object') {
      return res.status(400).json({ error: 'INVALID_REGISTRATION_PAYLOAD' });
    }

    // Possession of the one-time token is required BEFORE verification, and
    // the exact grant id is re-derived from it.
    const grant = await findGrantByToken(rawToken, wallet);
    if (!grant) {
      return res.status(403).json({
        error: 'ENROLLMENT_GRANT_REQUIRED',
        message: 'A valid one-time enrollment token is required to register a passkey.'
      });
    }

    // The verified challenge is captured from the read-only callback so it
    // can be atomically consumed in the RPC (never consumed here).
    let verifiedChallenge = '';
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: async (challenge) => {
          const ok = await validateRegistrationChallenge(challenge, wallet, grant.id);
          if (ok) verifiedChallenge = challenge;
          return ok;
        },
        expectedOrigin: config.origin,
        expectedRPID: config.rpId,
        requireUserVerification: true
      });
    } catch (error) {
      await recordAuthEventBestEffort(wallet, 'passkey_auth_failure', null, {
        phase: 'registration',
        reason: String(error?.message || 'verification failed').slice(0, 200)
      });
      return res.status(400).json({ error: 'REGISTRATION_NOT_VERIFIED' });
    }

    if (!verification.verified || !verification.registrationInfo || !verifiedChallenge) {
      await recordAuthEventBestEffort(wallet, 'passkey_auth_failure', null, {
        phase: 'registration',
        reason: 'not verified'
      });
      return res.status(400).json({ error: 'REGISTRATION_NOT_VERIFIED' });
    }

    const { credential, aaguid } = verification.registrationInfo;
    const label = String(body?.label || '').slice(0, 80) || null;

    // Atomic: validate + consume the grant and its bound challenge, insert
    // the credential, and write grant_consumed + passkey_enrolled. Any
    // failure inside the transaction rolls the whole thing back, so the
    // one-time (bootstrap) grant is never lost on a partial failure.
    const result = await completeRegistrationRpc({
      grantId: grant.id,
      tokenHash: hashGrantToken(rawToken),
      wallet,
      purpose: grant.purpose,
      challenge: verifiedChallenge,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      signCount: credential.counter,
      transports: JSON.stringify(credential.transports || []),
      aaguid: aaguid || null,
      label
    });

    if (result !== 'OK') {
      await recordAuthEventBestEffort(wallet, 'passkey_auth_failure', credential.id, {
        phase: 'registration_commit',
        reason: String(result)
      });
      const status = result === 'BOOTSTRAP_ALREADY_ESTABLISHED' ? 409 : 403;
      return res.status(status).json({ error: result || 'REGISTRATION_COMMIT_FAILED' });
    }

    res.status(200).json({ success: true, credential_id: credential.id });
  } catch (error) {
    sendError(res, error);
  }
}
