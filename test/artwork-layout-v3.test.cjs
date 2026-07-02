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
    assert.match(styles, /\.artwork-page-left \{[\s\S]*?position: sticky;[\s\S]*?"media context"[\s\S]*?"media ai"[\s\S]*?"trust trust"[\s\S]*?overflow: hidden;/);
    assert.match(styles, /\.artwork-page-right \{[\s\S]*?height: 100%;[\s\S]*?overflow-y: auto;/);
    assert.match(styles, /\.artwork-page-left \.artwork-page-context \{[\s\S]*?align-self: start;[\s\S]*?height: fit-content;/);
    assert.match(styles, /\.artwork-page-left \.artwork-detail-frame \{[\s\S]*?width: 100%;[\s\S]*?height: 100%;/);
    assert.match(styles, /\.artwork-page-left \.artwork-page-trust \{[\s\S]*?width: 100%;[\s\S]*?height: 160px;/);
});

test('title, description and details share one tight transparent card with Gemini below', () => {
    assert.match(source, /className="artwork-page-panel artwork-page-context artwork-mobile-context"/);
    assert.match(source, /<h1 className="artwork-detail-title">\{artwork\.title\}<\/h1>/);
    assert.match(source, /<h2>Description<\/h2>/);
    assert.match(source, /<h2>Artwork details<\/h2>/);
    assert.doesNotMatch(source, /artwork-page-insights/);
    assert.match(source, /<h2>Community<\/h2>/);
    assert.match(source, /<h2>Gemini Analysis<\/h2>/);
    assert.match(styles, /\.artwork-page-context \{[\s\S]*?gap: 8px;[\s\S]*?padding: 12px 14px 8px !important;[\s\S]*?background: transparent !important;/);
    assert.match(styles, /\.artwork-page-left \.artwork-page-ai \{ grid-area: ai; \}/);
});

test('mobile scroll order matches the rebuilt blocks and disables motion', () => {
    const orderRules = [
        ['artwork-page-left \\.artwork-mobile-media', 'artwork-mobile-media', 1],
        ['artwork-page-left \\.artwork-mobile-context', 'artwork-mobile-context', 2],
        ['artwork-page-right \\.artwork-mobile-auction', 'artwork-mobile-auction', 3],
        ['artwork-page-right \\.artwork-mobile-people', 'artwork-mobile-people', 4],
        ['artwork-page-left \\.artwork-mobile-trust', 'artwork-mobile-trust', 5],
        ['artwork-page-left \\.artwork-mobile-ai', 'artwork-mobile-ai', 6],
        ['artwork-page-right \\.artwork-mobile-moderation', 'artwork-mobile-moderation', 7]
    ];
    orderRules.forEach(([selector, className, order]) => {
        assert.match(styles, new RegExp(`\\.${selector} \\{ order: ${order}; \\}`));
        assert.match(`${source}\n${skeleton}`, new RegExp(className));
    });
    assert.match(styles, /@media \(max-width: 900px\)[\s\S]*?\.artwork-page-layout \{[\s\S]*?align-items: stretch;/);
    assert.match(styles, /\.artwork-mobile-context,[\s\S]*?\.artwork-mobile-ai,[\s\S]*?\.artwork-mobile-moderation \{[\s\S]*?width: 100%;/);
    assert.match(styles, /animation: none !important;[\s\S]*?transition: none !important;/);
});

test('header keeps a top-right avatar button during wallet initialization', () => {
    assert.match(html, /class="artwork-header-spacer flex-1"/);
    assert.match(html, /class="artwork-header-actions flex items-center gap-3"/);
    assert.match(html, /data-avatar-render-key="initializing"/);
    assert.match(html, /class="avatar-button artwork-header-initializing-button"/);
    assert.match(html, /src="\/default-avatar\.png"/);
    assert.match(styles, /\.artwork-header-actions \{[\s\S]*?margin-left: auto;/);
});

test('image and video fill side-borderless detail frames while audio controls remain intact', () => {
    assert.match(styles, /artwork-detail-frame:not\(\.artwork-detail-frame-audio\)[\s\S]*?border-width: 1px 0;[\s\S]*?box-shadow: none;/);
    assert.match(styles, /\.artwork-page-left \.artwork-detail-media-object,[\s\S]*?object-fit: fill;/);
    assert.doesNotMatch(source, /artwork-detail-audio-title/);
    assert.match(source, /className="artwork-detail-audio-controls"/);
    assert.match(source, /className="artwork-detail-audio-player"/);
    assert.match(source, /onPlay=\{\(\) => setIsPlaying\(true\)\}/);
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
