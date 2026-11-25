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
vm.runInNewContext(source, { window, document: {}, CustomEvent });
const { mediaType, mediaUrl, posterUrl, mediaDescriptor } = window.ArtSoulArtworkCard;

test('only a failed generated preview retries the original video once', () => {
    const { retryVideoPreview, startVideoFromPreview } = window.ArtSoulArtworkCard;
    const url = 'https://cdn.example.test/work.mp4?quality=source';
    const video = { src: url + '#t=0.1', currentTime: 0.1, dataset: {}, getAttribute() { return this.src; } };
    assert.equal(retryVideoPreview(video, url), true);
    assert.equal(video.src, url);
    assert.equal(retryVideoPreview(video, url), false);
    startVideoFromPreview(video, url);
    assert.equal(video.currentTime, 0.1);
    for (const [source, poster] of [[url + '#t=0.1', 'poster.png'], [url + '#t=0.1', '']]) {
        video.src = source;
        assert.equal(retryVideoPreview(video, source, poster), false, 'authored fragments stay intact');
        assert.equal(video.src, source);
    }
});

test('a rejected generated preview carries one active Play request to the original source', () => {
    const { retryVideoPreview } = window.ArtSoulArtworkCard;
    const url = 'https://cdn.example.test/work.mp4';
    for (const [paused, ended, isConnected, hidden] of [
        [false, false, true, false], [true, false, true, false], [false, true, true, false],
        [false, false, false, false], [false, false, true, true]
    ]) {
        const actions = [];
        const video = {
            src: url + '#t=0.1', paused, ended, isConnected, ownerDocument: { hidden },
            getAttribute() { return this.src; },
            load() { actions.push(['load', this.src]); },
            play() { actions.push(['play', this.src]); return Promise.resolve(); }
        };
        assert.equal(retryVideoPreview(video, url), true);
        assert.equal(retryVideoPreview(video, url), false);
        assert.deepEqual(actions, !paused && !ended && isConnected && !hidden ? [['load', url], ['play', url]] : []);
    }
});

test('a posterless preview requests one frame and first playback includes the opening soundtrack', () => {
    const { videoPreviewSource, startVideoFromPreview } = window.ArtSoulArtworkCard;
    const url = 'https://cdn.example.test/work.mp4?quality=source';
    assert.equal(videoPreviewSource(url, ''), url + '#t=0.1');
    assert.equal(videoPreviewSource(url, 'poster.png'), url);
    assert.equal(videoPreviewSource(url + '#t=3', ''), url + '#t=3');
    const video = { currentTime: 0.1, dataset: {} };
    startVideoFromPreview(video, url, '');
    assert.equal(video.currentTime, 0);
    video.currentTime = 0.1;
    startVideoFromPreview(video, url, '');
    assert.equal(video.currentTime, 0.1, 'resume preserves position');
    const scrubbed = { currentTime: 3.5, dataset: {} };
    startVideoFromPreview(scrubbed, url, '');
    assert.equal(scrubbed.currentTime, 3.5);
    const short = { currentTime: 0.04, duration: 0.04, dataset: {} };
    startVideoFromPreview(short, url, '');
    assert.equal(short.currentTime, 0);
});

test('restoring a cached page resets generated previews and preserves author-specified clips', () => {
    const { reviveMediaPreviews } = window.ArtSoulArtworkCard;
    const url = 'https://cdn.example.test/work.mp4';
    const makeVideo = (src, dataset) => ({ src, dataset, readyState: 4, duration: 8,
        currentTime: 4, pause() {}, closest() { return null; } });
    const preview = makeVideo(url + '#t=0.1', { artsoulPlayedSource: url });
    const authored = makeVideo(url + '#t=3,6', {});
    const poster = makeVideo(url, {});
    window.matchMedia = () => ({ matches: false });
    window.dispatchEvent = () => {};
    const root = { querySelectorAll: selector => selector.endsWith(' video') ? [preview, authored, poster] : [] };
    reviveMediaPreviews(root);
    reviveMediaPreviews(root);
    assert.deepEqual([preview.currentTime, authored.currentTime, poster.currentTime], [0.1, 4, 0]);
});

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
        { type: 'video', url: artwork.file_url, thumbnailUrl: artwork.file_url, poster: '', known: true }
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

test('audio card previews display the compact local cover before a listener presses play', () => {
    const cover = '/brand/artsoul-audio-cover-384.webp';
    const bytes = fs.readFileSync(path.join(__dirname, '..', 'public', cover));
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
    assert.ok(bytes.length < 64 * 1024);
    assert.ok(source.includes(cover) && gallerySource.includes(cover));
    assert.match(source, /audio\.preload = 'none'/);
    assert.match(source, /className: 'artsoul-card-audio-element', preload: 'none'/);
});
