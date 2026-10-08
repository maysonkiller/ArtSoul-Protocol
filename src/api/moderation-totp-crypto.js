import crypto from 'node:crypto';

// Unwired cryptographic primitives only. A matching step is NOT authorization.
// Before issuing the existing 15-minute staff session, integration must enforce
// the active wallet/role/factor, rate limits and atomic one-time step consumption.
// Enrollment, replacement and recovery require the approved two-wallet policy.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const KEY_BYTES = Object.freeze({ sha1: 20, sha256: 32, sha512: 64 });
const PERIOD_SECONDS = 30;

function encodeBase32(bytes) {
  let value = 0, bits = 0, result = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += ALPHABET[(value >>> bits) & 31];
    }
    value &= (1 << bits) - 1;
  }
  if (bits) result += ALPHABET[(value << (5 - bits)) & 31];
  return result;
}

function decodeSecret(secret, length = 20) {
  if (typeof secret !== 'string' || secret.length !== Math.ceil(length * 8 / 5) || !/^[A-Z2-7]+$/.test(secret)) {
    throw new TypeError('Invalid canonical TOTP secret');
  }
  const bytes = Buffer.alloc(length);
  let value = 0, bits = 0, offset = 0;
  for (const character of secret) {
    value = (value << 5) | ALPHABET.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes[offset++] = (value >>> bits) & 255;
    }
    value &= (1 << bits) - 1;
  }
  if (value !== 0 || offset !== length || encodeBase32(bytes) !== secret) {
    bytes.fill(0);
    throw new TypeError('Invalid canonical TOTP secret');
  }
  return bytes;
}

function timeStep(unixSeconds) {
  if (!Number.isSafeInteger(unixSeconds) || unixSeconds < 0) throw new TypeError('Invalid TOTP time');
  return Math.floor(unixSeconds / PERIOD_SECONDS);
}

function codeAtStep(secret, step, algorithm = 'sha1', digits = 6) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = crypto.createHmac(algorithm, secret).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  const truncated = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(truncated % (10 ** digits)).padStart(digits, '0');
}

export function generateTotpSecret() {
  const bytes = crypto.randomBytes(20);
  try { return encodeBase32(bytes); } finally { bytes.fill(0); }
}

// Algorithm/digit options support RFC 6238 interoperability tests. Product
// matching and encrypted storage below accept only 20-byte SHA-1 / 6-digit seeds.
export function calculateTotp(secret, unixSeconds, { algorithm = 'sha1', digits = 6 } = {}) {
  if (typeof algorithm !== 'string' || !Object.hasOwn(KEY_BYTES, algorithm) || ![6, 8].includes(digits)) throw new TypeError('Invalid TOTP parameters');
  const step = timeStep(unixSeconds), bytes = decodeSecret(secret, KEY_BYTES[algorithm]);
  try { return codeAtStep(bytes, step, algorithm, digits); } finally { bytes.fill(0); }
}

// The caller must supply trusted server time, never a timestamp from the client.
// Return the highest matching step in the fixed +/-1 window; do not stop the
// constant-time comparisons early. A persistent atomic consumer must reject any
// step <= the factor's last consumed step, including concurrent submissions.
export function matchTotpStep(secret, code, unixSeconds) {
  const step = timeStep(unixSeconds), bytes = decodeSecret(secret);
  try {
    if (typeof code !== 'string' || code.length !== 6 || !/^[0-9]{6}$/.test(code)) return null;
    const supplied = Buffer.from(code, 'ascii');
    let match = null;
    for (const candidate of [step - 1, step, step + 1]) {
      if (candidate < 0) continue;
      if (crypto.timingSafeEqual(supplied, Buffer.from(codeAtStep(bytes, candidate), 'ascii'))) match = candidate;
    }
    return match;
  } finally { bytes.fill(0); }
}

function associatedData(context) {
  const { wallet, factorId, keyVersion } = context || {};
  if (typeof wallet !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(wallet) || /^0x0{40}$/.test(wallet) ||
      typeof factorId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(factorId) ||
      !Number.isSafeInteger(keyVersion) || keyVersion < 1) {
    throw new TypeError('Invalid TOTP encryption context');
  }
  return Buffer.from(JSON.stringify(['artsoul-moderation-totp-sha1-6-30', 1, wallet.toLowerCase(), factorId, keyVersion]), 'utf8');
}

function requireEncryptionKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new TypeError('TOTP encryption requires a 32-byte key');
}

function decodeEnvelopeField(value, length) {
  if (typeof value !== 'string' || value.length !== Math.ceil(length * 8 / 6) || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('Invalid encrypted TOTP secret');
  }
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length !== length || bytes.toString('base64url') !== value) throw new Error('Invalid encrypted TOTP secret');
  return bytes;
}

export function encryptTotpSecret(secret, key, context) {
  requireEncryptionKey(key);
  const aad = associatedData(context), bytes = decodeSecret(secret);
  try {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
    return { version: 1, keyVersion: context.keyVersion, iv: iv.toString('base64url'),
      ciphertext: ciphertext.toString('base64url'), tag: cipher.getAuthTag().toString('base64url') };
  } finally { bytes.fill(0); }
}

export function decryptTotpSecret(envelope, key, context) {
  requireEncryptionKey(key);
  const aad = associatedData(context);
  let plaintext;
  try {
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) ||
        Object.keys(envelope).sort().join(',') !== 'ciphertext,iv,keyVersion,tag,version' ||
        envelope.version !== 1 || envelope.keyVersion !== context.keyVersion) throw new Error();
    const iv = decodeEnvelopeField(envelope.iv, 12), ciphertext = decodeEnvelopeField(envelope.ciphertext, 20), tag = decodeEnvelopeField(envelope.tag, 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    plaintext = decipher.update(ciphertext);
    decipher.final();
    return encodeBase32(plaintext);
  } catch {
    throw new Error('Invalid encrypted TOTP secret');
  } finally { plaintext?.fill(0); }
}
