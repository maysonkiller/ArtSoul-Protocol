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
let projectedArtworkAura;

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
    ({ projectedArtworkAura } = await import('../src/ui/components/aura-frame.js'));
    const network = source.slice(source.indexOf('const historyNetwork ='), source.indexOf('const recordedNftSale ='));
    const aliases = source.slice(source.indexOf('const DetailsPanel ='), source.indexOf('const detailsPanel ='));
    panelCode = (await transformWithOxc([
        ...['OwnershipIdentity', 'isZeroAddress', 'isSameAddress', 'shouldShowOwnerRole', 'renderOwnershipRole'].map(extractFunction),
        ...['normalizeTimestampMs', 'formatProvenanceTime', 'provenanceEventView', 'transactionExplorerUrl',
            'getTokenExplorerUrl', 'renderProvenanceAddress'].map(extractFunction),
        network,
        aliases,
        ...['detailsPanel', 'guidancePanel', 'ownershipPanel', 'provenancePanel'].map(declaration),
        'globalThis.panels = { detailsPanel, guidancePanel, ownershipPanel, provenancePanel };'
    ].join('\n'), 'artwork-panels.jsx', { jsx: { runtime: 'classic' } })).code;
});

test('an open detail refreshes its actions at expiry and stops its countdown until default is eligible', async t => {
    const { transformWithOxc } = await import('vite');
    const { code } = await transformWithOxc(extractFunction('AuctionPhaseCountdown'), 'countdown.jsx', { jsx: { runtime: 'classic' } });
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1850000000000 });
    const context = vm.createContext({ React, window: {}, Date, setTimeout, clearTimeout });
    vm.runInContext(code, context);

    function mount(graceMs) {
        let now, cleanup;
        const boundaries = [];
        context.useState = initial => [now ?? initial(), value => { now = value; }];
        context.useEffect = start => { cleanup ??= start(); };
        const deadline = Date.now() + 1250;
        const props = { deadline, graceMs, onBoundary: time => boundaries.push(time) };
        const render = () => renderToStaticMarkup(context.AuctionPhaseCountdown(props));
        assert.match(render(), /role="timer"/);
        return { render, deadline, boundaries, unmount: () => cleanup() };
    }

    const bidding = mount(0);
    t.mock.timers.tick(1249);
    assert.match(bidding.render(), /1s/);
    t.mock.timers.tick(1);
    assert.equal(bidding.render(), '');
    assert.deepEqual(bidding.boundaries, [bidding.deadline]);
    bidding.unmount();

    const payment = mount(60000);
    t.mock.timers.tick(1250);
    assert.equal(payment.render(), 'Payment deadline reached');
    assert.deepEqual(payment.boundaries, [payment.deadline]);
    t.mock.timers.tick(60000);
    assert.equal(payment.boundaries.length, 1);
    t.mock.timers.tick(1);
    assert.deepEqual(payment.boundaries, [payment.deadline, payment.deadline + 60001]);
    t.mock.timers.tick(120000);
    assert.equal(payment.boundaries.length, 2);
    payment.unmount();

    const removed = mount(60000);
    removed.unmount();
    t.mock.timers.tick(120000);
    assert.deepEqual(removed.boundaries, []);
});

test('auction facts identify the recorded network in live, payment and resale states', async () => {
    const { transformWithOxc } = await import('vite');
    const auctionPanel = declaration('auctionPanel');
    const start = auctionPanel.indexOf('<div className="space-y-3">');
    const end = auctionPanel.indexOf('<div className="context-help-label artwork-payment-help">');
    const network = source.slice(source.indexOf('const historyNetwork ='), source.indexOf('const tokenExplorerUrl ='));
    const { code } = await transformWithOxc(network + '\nglobalThis.facts = ' + auctionPanel.slice(start, end),
        'auction-facts.jsx', { jsx: { runtime: 'classic' } });

    for (const [chainId, currency] of [[84532, 'test ETH'], [11155111, 'test ETH'], [null, 'ETH']]) {
        for (const state of ['live', 'awaiting', 'listed']) {
            const context = vm.createContext({React, artwork: {chain_id: chainId, floor_price: '5', sale_price: '6'},
                getAuctionActionId: () => '75', startingPrice: '0.001', currentHighestBid: '0.001000000000000001',
                currentHighestBidWei: 1000000000000001n, hasAuctionBids: true, liveAuction: state === 'live', awaitingPayment: state === 'awaiting',
                settlementDeadlineMs: 0, AuctionPhaseCountdown: () => '2h', normalizeAuctionTimestamp: () => 0,
                refreshAuctionPhase() {}, minimumBidDetails: {eth: '0.011000000000000001'},
                auction: {depositAmount: '0.01'}, mintedArtwork: state === 'listed', listedForResale: state === 'listed',
                finalPrice: '4'});
            vm.runInContext(code, context);
            const html = renderToStaticMarkup(context.facts);
            const amounts = state === 'live' ? ['0.001', '0.001000000000000001', '0.011000000000000001', '0.01']
                : state === 'awaiting' ? ['0.001', '0.001000000000000001'] : ['0.001', '4', '5', '6'];
            for (const amount of amounts) assert.ok(html.includes(`>${amount} ${currency}<`), `${state}: ${amount} ${currency}`);
        }
    }
});

