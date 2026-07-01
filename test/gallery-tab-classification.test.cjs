const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadDiscoveryService() {
    const context = vm.createContext({
        window: {
            location: { search: '' },
            localStorage: { getItem: () => null },
            ArtSoulSecurity: { isValidStorageUrl: () => true }
        },
        URLSearchParams,
        console
    });
    vm.runInContext(
        fs.readFileSync('src/features/discovery/discovery-service.js', 'utf8'),
        context,
        { filename: 'src/features/discovery/discovery-service.js' }
    );
    return context.window.ArtSoulDiscovery;
}

function loadArtworkCard(signals) {
    const context = vm.createContext({
        window: {
            ArtSoulDiscovery: { getSocialSignals: () => signals }
        },
        console
    });
    vm.runInContext(
        fs.readFileSync('src/ui/components/artwork-card.js', 'utf8'),
        context,
        { filename: 'src/ui/components/artwork-card.js' }
    );
    return context.window.ArtSoulArtworkCard;
}

const baseArtwork = {
    source: 'v41_projection',
    chain_id: 84532,
    artwork_id: '1',
    blockchain_id: '1',
    title: 'Test artwork',
    file_url: 'https://example.com/art.png',
    minted: false,
    active_auction_id: null,
    token_id: '0'
};

test('gallery lifecycle states map to one mutually exclusive tab', () => {
    const discovery = loadDiscoveryService();
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const cases = [
        [{ ...baseArtwork, status: 'auction', active_auction_id: '1', auction_end_time: future }, 'live_auctions'],
        [{ ...baseArtwork, status: 'for_sale', minted: true, token_id: '2', sale_price: '0.5' }, 'marketplace'],
        [{ ...baseArtwork, status: 'registered' }, 'discover'],
        [{ ...baseArtwork, status: 'defaulted' }, 'discover'],
        [{ ...baseArtwork, status: 'ended_no_bids' }, 'discover'],
        [{ ...baseArtwork, status: 'registered', is_collection: true }, 'collections'],
        [{ ...baseArtwork, status: 'sold', minted: true, token_id: '3' }, 'nft'],
        [{ ...baseArtwork, status: 'settlement_pending', active_auction_id: '4' }, 'discover']
    ];
    const tabs = ['live_auctions', 'nft', 'discover', 'marketplace', 'collections'];

    for (const [artwork, expected] of cases) {
        assert.equal(discovery.galleryTabForArtwork(artwork), expected);
        const matchingTabs = tabs.filter(tab => discovery.filterForGalleryTab([artwork], tab).length === 1);
        assert.deepEqual(matchingTabs, expected ? [expected] : []);
    }
});

test('expired active auctions enter Discovery even before on-chain finalization', () => {
    const discovery = loadDiscoveryService();
    const expired = {
        ...baseArtwork,
        status: 'auction',
        active_auction_id: '5',
        auction_end_time: new Date(Date.now() - 60 * 1000).toISOString()
    };

    assert.equal(discovery.galleryTabForArtwork(expired), 'discover');
    assert.equal(discovery.filterForGalleryTab([expired], 'discover').length, 1);
});

test('moderation-hidden works are excluded from every gallery tab', () => {
    const discovery = loadDiscoveryService();
    const hidden = { ...baseArtwork, status: 'registered', moderation_hidden: true };
    const tabs = ['live_auctions', 'nft', 'discover', 'marketplace', 'collections'];

    for (const tab of tabs) {
        assert.equal(discovery.filterForGalleryTab([hidden], tab).length, 0);
    }
});

test('Discovery cards can show all three persisted signal counts', () => {
    const card = loadArtworkCard({ likes: 2, wouldBuy: 3, watching: 4 });
    assert.equal(card.signalsText({}, true), '2 likes · 3 would buy · 4 watching');

    const emptyCard = loadArtworkCard({ likes: 0, wouldBuy: 0, watching: 0 });
    assert.equal(emptyCard.signalsText({}, true), '0 likes · 0 would buy · 0 watching');
});

test('gallery markup keeps the requested order and default without card signals', () => {
    const gallery = fs.readFileSync('gallery.html', 'utf8') + fs.readFileSync('src/entries/gallery.jsx', 'utf8');
    const auctions = gallery.indexOf("{ id: 'live_auctions', label: 'Auctions' }");
    const nft = gallery.indexOf("{ id: 'nft', label: 'NFT' }");
    const discover = gallery.indexOf("{ id: 'discover', label: 'Discovery' }");
    const marketplace = gallery.indexOf("{ id: 'marketplace', label: 'Marketplace' }");
    const collections = gallery.indexOf("{ id: 'collections', label: 'Collections' }");

    assert.ok(auctions < nft && nft < discover && discover < marketplace && marketplace < collections);
    assert.match(gallery, /\? tabId : 'live_auctions'/);
    assert.doesNotMatch(gallery, /showSignals=/);
    assert.match(gallery, /ArtSoulArtworkCard\?\.hasSafeMedia/);
    assert.match(gallery, /TODO: Add a "Make an offer" action to NFT cards/);
    assert.match(
        fs.readFileSync('src/features/discovery/discovery-service.js', 'utf8'),
        /TODO: Once the canonical project wallet is configured/
    );
});
