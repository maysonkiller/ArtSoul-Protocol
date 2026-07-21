import { allowMethods, sendError } from '../../backend.js';
import {
  generateGrantToken,
  hashGrantToken,
  issueEnrollmentGrantRpc,
  requirePasskeyRouteContext,
  verifyModerationStepUp
} from '../../moderation-passkey.js';

// A staff member who already holds a VALID passkey step-up may issue ONE
// single-use, expiring ADDITIONAL enrollment grant for THEIR OWN wallet to
// enroll another device (founder decision: two independent founder
// passkeys). This route can never create a bootstrap grant and can never
// target another wallet, so it is not a wallet-only or delegation bypass.
// The raw one-time token is returned exactly once here; only its SHA-256
// hash is persisted (inside the atomic issue RPC).
const ADDITIONAL_GRANT_TTL_MS = 15 * 60 * 1000; // bounded by the step-up TTL

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;

  try {
    const { wallet } = await requirePasskeyRouteContext(req);

    const stepUp = await verifyModerationStepUp(req, wallet);
    if (!stepUp.valid) {
      return res.status(403).json({
        error: stepUp.code,
        message: 'A valid passkey step-up is required to issue an enrollment grant.'
      });
    }

    const rawToken = generateGrantToken();
    const expiresAt = new Date(Date.now() + ADDITIONAL_GRANT_TTL_MS).toISOString();

    await issueEnrollmentGrantRpc({
      targetWallet: wallet,
      purpose: 'additional',
      issuedBy: wallet,
      tokenHash: hashGrantToken(rawToken),
      expiresAt
    });

    // The raw token is shown exactly once and never persisted or logged.
    res.status(200).json({ success: true, token: rawToken, expires_at: expiresAt });
  } catch (error) {
    sendError(res, error);
  }
}
