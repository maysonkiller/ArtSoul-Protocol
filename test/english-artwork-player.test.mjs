import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync('src/ui/components/artwork-audio.js', 'utf8').replace('export const artworkAudio', 'const artworkAudio')
    + '\n' + readFileSync('src/ui/components/artwork-player.js', 'utf8')
        .replace(/^import .*;$/gm, '').replace('export function', 'function');

function fixture(kind = 'video', audioWindow = {}) {
    class Element extends EventTarget {
        constructor(tag) { super(); this.tagName = tag?.toUpperCase(); this.dataset = {}; this.attributes = {}; }
        setAttribute(name, value) { this.attributes[name] = String(value); }
        toggleAttribute(name, enabled) { if (enabled) this.setAttribute(name, ''); else this.removeAttribute(name); }
        removeAttribute(name) { delete this.attributes[name]; }
        appendChild() {}
        remove() {}
    }
    const fields = new Map();
    const control = name => {
        if (!fields.has(name)) fields.set(name, new Element());
        return fields.get(name);
    };
    const bar = new Element('div');
    bar.querySelector = control;
    const media = new Element(kind);
    Object.assign(media, {currentTime: 0, paused: true, volume: 1, duration: NaN, muted: false, playbackRate: 1, isConnected:true,
        src: 'https://storage.example/storage/v1/object/public/artworks/file.mp4?rev=2'});
    const fire = (target, type) => target.dispatchEvent(new Event(type));
    media.play = async () => { media.paused = false; fire(media, 'play'); };
    media.pause = () => { media.paused = true; fire(media, 'pause'); };
    const other = {paused:false, pause() { this.paused = true; }};
    const document = Object.assign(new EventTarget(), {
        baseURI:'https://artsoulprotocol.com/', createElement:() => bar, querySelectorAll:() => [other, media], hidden:false
    });
    const dialog = control('dialog');
    dialog.showModal = () => { dialog.open = true; };
    dialog.close = () => { dialog.open = false; };
    let Player;
    const timers = new Set();
    vm.runInNewContext(source, {window:audioWindow, HTMLElement:Element, document, customElements:{get() {}, define(name, implementation) { Player = implementation; }},
        AbortController, URL, location:new URL(document.baseURI),
        setInterval(callback) { timers.add(callback); return callback; },
        clearInterval(callback) { timers.delete(callback); }});
    const host = new Player();
    host.bind(media);
    return {host, media, other, control, fire, dialog, document, timers};
}

test('English artwork controls seek, change speed and volume, and release the previous soundtrack', () => {
    const {host,media,other,control,fire} = fixture();
    assert.equal(host.lang, 'en');
    const play = control('.artsoul-media-toggle'), seek = control('.ap-seek'), mute = control('.artsoul-media-mute');
    assert.equal(seek.disabled, true);
    media.duration = 13; fire(media, 'loadedmetadata');
    fire(play, 'click');
    assert.equal(play.attributes['aria-label'], 'Pause');
    assert.equal(media.currentTime, 0);
    assert.equal(other.paused, true);
    seek.value = '4'; fire(seek, 'input');
    assert.equal(media.currentTime, 4);
    assert.equal(seek.attributes['aria-valuetext'], '0:04 / 0:13');
    const speed = control('select'), volume = control('.ap-volume');
    speed.value = '1.5'; fire(speed, 'change'); assert.equal(media.playbackRate, 1.5);
    volume.value = '0'; fire(volume, 'input'); assert.equal(media.muted, true);
    assert.equal(mute.attributes['aria-label'], 'Unmute');
    fire(mute, 'click'); assert.equal(media.muted, false); assert.equal(media.volume, 1);
    fire(play, 'click'); assert.equal(play.attributes['aria-label'], 'Play');
    host.disconnectedCallback(); fire(play, 'click'); assert.equal(media.paused, true);
});

