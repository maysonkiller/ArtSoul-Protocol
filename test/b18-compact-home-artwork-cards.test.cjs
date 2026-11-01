// Shared card presentation stays truthful and equivalent in both renderers.
// No DB, wallet provider, network RPC, storage request or media playback.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const cardSource = fs.readFileSync('src/ui/components/artwork-card.js', 'utf8');
const homeSource = fs.readFileSync('index.html', 'utf8');
const NOW = Date.UTC(2026, 10, 2, 12);

class FakeElement {
    constructor(tagName) {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.dataset = {};
        this.style = {};
        this.className = '';
        this.attributes = {};
    }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.children.push(child); return child; }
    addEventListener() {}
    setAttribute(key, value) { this.attributes[key] = String(value); }
}

function getRuntime() {
    const document = { createElement: name => new FakeElement(name) };
    const window = {
        ArtSoulSecurity: { isValidStorageUrl: () => true },
        ArtSoulArtworkUrl: { artworkPath: id => '/artwork/' + id },
        ethereum: { chainId: '0x14a34' },
        addEventListener() {}
    };
    class FakeDate extends Date {
        static now() { return NOW; }
    }
    vm.runInNewContext(cardSource, { window, document, Date: FakeDate }, { filename: 'artwork-card.js' });
    window.React = {
        createElement: (type, props, ...children) => ({ type, props, children }),
        useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
        useEffect() {}
    };
    return { api: window.ArtSoulArtworkCard };
}

function walk(root, visitor) {
    if (!root || typeof root !== 'object') return;
    visitor(root);
    for (const child of root.children || []) walk(child, visitor);
}

function nodesWithClass(root, name) {
    const matches = [];
    walk(root, node => {
        if ((node.className || node.props?.className || '').split(/\s+/).includes(name)) matches.push(node);
    });
    return matches;
}

function textUnder(root) {
    if (typeof root === 'string') return root;
    if (!root || typeof root !== 'object') return '';
    return [root.textContent || '', ...(root.children || []).map(textUnder)].filter(Boolean).join(' ');
}

const cases = [
    {
        name: 'unminted discovery', artwork: { status: 'registered', creator_value: '0.02', token_id: '0' },
        status: 'Discover', label: 'Starting price', value: '0.02 test ETH'
    },
    {
        name: 'auction without bids', artwork: { auction_id: '7', auction_end_time: NOW + 60000, current_bid: '0', start_price: '0.001' },
        status: 'Auction open', label: 'Starting price', value: '0.001 test ETH'
    },
    {
        name: 'live highest bid', artwork: { auction_id: '7', auction_end_time: NOW + 60000, current_bid: '0.012', start_price: '0.001' },
        status: 'Auction open', label: 'Current bid', value: '0.012 test ETH'
    },
    {
        name: 'settlement pending', artwork: { status: 'settlement_pending', current_bid: '0.012', start_price: '0.001' },
        status: 'Awaiting payment', label: 'Final bid', value: '0.012 test ETH'
    },
    {
        name: 'listed NFT', artwork: { status: 'for_sale', minted: true, token_id: '42', sale_price: '0.25', floor_price: '0.1' },
        status: 'For sale', label: 'Asking price', value: '0.25 test ETH'
    },
    {
        name: 'unlisted NFT with retained prices', artwork: { status: 'sold', listing_status: 'cancelled', minted: true, token_id: '42', sale_price: '0.25', floor_price: '0.1' },
        status: 'NFT', label: 'Status', value: 'Not for sale'
    },
    {
        name: 'missing price', artwork: { status: 'registered' },
        status: 'Discover', label: 'Price', value: 'Not set'
    },
    {
        name: 'projection pending', artwork: { source: 'pending_indexer', created_at: new Date(NOW).toISOString(), creator_value: '0.02' },
        status: 'Finalizing...', label: 'Status', value: 'Updating'
    }
];

test('Home retains the approved discovery-first promise', () => {
    assert.match(homeSource, /Art first\. Ownership next\./);
    assert.match(homeSource, /Discover a work\.\s*<br class="home-hero-break">Start its next chapter\./);
    assert.match(homeSource, /Meet independent artists\. Support the work you love\. Collector demand comes before minting\. An NFT is created only after successful settlement\./);
});

