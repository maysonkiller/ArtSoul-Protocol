import test from 'node:test';
import assert from 'node:assert/strict';
import { pickHomeShowcaseSlides } from '../src/ui/home-showcase.js';

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