function render(overrides = {}) {
    const context = vm.createContext({
        React, URL, ZERO_ADDRESS: ZERO,
        window: { ARTSOUL_CONTRACTS: { baseSepolia: { nft: CREATOR }, sepolia: { nft: CREATOR } } },
        useDecodedImage: () => ({ url: '/default-avatar.png' }), prepareAvatar() {}, readPreparedAvatar() {},
        getProfileAvatarUrl: () => '/default-avatar.png',
        getProfileDisplayName: (profile, address) => profile?.display_name || address,
        artwork: { auction_winner_address: COLLECTOR, creator_id: CREATOR, artwork_id: '42', token_id: '7', chain_id: 84532 },
        isClassic: false, mintedArtwork: true, awaitingPayment: false,
        creatorAddress: CREATOR, ownerAddress: COLLECTOR, winnerAddress: COLLECTOR,
        creatorProfile: null, auctionWinnerProfile: null, currentOwnerProfile: null,
        resolvedProfileAddresses: new Set([CREATOR, COLLECTOR, BUYER]), bidderProfiles: {},
        resolvedMedia: { type: 'image' }, describeArtworkNetwork: () => 'Base Sepolia', recordedNftSale: null,
        aiGuidance: null, formatAIPrice: String, isV41CompositeId: true,
        provenanceState: { status: 'ready', events: [], complete: true },
        ...overrides
    });
    context.aura = projectedArtworkAura(context.artwork);
    vm.runInContext(panelCode, context);
    return Object.fromEntries(Object.entries(context.panels).map(([key, element]) => [key, renderToStaticMarkup(element)]));
}

