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
            type: name,
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
    const events = new EventTarget();
    const document = {
        createElement: tag => new FakeElement(tag, mediaElements),
        querySelectorAll: () => mediaElements
    };
    const window = {
        ArtSoulSecurity: { isValidStorageUrl: () => true },
        addEventListener: events.addEventListener.bind(events)
    };
    // The page loads the artwork URL owner before the card script; the harness
  // must do the same or the card falls back to a different URL shape.
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'artwork-url.js'), 'utf8'),
    { window, document }
  );
  vm.runInNewContext(source, { window, document });
    return { api: window.ArtSoulArtworkCard, mediaElements, window, document, events };
}

test('both card renderers disclose the confirmed transaction while projection synchronization is pending', () => {
    const { api, window } = loadDomCardRuntime();
    window.React = {
        createElement: (type, props, ...children) => ({ type, props, children }),
        useState: value => [value, () => {}], useEffect() {}
    };
    const artwork = { file_type: 'image', file_url: 'image.png', pending_auction_sync: true };
    const text = node => typeof node === 'string' ? node : [node?.textContent || '', ...(node?.children || []).map(text)].join(' ');
    for (const render of [value => api.createCardElement(value, { href: false }), value => api.ReactCard({ artwork: value })]) {
        assert.match(text(render(artwork)), /Transaction confirmed\. Updating auction data\./);
        assert.doesNotMatch(text(render({ ...artwork, pending_auction_sync: false })), /Transaction confirmed/);
    }
});

test('both card renderers expose the verified frame on the card and name it on the artwork link', async () => {
    const { api, window } = loadDomCardRuntime();
    window.ArtSoulArtworkAura = (await import('../src/ui/components/aura-frame.js')).projectedArtworkAura;
    window.React = {
        createElement: (type, props, ...children) => ({ type, props, children }),
        useState: value => [value, () => {}], useEffect() {}
    };
    const nft = { source: 'v41_projection', minted: true, ownership_status: 'verified', chain_id: 84532,
        artwork_id: '34', file_type: 'audio', file_url: 'track.mp3', aura_kind: 'platform' };
    const fields = node => node?.props || node || {};
    for (const render of [artwork => api.createCardElement(artwork), artwork => api.ReactCard({ artwork, href: '/artwork/34' })]) {
        for (const minted of [true, false]) {
            const card = render({ ...nft, minted });
            const link = card.children.find(child => fields(child).className === 'artsoul-card-link');
            assert.equal(fields(card).className.includes('artsoul-aura-frame--platform'), minted);
            assert.equal(fields(link)['aria-label'].includes('ArtSoul platform NFT'), minted);
        }
    }
});

test('a profile card hides when its media fails without requiring a gallery callback', () => {
    const { api, window } = loadDomCardRuntime();
    const states = [];
    let cursor;
    window.React = {
        createElement: (type, props, ...children) => ({ type, props, children }),
        useState(initial) {
            const index = cursor++;
            if (!(index in states)) states[index] = initial;
            return [states[index], value => { states[index] = value; }];
        },
        useEffect() {}
    };
    const render = artwork => {
        cursor = 0;
        return api.ReactCard({ artwork, surface: 'profile' });
    };
    assert.equal(render({}), null);
    const artwork = { file_type: 'image', file_url: 'preview.png' };
    const card = render(artwork);
    const media = card.children[0].children.find(child => typeof child?.props?.onUnavailable === 'function');
    media.props.onUnavailable();
    assert.equal(render(artwork), null);
});

