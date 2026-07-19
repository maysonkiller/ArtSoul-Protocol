const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src', 'ui', 'components', 'artwork-card.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'unified-styles.css'), 'utf8');
const detail = fs.readFileSync(path.join(root, 'artwork.html'), 'utf8') +
  fs.readFileSync(path.join(root, 'src', 'entries', 'artwork.jsx'), 'utf8');

class FakeElement {
    constructor(tagName, mediaElements) {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.dataset = {};
        this.style = {};
        this.listeners = {};
        this.classList = { add: (...names) => { this.className = [this.className, ...names].filter(Boolean).join(' '); } };
        this.paused = true;
        this.ended = false;
        this.muted = false;
        this.removed = false;
        if (tagName === 'audio' || tagName === 'video') mediaElements.push(this);
    }
    appendChild(child) { this.children.push(child); return child; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    remove() { this.removed = true; }
    setAttribute(name, value) { this[name] = String(value); }
    addEventListener(name, listener) { (this.listeners[name] ||= []).push(listener); }
    dispatch(name) {
        const event = {
            currentTarget: this,
            preventDefault() { this.defaultPrevented = true; },
            stopPropagation() { this.propagationStopped = true; }
        };
        for (const listener of this.listeners[name] || []) listener(event);
        return event;
    }
    play() { this.paused = false; this.ended = false; this.dispatch('play'); return Promise.resolve(); }
    pause() { if (!this.paused) { this.paused = true; this.dispatch('pause'); } }
}

function loadDomCardRuntime() {
    const mediaElements = [];
    const document = {
        createElement: tag => new FakeElement(tag, mediaElements),
        querySelectorAll: () => mediaElements
    };
    const window = {
        ArtSoulSecurity: { isValidStorageUrl: () => true },
        addEventListener: () => {}
    };
    vm.runInNewContext(source, { window, document });
    return { api: window.ArtSoulArtworkCard, mediaElements };
}

test('card media keeps the uniform square frame and cover crop', () => {
    assert.match(css, /\.artsoul-card-media\s*\{[\s\S]*?aspect-ratio:\s*1\s*\/\s*1;/);
    assert.match(css, /\.artsoul-card-media-object\s*\{[\s\S]*?object-fit:\s*cover;/);
    assert.doesNotMatch(source, /artsoul-card-video-frame/);
});

test('card video and audio expose play and mute overlays without a scrubber', () => {
    assert.match(source, /createPlaybackButton\(video/);
    assert.match(source, /createMuteButton\(video/);
    assert.match(source, /createPlaybackButton\(audio/);
    assert.match(source, /createMuteButton\(audio/);
    assert.doesNotMatch(source, /artsoul-media-progress|type\s*=\s*['"]range['"]/);
    assert.match(css, /\.artsoul-card-media-controls\s*\{[\s\S]*?position:\s*absolute;/);
});

test('controls isolate click, pointer, mouse, touch, and drag events', () => {
    for (const eventName of ['click', 'pointerdown', 'mousedown', 'touchstart', 'dragstart']) {
        assert.match(source, new RegExp(`addEventListener\\('${eventName}'`));
    }
    assert.match(source, /onDragStart:\s*stopCardActivation/);
    assert.match(source, /onPointerDown:\s*stopCardPropagation/);
});

test('desktop playback auto-hides overlays while mobile forces them visible and static', () => {
    assert.match(css, /artsoul-artwork-card:not\(:hover\)[\s\S]*data-playing="true"/);
    assert.match(css, /@media \(max-width:\s*768px\)[\s\S]*animation-duration:\s*0s !important;/);
    assert.match(css, /artsoul-card-media-controls,[\s\S]*artsoul-card-media-badge[\s\S]*opacity:\s*1 !important;/);
});

test('the full player controls remain on artwork detail only', () => {
    assert.match(detail, /<video[\s\S]*?controls/);
    assert.match(detail, /<audio[\s\S]*?controls/);
    assert.doesNotMatch(source, /controls:\s*true|\.controls\s*=\s*true/);
});

test('DOM cards render two isolated overlay buttons and keep only one media playing', async () => {
    const { api, mediaElements } = loadDomCardRuntime();
    const videoCard = api.createCardElement({ id: 'video', file_type: 'video', file_url: 'video.mp4' });
    const audioCard = api.createCardElement({ id: 'audio', file_type: 'audio', file_url: 'audio.mp3' });
    const videoControls = videoCard.children[0].children[2];
    const audioControls = audioCard.children[0].children[0].children[2];

    assert.equal(videoControls.children.length, 2);
    assert.equal(audioControls.children.length, 2);
    assert.equal(videoControls.children.some(child => child.tagName === 'INPUT'), false);

    videoControls.children[0].dispatch('click');
    await Promise.resolve();
    assert.equal(mediaElements[0].paused, false);

    audioControls.children[0].dispatch('click');
    await Promise.resolve();
    assert.equal(mediaElements[0].paused, true);
    assert.equal(mediaElements[1].paused, false);

    audioControls.children[1].dispatch('click');
    assert.equal(mediaElements[1].muted, true);
    const dragEvent = audioControls.dispatch('dragstart');
    assert.equal(dragEvent.defaultPrevented, true);
    assert.equal(dragEvent.propagationStopped, true);
});

test('cards omit unsafe media and remove themselves when media loading fails', () => {
    const { api } = loadDomCardRuntime();
    assert.equal(api.createCardElement({ id: 'missing', title: 'Missing' }), null);

    const card = api.createCardElement({ id: 'image', title: 'Image', file_url: 'image.jpg' });
    card.children[0].children[0].onerror();
    assert.equal(card.removed, true);
});

test('card bodies contain title, canonical Creator attribution, and status-price metadata', () => {
    const { api } = loadDomCardRuntime();
    const card = api.createCardElement({
        id: 'image',
        title: 'Image',
        file_url: 'image.jpg',
        creator: '0x1000000000000000000000000000000000000001',
        creator_value: '1'
    });
    const body = card.children[1];
    assert.equal(body.children.length, 3);
    assert.equal(body.children[0].className, 'artsoul-card-title');
    assert.equal(body.children[1].className, 'artsoul-card-creator');
    assert.equal(body.children[1].textContent, 'Creator: 0x100000...000001');
    assert.equal(body.children[2].className, 'artsoul-card-meta');
});
