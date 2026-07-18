const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');

test('artwork upload policy is one 50 MB boundary with the reviewed MIME allowlist', async () => {
  const policy = await import(pathToFileURL(path.join(ROOT, 'src/config/upload-policy.js')).href);

  assert.equal(policy.MAX_ARTWORK_UPLOAD_MB, 50);
  assert.equal(policy.MAX_ARTWORK_UPLOAD_BYTES, 50 * 1024 * 1024);
  assert.equal(policy.MAX_METADATA_BYTES, 256 * 1024);
  assert.deepEqual(policy.STORAGE_ALLOWED_MIME_TYPES, [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/x-wav',
    'audio/ogg',
    'audio/aac',
    'audio/mp4',
    'application/json'
  ]);
});

test('active upload surfaces consume the shared policy and no longer advertise 100 MB', () => {
  const files = [
    'src/api/routes/upload/file.js',
    'src/entries/upload.js',
    'src/features/artwork/file-service.js',
    'src/core/utils/error-handler.js'
  ];

  for (const relativePath of files) {
    const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
    assert.match(source, /config\/upload-policy\.js/);
    assert.doesNotMatch(source, /(?:100|200)\s*\*\s*1024\s*\*\s*1024/);
    assert.doesNotMatch(source, /(?:100|200)\s*MB/i);
  }

  for (const relativePath of ['index.html', 'upload.html']) {
    const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
    assert.match(source, /50 MB/);
    assert.doesNotMatch(source, /100\s*MB/i);
  }
});
