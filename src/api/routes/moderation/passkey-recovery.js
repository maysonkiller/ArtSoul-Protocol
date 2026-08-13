import { allowMethods, readJson, sendError } from '../../backend.js';
import {
  ENROLLMENT_GRANT_TTL_MS,
  generateGrantToken,
  hashGrantToken,
  recordAuthEventBestEffort,
  requirePasskeyRouteContext
} from '../../moderation-passkey.js';
import {
  buildModerationSafeRecoveryMessage,
  completeModerationSafeRecoveryRpc,
  createModerationSafeRecoveryRequest,
  findModerationSafeRecoveryRequest,
  getModerationSafeRecoveryConfig,
  hashModerationSafeRecoveryMessage,
  hashSafeRecoverySignature,
  moderationSafeRecoveryRequestExpiry,
  newModerationSafeRecoveryRequestId,
  verifyModerationSafeSignature
} from '../../moderation-safe-recovery.js';

function publicRequest(record) {
  return {
    request_id: record.request_id,
    safe_address: record.safe_address,
    chain_id: Number(record.chain_id),
    message: record.message,
    message_hash: record.message_hash,
    expires_at: record.expires_at
  };
}

async function deny(wallet, reason, res, status = 403, error = 'RECOVERY_NOT_AUTHORIZED') {
  await recordAuthEventBestEffort(wallet, 'recovery_denied', null, { reason });
  return res.status(status).json({
    error,
    message: 'Safe-authorized passkey recovery was not completed.'
  });
}

// Safe-only founder/staff recovery. This route never grants a moderation
// session, changes a role, or enrolls a credential directly. A threshold-
// valid EIP-1271 Safe signature can only mint one hashed, short-lived,
// single-use enrollment grant for the already SIWE-authenticated staff
// wallet. X, Discord, email, body-supplied wallets, and EOAs are irrelevant.
export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;

  let wallet = null;
  try {
    const context = await requirePasskeyRouteContext(req);
    wallet = context.wallet;
    const safeConfig = getModerationSafeRecoveryConfig();
    const body = await readJson(req);
    const action = String(body?.action || 'request');

    if (action === 'request') {
      const requestId = newModerationSafeRecoveryRequestId();
      const expiresAt = moderationSafeRecoveryRequestExpiry();
      const message = buildModerationSafeRecoveryMessage({
        requestId,
        wallet,
        safeAddress: safeConfig.safeAddress,
        chainId: safeConfig.chainId,
        rpId: context.config.rpId,
        origin: context.config.origin,
        expiresAt
      });
      const messageHash = hashModerationSafeRecoveryMessage(message);
      const record = await createModerationSafeRecoveryRequest({
        requestId,
        wallet,
        safeAddress: safeConfig.safeAddress,
        chainId: safeConfig.chainId,
        rpId: context.config.rpId,
        origin: context.config.origin,
        message,
        messageHash,
        expiresAt
      });
      if (!record) {
        return await deny(wallet, 'recovery_request_not_persisted', res, 503, 'RECOVERY_UNAVAILABLE');
      }
      return res.status(200).json({ success: true, request: publicRequest(record) });
    }

    if (action !== 'complete') {
      return res.status(400).json({ error: 'INVALID_RECOVERY_ACTION' });
    }

    const requestId = String(body?.request_id || '').trim();
    const signature = String(body?.signature || '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId) ||
        !signature || signature.length > 32_768) {
      return await deny(wallet, 'missing_request_or_signature', res, 400, 'INVALID_RECOVERY_PAYLOAD');
    }

    const record = await findModerationSafeRecoveryRequest(requestId, wallet);
    if (!record) {
      return await deny(wallet, 'request_missing_expired_or_consumed', res);
    }

    const exactConfiguration = (
      record.target_wallet === wallet &&
      record.safe_address === safeConfig.safeAddress &&
      Number(record.chain_id) === safeConfig.chainId &&
      record.rp_id === context.config.rpId &&
      record.origin === context.config.origin &&
      record.message_hash === hashModerationSafeRecoveryMessage(record.message)
    );
    if (!exactConfiguration) {
      return await deny(wallet, 'request_configuration_mismatch', res);
    }

    let signatureValid = false;
    try {
      signatureValid = await verifyModerationSafeSignature({
        config: safeConfig,
        messageHash: record.message_hash,
        signature
      });
    } catch {
      signatureValid = false;
    }
    if (!signatureValid) {
      return await deny(wallet, 'safe_signature_invalid_or_rpc_quorum_failed', res);
    }

    const rawToken = generateGrantToken();
    const grantExpiresAt = new Date(Date.now() + ENROLLMENT_GRANT_TTL_MS).toISOString();
    const result = await completeModerationSafeRecoveryRpc({
      requestId: record.request_id,
      wallet,
      safeAddress: safeConfig.safeAddress,
      chainId: safeConfig.chainId,
      messageHash: record.message_hash,
      signatureHash: hashSafeRecoverySignature(signature),
      tokenHash: hashGrantToken(rawToken),
      grantExpiresAt
    });
    if (result !== 'OK') {
      return await deny(wallet, String(result || 'recovery_commit_failed'), res, 409);
    }

    // The raw token is returned once and is never persisted or logged.
    return res.status(200).json({ success: true, token: rawToken, expires_at: grantExpiresAt });
  } catch (error) {
    if (wallet) {
      await recordAuthEventBestEffort(wallet, 'recovery_denied', null, {
        reason: String(error?.code || error?.message || 'recovery_error').slice(0, 160)
      });
    }
    sendError(res, error);
  }
}
