const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'components', 'artwork-card.js'), 'utf8');
const gallerySource = fs.readFileSync(path.join(__dirname, '..', 'src', 'entries', 'gallery.jsx'), 'utf8');
const window = {
    ArtSoulSecurity: { isValidStorageUrl: () => true },
    addEventListener: () => {}
};
// The page loads the artwork URL owner before the card script; the harness
// must do the same or the card builds a different URL shape than the product.
vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'artwork-url.js'), 'utf8'),
    { window, document: {} }
);
vm.runInNewContext(source, { window, document: {} });
const { mediaType, mediaUrl, posterUrl, mediaDescriptor } = window.ArtSoulArtworkCard;

test('video evidence wins over stale audio metadata without selecting the audio URL', () => {
    const artwork = {
        media_type: 'audio',
        animation_url: 'https://cdn.example.test/legacy.mp3',
        file_url: 'https://cdn.example.test/artwork.mp4',
        image: 'https://cdn.example.test/poster.jpg'
    };
    assert.equal(mediaType(artwork), 'video');
    assert.equal(mediaUrl(artwork), artwork.file_url);
    assert.equal(posterUrl(artwork), artwork.image);
});

test('audio chooses its media URL instead of its cover image', () => {
    const artwork = {
        file_type: 'audio/mpeg',
        animation_url: 'https://cdn.example.test/track.mp3',
        image: 'https://cdn.example.test/cover.png'
    };
    assert.equal(mediaType(artwork), 'audio');
    assert.equal(mediaUrl(artwork), artwork.animation_url);
});

test('extensionless video keeps the explicitly typed media URL', () => {
    const artwork = { file_type: 'video/mp4', file_url: 'https://storage.example.test/object?id=42' };
    assert.equal(mediaType(artwork), 'video');
    assert.equal(mediaUrl(artwork), artwork.file_url);
});

test('video metadata wins over stale audio metadata before first paint', () => {
    const artwork = {
        file_type: 'audio/mpeg',
        media_type: 'video/mp4',
        file_url: 'https://storage.example.test/object?id=video'
    };
    assert.equal(mediaType(artwork), 'video');
    assert.deepEqual(
        { ...mediaDescriptor(artwork) },
        { type: 'video', url: artwork.file_url, poster: '', known: true }
    );
});

test('unresolved media remains unknown instead of defaulting to image or audio', () => {
    const artwork = { file_url: 'https://storage.example.test/object?id=unknown' };
    assert.equal(mediaType(artwork), 'unknown');
    assert.equal(mediaDescriptor(artwork).known, false);
});

test('shared card images defer offscreen transfer and decode work', () => {
    assert.match(source, /guard\.loading = 'lazy'/);
    assert.match(source, /guard\.decoding = 'async'/);
    assert.match(source, /avatar\.loading = 'lazy'/);
    assert.match(source, /avatar\.decoding = 'async'/);
    assert.match(source, /img\.loading = 'lazy'/);
    assert.match(source, /img\.decoding = 'async'/);
    assert.match(source, /className: 'artsoul-card-media-object',[\s\S]*loading: 'lazy',[\s\S]*decoding: 'async'/);
    assert.match(source, /className: 'artsoul-video-poster', loading: 'lazy', decoding: 'async'/);
    assert.match(source, /className: 'artsoul-card-audio-avatar', loading: 'lazy', decoding: 'async'/);
    assert.equal((gallerySource.match(/loading="lazy"/g) || []).length, 2);
    assert.equal((gallerySource.match(/decoding="async"/g) || []).length, 2);
});
