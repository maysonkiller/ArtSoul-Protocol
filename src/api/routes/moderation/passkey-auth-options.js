import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { allowMethods, sendError } from '../../backend.js';
import {
  findWalletCredentials,
  parseStoredTransports,
  requirePasskeyRouteContext,
  storeChallenge
} from '../../moderation-passkey.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;

  try {
    const { config, wallet } = await requirePasskeyRouteContext(req);

    const credentials = await findWalletCredentials(wallet);
    if (!credentials.length) {
      return res.status(403).json({
        error: 'NO_CREDENTIALS',
        message: 'No active passkey is enrolled for this staff wallet.'
      });
    }

    const options = await generateAuthenticationOptions({
      rpID: config.rpId,
      userVerification: 'required',
      allowCredentials: credentials.map(credential => ({
        id: credential.credential_id,
        transports: parseStoredTransports(credential.transports)
      }))
    });

    await storeChallenge(options.challenge, wallet, 'authentication');
    res.status(200).json({ success: true, options });
  } catch (error) {
    sendError(res, error);
  }
}
