import crypto from 'node:crypto';
import { FetchRequest, Interface, JsonRpcProvider, hashMessage, isAddress, isHexString } from 'ethers';
import { supabaseRest } from './backend.js';
import { WEBAUTHN_CHALLENGE_TTL_MS } from './moderation-passkey.js';

const EIP1271_MAGIC_VALUE = '0x1626ba7e';
const EIP1271_LEGACY_MAGIC_VALUE = '0x20c13b0b';
const SAFE_RPC_TIMEOUT_MS = 8_000;
const EIP1271_INTERFACE = new Interface([
  'function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)'
]);
const EIP1271_LEGACY_INTERFACE = new Interface([
  'function isValidSignature(bytes data, bytes signature) view returns (bytes4)'
]);

function recoveryConfigError(message) {
  const error = new Error(message);
  error.statusCode = 503;
  error.code = 'MODERATION_SAFE_RECOVERY_MISCONFIGURED';
  return error;
}

function parseRpcUrls(value) {
  return [...new Set(String(value || '')
    .split(',')
    .map(url => url.trim())
    .filter(Boolean))];
}

export function getModerationSafeRecoveryConfig() {
  const safeAddress = String(process.env.ARTSOUL_MODERATION_SAFE_RECOVERY_ADDRESS || '').trim();
  const chainIdText = String(process.env.ARTSOUL_MODERATION_SAFE_RECOVERY_CHAIN_ID || '').trim();
  const rpcUrls = parseRpcUrls(process.env.ARTSOUL_MODERATION_SAFE_RECOVERY_RPC_URLS);
  const chainId = Number(chainIdText);

  if (!isAddress(safeAddress) || !/^\d+$/.test(chainIdText) || !Number.isSafeInteger(chainId) || chainId <= 0) {
    throw recoveryConfigError('Safe recovery requires an explicit Safe address and chain id.');
  }
  if (rpcUrls.length < 2) {
    throw recoveryConfigError('Safe recovery requires at least two explicitly configured RPC endpoints.');
  }
  for (const rpcUrl of rpcUrls) {
    let parsed;
    try {
      parsed = new URL(rpcUrl);
    } catch {
      throw recoveryConfigError('Safe recovery RPC configuration contains an invalid URL.');
    }
    if (!['https:', 'http:'].includes(parsed.protocol)) {
      throw recoveryConfigError('Safe recovery RPC endpoints must use HTTP or HTTPS.');
    }
    if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
      throw recoveryConfigError('Safe recovery RPC endpoints must use HTTPS in production.');
    }
  }

  return { safeAddress: safeAddress.toLowerCase(), chainId, rpcUrls };
}

export function buildModerationSafeRecoveryMessage({
  requestId,
  wallet,
  safeAddress,
  chainId,
  rpId,
  origin,
  expiresAt
}) {
  return [
    'ArtSoul moderation passkey recovery',
    '',
    `Request ID: ${requestId}`,
    `Target wallet: ${wallet}`,
    `Authorizing Safe: ${safeAddress}`,
    `Chain ID: ${chainId}`,
    `RP ID: ${rpId}`,
    `Origin: ${origin}`,
    `Expires at: ${expiresAt}`,
    'Action: issue one single-use passkey enrollment grant',
    '',
    'This message does not authorize a transaction, role change, or protocol action.'
  ].join('\n');
}

export function hashModerationSafeRecoveryMessage(message) {
  return hashMessage(String(message));
}

export function hashSafeRecoverySignature(signature) {
  const normalized = String(signature || '').trim();
  if (!isHexString(normalized) || normalized === '0x') {
    throw new TypeError('Safe recovery signature must be non-empty hex bytes.');
  }
  return crypto.createHash('sha256').update(Buffer.from(normalized.slice(2), 'hex')).digest('hex');
}

