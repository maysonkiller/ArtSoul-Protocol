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
    assert.match(source, /new Intl\.DateTimeFormat\('en-US'/);
    assert.match(source, /hour12: false/);
    assert.match(source, /Number\(right\.block_number \|\| 0\) - Number\(left\.block_number \|\| 0\)/);
});

test('desktop pins the complete left composition and scrolls the right rail', () => {
    assert.match(styles, /@media \(min-width: 901px\)[\s\S]*?\.artwork-page-root \{[\s\S]*?height: calc\(100dvh - var\(--site-header-height, 77px\)\);[\s\S]*?overflow: hidden;/);
    assert.match(styles, /@media \(min-width: 901px\)[\s\S]*?\.artwork-page-left \{[\s\S]*?position: sticky;[\s\S]*?"media context"[\s\S]*?"media ai"[\s\S]*?"trust trust"[\s\S]*?overflow: hidden;/);
    assert.match(styles, /@media \(min-width: 901px\)[\s\S]*?\.artwork-page-right \{[\s\S]*?height: 100%;[\s\S]*?overflow-y: auto;/);
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
    assert.match(styles, /\.artwork-page-left \.artwork-page-context \{[\s\S]*?display: flex;[\s\S]*?flex-direction: column;[\s\S]*?justify-content: flex-start;[\s\S]*?gap: 8px;[\s\S]*?padding: 10px 14px 6px !important;/);
    assert.match(styles, /\.artwork-page-left \.artwork-page-context > \* \{[\s\S]*?flex: 0 0 auto;/);
    assert.match(styles, /\.artwork-page-context \.artwork-page-header \{[\s\S]*?min-height: 0 !important;/);
    assert.match(styles, /\.artwork-page-left \.artwork-page-ai \{ grid-area: ai; \}/);
    assert.match(styles, /\.artwork-page-root \.artwork-page-ai \.artwork-page-copy \{[\s\S]*?font-size: 0\.86rem;/);
    assert.match(html, /unified-styles\.css\?v=42/);
});

test('mobile scroll order matches the rebuilt blocks and disables motion', () => {
    const orderRules = [
        ['artwork-page-left \\.artwork-mobile-media', 'artwork-mobile-media', 1],
        ['artwork-page-left \\.artwork-mobile-context', 'artwork-mobile-context', 2],
        ['artwork-page-right \\.artwork-mobile-auction', 'artwork-mobile-auction', 3],
        ['artwork-page-left \\.artwork-mobile-ai', 'artwork-mobile-ai', 4],
        ['artwork-page-left \\.artwork-mobile-trust', 'artwork-mobile-trust', 5],
        ['artwork-page-right \\.artwork-mobile-moderation', 'artwork-mobile-moderation', 6],
        ['artwork-page-right \\.artwork-mobile-people', 'artwork-mobile-people', 7]
    ];
    orderRules.forEach(([selector, className, order]) => {
        assert.match(styles, new RegExp(`\\.${selector} \\{ order: ${order}; \\}`));
        assert.match(`${source}\n${skeleton}`, new RegExp(className));
    });
    assert.match(styles, /@media \(max-width: 900px\)[\s\S]*?\.artwork-page-layout \{[\s\S]*?align-items: stretch;/);
    assert.match(styles, /\.artwork-mobile-context,[\s\S]*?\.artwork-mobile-ai,[\s\S]*?\.artwork-mobile-moderation \{[\s\S]*?width: 100%;/);
    assert.match(styles, /animation: none !important;[\s\S]*?transition: none !important;/);
    assert.match(styles, /\.artwork-page-root \.artwork-mobile-auction \{[\s\S]*?padding: 10px;/);
    assert.match(styles, /\.artwork-page-left \.artwork-detail-frame \{[\s\S]*?max-height: 30svh;/);
});

test('header keeps a top-right avatar button during wallet initialization', () => {
    assert.match(html, /class="site-header-row"/);
    assert.match(html, /class="site-header-logo-zone"/);
    assert.match(html, /class="site-header-actions"/);
    assert.match(html, /data-avatar-render-key="initializing"/);
    assert.match(html, /class="avatar-button"/);
    assert.match(html, /src="\/default-avatar\.png"/);
    assert.match(html, /data-avatar-name>ArtSoul Guest<\/div>/);
    assert.match(styles, /\.site-header-row \{[\s\S]*?grid-template-columns: 172px minmax\(0, 1fr\) 172px;/);
    assert.match(styles, /\.site-header-actions \{[\s\S]*?justify-content: flex-end;/);
    assert.match(styles, /\.site-header \.site-logo,[\s\S]*?width: 56px !important;[\s\S]*?height: 56px !important;/);
    assert.match(styles, /\.site-header #navButtons,[\s\S]*?width: 164px !important;[\s\S]*?height: 42px !important;/);
    assert.match(styles, /@media \(max-width: 768px\)[\s\S]*?\.site-header #navButtons,[\s\S]*?width: 48px !important;[\s\S]*?height: 44px !important;/);
});

test('images keep their aspect ratio and use an in-page lightbox while video and audio controls remain intact', () => {
    assert.match(styles, /artwork-detail-frame:not\(\.artwork-detail-frame-audio\)[\s\S]*?border-width: 1px 0;[\s\S]*?box-shadow: none;/);
    assert.match(styles, /\.artwork-page-left \.artwork-detail-media-object,[\s\S]*?object-fit: cover;/);
    assert.match(styles, /\.artwork-page-left \.artwork-detail-image \{[\s\S]*?object-fit: cover;/);
    assert.match(source, /className="artwork-detail-media-object artwork-detail-image artwork-detail-image-zoomable"/);
    assert.match(source, /window\.ReactDOM\?\.createPortal\?/);
    assert.match(source, /className="artwork-image-lightbox"/);
    assert.match(source, /className="artwork-image-lightbox-close"/);
    assert.doesNotMatch(source, /href=\{url\}/);
    assert.doesNotMatch(source, /requestFullscreen/);
    assert.match(styles, /\.artwork-image-lightbox \{[\s\S]*?position: fixed;/);
    assert.match(styles, /\.artwork-image-lightbox-media \{[\s\S]*?object-fit: contain;/);
    assert.match(styles, /\.artwork-detail-video:fullscreen,[\s\S]*?object-fit: contain !important;/);
    assert.doesNotMatch(source, /artwork-detail-audio-title/);
    assert.match(source, /className="artwork-detail-audio-controls"/);
    assert.match(source, /className="artwork-detail-audio-player"/);
    assert.match(source, /onPlay=\{\(\) => setIsPlaying\(true\)\}/);
});

test('Community aligns one number over each action without duplicate signal labels', () => {
    assert.match(source, /className="artwork-page-signal-actions"/);
    assert.equal((source.match(/className="artwork-page-signal-action"/g) || []).length, 3);
    assert.doesNotMatch(source, /<span>Likes<\/span>/);
    assert.doesNotMatch(source, /<span>Would Buy<\/span>/);
    assert.doesNotMatch(source, /<span>Watching<\/span>/);
    assert.match(styles, /\.artwork-page-signal-action \{[\s\S]*?grid-template-rows: 26px auto;[\s\S]*?align-items: center;/);
    assert.match(styles, /\.artwork-page-signal-action strong \{[\s\S]*?width: 100%;[\s\S]*?text-align: center;/);
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
