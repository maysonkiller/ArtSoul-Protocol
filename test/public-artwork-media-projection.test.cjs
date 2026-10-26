const assert = require('node:assert/strict');
const test = require('node:test');
let getMediaType, getMediaUrl, getPosterUrl;
test.before(async () => {
  ({ getMediaType, getMediaUrl, getPosterUrl } = await import('../src/api/routes/public/artworks.js'));
});

test('projection keeps video playback URL separate from its image poster', () => {
  const metadata = {
    media_type: 'video/mp4',
    animation_url: 'ipfs://video.mp4',
    image: 'ipfs://poster.jpg'
  };
  const type = getMediaType(metadata);
  const mediaUrl = getMediaUrl(metadata, type);
  assert.equal(type, 'video');
  assert.equal(mediaUrl, metadata.animation_url);
  assert.equal(getPosterUrl(metadata, mediaUrl), metadata.image);
});

test('projection supports explicitly typed extensionless video without choosing its poster', () => {
  const metadata = {
    file_type: 'audio/mpeg',
    mime_type: 'video/mp4',
    animation_url: 'ipfs://extensionless-video',
    image: 'ipfs://poster-without-extension'
  };
  const type = getMediaType(metadata);
  assert.equal(type, 'video');
  assert.equal(getMediaUrl(metadata, type), metadata.animation_url);
});

test('projection treats an extensionless image field as known image data', () => {
  const metadata = { image: 'ipfs://extensionless-image' };
  const type = getMediaType(metadata);
  assert.equal(type, 'image');
  assert.equal(getMediaUrl(metadata, type), metadata.image);
});