export async function createModerationSafeRecoveryRequest({
  requestId,
  wallet,
  safeAddress,
  chainId,
  rpId,
  origin,
  message,
  messageHash,
  expiresAt
}) {
  const rows = await supabaseRest('artsoul_staff_recovery_requests', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: [{
      request_id: requestId,
      target_wallet: wallet,
      safe_address: safeAddress,
      chain_id: chainId,
      rp_id: rpId,
      origin,
      message,
      message_hash: messageHash,
      expires_at: expiresAt
    }]
  });
  return rows?.[0] || null;
}

export async function findModerationSafeRecoveryRequest(requestId, wallet) {
  const rows = await supabaseRest(
    `artsoul_staff_recovery_requests?request_id=eq.${encodeURIComponent(requestId)}` +
      `&target_wallet=eq.${encodeURIComponent(wallet)}` +
      '&consumed_at=is.null' +
      `&expires_at=gt.${encodeURIComponent(new Date().toISOString())}` +
      '&select=request_id,target_wallet,safe_address,chain_id,rp_id,origin,message,message_hash,expires_at&limit=1'
  );
  return rows?.[0] || null;
}

async function callEip1271(provider, safeAddress, messageHash, signature, iface, magicValue) {
  const fragment = iface.getFunction('isValidSignature');
  const data = iface.encodeFunctionData(fragment, [messageHash, signature]);
  const response = await provider.call({ from: safeAddress, to: safeAddress, data });
  const [result] = iface.decodeFunctionResult(fragment, response);
  return String(result).toLowerCase() === magicValue;
}

async function verifyWithRpc(rpcUrl, config, messageHash, signature, providerFactory) {
  const provider = providerFactory(rpcUrl, config.chainId);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== config.chainId) return false;
  if (await provider.getCode(config.safeAddress) === '0x') return false;

  try {
    if (await callEip1271(
      provider,
      config.safeAddress,
      messageHash,
      signature,
      EIP1271_INTERFACE,
      EIP1271_MAGIC_VALUE
    )) return true;
  } catch {
    // Safe versions before the updated bytes32 EIP-1271 overload use bytes.
  }

  try {
    return await callEip1271(
      provider,
      config.safeAddress,
      messageHash,
      signature,
      EIP1271_LEGACY_INTERFACE,
      EIP1271_LEGACY_MAGIC_VALUE
    );
  } catch {
    return false;
  }
}

export async function verifyModerationSafeSignature({
  config,
  messageHash,
  signature,
  providerFactory = (rpcUrl, chainId) => {
    const request = new FetchRequest(rpcUrl);
    request.timeout = SAFE_RPC_TIMEOUT_MS;
    return new JsonRpcProvider(request, chainId, { staticNetwork: true });
  }
}) {
  if (!isHexString(messageHash, 32) || !isHexString(signature) || signature === '0x' || signature.length > 32_768) {
    return false;
  }

  // The configured endpoints form a fail-closed read quorum. A single
  // unavailable, wrong-chain, or dishonest endpoint cannot authorize
  // recovery by itself.
  const results = await Promise.all(
    config.rpcUrls.map(rpcUrl => verifyWithRpc(rpcUrl, config, messageHash, signature, providerFactory))
  );
  return results.length >= 2 && results.every(Boolean);
}

export async function completeModerationSafeRecoveryRpc({
  requestId,
  wallet,
  safeAddress,
  chainId,
  messageHash,
  signatureHash,
  tokenHash,
  grantExpiresAt
}) {
  const result = await supabaseRest('rpc/a8d_complete_safe_recovery', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: {
      p_request_id: requestId,
      p_target_wallet: wallet,
      p_safe_address: safeAddress,
      p_chain_id: chainId,
      p_message_hash: messageHash,
      p_signature_hash: signatureHash,
      p_token_hash: tokenHash,
      p_grant_expires_at: grantExpiresAt
    }
  });
  return Array.isArray(result) ? result[0] : result;
}

export function newModerationSafeRecoveryRequestId() {
  return crypto.randomUUID();
}

export function moderationSafeRecoveryRequestExpiry() {
  return new Date(Date.now() + WEBAUTHN_CHALLENGE_TTL_MS).toISOString();
}
