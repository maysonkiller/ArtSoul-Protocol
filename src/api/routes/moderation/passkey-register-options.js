import { generateRegistrationOptions } from '@simplewebauthn/server';
import { allowMethods, sendError } from '../../backend.js';
import {
  findValidEnrollmentGrant,
  findWalletCredentials,
  parseStoredTransports,
  requirePasskeyRouteContext,
  storeChallenge
} from '../../moderation-passkey.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;

  try {
    const { config, wallet } = await requirePasskeyRouteContext(req);

    // Enrollment always consumes a one-time grant bound to this wallet.
    // The bootstrap grant is created only by the founder-operated runbook.
    const grant = await findValidEnrollmentGrant(wallet);
    if (!grant) {
      return res.status(403).json({
        error: 'ENROLLMENT_GRANT_REQUIRED',
        message: 'A valid enrollment grant is required to register a passkey.'
      });
    }

    const existing = await findWalletCredentials(wallet);
    const options = await generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpId,
      userName: wallet,
      userID: Buffer.from(wallet),
      attestationType: 'none',
      excludeCredentials: existing.map(credential => ({
        id: credential.credential_id,
        transports: parseStoredTransports(credential.transports)
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'required'
      }
    });

    await storeChallenge(options.challenge, wallet, 'registration');
    res.status(200).json({ success: true, options });
  } catch (error) {
    sendError(res, error);
  }
}