test('React card leaves nested media and action keyboard activation to the focused control', () => {
    const { api, window } = loadDomCardRuntime();
    window.React = {
        createElement: (type, props, ...children) => ({ type, props, children }),
        useState: value => [value, () => {}],
        useEffect() {}
    };
    let opened = 0;
    const card = api.ReactCard({ artwork: { file_type: 'audio', file_url: 'track.mp3' }, onOpen: () => { opened++; } });
    const root = {};
    for (const key of ['Enter', ' ']) {
        for (const target of [{ type: 'play' }, { type: 'mute' }, { type: 'action' }]) {
            let prevented = false;
            card.props.onKeyDown({ key, target, currentTarget: root, preventDefault() { prevented = true; } });
            assert.equal(opened, 0, `${key} from a nested control must not open the artwork`);
            assert.equal(prevented, false, 'native button keyboard behavior must remain available');
        }
    }
});

test('Saved control is outside card metadata and isolates navigation until the feature is enabled', () => {
    const { api, window } = loadDomCardRuntime();
    const artwork = { chain_id: 84532, artwork_id: '34', file_type: 'image', file_url: 'image.png' };
    const card = api.createCardElement(artwork);
    const preview = card.children.find(child => child.className === 'artsoul-card-preview');
    assert.ok(preview, 'the preview must own its controls in every card surface');
    const save = preview.children.find(child => child.className === 'saved-button saved-button-overlay');
    assert.ok(save);
    assert.match(preview.children[0].className, /artsoul-card-media/);
    assert.equal(save.hidden, true);
    assert.equal(save['aria-pressed'], 'false');
    assert.equal(save.dataset.savedArtwork, '34');
    assert.equal(save.dataset.savedChain, '84532');
    assert.ok(!card.children.find(child => child.className === 'artsoul-card-body').children.includes(save));
    let toggled = null;
    window.ArtSoulSaved = { toggle: control => { toggled = control; } };
    const event = save.dispatch('click');
    assert.equal(toggled, save);
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.propagationStopped, true);
    assert.equal(api.createSavedControl({ artwork_id: 'pending:1', chain_id: 84532 }), null);
    const detail = api.createSavedControl(artwork, { detail: true });
    assert.equal(detail.className, 'saved-button saved-button-detail');
});

test('React card also places Saved inside the media preview, independent of card-body height', () => {
    const { api, window } = loadDomCardRuntime();
    window.React = {
        createElement: (type, props, ...children) => ({ type, props, children }),
        useState: value => [value, () => {}],
        useEffect() {}
    };
    for (const file_type of ['image', 'audio', 'video']) {
        const card = api.ReactCard({
            artwork: { artwork_id: '34', chain_id: 84532, file_type, file_url: 'preview.' + file_type },
            href: '/artwork/34'
        });
        const preview = card.children.find(child => child.props?.className === 'artsoul-card-preview');
        assert.ok(preview, file_type + ' must have a shared media-local preview');
        assert.equal(preview.children[0].type, api.ReactMedia);
        assert.equal(preview.children[1].type, api.ReactSavedControl);
        assert.ok(!card.children.some(child => child?.type === api.ReactSavedControl),
            'Saved must not be positioned relative to the variable card body');
    }
});

test('media footer alignment keeps full-size controls on wide cards and a two-row fallback on narrow cards', () => {
    const section = css.slice(css.lastIndexOf('/* Owner layout review 2026-11-16:'));
    assert.match(section, /\.artsoul-card-preview[\s\S]*?position: relative;/);
    assert.match(section, /\.saved-button-overlay\s*\{[\s\S]*?bottom: 8px !important;/);
    const controls = section.match(/\.artsoul-card-media-controls\s*\{([^}]+)\}/)[1];
    assert.match(controls, /left: 0 !important;/);
    assert.match(controls, /right: 0 !important;/);
    assert.match(controls, /width: max-content;/);
    assert.match(controls, /margin-inline: auto;/);
    assert.doesNotMatch(controls, /(?:transform|translate)\s*:/, 'a touch press must keep the buttons in the same position');
    assert.match(section, /@container \(max-width: 215px\)[\s\S]*?bottom: 56px !important;/);
});

