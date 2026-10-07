import { generateRegistrationOptions } from '@simplewebauthn/server';
import { allowMethods, readJson, sendError } from '../../backend.js';
import {
  resolveRegistrationGrant,
  findWalletCredentials,
  parseStoredTransports,
  requirePasskeyRouteContext,
  storeRegistrationChallenge
} from '../../moderation-passkey.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;

  try {
    const { config, wallet } = await requirePasskeyRouteContext(req);

    // Both modes consume a pre-existing approved grant. Only the first
    // bootstrap supports code-free setup; additional/recovery needs its token.
    const body = await readJson(req);
    const grant = await resolveRegistrationGrant(body, wallet);
    if (!grant) {
      return res.status(403).json({
        error: body?.mode === 'approved-bootstrap' ? 'FIRST_ENROLLMENT_UNAVAILABLE' : 'ENROLLMENT_GRANT_REQUIRED',
        message: 'An active enrollment approval is required to register this passkey.'
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

    // Bind this challenge to the exact grant id so no other pending grant
    // can be substituted at verification time.
    await storeRegistrationChallenge(options.challenge, wallet, grant.id);
    res.status(200).json({ success: true, options });
  } catch (error) {
    sendError(res, error);
  }
}
