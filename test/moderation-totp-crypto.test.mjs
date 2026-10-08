import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import crypto from 'node:crypto';
import { generateTotpSecret, calculateTotp, matchTotpStep, encryptTotpSecret, decryptTotpSecret } from '../src/api/moderation-totp-crypto.js';

// RFC 6238 Appendix B, with the algorithm-specific 20/32/64-byte secrets
// described in Appendix A. These are public test vectors, never live factors.
// https://www.rfc-editor.org/rfc/rfc6238#appendix-B
const SEEDS = {
  sha1: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
  sha256: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA',
  sha512: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA'
};
const VECTORS = [
  [59, '94287082', '46119246', '90693936'],
  [1111111109, '07081804', '68084774', '25091201'],
  [1111111111, '14050471', '67062674', '99943326'],
  [1234567890, '89005924', '91819424', '93441116'],
  [2000000000, '69279037', '90698825', '38618901'],
  [20000000000, '65353130', '77737706', '47863826']
];
const CONTEXT = { wallet: '0x' + 'ab'.repeat(20), factorId: '12345678-1234-4123-8123-123456789012', keyVersion: 1 };
const KEY = Buffer.alloc(32, 19);

for (const [time, ...codes] of VECTORS) {
  ['sha1', 'sha256', 'sha512'].forEach((algorithm, i) => {
    test(`RFC 6238 ${algorithm} vector at ${time}`, () => {
      assert.equal(calculateTotp(SEEDS[algorithm], time, { algorithm, digits: 8 }), codes[i]);
    });
  });
}

test('the six-digit product profile preserves RFC HOTP vectors and leading zeroes', () => {
  // RFC 4226 Appendix D. The TOTP counter is floor(unixSeconds / 30).
  const codes = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
  codes.forEach((code, step) => assert.equal(calculateTotp(SEEDS.sha1, step * 30), code));
  assert.equal(calculateTotp(SEEDS.sha1, 1111111109), '081804');
  assert.equal(matchTotpStep(SEEDS.sha1, '081804', 1111111109), Math.floor(1111111109 / 30));
});

test('counter boundaries use epoch zero, exact 30-second intervals and more than 32 bits', () => {
  assert.equal(calculateTotp(SEEDS.sha1, 29), '755224');
  assert.equal(calculateTotp(SEEDS.sha1, 30), '287082');
  assert.equal(calculateTotp(SEEDS.sha1, 59), '287082');
  assert.equal(calculateTotp(SEEDS.sha1, 60), '359152');
  // Independently reproduced with Python stdlib hmac/struct, not bitwise time arithmetic.
  assert.equal(calculateTotp(SEEDS.sha1, 4294967296 * 30), '999456');
  assert.equal(calculateTotp(SEEDS.sha1, 4294967297 * 30), '108930');
});

test('secret generation draws exactly 20 random bytes and stores canonical uppercase Base32', () => {
  const random = crypto.randomBytes;
  const sizes = [];
  mock.method(crypto, 'randomBytes', size => { sizes.push(size); return random(size); });
  try {
    const values = Array.from({ length: 16 }, () => generateTotpSecret());
    values.forEach(secret => assert.match(secret, /^[A-Z2-7]{32}$/));
    assert.equal(new Set(values).size, values.length);
    assert.deepEqual(sizes, Array(16).fill(20));
  } finally { mock.restoreAll(); }
});

test('entropy-source failure never falls back to a predictable secret or IV', () => {
  mock.method(crypto, 'randomBytes', () => { throw new Error('Entropy unavailable'); });
  try {
    assert.throws(() => generateTotpSecret(), /Entropy unavailable/);
    assert.throws(() => encryptTotpSecret(SEEDS.sha1, KEY, CONTEXT), /Entropy unavailable/);
  } finally { mock.restoreAll(); }
});

test('noncanonical, padded, lowercase, whitespace and malformed secrets are rejected', () => {
  for (const secret of [null, undefined, 123, '', SEEDS.sha1.toLowerCase(), ' ' + SEEDS.sha1,
    SEEDS.sha1 + '\n', SEEDS.sha1 + '=', SEEDS.sha1.slice(1), '0' + SEEDS.sha1.slice(1),
    '1' + SEEDS.sha1.slice(1), 'Ａ' + SEEDS.sha1.slice(1), 'A'.repeat(100000)]) {
    assert.throws(() => calculateTotp(secret, 59), /Invalid canonical TOTP secret/);
    assert.throws(() => encryptTotpSecret(secret, KEY, CONTEXT), /Invalid canonical TOTP secret/);
  }
});

