import crypto from 'node:crypto';
import {
  allowMethods,
  getPublicStorageUrl,
  getSupabaseServiceKeyInfo,
  getSupabaseStorageBaseUrl,
  readJson,
  requireWallet,
  supabaseStorageRest
} from '../../backend.js';
import {
  ARTWORK_MIME_EXTENSIONS,
  MAX_ARTWORK_UPLOAD_BYTES,
  MAX_ARTWORK_UPLOAD_MB,
  MAX_METADATA_BYTES
} from '../../../config/upload-policy.js';

const ARTWORKS_BUCKET = 'artworks';
const ALLOWED_TYPES = new Map(Object.entries(ARTWORK_MIME_EXTENSIONS));
const METADATA_CONTENT_TYPE = 'application/json';

const SAFE_ERROR_MESSAGES = {
  MISSING_SERVICE_ROLE_KEY: 'Upload service is missing the Supabase service role key.',
  SERVICE_ROLE_KEY_NOT_SERVICE_ROLE: 'Upload service is not configured with a Supabase service role key.',
  STORAGE_BUCKET_NOT_FOUND: 'Upload storage bucket is not available.',
  STORAGE_SIGNED_UPLOAD_RLS_DENIED: 'Upload storage authorization was denied by Supabase policy.',
  STORAGE_SIGNED_UPLOAD_FAILED: 'Upload storage authorization failed.',
  INVALID_UPLOAD_PAYLOAD: 'Upload request is invalid.',
  SIGNED_UPLOAD_URL_MISSING: 'Upload storage did not return an upload URL.',
  PROFILE_COVER_RETIRED: 'Profile cover uploads are no longer available.',
  UNAUTHENTICATED: 'Please authenticate with your connected wallet.'
};

