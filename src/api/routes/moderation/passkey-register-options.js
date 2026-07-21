import { generateRegistrationOptions } from '@simplewebauthn/server';
import { allowMethods, readJson, sendError } from '../../backend.js';
import {
  findGrantByToken,
  findWalletCredentials,
  parseStoredTransports,
  requirePasskeyRouteContext,
  storeRegistrationChallenge
} from '../../moderation-passkey.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;

  try {
    const { config, wallet } = await requirePasskeyRouteContext(req);

    // Enrollment requires the SIWE wallet AND possession of the one-time
    // bearer token. A stolen wallet without the token resolves no grant.
    const body = await readJson(req);
    const grant = await findGrantByToken(body?.token, wallet);
    if (!grant) {
      return res.status(403).json({
        error: 'ENROLLMENT_GRANT_REQUIRED',
        message: 'A valid one-time enrollment token is required to register a passkey.'
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
