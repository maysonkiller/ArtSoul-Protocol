const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src', 'entries', 'artwork.jsx'), 'utf8');
const skeleton = fs.readFileSync(path.join(root, 'src', 'entries', 'loading-skeletons.jsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'unified-styles.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'artwork.html'), 'utf8');

test('status and state-specific auction content are not duplicated', () => {
    assert.equal((source.match(/<span className=\{`artsoul-card-status/g) || []).length, 1);
    assert.match(source, /const liveAuction = Boolean/);
    assert.match(source, /const awaitingPayment =/);
    assert.match(source, /const mintedArtwork =/);
    assert.match(source, /\{liveAuction && \(/);
    assert.match(source, /\{listedForResale && \(/);
    assert.match(source, /\{canCreateNewAuction && \(/);
    assert.doesNotMatch(source, /No bids yet|be the first|[—–]/);
});

test('participant identities are linked names and live bids retain time and newest-first order', () => {
    assert.match(source, /href=\{`profile\.html\?address=\$\{encodeURIComponent\(address\)\}`\}/);
    assert.match(source, /getBidderDisplayName\(bid\.bidder\)/);
    assert.match(source, /formatBidTime\(bid\)/);
    assert.match(source, /Number\(right\.block_number \|\| 0\) - Number\(left\.block_number \|\| 0\)/);
    assert.match(source, /data-testid="live-auction-bid-feed"/);
});

test('desktop pins the compact left group and scrolls only the right rail', () => {
    assert.match(styles, /\.artwork-page-root \{[\s\S]*?height: calc\(100dvh - 105px\);[\s\S]*?overflow: hidden;/);
    assert.match(styles, /\.artwork-page-left \{[\s\S]*?position: sticky;[\s\S]*?overflow: hidden;/);
    assert.match(styles, /\.artwork-page-right \{[\s\S]*?height: 100%;[\s\S]*?overflow-y: auto;/);
    assert.match(styles, /font-size: clamp\(1\.35rem, 2\.25vw, 2\.15rem\)/);
    assert.match(styles, /height: clamp\(260px, 38vh, 410px\)/);
});

test('mobile order and matching skeleton keep Back last', () => {
    const orderRules = [
        ['artwork-mobile-media', 1],
        ['artwork-mobile-header', 2],
        ['artwork-mobile-auction', 3],
        ['artwork-mobile-people', 4],
        ['artwork-mobile-ai', 5],
        ['artwork-mobile-trust', 6],
        ['artwork-mobile-description', 7],
        ['artwork-mobile-extra', 8],
        ['artwork-mobile-navigation', 10]
    ];
    orderRules.forEach(([className, order]) => {
        assert.match(styles, new RegExp(`\\.${className} \\{ order: ${order}; \\}`));
        assert.match(`${source}\n${skeleton}`, new RegExp(className));
    });
    assert.ok(source.indexOf('Share on X') < source.indexOf('artwork-mobile-back'));
});

test('detail-only media controls use theme glass variables', () => {
    assert.match(styles, /--c-media-glass:/);
    assert.match(styles, /\.artwork-detail-audio-controls \{/);
    assert.match(styles, /\.artwork-detail-video::-webkit-media-controls-panel/);
    assert.match(styles, /\.artwork-detail-video-shell::after/);
    assert.match(styles, /@supports not \(\(-webkit-backdrop-filter:/);
});

test('header, footer details and navigation use the compact V3 composition', () => {
    assert.match(html, /Artwork \/ Auction, ownership, and provenance/);
    assert.doesNotMatch(source, /artwork-page-byline/);
    assert.match(source, /<h2>Artwork details<\/h2>/);
    assert.match(source, /getTokenExplorerUrl/);
    assert.match(source, /className="artwork-page-navigation artwork-mobile-navigation"/);
});
