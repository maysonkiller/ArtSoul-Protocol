import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { allowMethods, readJson, sendError, supabaseRest } from '../../backend.js';
import {
  consumeChallenge,
  consumeEnrollmentGrant,
  findValidEnrollmentGrant,
  recordAuthEvent,
  recordAuthEventBestEffort,
  requirePasskeyRouteContext
} from '../../moderation-passkey.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;

  try {
    const { config, wallet } = await requirePasskeyRouteContext(req);

    const grant = await findValidEnrollmentGrant(wallet);
    if (!grant) {
      return res.status(403).json({
        error: 'ENROLLMENT_GRANT_REQUIRED',
        message: 'A valid enrollment grant is required to register a passkey.'
      });
    }

    const body = await readJson(req);
    const response = body?.response;
    if (!response || typeof response !== 'object') {
      return res.status(400).json({ error: 'INVALID_REGISTRATION_PAYLOAD' });
    }

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        // One-time consume, bound to this wallet and to the registration
        // purpose; an expired, reused, or purpose-mismatched challenge fails.
        expectedChallenge: async (challenge) => consumeChallenge(challenge, wallet, 'registration'),
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

    if (!verification.verified || !verification.registrationInfo) {
      await recordAuthEventBestEffort(wallet, 'passkey_auth_failure', null, {
        phase: 'registration',
        reason: 'not verified'
      });
      return res.status(400).json({ error: 'REGISTRATION_NOT_VERIFIED' });
    }

    // Burn the one-time grant BEFORE storing the credential so a raced
    // duplicate submit cannot enroll twice from one grant.
    const consumed = await consumeEnrollmentGrant(grant.id, verification.registrationInfo.credential.id);
    if (!consumed) {
      return res.status(409).json({ error: 'ENROLLMENT_GRANT_ALREADY_USED' });
    }

    const { credential, aaguid } = verification.registrationInfo;
    const label = String(body?.label || '').slice(0, 80) || null;
    await supabaseRest('artsoul_staff_passkeys', {
      method: 'POST',
      body: [{
        wallet_address: wallet,
        credential_id: credential.id,
        // Public COSE key only — private key material never leaves the
        // authenticator and is never sent to the server.
        public_key: Buffer.from(credential.publicKey).toString('base64url'),
        sign_count: credential.counter,
        transports: JSON.stringify(credential.transports || []),
        aaguid: aaguid || null,
        label,
        enrolled_via: grant.purpose
      }]
    });

    await recordAuthEvent(wallet, 'grant_consumed', credential.id, {
      grant_id: grant.id,
      purpose: grant.purpose
    });
    await recordAuthEvent(wallet, 'passkey_enrolled', credential.id, {
      enrolled_via: grant.purpose,
      label
    });

    res.status(200).json({ success: true, credential_id: credential.id });
  } catch (error) {
    sendError(res, error);
  }
}
