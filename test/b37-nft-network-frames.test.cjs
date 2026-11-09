// B37: display-only network identity and uniform NFT frames.
// No real wallet, provider, storage, RPC, rendering engine or deployment effects.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/ui/components/artwork-card.js', 'utf8');
const style = fs.readFileSync('nft-network-frames.css', 'utf8');
const legacy = fs.readFileSync('src/features/profile/wallet-nfts.jsx', 'utf8');

class FakeElement {
    constructor(tag) {
        this.tagName = tag.toUpperCase();
        this.children = [];
        this.attributes = {};
        this.className = '';
        this.classList = { add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); } };
        this.dataset = {};
        this.style = {};
    }
    append(...items) { this.children.push(...items); }
    appendChild(item) { this.children.push(item); return item; }
    addEventListener() {}
    setAttribute(key, val) { this.attributes[key] = val; }
}
function runtime() {
    const document = { createElement: tag => new FakeElement(tag) };
    let requests = 0;
    const window = {
        ArtSoulSecurity: { isValidStorageUrl: () => true },
        ArtSoulArtworkUrl: { artworkPath: id => '/artwork/' + id },
        addEventListener() {},
        fetch() { requests++; throw Error('Network is forbidden in B37 tests'); },
        React: {
            createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
            useState: initial => [initial, () => {}],
            useRef: () => ({ current: null }),
            useEffect() {}
        }
    };
    vm.runInNewContext(source, { window, document }, { filename: 'artwork-card.js' });
    return { api: window.ArtSoulArtworkCard, requests: () => requests };
}
function walk(node, visit) {
    if (!node || typeof node !== 'object') return;
    visit(node);
    for (const child of node.children || []) walk(child, visit);
}
function markers(node) {
    const arr = [];
    walk(node, el => {
        if (String(el.className || el.props?.className || '').split(/\s+/).includes('artsoul-chain-marker')) arr.push(el);
    });
    return arr;
}
function imageNodes(node) {
    const arr = [];
    walk(node, el => {
        if (el.tagName === 'IMG' || el.type === 'img') arr.push(el);
    });
    return arr;
}
function imageArtwork(extra = {}) {
    return { id: 'v41:84532:12', title: 'A story', file_type: 'image/png',
        file_url: 'https://storage.example.test/artwork.png', chain_id: 84532, ...extra };
}

test('chain identity is drawn from exact NFT metadata, not connected wallet', () => {
    const { api, requests } = runtime();
    assert.equal(api.networkInfo({ chain_id: 84532 }).name, 'Base Sepolia');
    assert.equal(api.networkInfo({ chain_id: 8453 }).name, 'Base');
    assert.equal(api.networkInfo({ chain_id: 1 }).name, 'Ethereum');
    assert.equal(api.networkInfo({ chainId: 11155111 }).name, 'Ethereum Sepolia');
    assert.equal(api.networkInfo({ canonical_v41_id: 'v41:84532:1000' }).name, 'Base Sepolia');
    assert.equal(api.networkInfo({ network: 'robinhood-mainnet' }).name, 'Robinhood Chain');
    assert.equal(api.networkInfo({ network: 'soneium-mainnet' }).name, 'Soneium');
    assert.equal(api.networkInfo({ chain_id: 1, network: 'base-mainnet' }).name, 'Ethereum');
    assert.equal(api.networkInfo({ chain_id: 999999, network: 'base-mainnet' }), null);
    assert.equal(api.networkInfo({ network: 'untrusted-network' }), null);
    assert.equal(api.networkInfo({}), null);
    assert.equal(requests(), 0);
});

test('DOM images, video and audio each carry a locally hosted chain mark', () => {
    const { api, requests } = runtime();
    for (const [type, url] of [['image/png','a.png'],['video/mp4','v.mp4'],['audio/mpeg','a.mp3']]) {
        const root = api.createMediaElement(imageArtwork({ file_type: type,
            file_url: 'https://storage.example.test/' + url }));
        const badges = markers(root);
        assert.equal(badges.length, 1, type);
        assert.equal(badges[0].attributes['aria-label'], 'Network: Base Sepolia');
        assert.equal(imageNodes(badges[0])[0].src, '/brand/base.svg');
        assert.equal(imageNodes(badges[0])[0].alt, '');
    }
    const without = api.createMediaElement(imageArtwork({ chain_id: 999999 }));
    assert.equal(markers(without).length, 0);
    assert.equal(requests(), 0);
});

test('React still image, video and audio previews preserve chain marks', () => {
    const { api, requests } = runtime();
    for (const [type, url] of [['image/png','a.png'],['video/mp4','v.mp4'],['audio/mpeg','a.mp3']]) {
        const art = imageArtwork({ file_type: type, file_url: 'https://storage.example.test/' + url });
        let root = api.ReactMedia({ artwork: art });
        // ReactMedia returns a component type for video/audio. Render that
        // pure function with the fake hook surface; never mount or play media.
        if (typeof root.type === 'function') root = root.type(root.props);
        const badges = markers(root);
        assert.equal(badges.length, 1, type);
        assert.equal(badges[0].props['aria-label'], 'Network: Base Sepolia');
        assert.equal(imageNodes(badges[0])[0].props.src, '/brand/base.svg');
    }
    assert.equal(requests(), 0);
});

test('existing Base wallet renders its network over the media without another API call', () => {
    assert.match(legacy, /className="wallet-nft-image"/);
    assert.match(legacy, /className="wallet-asset-overlay" aria-label="Network: Base"/);
    assert.match(legacy, /className="wallet-chain-chip" data-chain="base-mainnet"/);
    assert.match(legacy, /src="\/brand\/base\.svg"/);
    assert.match(legacy, /Preview unavailable/);
    assert.match(legacy, /config.multichainWalletAssetsEnabled === true\s*\? <MultiChainWalletAssets/);
});

test('all primary NFT pages load one small theme-safe stylesheet and fresh card script', () => {
    for (const path of ['index.html', 'gallery.html', 'profile.html', 'artwork.html']) {
        const html = fs.readFileSync(path, 'utf8');
        assert.match(html, /\/nft-network-frames\.css\?v=1/);
        assert.match(html, /\/src\/ui\/components\/artwork-card\.js\?v=29/);
    }
    assert.match(style, /\.wallet-nfts-grid[\s\S]*align-items:\s*stretch/);
    assert.match(style, /\.wallet-nft-image[\s\S]*aspect-ratio:\s*1\s*\/\s*1/);
    assert.match(style, /\.artsoul-card-media \.artsoul-chain-marker/);
    assert.match(style, /pointer-events:\s*none/);
    assert.doesNotMatch(style, /#[a-f0-9]{3,8}\b/i, 'no hardcoded theme colors');
    assert.doesNotMatch(style, /https?:\/\//i, 'styles never load new third-party assets');
});