test('nonzero Base32 padding bits and mismatched digest seed lengths are rejected', () => {
  assert.throws(() => calculateTotp(SEEDS.sha256.slice(0, -1) + 'B', 59, { algorithm: 'sha256' }), /Invalid canonical/);
  assert.throws(() => calculateTotp(SEEDS.sha512.slice(0, -1) + 'B', 59, { algorithm: 'sha512' }), /Invalid canonical/);
  assert.throws(() => calculateTotp(SEEDS.sha1, 59, { algorithm: 'sha256' }), /Invalid canonical/);
  assert.throws(() => matchTotpStep(SEEDS.sha256, '119246', 59), /Invalid canonical/);
  assert.throws(() => encryptTotpSecret(SEEDS.sha512, KEY, CONTEXT), /Invalid canonical/);
});

test('only the explicit interoperable calculator parameters are accepted', () => {
  for (const algorithm of ['md5', 'SHA1', 'sha-1', '', null, ['sha1'], '__proto__']) {
    assert.throws(() => calculateTotp(SEEDS.sha1, 59, { algorithm }), /Invalid TOTP parameters/);
  }
  for (const digits of [0, 5, 7, 9, '6', null, NaN]) {
    assert.throws(() => calculateTotp(SEEDS.sha1, 59, { digits }), /Invalid TOTP parameters/);
  }
});

test('the matcher accepts exactly the previous, current and next steps and returns their identity', () => {
  assert.equal(matchTotpStep(SEEDS.sha1, '338314', 150), 4);
  assert.equal(matchTotpStep(SEEDS.sha1, '254676', 150), 5);
  assert.equal(matchTotpStep(SEEDS.sha1, '287922', 150), 6);
  assert.equal(matchTotpStep(SEEDS.sha1, '969429', 150), null);
  assert.equal(matchTotpStep(SEEDS.sha1, '162583', 150), null);
  assert.equal(matchTotpStep(SEEDS.sha1, '755224', 0), 0);
  assert.equal(matchTotpStep(SEEDS.sha1, '287082', 0), 1);
});

test('code input must be exactly six ASCII digits, preserving leading zeroes', () => {
  for (const code of [254676, null, undefined, '25467', '2546760', '254 676', '254676\n', ' 254676',
    '２５４６７６', '+54676', '25e676', {}, ['254676'], '0'.repeat(100000)]) {
    assert.equal(matchTotpStep(SEEDS.sha1, code, 150), null);
  }
});

test('trusted time requires a nonnegative safe integer in seconds', () => {
  for (const time of [undefined, null, -1, 0.1, '59', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 59n]) {
    assert.throws(() => calculateTotp(SEEDS.sha1, time), /Invalid TOTP time/);
    assert.throws(() => matchTotpStep(SEEDS.sha1, '287082', time), /Invalid TOTP time/);
  }
});

test('all valid candidate comparisons use timingSafeEqual even after an early match', () => {
  const equal = crypto.timingSafeEqual;
  let calls = 0;
  mock.method(crypto, 'timingSafeEqual', (left, right) => { calls++; return equal(left, right); });
  try {
    assert.equal(matchTotpStep(SEEDS.sha1, '338314', 150), 4);
    assert.equal(calls, 3);
    calls = 0;
    assert.equal(matchTotpStep(SEEDS.sha1, '000000', 150), null);
    assert.equal(calls, 3);
  } finally { mock.restoreAll(); }
});

test('matching is stateless: a repeated step still matches and MUST be consumed atomically by integration', () => {
  assert.equal(matchTotpStep(SEEDS.sha1, '254676', 150), 5);
  assert.equal(matchTotpStep(SEEDS.sha1, '254676', 151), 5);
});

test('AES-256-GCM round-trips canonical secrets with fresh 12-byte IVs and 16-byte tags', () => {
  const first = encryptTotpSecret(SEEDS.sha1, KEY, CONTEXT);
  const second = encryptTotpSecret(SEEDS.sha1, KEY, CONTEXT);
  assert.equal(Buffer.from(first.iv, 'base64url').length, 12);
  assert.equal(Buffer.from(first.tag, 'base64url').length, 16);
  assert.equal(Buffer.from(first.ciphertext, 'base64url').length, 20);
  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.ciphertext, second.ciphertext);
  assert.equal(decryptTotpSecret(JSON.parse(JSON.stringify(first)), KEY, CONTEXT), SEEDS.sha1);
  assert.equal(decryptTotpSecret(second, KEY, { ...CONTEXT, wallet: '0x' + 'AB'.repeat(20) }), SEEDS.sha1);
});

test('seed codec covers every byte value through authenticated encryption round-trips', () => {
  const random = crypto.randomBytes;
  try {
    for (let byte = 0; byte < 256; byte++) {
      mock.method(crypto, 'randomBytes', length => length === 20 ? Buffer.alloc(20, byte) : random(length));
      const secret = generateTotpSecret();
      assert.equal(decryptTotpSecret(encryptTotpSecret(secret, KEY, CONTEXT), KEY, CONTEXT), secret);
      mock.restoreAll();
    }
  } finally { mock.restoreAll(); }
});

