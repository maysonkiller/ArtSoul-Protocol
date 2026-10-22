import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyUploadedMedia, uploadedMediaUrl } from '../src/api/upload-media-identity.js';
import { MAX_ARTWORK_UPLOAD_BYTES, ALLOWED_ARTWORK_MIME_TYPES } from '../src/config/upload-policy.js';

const wallet = '0x1111111111111111111111111111111111111111';
const other = '0x2222222222222222222222222222222222222222';
const basename = '1792703502286-3aad8537-cd2e-452e-bae2-600a1cfc8a36-';
const path = `uploads/${wallet}/${basename}image.png`;
const origin = 'https://storage.example.com';
let originalFetch;
let originalUrl;
test.beforeEach(() => {
  originalFetch = globalThis.fetch;
  originalUrl = process.env.SUPABASE_URL;
  process.env.SUPABASE_URL = origin;
});
test.afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalUrl;
});

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const expectCode = (code, statusCode) => e => e.code === code && e.statusCode === statusCode;

test('hashes downloaded bytes regardless of the uploaded filename or chunks', async () => {
  const bytes = Buffer.from('the exact original upload');
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return new Response(new ReadableStream({ start(c) {
      c.enqueue(bytes.subarray(0, 3)); c.enqueue(bytes.subarray(3)); c.close();
    } }), { headers: { 'content-type': 'image/png; charset=binary', 'content-length': '1' } });
  };
  const first = await verifyUploadedMedia(wallet, path);
  const renamed = await verifyUploadedMedia(wallet, path.replace('image.png', 'screen-shot-1.png'));
  assert.equal(first.sha256, digest(bytes));
  assert.equal(renamed.sha256, first.sha256);
  assert.equal(first.size, bytes.length);
  assert.equal(first.storagePath, path);
  assert.equal(first.contentType, 'image/png');
  assert.equal(first.mediaUrl, `${origin}/storage/v1/object/public/artworks/${path}`);
  assert.ok(requests.every(r => r.options.redirect === 'error' && r.options.signal.aborted));
});

test('a different byte sequence produces a different identity', async () => {
  globalThis.fetch = async () => new Response('first', { headers: { 'content-type': 'image/png' } });
  const first = await verifyUploadedMedia(wallet, path);
  globalThis.fetch = async () => new Response('second', { headers: { 'content-type': 'image/png' } });
  assert.notEqual((await verifyUploadedMedia(wallet, path)).sha256, first.sha256);
});

test('only the authenticated wallet original upload path can be fetched', async () => {
  let fetches = 0;
  globalThis.fetch = async () => { fetches++; throw Error('unexpected fetch'); };
  const invalidPaths = [
    path.replace(wallet, other), path.replace('uploads/', 'metadata/'),
    `${path}?width=1`, `${path}#fragment`, `${path}/other`, path.replace(basename, ''),
    path.replace('image.png', '../image.png'), path.replace('image.png', '%2e%2e%2fimage.png'),
    path.replace('image.png', '%252e%252e'), path.replace('image.png', 'x\\image.png'),
    `https://attacker.example/${path}`, `https://storage.example.com/storage/v1/render/image/public/artworks/${path}`,
    `ipfs://Qm${'a'.repeat(44)}`, `${path}\n`
  ];
  for (const candidate of invalidPaths) {
    await assert.rejects(verifyUploadedMedia(wallet, candidate), expectCode('INVALID_UPLOAD_PATH', 400));
  }
  for (const owner of ['', '0x0', `0x${'0'.repeat(40)}`]) {
    await assert.rejects(verifyUploadedMedia(owner, path), expectCode('INVALID_UPLOAD_OWNER', 400));
  }
  assert.equal(fetches, 0);
});

test('invalid configured hosts are rejected before a request', () => {
  for (const url of ['http://127.0.0.1', 'https://user:pass@storage.example.com', 'https://storage.example.com:8443', 'https://storage.example.com/rest/v1']) {
    process.env.SUPABASE_URL = url;
    assert.throws(() => uploadedMediaUrl(wallet, path), expectCode('INVALID_UPLOAD_STORAGE', 503));
  }
});

