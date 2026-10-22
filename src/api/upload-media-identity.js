import { createHash } from 'node:crypto';
import { getPublicStorageUrl } from './backend.js';
import { allowedArtworkUrl } from './safe-artwork-fetch.js';
import { ARTWORK_MIME_EXTENSIONS, MAX_ARTWORK_UPLOAD_BYTES } from '../config/upload-policy.js';

const FETCH_TIMEOUT_MS = 30000;
const ISSUED_FILENAME = /^\d{13}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[\w.-]{1,100}$/;

class UploadMediaIdentityError extends Error {
  constructor(code, statusCode = 422) {
    super(code);
    this.code = code;
    this.statusCode = statusCode;
  }
}

const identityError = (code, status) => new UploadMediaIdentityError(code, status);

// The authenticated wallet and server-issued raw object path are the inputs.
// A browser digest, filename, preview URL or declared size is never evidence.
export function uploadedMediaUrl(walletAddress, storagePath) {
  const wallet = String(walletAddress || '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(wallet) || /^0x0{40}$/.test(wallet)) {
    throw identityError('INVALID_UPLOAD_OWNER', 400);
  }
  const prefix = `uploads/${wallet}/`;
  if (typeof storagePath !== 'string' || !storagePath.startsWith(prefix) ||
      !ISSUED_FILENAME.test(storagePath.slice(prefix.length))) {
    throw identityError('INVALID_UPLOAD_PATH', 400);
  }
  const url = getPublicStorageUrl('artworks', storagePath);
  // Reuse the artwork host allowlist, but construct only original object URLs;
  // transformed images, remote URLs and IPFS are not upload identity inputs.
  if (!allowedArtworkUrl(url)) throw identityError('INVALID_UPLOAD_STORAGE', 503);
  return url;
}

export async function verifyUploadedMedia(walletAddress, storagePath, { timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  const url = uploadedMediaUrl(walletAddress, storagePath);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > FETCH_TIMEOUT_MS) {
    throw identityError('INVALID_UPLOAD_TIMEOUT', 500);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let reader;
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'error' });
    if (!response.ok || !response.body) throw identityError('UPLOAD_MEDIA_UNAVAILABLE', 503);
    const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!Object.hasOwn(ARTWORK_MIME_EXTENSIONS, contentType)) {
      throw identityError('UNSUPPORTED_UPLOAD_MEDIA');
    }
    if (Number(response.headers.get('content-length')) > MAX_ARTWORK_UPLOAD_BYTES) {
      throw identityError('UPLOAD_MEDIA_TOO_LARGE', 413);
    }
    reader = response.body.getReader();
    const hash = createHash('sha256');
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > MAX_ARTWORK_UPLOAD_BYTES - size) {
        throw identityError('UPLOAD_MEDIA_TOO_LARGE', 413);
      }
      hash.update(value);
      size += value.byteLength;
    }
    if (!size) throw identityError('EMPTY_UPLOAD_MEDIA');
    return { sha256: hash.digest('hex'), size, contentType, storagePath, mediaUrl: url };
  } catch (error) {
    if (controller.signal.aborted) throw identityError('UPLOAD_MEDIA_TIMEOUT', 503);
    if (error instanceof UploadMediaIdentityError) throw error;
    // Do not return storage response bodies, internal URLs or transport errors.
    throw identityError('UPLOAD_MEDIA_UNAVAILABLE', 503);
  } finally {
    clearTimeout(timeout);
    controller.abort();
    if (reader) {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}