test('detail clocks detect real progress after buffering and stop on hiding, pause and teardown', () => {
    const {host, media, control, fire, document, timers} = fixture('audio');
    media.duration = 60;
    media.readyState = 4;
    media.play();
    fire(media, 'playing');
    fire(media, 'playing');
    assert.equal(timers.size, 1);
    media.currentTime = 3.5;
    for (const tick of timers) tick();
    assert.equal(control('.ap-time').textContent, '0:03 / 1:00');
    media.readyState = 2;
    fire(media, 'waiting');
    assert.equal(timers.size, 1);
    for (const tick of timers) tick();
    assert.equal(control('.ap-message').textContent, 'Buffering…');
    media.readyState = 4;
    media.currentTime = 4.5;
    for (const tick of timers) tick();
    assert.equal(control('.ap-time').textContent, '0:04 / 1:00');
    assert.equal(control('.ap-message').textContent, '');
    document.hidden = true;
    fire(document, 'visibilitychange');
    assert.equal(timers.size, 0);
    document.hidden = false;
    fire(document, 'visibilitychange');
    assert.equal(timers.size, 1);
    media.pause();
    assert.equal(timers.size, 0);
    media.play(); fire(media, 'playing');
    host.disconnectedCallback();
    assert.equal(timers.size, 0);
});

test('only an active connected soundtrack interrupted by the mute gesture resumes in that gesture', () => {
    for (const state of ['playing', 'paused', 'hidden', 'detached', 'ended']) {
        const {media, control, fire, document} = fixture('audio');
        document.hidden = state === 'hidden';
        media.isConnected = state !== 'detached';
        media.paused = state === 'paused';
        media.ended = state === 'ended';
        let muted = false, starts = 0;
        Object.defineProperty(media, 'muted', {
            get: () => muted,
            set(value) { muted = value; media.pause(); }
        });
        media.play = async () => { starts++; media.paused = false; };
        fire(control('.artsoul-media-mute'), 'click');
        assert.equal(starts, state === 'playing' ? 1 : 0, state);
        assert.equal(media.muted, true);
    }
});

test('Unmute renews a running track in its gesture and leaves an intentionally paused track alone', () => {
    const { media, control, fire } = fixture('AUDIO');
    let plays = 0;
    media.play = async () => { plays++; media.paused = false; };
    media.currentTime = 7;
    for (const paused of [true, false]) {
        media.paused = paused;
        media.muted = true;
        fire(control('.artsoul-media-mute'), 'click');
        assert.equal(media.muted, false);
        assert.equal(plays, paused ? 0 : 1);
        assert.equal(media.currentTime, 7);
        fire(media, 'volumechange');
        assert.equal(plays, paused ? 0 : 1);
    }
});

test('a muted MP3 that collapses from 42 seconds to 3 and then zero recovers on Play', () => {
    let gain, sourceCount = 0, resumes = 0, reloads = 0, starts = 0;
    const { media, control, fire } = fixture('audio', {
        ArtSoulStorageImage: { isValidStorageUrl: () => true },
        AudioContext: class {
            state = 'suspended';
            createGain() { return gain = { gain: { value: 1 }, connect() {}, disconnect() {} }; }
            createMediaElementSource() { sourceCount++; return { connect() {} }; }
            resume() { resumes++; this.state = 'running'; return Promise.resolve(); }
            suspend() { this.state = 'suspended'; return Promise.resolve(); }
        }
    });
    media.crossOrigin = 'anonymous';
    media.duration = 42.32;
    media.currentTime = 3;
    fire(media, 'loadedmetadata');
    fire(control('.artsoul-media-mute'), 'click');
    assert.equal(sourceCount, 0);
    media.currentTime = 3;
    media.duration = 3;
    media.ended = true;
    fire(media, 'ended');
    assert.equal(control('.ap-time').textContent, '0:03 / 0:42');
    media.duration = 0.0006;
    media.currentTime = 0;
    fire(media, 'durationchange');
    assert.equal(control('.ap-time').textContent, '0:03 / 0:42');
    assert.equal(sourceCount, 0);
    media.load = () => { reloads++; media.currentTime = 0; media.duration = NaN; };
    media.play = async () => { starts++; media.paused = false; media.ended = false; };
    fire(control('.artsoul-media-toggle'), 'click');
    assert.equal(starts, 1);
    assert.equal(reloads, 1);
    assert.equal(sourceCount, 1);
    assert.equal(resumes, 1);
    assert.equal(media.currentTime, 3);
    assert.equal(media.muted, false);
    assert.equal(gain.gain.value, 0);
    fire(media, 'volumechange');
    assert.equal(control('.artsoul-media-mute').attributes['aria-label'], 'Unmute');
    media.duration = 42.32;
    media.currentTime = 5;
    media.pause();
    fire(control('.artsoul-media-mute'), 'click');
    assert.equal(gain.gain.value, 1);
    assert.equal(starts, 1);
    fire(control('.artsoul-media-toggle'), 'click');
    assert.equal(media.currentTime, 5);
    assert.equal(reloads, 1);
    media.ended = true;
    media.currentTime = media.duration;
    fire(control('.artsoul-media-toggle'), 'click');
    assert.equal(media.currentTime, 0);
    assert.equal(reloads, 1);
});