test('wallet, factor UUID and key version are authenticated context, not envelope-supplied identity', () => {
  const envelope = encryptTotpSecret(SEEDS.sha1, KEY, CONTEXT);
  for (const context of [
    { ...CONTEXT, wallet: '0x' + 'cd'.repeat(20) },
    { ...CONTEXT, factorId: '12345678-1234-4123-8123-123456789013' },
    { ...CONTEXT, keyVersion: 2 }
  ]) assert.throws(() => decryptTotpSecret(envelope, KEY, context), /Invalid encrypted TOTP secret/);
  assert.throws(() => decryptTotpSecret({ ...envelope, keyVersion: 2 }, KEY, { ...CONTEXT, keyVersion: 2 }), /Invalid encrypted/);
  assert.throws(() => decryptTotpSecret(envelope, Buffer.alloc(32, 20), CONTEXT), /Invalid encrypted/);
});

test('ciphertext, IV and authentication-tag bit flips never produce plaintext', () => {
  const envelope = encryptTotpSecret(SEEDS.sha1, KEY, CONTEXT);
  for (const field of ['iv', 'ciphertext', 'tag']) {
    const bytes = Buffer.from(envelope[field], 'base64url');
    for (let offset = 0; offset < bytes.length; offset++) {
      const changed = Buffer.from(bytes); changed[offset] ^= 1;
      assert.throws(() => decryptTotpSecret({ ...envelope, [field]: changed.toString('base64url') }, KEY, CONTEXT), { message: 'Invalid encrypted TOTP secret' });
    }
  }
});

test('only full-length canonical base64url envelope fields are accepted', () => {
  const envelope = encryptTotpSecret(SEEDS.sha1, KEY, CONTEXT);
  for (const field of ['iv', 'ciphertext', 'tag']) {
    for (const bad of ['', null, 123, envelope[field] + '=', envelope[field] + '\n', envelope[field].slice(1), envelope[field] + 'A', '*'.repeat(envelope[field].length), 'A'.repeat(100000)]) {
      assert.throws(() => decryptTotpSecret({ ...envelope, [field]: bad }, KEY, CONTEXT), { message: 'Invalid encrypted TOTP secret' });
    }
  }
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const finalTag = alphabet.indexOf(envelope.tag.at(-1));
  assert.throws(() => decryptTotpSecret({ ...envelope, tag: envelope.tag.slice(0, -1) + alphabet[finalTag | 1] }, KEY, CONTEXT), /Invalid encrypted/);
});

test('unknown envelope versions, missing fields and extra fields fail closed', () => {
  const envelope = encryptTotpSecret(SEEDS.sha1, KEY, CONTEXT);
  const { tag, ...missing } = envelope;
  for (const invalid of [null, [], '', missing, { ...envelope, version: 2 }, { ...envelope, version: '1' },
    { ...envelope, keyVersion: '1' }, { ...envelope, wallet: CONTEXT.wallet }]) {
    assert.throws(() => decryptTotpSecret(invalid, KEY, CONTEXT), /Invalid encrypted/);
  }
});

test('invalid encryption keys and ambiguous identity contexts are rejected without coercion', () => {
  for (const key of [undefined, KEY.toString('hex'), new Uint8Array(32), Buffer.alloc(16), Buffer.alloc(31), Buffer.alloc(33)]) {
    assert.throws(() => encryptTotpSecret(SEEDS.sha1, key, CONTEXT), /32-byte key/);
    assert.throws(() => decryptTotpSecret({}, key, CONTEXT), /32-byte key/);
  }
  for (const context of [null, {}, { ...CONTEXT, wallet: '0x' + '0'.repeat(40) },
    { ...CONTEXT, wallet: CONTEXT.wallet + ' ' }, { ...CONTEXT, wallet: 123 },
    { ...CONTEXT, factorId: '../factor' }, { ...CONTEXT, factorId: '12345678-1234-4123-7123-123456789012' },
    { ...CONTEXT, keyVersion: 0 }, { ...CONTEXT, keyVersion: '1' }, { ...CONTEXT, keyVersion: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.throws(() => encryptTotpSecret(SEEDS.sha1, KEY, context), /Invalid TOTP encryption context/);
    assert.throws(() => decryptTotpSecret({}, KEY, context), /Invalid TOTP encryption context/);
  }
});

test('key rotation requires the matching explicit version and supplied encryption key', () => {
  const key = crypto.randomBytes(32), context = { ...CONTEXT, keyVersion: 2 };
  const envelope = encryptTotpSecret(SEEDS.sha1, key, context);
  assert.equal(decryptTotpSecret(envelope, key, context), SEEDS.sha1);
  assert.throws(() => decryptTotpSecret(envelope, KEY, context), /Invalid encrypted/);
  assert.throws(() => decryptTotpSecret(envelope, key, CONTEXT), /Invalid encrypted/);
});
