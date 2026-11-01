// B18.4: Source-only regression coverage for the founder's compact Home layout.
// No DB, wallet provider, network RPC, storage request or media playback.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const cardSource = fs.readFileSync('src/ui/components/artwork-card.js', 'utf8');
const homeSource = fs.readFileSync('index.html', 'utf8');
const homeRuntime = fs.readFileSync('src/entries/index.js', 'utf8');
const styles = fs.readFileSync('unified-styles.css', 'utf8');

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
        addEventListener() {}
    };
    const context = { window, document };
    vm.runInNewContext(cardSource, context, { filename: 'artwork-card.js' });
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

function provenance(root) {
    let row;
    walk(root, node => {
        if (node.className === 'artsoul-card-provenance' ||
            node.props?.className === 'artsoul-card-provenance') row = node;
    });
    return row;
}

function textUnder(root) {
    const values = [];
    walk(root, node => {
        if (typeof node.textContent === 'string') values.push(node.textContent);
        for (const child of node.children || []) {
            if (typeof child === 'string') values.push(child);
        }
    });
    return values.join(' ');
}

test('restore the original founder headline and discovery-first promise', () => {
    assert.match(homeSource, /Discovery-First Auctions for Digital Art/);
    assert.match(homeSource, /Collector demand comes before minting\. Publish artwork, build conviction through an auction, and mint only after settlement\./);
    assert.doesNotMatch(homeSource, /<h1[^>]+>Discover artworks<\/h1>/);
});

test('network chip is derived from artwork, never from the viewer wallet', () => {
    const { api } = getRuntime();
    assert.equal(api.cardNetworkLabel({ chain_id: 84532 }), 'Base Sepolia');
    assert.equal(api.cardNetworkLabel({ chainId: 8453 }), 'Base');
    assert.equal(api.cardNetworkLabel({ canonical_v41_id: 'v41:11155111:42' }), 'Sepolia');
    assert.equal(api.cardNetworkLabel({ id: 'v41:84532:42' }), 'Base Sepolia');
    assert.equal(api.cardNetworkLabel({ chain_id: 99999 }), 'Chain 99999');
    assert.equal(api.cardNetworkLabel({ id: 'pending:123' }), 'Network pending');
    assert.equal(api.cardNetworkLabel({}), 'Network pending');
});

test('NFT label does not declare minting for unminted art or an open auction', () => {
    const { api } = getRuntime();
    assert.equal(api.cardMintLabel({ status: 'registered' }), 'Not minted');
    assert.equal(api.cardMintLabel({ active_auction_id: '1' }), 'Not minted');
    assert.equal(api.cardMintLabel({ token_id: '0' }), 'Not minted');
    assert.equal(api.cardMintLabel({ minted: true, token_id: '19' }), 'NFT');
});

test('DOM and React cards disclose matching real network and NFT state', () => {
    const { api } = getRuntime();
    const art = {
        id: 'v41:84532:15',
        chain_id: 84532,
        file_url: 'image.png',
        file_type: 'image',
        title: 'Quiet art',
        status: 'registered',
        token_id: '0'
    };
    for (const minted of [false, true]) {
        const artwork = { ...art, minted, token_id: minted ? '7' : '0' };
        const dom = api.createCardElement(artwork, { href: false });
        const react = api.ReactCard({ artwork, href: '' });
        for (const result of [dom, react]) {
            const row = provenance(result);
            assert.ok(row, 'missing card provenance row');
            assert.match(textUnder(row), /Base Sepolia/);
            assert.match(textUnder(row), minted ? /\bNFT\b/ : /Not minted/);
        }
    }
});

test('Home caps rendered ranking and CSS displays at most two rows per width', () => {
    assert.match(homeRuntime, /const HOMEPAGE_MAX_CARDS = 10/);
    assert.match(homeRuntime, /\.slice\(0, HOMEPAGE_MAX_CARDS\)/);
    const responsive = [
        ['1200px', 5, 11],
        ['1199px', 4, 9],
        ['899px', 3, 7],
        ['768px', 2, 5],
        ['519px', 1, 3]
    ];
    for (const [width, columns, hiddenStart] of responsive) {
        assert.ok(styles.includes(width), 'missing breakpoint ' + width);
        assert.ok(styles.includes(columns === 1
            ? 'grid-template-columns: minmax(0, 1fr) !important;'
            : 'grid-template-columns: repeat(' + columns + ', minmax(0, 1fr)) !important;'));
        assert.ok(styles.includes('nth-child(n+' + hiddenStart + ')'), 'missing two-row window at ' + width);
    }
});

test('account button recovers compact shape while icon tools remain circular', () => {
    assert.match(styles, /B18\.4[\s\S]*#navButtons \.avatar-button \{[\s\S]*?border-radius: 13px !important/);
    assert.match(styles, /#navButtons :is\(\[data-avatar-name\], \[data-avatar-address\]\)[\s\S]*animation: none !important/);
    assert.match(styles, /@media \(max-width: 768px\)[\s\S]*?\.avatar-button[\s\S]*?44px !important/);
});