test('decorative disc rotation is limited to Future when the reader allows motion', () => {
    const touchCss = fs.readFileSync(path.join(root, 'mobile-no-motion.css'), 'utf8');
    const desktopRule = /@media \(min-width: 769px\) and \(prefers-reduced-motion: no-preference\)\s*\{\s*body\.future \.artsoul-card-audio-avatar\s*\{\s*animation: artsoulAudioAvatarSpin 12s/;
    const touchRule = /@media \(prefers-reduced-motion: no-preference\)\s*\{\s*:root:not\(#artsoul-motion-enabled\) body\.future \.artsoul-card-audio-avatar\[data-playing="true"\]\s*\{\s*animation: artsoulAudioAvatarSpin 3s/;
    assert.match(css, desktopRule);
    assert.match(touchCss, touchRule);
    for (const sheet of [css, touchCss]) {
        assert.equal(sheet.match(/animation:\s*artsoulAudioAvatarSpin\b/g)?.length, 1);
    }
});

test('both mobile and desktop show the moving track only when the Future visitor allows motion', () => {
    assert.match(css, /\.artsoul-aura-caption > artsoul-aura-track \{ display: none; \}/);
    assert.match(css, /@media \(prefers-reduced-motion: no-preference\)\s*\{\s*\.future \.artsoul-aura-caption > artsoul-aura-track:defined/);
    assert.match(css, /:has\(> artsoul-aura-track > svg\) > \.aura-word \{ display: none; \}/);
});

test('React card still opens when the card itself receives Enter or Space', () => {
    const { api, window } = loadDomCardRuntime();
    window.React = {
        createElement: (type, props, ...children) => ({ type, props, children }),
        useState: value => [value, () => {}],
        useEffect() {}
    };
    let opened = 0;
    const card = api.ReactCard({ artwork: { file_type: 'video', file_url: 'clip.mp4' }, onOpen: () => { opened++; } });
    const root = {};
    for (const key of ['Enter', ' ', 'Escape']) {
        let prevented = false;
        card.props.onKeyDown({ key, target: root, currentTarget: root, preventDefault() { prevented = true; } });
        assert.equal(prevented, key !== 'Escape');
    }
    assert.equal(opened, 2);
});

function loadActualClickGuard() {
    const listeners = {};
    const timers = [];
    const document = {
        readyState: 'loading',
        querySelectorAll: () => [],
        addEventListener: (name, listener) => { listeners[name] = listener; }
    };
    const runtime = fs.readFileSync(path.join(root, 'src/core/utils/performance-utils.js'), 'utf8')
        .replace(/export\s*\{[^}]*\};/, '');
    vm.runInNewContext(runtime, {
        document,
        window: { addEventListener() {}, matchMedia: () => ({ matches: false }) },
        navigator: { hardwareConcurrency: 8, deviceMemory: 8 },
        IntersectionObserver: class { observe() {} },
        console: { log() {} },
        setTimeout: (callback, duration) => { timers.push({ callback, duration }); }
    });
    listeners.DOMContentLoaded();
    return { timers, click(button) {
        button.classList.contains = name => (button.className || '').split(' ').includes(name);
        listeners.click?.({ target: { closest: () => button } });
    } };
}

function descendantButtons(node) {
    if (!node) return [];
    const self = node.tagName === 'BUTTON' || node.type === 'button' ? [node] : [];
    return self.concat((node.children || []).flat().flatMap(descendantButtons));
}

test('DOM audio and video controls remain enabled after shared performance initialization', () => {
    const { api } = loadDomCardRuntime();
    const guard = loadActualClickGuard();
    for (const [file_type, file_url] of [['audio', 'track.mp3'], ['video', 'clip.mp4']]) {
        const buttons = descendantButtons(api.createCardElement({ file_type, file_url }));
        assert.equal(buttons.length, 2);
        for (const button of buttons) {
            guard.click(button);
            assert.notEqual(button.disabled, true, `${file_type} ${button.className} must stay interactive`);
            guard.click(button);
        }
    }
    assert.equal(guard.timers.length, 0);
});

test('React audio and video controls remain enabled after shared performance initialization', () => {
    const { api, window } = loadDomCardRuntime();
    window.React = {
        createElement: (type, props, ...children) => typeof type === 'function' ? type(props) : ({ type, props, children }),
        useState: value => [value, () => {}], useEffect() {}, useRef: () => ({ current: null })
    };
    const guard = loadActualClickGuard();
    for (const [file_type, file_url] of [['audio', 'track.mp3'], ['video', 'clip.mp4']]) {
        const buttons = descendantButtons(api.ReactMedia({ artwork: { file_type, file_url } }));
        assert.equal(buttons.length, 2);
        for (const node of buttons) {
            const button = new FakeElement('button', []);
            button.className = node.props.className;
            if (node.props['data-allow-rapid'] !== undefined) button.dataset.allowRapid = node.props['data-allow-rapid'];
            guard.click(button);
            assert.notEqual(button.disabled, true, `${file_type} ${button.className} must stay interactive`);
            guard.click(button);
        }
    }
    assert.equal(guard.timers.length, 0);
});

test('shared performance initialization leaves ordinary action buttons to their handlers', () => {
    const guard = loadActualClickGuard();
    const button = new FakeElement('button', []);
    guard.click(button);
    assert.notEqual(button.disabled, true);
    assert.equal(guard.timers.length, 0);
});

test('Saved owns its pending guard and reaches its handler after shared performance initialization', () => {
    const { api, window } = loadDomCardRuntime();
    const guard = loadActualClickGuard();
    for (const detail of [false, true]) {
        const button = api.createSavedControl({ chain_id: 84532, artwork_id: '34' }, { detail });
        let writes = 0;
        window.ArtSoulSaved = { toggle(control) { if (!control.disabled) writes++; } };
        // Any document capture listener runs before the target handler.
        guard.click(button);
        button.dispatch('click');
        assert.equal(writes, 1, 'Saved must receive the first click on every surface');
        guard.click(button);
        button.dispatch('click');
        assert.equal(writes, 2, 'a subsequent click can remove the same bookmark');
    }
    assert.equal(guard.timers.length, 0);
});

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
    const findClass = (root, name) => (root?.className || '').split(/\s+/).includes(name)
        ? root : (root?.children || []).map(child => findClass(child, name)).find(Boolean);
    const videoControls = findClass(videoCard, 'artsoul-card-media-controls');
    const audioControls = findClass(audioCard, 'artsoul-card-media-controls');
    assert.ok(videoControls);
    assert.ok(audioControls);

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
    mediaElements[0].dispatch('play');
    assert.equal(mediaElements[1].paused, false, 'a delayed play event from a paused preview must not interrupt the active preview');

    audioControls.children[1].dispatch('click');
    assert.equal(mediaElements[1].muted, true);
    audioControls.children[0].dispatch('click');
    assert.equal(mediaElements[1].paused, true, 'a second Play/Pause click pauses the preview');
    audioControls.children[1].dispatch('click');
    assert.equal(mediaElements[1].muted, false);
    assert.equal(mediaElements[1].paused, true, 'unmuting alone never starts a preview');
    const dragEvent = audioControls.dispatch('dragstart');
    assert.equal(dragEvent.defaultPrevented, true);
    assert.equal(dragEvent.propagationStopped, true);
});

test('hidden and departing pages pause only card previews and never resume them on return', () => {
    const { document, events } = loadDomCardRuntime();
    const makeMedia = paused => ({ paused, calls: 0, pause() { this.paused = true; this.calls++; } });
    const video = makeMedia(false), audio = makeMedia(false), idle = makeMedia(true), fullPlayer = makeMedia(false);
    document.querySelectorAll = selector => {
        assert.equal(selector, '.artsoul-card-media video, .artsoul-card-audio-element');
        return [video, audio, idle];
    };
    document.hidden = true;
    events.dispatchEvent(new Event('visibilitychange'));
    assert.deepEqual([video.calls, audio.calls, idle.calls, fullPlayer.calls], [1, 1, 0, 0]);
    document.hidden = false;
    events.dispatchEvent(new Event('visibilitychange'));
    events.dispatchEvent(new Event('scroll'));
    assert.deepEqual([video.paused, audio.paused, fullPlayer.paused], [true, true, false]);
    audio.paused = false;
    events.dispatchEvent(new Event('pagehide'));
    assert.deepEqual([video.calls, audio.calls, idle.calls], [1, 2, 0]);
});

test('muted audio shows loading, progress, interruption and retry without changing mute or starting itself', async () => {
    const { api, mediaElements } = loadDomCardRuntime();
    const wrap = api.createMediaElement({ file_type: 'audio', file_url: 'music.mp3' }).children[0];
    const label = wrap.children[0];
    const [play, mute] = wrap.children.find(el => el.className === 'artsoul-card-media-controls').children;
    const [audio] = mediaElements;
    mute.dispatch('click');
    assert.equal(audio.muted, true);
    assert.equal(audio.paused, true);
    audio.readyState = 0;
    play.dispatch('click');
    assert.equal(label.textContent, 'Wait');
    audio.pause();
    audio.dispatch('timeupdate');
    assert.equal(label.textContent, '0:00');
    const originalPlay = audio.play;
    audio.play = () => Promise.reject(Object.assign(new Error(), { name: 'NotAllowedError' }));
    play.dispatch('click');
    await Promise.resolve();
    assert.equal(label.textContent, 'Retry');
    assert.equal(play['aria-label'], 'Retry audio preview');
    assert.equal(audio.paused, true);
    audio.play = originalPlay;
    audio.readyState = 4;
    play.dispatch('click');
    audio.currentTime = 66.8;
    audio.dispatch('timeupdate');
    assert.equal(label.textContent, '1:06');
    assert.equal(play['aria-label'], 'Pause audio preview');
    assert.equal(audio.muted, true);
    assert.equal(audio.paused, false);
    audio.ended = true;
    audio.dispatch('ended');
    assert.equal(label.textContent, '1:06');
});

test('an active audio preview samples the real position when timeupdate is sparse and releases the ticker on pause', () => {
    const { api, mediaElements, window, document } = loadDomCardRuntime();
    let tick;
    let clears = 0;
    window.setInterval = (callback, interval) => {
        assert.equal(interval, 1000);
        assert.equal(tick, undefined, 'only one ticker should be active');
        tick = callback;
        return 7;
    };
    window.clearInterval = id => { assert.equal(id, 7); tick = undefined; clears++; };
    const wrap = api.createMediaElement({ file_type: 'audio', file_url: 'music.mp3' }).children[0];
    const label = wrap.children[0], [audio] = mediaElements;
    Object.assign(audio, { isConnected: true, ownerDocument: document, currentTime: 0, readyState: 2 });
    assert.equal(tick, undefined);
    audio.play();
    audio.dispatch('playing');
    audio.currentTime = 4.25;
    tick();
    assert.equal(label.textContent, '0:04', 'a progressing playhead takes precedence over low readiness');
    audio.dispatch('waiting');
    tick();
    assert.equal(label.textContent, '0:04');
    audio.currentTime = 5.25;
    tick();
    assert.equal(label.textContent, '0:05');
    audio.readyState = 4;
    audio.dispatch('waiting');
    assert.equal(label.textContent, '0:05', 'a stale waiting event does not overwrite a ready stream');
    tick();
    tick();
    assert.equal(label.textContent, '0:05', 'a stationary native playhead must never gain fictitious seconds');
    audio.currentTime = 8.01;
    tick();
    assert.equal(label.textContent, '0:08');
    audio.pause();
    assert.equal(tick, undefined);
    assert.equal(clears, 1);
    assert.equal(label.textContent, '0:08');
});

test('sparse clocks stay at the last real second through pause, mute and a new Play gesture', () => {
    for (const kind of ['audio', 'video']) {
        const { api, mediaElements, window, document } = loadDomCardRuntime();
        let tick;
        window.setInterval = callback => { tick = callback; return 7; };
        window.clearInterval = () => { tick = undefined; };
        const card = api.createMediaElement({ file_type: kind, file_url: kind === 'audio' ? 'track.mp3' : 'clip.mp4' });
        const container = kind === 'audio' ? card.children[0] : card;
        const controls = container.children.find(el => el.className === 'artsoul-card-media-controls');
        const label = container.children.find(el => ['artsoul-card-audio-label', 'artsoul-card-media-badge'].includes(el.className));
        const [media] = mediaElements;
        Object.assign(media, { isConnected: true, ownerDocument: document, readyState: 4, currentTime: 3.2 });
        controls.children[0].dispatch('click');
        for (let i = 0; i < 4; i++) tick();
        assert.equal(media.paused, false, 'a sparse native clock must not interrupt audible playback');
        controls.children[0].dispatch('click');
        assert.equal(media.paused, true);
        assert.equal(controls.children[0].dataset.state, 'paused');
        assert.equal(label.textContent, '0:03');
        assert.equal(tick, undefined);
        controls.children[1].dispatch('click');
        assert.equal(media.paused, true);
        controls.children[0].dispatch('click');
        media.currentTime = 4.8;
        tick();
        assert.equal(label.textContent, '0:04');
        controls.children[0].dispatch('click');
        assert.equal(label.textContent, '0:04');
    }
});

test('only a visible playing audio interrupted by its mute gesture makes one immediate recovery attempt', () => {
    for (const [playing, interrupted, hidden, connected, ended, expected] of [
        [true, true, false, true, false, 1], [false, true, false, true, false, 0],
        [true, false, false, true, false, 0], [true, true, true, true, false, 0],
        [true, true, false, false, false, 0], [true, true, false, true, true, 0]
    ]) {
        const { api, mediaElements } = loadDomCardRuntime();
        const wrap = api.createMediaElement({ file_type: 'audio', file_url: 'music.mp3' }).children[0];
        const [, mute] = wrap.children.find(node => node.className === 'artsoul-card-media-controls').children;
        const [audio] = mediaElements;
        Object.assign(audio, { isConnected: connected, ownerDocument: { hidden }, paused: !playing, ended });
        let muted = false, attempts = 0;
        Object.defineProperty(audio, 'muted', {
            get() { return muted; },
            set(value) { muted = value; if (interrupted) this.pause(); }
        });
        audio.play = () => { attempts++; audio.paused = false; return Promise.resolve(); };
        mute.dispatch('click');
        assert.equal(attempts, expected);
        assert.equal(audio.muted, true);
        audio.dispatch('volumechange');
        assert.equal(attempts, expected, 'a later system volume event must not initiate playback');
    }
});

test('cards omit unsafe media and remove themselves when media loading fails', () => {
    const { api } = loadDomCardRuntime();
    assert.equal(api.createCardElement({ id: 'missing', title: 'Missing' }), null);

    const card = api.createCardElement({ id: 'image', title: 'Image', file_url: 'image.jpg' });
    const image = card.children[0].children[0].children[0];
    assert.equal(image.tagName, 'IMG');
    image.onerror();
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
    assert.equal(card.children[2].className, 'artsoul-card-menu');
    assert.equal(body.children[0].className, 'artsoul-card-title-row');
    assert.equal(body.children[0].children[0].className, 'artsoul-card-title');
    assert.equal(body.children[0].children[0].textContent, 'Image');
    assert.equal(body.children[1].className, 'artsoul-card-creator');
    assert.equal(body.children[1].textContent, 'Creator: 0x100000...000001');
    assert.equal(body.children[2].className, 'artsoul-card-meta');
});