for (const scenario of cases) {
    test(`DOM and React show one status and one contextual summary: ${scenario.name}`, () => {
        const { api } = getRuntime();
        const artwork = {
            id: 'v41:84532:14', chain_id: 84532, file_type: 'image', file_url: 'image.png',
            title: 'Quiet art', creator_name: 'Mira', ...scenario.artwork
        };
        assert.deepEqual({ ...api.cardSummary(artwork) }, { label: scenario.label, value: scenario.value });
        const cards = [api.createCardElement(artwork), api.ReactCard({ artwork, href: '/artwork/14' })];
        for (const card of cards) {
            const link = nodesWithClass(card, 'artsoul-card-link')[0];
            const accessible = link.attributes?.['aria-label'] || link.props['aria-label'];
            assert.ok(accessible.includes(`${scenario.label}: ${scenario.value}`), 'the accessible description uses the displayed summary');
            if (scenario.value === 'Not for sale') assert.ok(!accessible.includes('ETH'), 'removed prices cannot remain in the accessible description');
            const statuses = nodesWithClass(card, 'artsoul-card-status');
            assert.equal(statuses.length, 1, 'the lifecycle is stated once');
            assert.equal(textUnder(statuses[0]), scenario.status);
            const meta = nodesWithClass(card, 'artsoul-card-meta')[0];
            assert.equal(meta.children[0], statuses[0], 'the timer retains its existing status target');
            assert.equal(nodesWithClass(card, 'artsoul-card-price-label').length, 1);
            assert.equal(textUnder(nodesWithClass(card, 'artsoul-card-price-label')[0]), scenario.label);
            const values = nodesWithClass(card, 'artsoul-card-price');
            assert.equal(values.length, 1);
            assert.equal(textUnder(values[0]), scenario.value);
            assert.equal(nodesWithClass(card, 'artsoul-card-provenance').length, 0);
            assert.equal(nodesWithClass(card, 'artsoul-card-mint').length, 0);
            assert.equal(nodesWithClass(card, 'artsoul-card-preview-badge').length, 0);
            assert.equal(textUnder(nodesWithClass(card, 'artsoul-card-creator')[0]), 'Creator: Mira');
            const visibleNFTs = textUnder(card).match(/\bNFT\b/g) || [];
            assert.equal(visibleNFTs.length, scenario.status === 'NFT' ? 1 : 0, 'no duplicate or unsupported mint label');

            const marks = nodesWithClass(card, 'artsoul-card-price-mark');
            const priced = scenario.value.endsWith('ETH');
            assert.equal(marks.length, priced ? 1 : 0, 'availability text has no currency logo');
            if (priced) {
                const children = values[0].children.filter(Boolean);
                assert.equal(children[0], marks[0], 'the currency mark precedes the amount in both renderers');
                assert.equal(textUnder(children[1]), scenario.value);
                assert.equal(marks[0].src || marks[0].props.src, '/brand/eth.png');
                assert.equal(marks[0].alt ?? marks[0].props?.alt, '');
                assert.equal(marks[0].attributes?.['aria-hidden'] ?? marks[0].props?.['aria-hidden'], 'true');
            }
        }
        const domMedia = nodesWithClass(cards[0], 'artsoul-card-media-badge-image');
        const reactMedia = nodesWithClass(api.ReactMedia({ artwork }), 'artsoul-card-media-badge-image');
        assert.deepEqual(domMedia.map(textUnder), ['IMAGE']);
        assert.deepEqual(reactMedia.map(textUnder), ['IMAGE']);
    });
}

test('an inactive listing never becomes an asking price through retained sale or floor values', () => {
    const { api } = getRuntime();
    for (const listing_status of ['cancelled', 'sold', 'inactive', '']) {
        const artwork = { status: 'sold', listing_status, minted: true, token_id: '42',
            sale_price: '0.25', resale_price: '0.3', listing_price: '0.4', floor_price: '0.1' };
        assert.deepEqual({ ...api.cardSummary(artwork) }, { label: 'Status', value: 'Not for sale' });
    }
});

test('test-currency qualification follows the artwork chain instead of the connected wallet', () => {
    const { api } = getRuntime();
    for (const identity of [{ chain_id: 84532 }, { canonical_v41_id: 'v41:84532:14' }, { chainId: 11155111 }]) {
        assert.equal(api.cardSummary({ ...identity, creator_value: '0.02' }).value, '0.02 test ETH');
    }
    assert.equal(api.cardSummary({ chain_id: 8453, creator_value: '0.02' }).value, '0.02 ETH');
    assert.equal(api.cardSummary({ creator_value: '0.02' }).value, '0.02 ETH');
});

test('preview copy does not change lifecycle truth or imply minting from sold status alone', () => {
    const { api } = getRuntime();
    const live = { auction_id: '7', auction_end_time: NOW + 60000 };
    assert.equal(api.statusInfo(live).label, 'Live');
    assert.equal(api.cardPreviewInfo(live).label, 'Auction open');
    assert.equal(api.statusInfo({ status: 'registered' }).label, 'Not yet minted');
    assert.equal(api.cardPreviewInfo({ status: 'registered' }).label, 'Discover');
    assert.equal(api.cardPreviewInfo({ status: 'sold', token_id: '0' }).label, 'Sold');
    assert.equal(api.cardPreviewInfo({ status: 'sold', minted: true, token_id: '42' }).label, 'NFT');
    assert.ok(fs.statSync('public/brand/eth.png').size > 0);
});
