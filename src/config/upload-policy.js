export const MAX_ARTWORK_UPLOAD_MB = 50;
export const MAX_ARTWORK_UPLOAD_BYTES = MAX_ARTWORK_UPLOAD_MB * 1024 * 1024;
export const MAX_METADATA_BYTES = 256 * 1024;

export const ARTWORK_MIME_EXTENSIONS = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/aac': 'aac',
  'audio/mp4': 'm4a'
});

export const ALLOWED_ARTWORK_MIME_TYPES = Object.freeze(
  Object.keys(ARTWORK_MIME_EXTENSIONS)
);

export const STORAGE_ALLOWED_MIME_TYPES = Object.freeze([
  ...ALLOWED_ARTWORK_MIME_TYPES,
  'application/json'
]);
