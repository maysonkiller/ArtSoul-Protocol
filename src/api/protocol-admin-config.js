import { isModerationPasskeyEnabled } from './moderation-passkey.js';

export function readProtocolAdminConfig() {
  const requested = String(process.env.ARTSOUL_PROTOCOL_ADMIN_ENABLED || '').toLowerCase() === 'true';
  const passkeyEnabled = isModerationPasskeyEnabled();

  return {
    requested,
    passkeyEnabled,
    enabled: requested && passkeyEnabled
  };
}

export function requireProtocolAdminEnabled() {
  const config = readProtocolAdminConfig();
  if (!config.requested) {
    const error = new Error('Protocol Admin is not enabled yet.');
    error.code = 'PROTOCOL_ADMIN_DISABLED';
    error.statusCode = 503;
    throw error;
  }
  if (!config.passkeyEnabled) {
    const error = new Error('Protocol Admin requires the moderation passkey feature.');
    error.code = 'PROTOCOL_ADMIN_PASSKEY_REQUIRED';
    error.statusCode = 503;
    throw error;
  }
  return config;
}
