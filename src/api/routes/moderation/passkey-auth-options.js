import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { allowMethods, sendError } from '../../backend.js';
import {
  findWalletCredentials,
  parseStoredTransports,
  requirePasskeyRouteContext,
  storeAuthenticationChallenge
} from '../../moderation-passkey.js';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;

  try {
    const { config, wallet, authorizationVersion } = await requirePasskeyRouteContext(req);

    const credentials = await findWalletCredentials(wallet, { authorizationVersion });
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

    await storeAuthenticationChallenge(options.challenge, wallet, authorizationVersion);
    res.status(200).json({ success: true, options });
  } catch (error) {
    sendError(res, error);
  }
}
