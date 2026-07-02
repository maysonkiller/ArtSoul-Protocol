const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src', 'entries', 'artwork.jsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'unified-styles.css'), 'utf8');

test('artwork status is rendered once and state content is conditional', () => {
    assert.equal((source.match(/<span className=\{`artsoul-card-status/g) || []).length, 1);
    assert.match(source, /const liveAuction = Boolean/);
    assert.match(source, /\{liveAuction && \(/);
    assert.match(source, /\{awaitingPayment && \(/);
    assert.match(source, /\{mintedArtwork && \(/);
    assert.match(source, /\{canCreateNewAuction && \(/);
});

test('mobile content follows the required compact order', () => {
    const markers = [
        'artwork-mobile-media',
        'artwork-mobile-header',
        'artwork-mobile-state',
        'artwork-mobile-bids',
        'artwork-mobile-ai',
        'artwork-mobile-trust',
        'artwork-mobile-description',
        'artwork-mobile-extra',
        'artwork-mobile-back'
    ];
    const positions = markers.map(marker => source.indexOf(marker));
    positions.forEach(position => assert.notEqual(position, -1));
    assert.deepEqual([...positions].sort((a, b) => a - b), positions);

    assert.match(styles, /\.artwork-mobile-media \{ order: 1; \}/);
    assert.match(styles, /\.artwork-mobile-header \{ order: 2; \}/);
    assert.match(styles, /\.artwork-mobile-state \{ order: 3; \}/);
    assert.match(styles, /\.artwork-mobile-bids \{ order: 4; \}/);
    assert.match(styles, /\.artwork-mobile-ai \{ order: 5; \}/);
    assert.match(styles, /\.artwork-mobile-trust \{ order: 6; \}/);
    assert.match(styles, /\.artwork-mobile-description \{ order: 7; \}/);
    assert.match(styles, /\.artwork-mobile-extra \{ order: 8; \}/);
    assert.match(styles, /\.artwork-mobile-back \{ order: 10; \}/);
});

test('desktop pins the artwork viewport and scrolls only the information rail', () => {
    assert.match(styles, /\.artwork-page-root \{[\s\S]*?height: calc\(100dvh - 105px\);[\s\S]*?overflow: hidden;/);
    assert.match(styles, /\.artwork-page-left \{[\s\S]*?position: sticky;[\s\S]*?overflow: hidden;/);
    assert.match(styles, /\.artwork-page-right \{[\s\S]*?height: 100%;[\s\S]*?overflow-y: auto;/);
});

test('dead bid placeholder and dash constructions are absent', () => {
    assert.doesNotMatch(source, /No bids yet/);
    assert.doesNotMatch(source, /be the first/);
    assert.doesNotMatch(source, /[—–]/);
});
