import test from 'node:test';
import assert from 'node:assert/strict';
import { pickHomeShowcaseSlides, shouldAutoAdvanceShowcase, renderHomeShowcase, HOME_SHOWCASE_CYCLE_MS } from '../src/ui/home-showcase.js';
import { readFileSync } from 'node:fs';

const ART = (id, extra = {}) => ({ id, title: `Artwork ${id}`, source: 'v41_projection', ...extra });
const SLOT = (artwork, label = 'Discovery Spotlight') => ({ artwork, label, reason: 'Public art' });
const helpers = {
    mediaDescriptor: (a) => ({ type: a.type || 'image', thumbnailUrl: a.image || 'https://media.test/' + a.id + '.png', poster: a.poster }),
    isValidStorageUrl: (url) => typeof url === 'string' && url.startsWith('https://media.test/'),
    artworkPath: (id) => '/artwork/' + id,
    isHidden: (a) => a.is_hidden === true,
    creatorLabel: (a) => a.creator || 'Artist'
};

test('showcase never invents items and stays empty when the public feed is empty', () => {
    assert.deepEqual(pickHomeShowcaseSlides([], helpers), []);
    assert.deepEqual(pickHomeShowcaseSlides([SLOT(null), SLOT(undefined)], helpers), []);
    assert.deepEqual(pickHomeShowcaseSlides([SLOT(ART(1))], {}), []);
});

test('reuses the ranked slots without any extra database call, preserves labels and caps four', () => {
    const list = Array.from({ length: 8 }, (_, i) => SLOT(ART(i + 1), i === 0 ? 'Featured Auction' : 'Discovery Spotlight'));
    const selected = pickHomeShowcaseSlides(list, helpers);
    assert.equal(selected.length, 4);
    assert.equal(selected[0].title, 'Artwork 1');
    assert.equal(selected[0].label, 'Featured Auction');
    assert.equal(selected[3].href, '/artwork/4');
    assert.equal(selected[0].creator, 'Artist');
});

test('no hidden, unindexed pending, duplicate or unsafe remote media enters the showcase', () => {
    const slots = [
        SLOT(ART(1, { is_hidden: true })),
        SLOT(ART(2, { source: 'pending_indexer' })),
        SLOT(ART(3, { image: 'https://evil.test/3.png' })),
        SLOT(ART(4, { title: '' })),
        SLOT(ART(5)), SLOT(ART(5)), SLOT(ART(6))
    ];
    assert.deepEqual(pickHomeShowcaseSlides(slots, helpers).map(x => x.title), ['Artwork 5', 'Artwork 6']);
});

test('video uses an existing safe static poster; audio and GIF are never background autoplay', () => {
    const selected = pickHomeShowcaseSlides([
        SLOT(ART(1, { type: 'video', poster: 'https://media.test/poster.webp' })),
        SLOT(ART(2, { type: 'video', poster: 'https://evil.test/poster.webp' })),
        SLOT(ART(3, { type: 'audio' })),
        SLOT(ART(4, { type: 'gif' }))
    ], helpers);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].image, 'https://media.test/poster.webp');
});

test('blocks unsafe destinations and malformed metadata instead of executing markup', () => {
    const malicious = SLOT(ART(1, { title: '<img src=x onerror=alert(1)>' }));
    assert.deepEqual(pickHomeShowcaseSlides([malicious], { ...helpers, artworkPath: () => 'javascript:alert(1)' }), []);
    // Text is only data: the renderer owns DOM nodes and uses textContent.
    assert.equal(pickHomeShowcaseSlides([malicious], helpers)[0].title, '<img src=x onerror=alert(1)>');
});


test('eight-second carousel interval supports both modes; pauses for motion preference, focus and hover', () => {
    assert.equal(HOME_SHOWCASE_CYCLE_MS, 8000);
    assert.equal(shouldAutoAdvanceShowcase({ slideCount: 3 }), true);
    for (const state of [
        { slideCount: 1 },
        { slideCount: 3, visibility: 'hidden' },
        { slideCount: 3, reducedMotion: true },
        { slideCount: 3, hovered: true },
        { slideCount: 3, focused: true },
        { slideCount: 3, paused: true }
    ]) assert.equal(shouldAutoAdvanceShowcase(state), false, JSON.stringify(state));
});