test('the details panel links an eligible frame to the frame legend', () => {
    assert.doesNotMatch(render().detailsPanel, /#nft-frames/);
    const artwork = { chain_id: 84532, source: 'v41_projection', ownership_status: 'verified', minted: true, aura_kind: 'platform' };
    assert.match(render({ artwork }).detailsPanel, /href="\/docs-protocol#nft-frames">ArtSoul platform NFT/);
});

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
        assert.match(panels.provenancePanel, /No events recorded yet/);
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

test('the artwork distinguishes a missing saved estimate from unavailable metadata and shows its published inputs', () => {
    const artwork = { chain_id: 84532, ai_guidance_status: 'not_recorded', published_creator_value: '0.000010000000000001', start_price: '9' };
    const historical = render({ artwork });
    assert.match(historical.guidancePanel, /No AI estimate was saved in the published metadata/);
    assert.match(historical.detailsPanel, /Creator’s value at publication<\/dt><dd>0\.000010000000000001 test ETH/);
    assert.match(render({ artwork: { ai_guidance_status: 'unavailable' } }).guidancePanel, /AI analysis is unavailable/);
    const recorded = render({ artwork, aiGuidance: {
        estimated_value_min_eth: 1, estimated_value_max_eth: 2, suggested_start_price_eth: 1,
        rationale: 'An original recording.', factors: ['Distinct rhythm'], risk_flags: ['Limited frame sample']
    } }).guidancePanel;
    assert.match(recorded, /Assessment factors<\/h3>.*Distinct rhythm/);
    assert.match(recorded, /Limitations<\/h3>.*Limited frame sample/);
    assert.doesNotMatch(recorded, /unavailable|No AI estimate/);
});

test('the layout reuses each keyed panel and keeps a single support/media/action implementation', () => {
    const layout = source.slice(source.indexOf('<div className="artwork-page-layout">'), source.indexOf('</main>', source.indexOf('<div className="artwork-page-layout">')));
    assert.match(layout, /\{mediaPanel\}\s*\{!twoColumns && \[contextPanel, ownershipPanel, auctionPanel\]\}\s*\{communityPanel\}\s*\{provenancePanel\}/);
    assert.match(layout, /artwork-page-right">\s*\{twoColumns && \[contextPanel, ownershipPanel, auctionPanel\]\}\s*\{guidancePanel\}\s*\{detailsPanel\}/);
    assert.doesNotMatch(source, /\{isClassic && detailsPanel\}|\? \[ownershipPanel, provenancePanel, auctionPanel\]/);
    assert.equal((source.match(/<MediaViewer\b/g) || []).length, 1);
    assert.equal((source.match(/<ArtistSupport\b/g) || []).length, 1);
    assert.equal((source.match(/id="artwork-actions"/g) || []).length, 1);
    const community = declaration('communityPanel');
    assert.equal((community.match(/<ContextHelp topic="reactions"/g) || []).length, 1);
    assert.equal((community.match(/<ContextHelp topic="trust"/g) || []).length, 1);
});

test('NFT details distinguish unavailable sale history from an absent sale and unminted artwork', () => {
    for (const [state, copy] of [
        [{ status: 'loading', events: [], complete: true }, 'Loading history…'],
        [{ status: 'idle', events: [], complete: false }, 'History unavailable'],
        [{ status: 'unavailable', events: [], complete: false }, 'History unavailable'],
        [{ status: 'ready', events: [], complete: false }, 'History incomplete'],
        [{ status: 'ready', events: [], complete: true }, 'Not recorded']
    ]) {
        const html = render({ provenanceState: state }).detailsPanel;
        assert.ok(html.includes(copy));
        assert.doesNotMatch(html, /0 ETH|You paid|Sale receipt/);
    }
    assert.doesNotMatch(render({ mintedArtwork: false }).detailsPanel, /NFT contract|Token ID|Last ArtSoul sale/);
});

test('NFT details display exact test currency, contract and sale receipt without implying personal acquisition', () => {
    const hash = `0x${'ab'.repeat(32)}`;
    const receipt = `https://sepolia.basescan.org/tx/${hash}`;
    const html = render({
        artwork: { chainId: 84532, token_id: '7' },
        recordedNftSale: { amount: '0.000000000000000001', venue: 'ArtSoul primary auction', event: { transaction_hash: hash } }
    }).detailsPanel;
    assert.match(html, /0\.000000000000000001 test ETH/);
    assert.match(html, /ArtSoul primary auction/);
    assert.ok(html.includes(`href="${receipt}"`));
    assert.match(html, /Wallet transfers do not record a purchase price/);
    assert.doesNotMatch(html, /You paid|Your purchase/);
});

test('recorded prices and receipt links follow the artwork chain on both history surfaces', () => {
    const hash = `0x${'ab'.repeat(32)}`;
    const amount = '0.000000000000000001';
    const event = { type: 'resale_completed', price: amount, transaction_hash: hash, block_number: 17 };
    for (const [artwork, explorer] of [
        [{ chain_id: 84532 }, 'https://sepolia.basescan.org'],
        [{ chainId: 11155111 }, 'https://sepolia.etherscan.io'],
        [{ chain_id: 87654, network: 'baseSepolia' }, ''],
        [{}, '']
    ]) {
        const panels = render({
            artwork: { ...artwork, token_id: '7' },
            recordedNftSale: { amount, venue: 'ArtSoul marketplace', event },
            provenanceState: { status: 'ready', events: [event], complete: true }
        });
        for (const html of [panels.provenancePanel, panels.detailsPanel]) {
            if (explorer) {
                assert.ok(html.includes(`${amount} test ETH`));
                assert.ok(html.includes(`href="${explorer}/tx/${hash}"`));
            } else assert.doesNotMatch(html, /href="https:/);
        }
        if (explorer) {
            assert.ok(panels.detailsPanel.includes(`href="${explorer}/token/${CREATOR}?a=7"`));
            assert.match(panels.provenancePanel, /aria-label="Transaction: Resale completed \(block 17\)"/);
        }
    }
});

test('partial provenance counts visible events and never labels partial coverage as an empty history', () => {
    for (const events of [[], [{ type: 'artwork_registered' }]]) {
        const html = render({ provenanceState: { status: 'ready', events, complete: false } }).provenancePanel;
        assert.ok(html.includes(events.length ? '1 event shown' : '0 events shown'));
        assert.match(html, /full history is unavailable/);
        assert.doesNotMatch(html, /No events recorded|older|indexer/i);
    }
});
