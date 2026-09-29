const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const window = { addEventListener() {} };
vm.runInNewContext(fs.readFileSync('src/ui/components/artwork-card.js', 'utf8'), { window });
const source = fs.readFileSync('src/entries/profile.jsx', 'utf8');
const start = source.indexOf('function getProfileArtworkPrice(');
const end = source.indexOf('function getProfileArtworkHref(', start);
const profilePrice = vm.runInNewContext(`(${source.slice(start, end).trim()})`, {
    window, isMintedArtwork: artwork => Boolean(artwork.minted || artwork.token_id)
});

test('profile auction price follows the actual current bid rather than its starting price', () => {
    const artwork = { status: 'auction', current_bid: '0.011', highest_bid: '0.011', start_price: '0.001', creator_value: '0.001' };
    assert.equal(profilePrice(artwork), '0.011 ETH');
});

test('all card surfaces share the same price resolver', () => {
    assert.equal(typeof window.ArtSoulArtworkCard.formatPrice, 'function');
    for (const artwork of [
        { current_bid: '0', highest_bid: '0', start_price: '0.001', creator_value: '0.002' },
        { current_bid: '0', highest_bid: '0.011', start_price: '0.001' },
        { minted: true, sale_price: '0.012', current_bid: '0.001', floor_price: '0.001' },
        { minted: true, floor_price: '0.0000001' },
        { start_price: '-1', creator_value: '0' },
        {}
    ]) assert.equal(profilePrice(artwork), window.ArtSoulArtworkCard.formatPrice(artwork));
});

test('zero bids fall through to start price, and tiny prices are not rounded to zero', () => {
    const format = window.ArtSoulArtworkCard.formatPrice;
    assert.equal(format({ current_bid: '0', highest_bid: '0', start_price: '0.001' }), '0.001 ETH');
    assert.equal(format({ current_bid: '0', highest_bid: '0.011', start_price: '0.001' }), '0.011 ETH');
    assert.equal(format({ start_price: '0.0000001' }), '0.0000001 ETH');
    assert.equal(format({ start_price: '0.001invalid', creator_value: '0.002' }), '0.002 ETH');
    assert.equal(format({ start_price: 'Infinity' }), '');
});

test('unminted token sentinels retain live auction prices and status', () => {
    const card = window.ArtSoulArtworkCard;
    for (const field of ['token_id', 'tokenId']) {
        for (const value of [undefined, null, '', 0, '0', ' 0 ', 'none', 'None']) {
            const artwork = { [field]: value, minted: false, status: 'auction', active_auction_id: '66', current_bid: '0.011', start_price: '0.001' };
            assert.equal(card.formatPrice(artwork), '0.011 ETH', `${field}=${value}`);
            assert.equal(card.statusInfo(artwork).key, 'live', `${field}=${value}`);
        }
    }
    assert.equal(card.formatPrice({ token_id: '4', sale_price: '0.012', current_bid: '0.001' }), '0.012 ETH');
    assert.equal(card.formatPrice({ minted: true, token_id: '0', floor_price: '0.012', current_bid: '0.001' }), '0.012 ETH');
});