function renderedShowcaseHarness(mode = 'classic', reducedMotion = false) {
    class Element {
        constructor(tagName = 'div') {
            this.tagName = tagName;
            this.children = [];
            this.parentNode = null;
            this.dataset = {};
            this.attributes = {};
            this.hidden = false;
            this.listeners = new Map();
            this.textContent = '';
            this.title = '';
            this.hovered = false;
        }
        append(...nodes) { for (const child of nodes) { this.children.push(child); child.parentNode = this; } }
        appendChild(node) { this.append(node); }
        replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
        remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(x => x !== this); }
        querySelector(query) {
            if (query === 'img[data-showcase-src]') return this.children.find(x => x.tagName === 'img' && x.dataset.showcaseSrc) || null;
            return null;
        }
        setAttribute(name, value) { this.attributes[name] = String(value); }
        getAttribute(name) { return name === 'src' ? this.src || null : this.attributes[name] ?? null; }
        addEventListener(name, fn) { this.listeners.set(name, fn); }
        removeEventListener(name, fn) { if (this.listeners.get(name) === fn) this.listeners.delete(name); }
        matches(selector) { return selector === ':hover' && this.hovered; }
        contains(element) { return element === this || this.children.some(child => child.contains(element)); }
        fire(name, event = {}) { this.listeners.get(name)?.(event); }
    }

    const ids = Object.fromEntries([
        'homeShowcase', 'homeShowcaseStage', 'homeShowcaseIntro',
        'homeShowcaseControls', 'homeShowcasePrev', 'homeShowcaseNext',
        'homeShowcaseCount', 'homeShowcaseStatus'
    ].map(id => [id, new Element()]));
    ids.homeShowcase.append(ids.homeShowcaseIntro, ids.homeShowcaseStage, ids.homeShowcaseControls);
    ids.homeShowcaseControls.append(ids.homeShowcasePrev, ids.homeShowcaseCount, ids.homeShowcaseNext);
    let counter = 0;
    const timers = new Map(), durations = [];
    const window = {
        ArtSoulArtworkCard: {
            mediaDescriptor: helpers.mediaDescriptor, isHidden: helpers.isHidden, creatorLabel: helpers.creatorLabel
        },
        ArtSoulArtworkUrl: { artworkPath: helpers.artworkPath },
        ArtSoulSecurity: { isValidStorageUrl: helpers.isValidStorageUrl },
        matchMedia: () => ({ matches: reducedMotion, addEventListener() {}, removeEventListener() {} }),
        setInterval(fn, ms) { timers.set(++counter, fn); durations.push(ms); return counter; },
        clearInterval(id) { timers.delete(id); },
        addEventListener() {}, removeEventListener() {}
    };
    const document = {
        visibilityState: 'visible', activeElement: null,
        documentElement: { classList: { contains: name => name === mode } },
        getElementById: id => ids[id],
        createElement: tag => new Element(tag),
        listeners: new Map(),
        addEventListener(name, fn) { this.listeners.set(name, fn); },
        removeEventListener(name, fn) { if (this.listeners.get(name) === fn) this.listeners.delete(name); },
        fire(name) { this.listeners.get(name)?.(); }
    };
    return { window, document, ids, timers, durations };
}

test('rendered carousel actually changes slides every eight seconds in both Classic and Future', () => {
    const originalWindow = globalThis.window, originalDocument = globalThis.document;
    try {
        for (const theme of ['classic', 'future']) {
            const h = renderedShowcaseHarness(theme);
            globalThis.window = h.window;
            globalThis.document = h.document;
            renderHomeShowcase([SLOT(ART(1)), SLOT(ART(2)), SLOT(ART(3))]);
            assert.equal(h.ids.homeShowcaseStage.children.length, 3);
            assert.equal(h.ids.homeShowcaseCount.textContent, '1 / 3');
            assert.deepEqual(h.durations, [8000]);
            assert.equal(h.timers.size, 1);
            [...h.timers.values()][0]();
            assert.equal(h.ids.homeShowcaseCount.textContent, '2 / 3', theme);
            h.ids.homeShowcaseCount.onclick();
            assert.equal(h.ids.homeShowcaseCount.attributes['aria-pressed'], 'true');
            assert.equal(h.timers.size, 0);
            h.document.activeElement = h.ids.homeShowcaseCount;
            h.ids.homeShowcaseCount.onclick();
            assert.equal(h.timers.size, 1, 'explicit resume must function with focus on pause');
            h.ids.homeShowcase.fire('focusin', { target: h.ids.homeShowcaseNext });
            assert.equal(h.timers.size, 0, 'navigating between controls stops auto-rotation');
            h.document.activeElement = null;
            h.ids.homeShowcase.fire('focusout', { relatedTarget: null });
            assert.equal(h.timers.size, 0, 'keyboard focus pause persists after focus leaves');
            h.ids.homeShowcaseCount.onclick();
            assert.equal(h.timers.size, 1, 'only explicit resume restarts the rotation');
            h.document.visibilityState = 'hidden';
            h.document.fire('visibilitychange');
            assert.equal(h.timers.size, 0, 'hidden tabs do not keep an interval');
        }
    } finally {
        globalThis.window = originalWindow;
        globalThis.document = originalDocument;
    }
});