test('fresh or replaced audio never inherits another source duration or requests a recovery output', () => {
    const { media, control, fire } = fixture('audio');
    media.duration = 60; fire(media, 'loadedmetadata');
    fire(control('.artsoul-media-mute'), 'click');
    media.src = 'https://elsewhere.example/a-short-sample.mp3';
    media.duration = 0; fire(media, 'loadedmetadata');
    assert.equal(control('.ap-time').textContent, '0:00 / –:––');
    media.duration = 0.5; fire(media, 'durationchange');
    fire(control('.artsoul-media-toggle'), 'click');
    assert.equal(media.paused, false);
    assert.equal(media.muted, true);
});

test('third-party media recovers its native source without routing cross-origin sound', () => {
    const { media, control, fire } = fixture('audio', {
        ArtSoulStorageImage: { isValidStorageUrl: () => false },
        AudioContext: class { constructor() { assert.fail('external media must use its native output'); } }
    });
    media.crossOrigin = 'anonymous';
    media.duration = 42; fire(media, 'loadedmetadata');
    fire(control('.artsoul-media-mute'), 'click');
    media.duration = 2; media.currentTime = 2; media.ended = true; fire(media, 'ended');
    let loads = 0;
    media.load = () => { loads++; media.currentTime = 0; media.duration = NaN; };
    fire(control('.artsoul-media-toggle'), 'click');
    assert.equal(loads, 1);
    assert.equal(media.muted, true);
    assert.equal(media.currentTime, 2);
    fire(media, 'emptied');
    assert.equal(control('.ap-time').textContent, '0:02 / 0:42');
});

test('audio offers a direct storage download and omits video-only controls', () => {
    const {media, control, fire, dialog} = fixture('audio');
    const options = control('.ap-options'), file = control('.ap-file');
    fire(options, 'click');
    assert.equal(dialog.open, true);
    const download = new URL(file.href);
    assert.equal(download.searchParams.get('rev'), '2');
    assert.equal(download.searchParams.has('download'), true);
    assert.equal(file.textContent, 'Download media');
    assert.equal(control('.ap-pip').hidden, true);
    assert.equal(control('.ap-full').hidden, true);
    media.src = 'https://media.example/audio.ogg'; fire(options, 'click');
    assert.equal(file.textContent, 'Open original media');
    assert.equal(file.attributes.download, undefined);
    media.src = 'javascript:void(0)'; fire(options, 'click');
    assert.equal(file.hidden, true);
});

test('public and staff playback avoids the browser-localized native controls menu', () => {
    for (const file of ['src/entries/artwork.jsx', 'src/entries/gallery.jsx', 'src/entries/index.js', 'src/features/admin/artwork-catalog.jsx']) {
        const entry = readFileSync(file, 'utf8');
        assert.doesNotMatch(entry, /<(?:audio|video)\b(?:[^>]|=>)*?\scontrols(?:\s|=|\/?>)|\.controls\s*=\s*true/, file);
        assert.match(entry, /(?:artsoul-media-player|wrapArtworkMedia)/, file);
    }
});
