import { allowMethods, sendError, supabaseRest } from '../../backend.js';
import {
  findValidEnrollmentGrant,
  recordAuthEvent,
  requirePasskeyRouteContext,
  verifyModerationStepUp
} from '../../moderation-passkey.js';

// A staff member who already holds a VALID passkey step-up may issue ONE
// single-use, expiring enrollment grant for THEIR OWN wallet to enroll an
// additional device (founder decision: two independent founder passkeys).
// This route can never create a bootstrap grant and can never target
// another wallet, so it is not a wallet-only or delegation bypass.
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

    const existing = await findValidEnrollmentGrant(wallet);
    if (existing) {
      return res.status(409).json({ error: 'GRANT_ALREADY_PENDING' });
    }

    const expiresAt = new Date(Date.now() + ADDITIONAL_GRANT_TTL_MS).toISOString();
    const rows = await supabaseRest('artsoul_staff_enrollment_grants', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: [{
        target_wallet: wallet,
        purpose: 'additional',
        issued_by: wallet,
        expires_at: expiresAt
      }]
    });
    const grant = rows?.[0];

    await recordAuthEvent(wallet, 'grant_issued', stepUp.credentialId, {
      purpose: 'additional',
      grant_id: grant?.id ?? null,
      expires_at: expiresAt
    });

    res.status(200).json({ success: true, expires_at: expiresAt });
  } catch (error) {
    sendError(res, error);
  }
}
