const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src', 'entries', 'artwork.jsx'), 'utf8');
const skeleton = fs.readFileSync(path.join(root, 'src', 'entries', 'loading-skeletons.jsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'unified-styles.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'artwork.html'), 'utf8');

test('auction keeps one status and exposes each existing state action', () => {
    assert.equal((source.match(/<span className=\{`artsoul-card-status/g) || []).length, 1);
    assert.match(source, /const liveAuction = Boolean/);
    assert.match(source, /const awaitingPayment =/);
    assert.match(source, /const mintedArtwork =/);
    assert.match(source, /End Expired Auction/);
    assert.match(source, /Create New Auction/);
    assert.match(source, /Confirm the expired auction first/);
    assert.match(source, /Complete Settlement & Mint NFT/);
    assert.match(source, /Buy Now/);
});

test('profile identities and live bids are linked, named, timed, and newest first', () => {
    assert.match(source, /href=\{`profile\.html\?address=\$\{encodeURIComponent\(address\)\}`\}/);
    assert.match(source, /getProfileDisplayName/);
    assert.match(source, /label: 'Highest Bidder'/);
    assert.match(source, /label: 'First Collector'/);
    assert.doesNotMatch(source, /label: 'Winner'/);
    assert.match(source, /getBidderDisplayName\(bid\.bidder\)/);
    assert.match(source, /formatBidTime\(bid\)/);
    assert.match(source, /Number\(right\.block_number \|\| 0\) - Number\(left\.block_number \|\| 0\)/);
});

test('desktop pins the complete left composition and scrolls the right rail', () => {
    assert.match(styles, /\.artwork-page-root \{[\s\S]*?height: calc\(100dvh - 105px\);[\s\S]*?overflow: hidden;/);
    assert.match(styles, /\.artwork-page-left \{[\s\S]*?position: sticky;[\s\S]*?"media context"[\s\S]*?"insights insights"[\s\S]*?overflow: hidden;/);
    assert.match(styles, /\.artwork-page-right \{[\s\S]*?height: 100%;[\s\S]*?overflow-y: auto;/);
    assert.match(styles, /\.artwork-page-left \.artwork-page-context \{[\s\S]*?align-self: start;[\s\S]*?height: fit-content;/);
    assert.match(styles, /\.artwork-page-left \.artwork-detail-frame \{[\s\S]*?width: 100%;[\s\S]*?height: 100%;/);
    assert.match(styles, /object-fit: contain;/);
});

test('left context and insights match the requested compact grouping', () => {
    assert.match(source, /className="artwork-page-panel artwork-page-context artwork-mobile-context"/);
    assert.match(source, /<h1 className="artwork-detail-title">\{artwork\.title\}<\/h1>/);
    assert.match(source, /<h2>Description<\/h2>/);
    assert.match(source, /<h2>Artwork details<\/h2>/);
    assert.match(source, /className="artwork-page-insights artwork-mobile-insights"/);
    assert.match(source, /<h2>Community<\/h2>/);
    assert.match(source, /<h2>Gemini Analysis<\/h2>/);
    assert.match(styles, /\.artwork-page-insights \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
});

test('mobile scroll order matches the rebuilt blocks and disables motion', () => {
    const orderRules = [
        ['artwork-page-left \\.artwork-mobile-media', 'artwork-mobile-media', 1],
        ['artwork-page-left \\.artwork-mobile-context', 'artwork-mobile-context', 2],
        ['artwork-page-right \\.artwork-mobile-auction', 'artwork-mobile-auction', 3],
        ['artwork-page-right \\.artwork-mobile-people', 'artwork-mobile-people', 4],
        ['artwork-page-left \\.artwork-mobile-insights', 'artwork-mobile-insights', 5],
        ['artwork-page-right \\.artwork-mobile-moderation', 'artwork-mobile-moderation', 6]
    ];
    orderRules.forEach(([selector, className, order]) => {
        assert.match(styles, new RegExp(`\\.${selector} \\{ order: ${order}; \\}`));
        assert.match(`${source}\n${skeleton}`, new RegExp(className));
    });
    assert.match(styles, /@media \(max-width: 900px\)[\s\S]*?\.artwork-page-insights \{[\s\S]*?grid-template-columns: 1fr;/);
    assert.match(styles, /animation: none !important;[\s\S]*?transition: none !important;/);
});

test('Ownership contains Share and Back while the header subtitle and V3 player skin are gone', () => {
    assert.doesNotMatch(html, /Artwork \/ Auction, ownership, and provenance/);
    assert.match(source, /className="artwork-ownership-actions"/);
    assert.ok(source.indexOf('Share on X') < source.indexOf('artwork-mobile-back'));
    assert.doesNotMatch(source, /artwork-page-navigation/);
    assert.doesNotMatch(styles, /--c-media-glass/);
    assert.doesNotMatch(styles, /\.artwork-detail-video-shell::after/);
});

test('ISO auction timestamps bypass the legacy helper Unknown result', () => {
    assert.match(source, /const endTimeMs = normalizeAuctionTimestamp\(endTime\)/);
    assert.match(source, /String\(formatted\)\.toLowerCase\(\) !== 'unknown'/);
    assert.match(source, /return 'Syncing end time'/);
    assert.match(source, /projection\.auction_end_time,[\s\S]*?projection\.end_time,[\s\S]*?projection\.endTime/);
});