test('reduced-motion users retain manual navigation without autoplay', () => {
    const oldW = globalThis.window, oldD = globalThis.document;
    try {
        const h = renderedShowcaseHarness('future', true);
        globalThis.window = h.window;
        globalThis.document = h.document;
        renderHomeShowcase([SLOT(ART(1)), SLOT(ART(2))]);
        assert.equal(h.timers.size, 0);
        h.ids.homeShowcaseNext.onclick();
        assert.equal(h.ids.homeShowcaseCount.textContent, '2 / 2');
        renderHomeShowcase([], { unavailable: true });
        assert.equal(h.ids.homeShowcaseStage.hidden, true);
        assert.match(h.ids.homeShowcaseStatus.textContent, /temporarily unavailable/);
    } finally {
        globalThis.window = oldW;
        globalThis.document = oldD;
    }
});

test('homepage keeps one editorial line and removes the demo slide and repeated feed', () => {
    const home = readFileSync('index.html', 'utf8');
    const css = readFileSync('unified-styles.css', 'utf8');
    assert.match(home, />Discovery-First Auctions for Digital Art<\/h1>/);
    assert.doesNotMatch(home, />Discover artworks[.]?<\/h1>/);
    assert.match(home, /Collector demand comes before minting/);
    for (const repeat of [
        'Art worth a closer look.', 'Find your next connection', 'Art to discover, auctions to follow.',
        'Bring new art into discovery', 'CURATED DISCOVERY', 'homepageFeaturedSection'
    ]) assert.equal(home.includes(repeat), false, repeat);
    assert.match(css, /#homeSection \.home-hero-copy \{[\s\S]*?text-align: left !important;/);
});

test('touch tapping Pause cannot be misread as keyboard focus Resume', () => {
    const oldW = globalThis.window, oldD = globalThis.document;
    try {
        const h = renderedShowcaseHarness('classic', false);
        globalThis.window = h.window;
        globalThis.document = h.document;
        renderHomeShowcase([SLOT(ART(1)), SLOT(ART(2))]);
        assert.equal(h.timers.size, 1);
        h.ids.homeShowcase.fire('pointerdown', {});
        h.document.activeElement = h.ids.homeShowcaseCount;
        h.ids.homeShowcase.fire('focusin', { target: h.ids.homeShowcaseCount });
        h.ids.homeShowcaseCount.onclick();
        assert.equal(h.ids.homeShowcaseCount.attributes['aria-pressed'], 'true');
        assert.equal(h.timers.size, 0, 'single iPhone tap should pause carousel');
        h.ids.homeShowcase.fire('pointerup', {});
        h.ids.homeShowcaseCount.onclick();
        assert.equal(h.ids.homeShowcaseCount.attributes['aria-pressed'], 'false');
        assert.equal(h.timers.size, 1, 'explicit resume still starts while pause retains focus');
    } finally {
        globalThis.window = oldW;
        globalThis.document = oldD;
    }
});

test('counter is the only pause control and no opaque pause icon is rendered', () => {
    const html = readFileSync('index.html', 'utf8');
    const start = html.indexOf('id="homeShowcaseControls"');
    const end = html.indexOf('</div>', start);
    const markup = start >= 0 && end > start ? html.slice(start, end + 6) : '';
    assert.doesNotMatch(markup, /homeShowcasePause|>Ⅱ<|>▶</);
    assert.match(markup, /<button id="homeShowcaseCount"[^>]*aria-pressed="false"/);
    assert.equal((markup.match(/<button /g) || []).length, 3);
});

test('restored founder copy and caption readability are protected by a theme-token scrim', () => {
    const html = readFileSync('index.html','utf8');
    const css = readFileSync('unified-styles.css','utf8');
    assert.match(html, />Discovery-First Auctions for Digital Art<\/h1>/);
    assert.doesNotMatch(html, />Discover artworks[.]?<\/h1>/);
    assert.match(css, /B18\.2 — one measured visual system/);
    assert.match(css, /\.home-showcase-slide::after \{[\s\S]*?pointer-events: none;[\s\S]*?linear-gradient/);
    assert.match(css, /\.home-showcase-caption \{[\s\S]*?z-index: 2;[\s\S]*?padding: 38px 22px 72px/);
    assert.match(css, /-webkit-line-clamp: 2;/);
    assert.match(css, /#homeShowcaseControls \{[\s\S]*?z-index: 3;/);
});