function sanitizeFilename(value, fallbackExtension) {
  const base = String(value || 'artwork')
    .split(/[\\/]/)
    .pop()
    .normalize('NFKD')
    .replace(/[^\w.\-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .toLowerCase()
    .slice(0, 96);

  const safe = base || `artwork.${fallbackExtension}`;
  return safe.includes('.') ? safe : `${safe}.${fallbackExtension}`;
}

export function buildStoragePath(wallet, fileName, contentType) {
  const extension = ALLOWED_TYPES.get(contentType);
  const safeName = sanitizeFilename(fileName, extension);
  const nonce = crypto.randomUUID();
  return `uploads/${wallet}/${Date.now()}-${nonce}-${safeName}`;
}

export function buildMetadataStoragePath(wallet, fileName) {
  const safeName = sanitizeFilename(fileName, 'json').replace(/\.[^.]+$/, '.json');
  const nonce = crypto.randomUUID();
  return `metadata/${wallet}/${Date.now()}-${nonce}-${safeName}`;
}

function invalidPayload(res, reason, message) {
  return res.status(400).json({
    error: 'INVALID_UPLOAD_PAYLOAD',
    reason,
    message
  });
}

function assertServiceRoleKey() {
  const keyInfo = getSupabaseServiceKeyInfo();
  if (!keyInfo.isServiceRole) {
    const err = new Error('Supabase service role key is required for upload authorization');
    err.statusCode = 500;
    err.code = 'SERVICE_ROLE_KEY_NOT_SERVICE_ROLE';
    throw err;
  }
}

function sendUploadError(res, error) {
  const status = error.statusCode || 500;
  const code = error.code || (status === 500 ? 'STORAGE_SIGNED_UPLOAD_FAILED' : 'REQUEST_FAILED');
  res.status(status).json({
    error: code,
    message: SAFE_ERROR_MESSAGES[code] || (status === 500 ? 'Upload service failed.' : error.message),
    stage: 'SIGNED_UPLOAD_CREATE',
    bucket: ARTWORKS_BUCKET
  });
}

export async function createSignedArtworkUpload(path, contentType, kind = 'media', options = {}) {
  if (kind === 'profile-cover') {
    throw Object.assign(new Error(SAFE_ERROR_MESSAGES.PROFILE_COVER_RETIRED), {code: 'PROFILE_COVER_RETIRED', statusCode: 410});
  }
  assertServiceRoleKey();
  const encodedPath = path.split('/').map(segment => encodeURIComponent(segment)).join('/');
  const signed = await supabaseStorageRest(
    `object/upload/sign/${ARTWORKS_BUCKET}/${encodedPath}`,
    { method: 'POST', body: {}, headers: { 'x-upsert': 'false' }, signal: options.signal }
  );
  const relativeUrl = signed?.url || signed?.signedURL || signed?.signedUrl;
  if (!relativeUrl) {
    const error = new Error('Supabase Storage did not return a signed upload URL');
    error.statusCode = 500;
    error.code = 'SIGNED_UPLOAD_URL_MISSING';
    throw error;
  }
  const storageBase = getSupabaseStorageBaseUrl();
  const url = relativeUrl.startsWith('http')
    ? relativeUrl : `${storageBase}${relativeUrl.startsWith('/') ? '' : '/'}${relativeUrl}`;
  return {
    bucket: ARTWORKS_BUCKET, kind, path,
    token: new URL(url).searchParams.get('token') || signed.token || null,
    signed_upload_url: url,
    public_url: getPublicStorageUrl(ARTWORKS_BUCKET, path),
    content_type: contentType,
    max_size: kind === 'metadata' ? MAX_METADATA_BYTES : MAX_ARTWORK_UPLOAD_BYTES
  };
}

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;

  try {
    const wallet = requireWallet(req);
    const body = await readJson(req);
    const kind = String(body.kind || body.upload_kind || 'media').trim().toLowerCase();
    if (kind === 'profile-cover') {
      return res.status(410).json({error: 'PROFILE_COVER_RETIRED', message: SAFE_ERROR_MESSAGES.PROFILE_COVER_RETIRED});
    }
    const fileName = String(body.file_name || body.fileName || '').trim();
    const contentType = String(body.content_type || body.contentType || '').trim().toLowerCase();
    const size = Number(body.size || body.file_size || 0);
    const isMetadata = kind === 'metadata';

    if (isMetadata) {
      if (contentType !== METADATA_CONTENT_TYPE) {
        return invalidPayload(
          res,
          'UNSUPPORTED_METADATA_TYPE',
          'Artwork metadata must be application/json.'
        );
      }
      if (!Number.isFinite(size) || size <= 0 || size > MAX_METADATA_BYTES) {
        return invalidPayload(
          res,
          'INVALID_METADATA_SIZE',
          'Artwork metadata must be between 1 byte and 256 KB.'
        );
      }
    } else if (!ALLOWED_TYPES.has(contentType)) {
      return invalidPayload(
        res,
        'UNSUPPORTED_FILE_TYPE',
        'This file type is not supported. Upload a JPG, PNG, WebP, GIF, MP4, WebM, MOV, MP3, WAV, OGG, AAC, or M4A file.'
      );
    } else if (!Number.isFinite(size) || size <= 0) {
      return invalidPayload(
        res,
        'EMPTY_FILE',
        'This file is empty. Choose a valid artwork file and try again.'
      );
    } else if (size > MAX_ARTWORK_UPLOAD_BYTES) {
      return invalidPayload(
        res,
        'INVALID_FILE_SIZE',
        `This file is too large. The maximum size is ${MAX_ARTWORK_UPLOAD_MB} MB.`
      );
    }

    assertServiceRoleKey();

    const path = isMetadata
      ? buildMetadataStoragePath(wallet, fileName || 'metadata.json')
      : buildStoragePath(wallet, fileName, contentType);
    res.status(200).json(await createSignedArtworkUpload(path, contentType, isMetadata ? 'metadata' : 'media'));
  } catch (error) {
    sendUploadError(res, error);
  }
}
