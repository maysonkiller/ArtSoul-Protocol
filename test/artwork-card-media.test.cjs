const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'components', 'artwork-card.js'), 'utf8');
const gallerySource = fs.readFileSync(path.join(__dirname, '..', 'src', 'entries', 'gallery.jsx'), 'utf8');
const homeSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'entries', 'index.js'), 'utf8');
const detailSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'entries', 'artwork.jsx'), 'utf8');
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
const { mediaType, mediaUrl, posterUrl, mediaDescriptor, brandMediaPoster } = window.ArtSoulArtworkCard;

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
        // thumbnailUrl mirrors url for anything that is not a still image, so a
        // video is never routed through a still transform.
        {
            type: 'video',
            url: artwork.file_url,
            thumbnailUrl: artwork.file_url,
            poster: '/ARTSOULlogo-clean.png',
            known: true
        }
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

test('card media reuses the already-loaded site-logo URL', () => {
    const siteLogoUrl = 'https://cdn.example.test/site-logo.png';
    const isolatedWindow = {
        ArtSoulSecurity: { isValidStorageUrl: () => true },
        addEventListener: () => {}
    };
    const isolatedDocument = {
        querySelector: selector => selector === '.site-logo'
            ? { currentSrc: siteLogoUrl, src: '/ARTSOULlogo-clean.png' }
            : null
    };
    vm.runInNewContext(source, { window: isolatedWindow, document: isolatedDocument });

    assert.equal(isolatedWindow.ArtSoulArtworkCard.brandMediaPoster(), siteLogoUrl);
    assert.equal(brandMediaPoster(), '/ARTSOULlogo-clean.png');
});

test('card audio and video stay off the page-load network path', () => {
    assert.doesNotMatch(source, /preload[:=] ['"]metadata['"]/);
    assert.match(source, /video\.preload = 'none'/);
    assert.match(source, /audio\.preload = 'none'/);
    assert.match(source, /preload: 'none'/);
    assert.doesNotMatch(source, /video\.currentTime = target/);

    assert.doesNotMatch(gallerySource, /preload="metadata"/);
    assert.match(gallerySource, /preload="none"/);
    assert.doesNotMatch(homeSource, /preload(?: = |', ')metadata/);
    assert.match(homeSource, /preload(?: = |', ')none/);
    assert.ok(
        (homeSource.match(/video\.poster = window\.ArtSoulArtworkCard\?\.brandMediaPoster\?\.\(\) \|\| '\/ARTSOULlogo-clean\.png'/g) || []).length >= 2,
        'both homepage fallback video renderers must paint a poster without fetching video bytes'
    );

    // The selected artwork is not a card: its player still needs metadata so
    // the user gets a usable detail surface before pressing Play.
    assert.match(detailSource, /preload="metadata"/);
});

test('runtime media uses the lighter existing ArtSoul visual', () => {
    for (const runtimeSource of [source, gallerySource, homeSource, detailSource]) {
        assert.doesNotMatch(runtimeSource, /['"]\/ARTSOULlogo\.png['"]/);
        assert.match(runtimeSource, /['"]\/ARTSOULlogo-clean\.png['"]/);
    }
});
