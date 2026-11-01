const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const source = fs.readFileSync(path.join(__dirname, '..', 'src/entries/artwork.jsx'), 'utf8');
const CREATOR = '0x111100000000000000000000000000000000aaaa';
const COLLECTOR = '0x222200000000000000000000000000000000bbbb';
const BUYER = '0x333300000000000000000000000000000000cccc';
const ZERO = '0x0000000000000000000000000000000000000000';
let panelCode;

function extractFunction(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1);
    let depth = 0;
    let end = source.indexOf('{', source.indexOf(')', start));
    for (; end < source.length; end++) {
        if (source[end] === '{') depth++;
        if (source[end] === '}' && --depth === 0) break;
    }
    return source.slice(start, end + 1);
}

function declaration(name) {
    const start = source.indexOf(`            const ${name} =`);
    assert.notEqual(start, -1);
    const end = source.indexOf('\n            );', start);
    assert.notEqual(end, -1);
    return source.slice(start, end + '\n            );'.length);
}

test.before(async () => {
    const { transformWithOxc } = await import('vite');
    const aliases = source.slice(source.indexOf('const DetailsPanel ='), source.indexOf('const detailsPanel ='));
    panelCode = (await transformWithOxc([
        ...['OwnershipIdentity', 'isZeroAddress', 'isSameAddress', 'shouldShowOwnerRole', 'renderOwnershipRole'].map(extractFunction),
        aliases,
        ...['detailsPanel', 'guidancePanel', 'ownershipPanel', 'provenancePanel'].map(declaration),
        'globalThis.panels = { detailsPanel, guidancePanel, ownershipPanel, provenancePanel };'
    ].join('\n'), 'artwork-panels.jsx', { jsx: { runtime: 'classic' } })).code;
});

function render(overrides = {}) {
    const context = vm.createContext({
        React, ZERO_ADDRESS: ZERO,
        useDecodedImage: () => ({ url: '/default-avatar.png' }), prepareAvatar() {}, readPreparedAvatar() {},
        getProfileAvatarUrl: () => '/default-avatar.png',
        getProfileDisplayName: (profile, address) => profile?.display_name || address,
        artwork: { auction_winner_address: COLLECTOR, creator_id: CREATOR, artwork_id: '42', token_id: '7' },
        isClassic: false, mintedArtwork: true, awaitingPayment: false,
        creatorAddress: CREATOR, ownerAddress: COLLECTOR, winnerAddress: COLLECTOR,
        creatorProfile: null, auctionWinnerProfile: null, currentOwnerProfile: null,
        resolvedProfileAddresses: new Set([CREATOR, COLLECTOR, BUYER]), bidderProfiles: {},
        resolvedMedia: { type: 'image' }, describeArtworkNetwork: () => 'Base Sepolia', tokenExplorerUrl: '',
        aiGuidance: null, formatAIPrice: String, isV41CompositeId: true,
        provenanceState: { status: 'ready', events: [], complete: true },
        ...overrides
    });
    vm.runInContext(panelCode, context);
    return Object.fromEntries(Object.entries(context.panels).map(([key, element]) => [key, renderToStaticMarkup(element)]));
}

test('the same collector and owner retain both labels in one actual profile link, case independently', () => {
    for (const isClassic of [true, false]) {
        const html = render({ isClassic, ownerAddress: COLLECTOR.toUpperCase() }).ownershipPanel;
        assert.match(html, />First Collector · Owner<\/div>/);
        assert.equal((html.match(/href="\/profile\?address=/g) || []).length, 2);
        assert.equal((html.match(/>Owner<\/div>/g) || []).length, 0);
        assert.match(html, new RegExp(`href="/profile\\?address=${COLLECTOR}"`));
    }
});

test('buyback and later transfer preserve the first collector and separate current owner', () => {
    for (const ownerAddress of [CREATOR, BUYER]) {
        const html = render({ ownerAddress }).ownershipPanel;
        assert.match(html, />First Collector<\/div>/);
        assert.match(html, />Owner<\/div>/);
        assert.doesNotMatch(html, /First Collector · Owner/);
        assert.equal((html.match(/href="\/profile\?address=/g) || []).length, 3);
    }
});

test('missing owner data and pre-settlement bidders never imply current ownership', () => {
    for (const ownerAddress of [null, '', ZERO]) {
        const html = render({ ownerAddress }).ownershipPanel;
        assert.match(html, />First Collector<\/div>/);
        assert.doesNotMatch(html, /· Owner|>Owner<\/div>/);
    }
    const pending = render({ mintedArtwork: false, awaitingPayment: true }).ownershipPanel;
    assert.match(pending, />Highest Bidder<\/div>/);
    assert.doesNotMatch(pending, /First Collector|· Owner|>Owner<\/div>/);
});

test('profile text remains escaped in combined identity rows', () => {
    const html = render({ auctionWinnerProfile: { display_name: '<img src=x onerror=alert(1)>' } }).ownershipPanel;
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.doesNotMatch(html, /<img src=x/);
});

test('both themes use native initially closed guidance and metadata with initially open history', () => {
    for (const isClassic of [true, false]) {
        const panels = render({ isClassic });
        for (const key of ['detailsPanel', 'guidancePanel']) {
            assert.match(panels[key], /^<details\b/);
            assert.match(panels[key], /<summary\b/);
            assert.doesNotMatch(panels[key], /<details[^>]*\bopen=/);
        }
        assert.match(panels.provenancePanel, /^<details open=""/);
        assert.match(panels.provenancePanel, /<summary\b[^>]*><h3 id="provenanceTitle"/);
        assert.match(panels.provenancePanel, /No indexer history is available yet/);
        assert.match(panels.guidancePanel, /Guidance only\. It does not affect settlement, floor, royalties, or mint rights/);
    }
});

test('both themes keep creator and collector identities outside collapsed details', () => {
    for (const isClassic of [true, false]) {
        const html = render({ isClassic }).ownershipPanel;
        assert.match(html, /^<div class="artwork-page-panel artwork-page-people/);
        assert.match(html, />Creator<\/div>/);
        assert.match(html, />First Collector · Owner<\/div>/);
        assert.doesNotMatch(html, /<details|<summary/);
    }
});

test('the layout reuses each keyed panel and keeps a single support/media/action implementation', () => {
    assert.match(source, /\{\[mediaPanel, contextPanel, ownershipPanel, auctionPanel, communityPanel, provenancePanel, guidancePanel, detailsPanel\]\}/);
    assert.doesNotMatch(source, /\{isClassic && detailsPanel\}|\? \[ownershipPanel, provenancePanel, auctionPanel\]/);
    assert.equal((source.match(/<MediaViewer\b/g) || []).length, 1);
    assert.equal((source.match(/<ArtistSupport\b/g) || []).length, 1);
    assert.equal((source.match(/id="artwork-actions"/g) || []).length, 1);
    const community = declaration('communityPanel');
    assert.match(community, /<details className="artwork-community-help">\s*<summary>About community signals<\/summary>/);
    assert.match(community, /href="\/docs-protocol#trust-community"/);
    assert.match(community, /does not place a bid or make a purchase/);
});