test('keeps every existing supported media MIME type', async () => {
  for (const contentType of ALLOWED_ARTWORK_MIME_TYPES) {
    globalThis.fetch = async () => new Response('bytes', { headers: { 'content-type': contentType } });
    assert.equal((await verifyUploadedMedia(wallet, path)).contentType, contentType);
  }
});

test('rejects non-media, empty bodies and unavailable objects', async () => {
  for (const mime of ['application/json', 'text/html', 'application/octet-stream', '']) {
    globalThis.fetch = async () => new Response('{}', { headers: { 'content-type': mime } });
    await assert.rejects(verifyUploadedMedia(wallet, path), expectCode('UNSUPPORTED_UPLOAD_MEDIA', 422));
  }
  globalThis.fetch = async () => new Response('', { headers: { 'content-type': 'image/png' } });
  await assert.rejects(verifyUploadedMedia(wallet, path), expectCode('EMPTY_UPLOAD_MEDIA', 422));
  for (const status of [403, 404, 500]) {
    globalThis.fetch = async () => new Response('private provider details', { status });
    await assert.rejects(verifyUploadedMedia(wallet, path), expectCode('UPLOAD_MEDIA_UNAVAILABLE', 503));
  }
});

test('bounds bytes even if Content-Length is absent or false', async () => {
  const chunk = Buffer.alloc(1024 * 1024);
  for (const contentLength of [undefined, '1']) {
    let sent = 0;
    let cancelled = false;
    const stream = new ReadableStream({
      pull(c) { sent++; c.enqueue(chunk); },
      cancel() { cancelled = true; }
    });
    globalThis.fetch = async () => new Response(stream, { headers: {
      'content-type': 'image/png', ...(contentLength ? { 'content-length': contentLength } : {})
    } });
    await assert.rejects(verifyUploadedMedia(wallet, path), expectCode('UPLOAD_MEDIA_TOO_LARGE', 413));
    assert.ok(sent <= MAX_ARTWORK_UPLOAD_BYTES / chunk.length + 2);
    assert.ok(cancelled);
  }
});

test('allows the exact size limit and rejects a declared oversize before reading', async () => {
  const chunk = Buffer.alloc(1024 * 1024);
  let remaining = MAX_ARTWORK_UPLOAD_BYTES / chunk.length;
  globalThis.fetch = async () => new Response(new ReadableStream({ pull(c) {
    if (remaining-- > 0) c.enqueue(chunk); else c.close();
  } }), { headers: { 'content-type': 'video/mp4' } });
  assert.equal((await verifyUploadedMedia(wallet, path)).size, MAX_ARTWORK_UPLOAD_BYTES);
  globalThis.fetch = async () => new Response(chunk, { headers: {
    'content-type': 'video/mp4', 'content-length': String(MAX_ARTWORK_UPLOAD_BYTES + 1)
  } });
  await assert.rejects(verifyUploadedMedia(wallet, path), expectCode('UPLOAD_MEDIA_TOO_LARGE', 413));
});

test('network failures and redirects cannot expose transport diagnostics', async () => {
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.redirect, 'error');
    throw new TypeError('redirect to private host, signed token or internal error');
  };
  await assert.rejects(verifyUploadedMedia(wallet, path), e => {
    assert.equal(e.message, 'UPLOAD_MEDIA_UNAVAILABLE');
    return e.statusCode === 503;
  });
});

test('the deadline covers both fetch and stalled stream reads', async () => {
  globalThis.fetch = (_url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  await assert.rejects(verifyUploadedMedia(wallet, path, { timeoutMs: 10 }), expectCode('UPLOAD_MEDIA_TIMEOUT', 503));
  globalThis.fetch = async (_url, { signal }) => new Response(new ReadableStream({ start(c) {
    signal.addEventListener('abort', () => c.error(signal.reason), { once: true });
  } }), { headers: { 'content-type': 'image/png' } });
  await assert.rejects(verifyUploadedMedia(wallet, path, { timeoutMs: 10 }), expectCode('UPLOAD_MEDIA_TIMEOUT', 503));
});
