const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const artwork = fs.readFileSync(path.join(__dirname, '..', 'artwork.html'), 'utf8');
const upload = fs.readFileSync(path.join(__dirname, '..', 'upload.html'), 'utf8');

function between(start, end) {
    const from = artwork.indexOf(start);
    const to = artwork.indexOf(end, from + start.length);
    assert.notEqual(from, -1, `Missing ${start}`);
    assert.notEqual(to, -1, `Missing ${end}`);
    return artwork.slice(from, to);
}

test('opening the modal requests guidance but cannot submit a transaction', () => {
    const openHandler = between('function openNewAuctionModal()', 'function closeNewAuctionModal()');
    assert.match(openHandler, /requestFreshReauctionValuation/);
    assert.doesNotMatch(openHandler, /createAuction/);
});

test('Confirm is the single re-auction transaction gate and redirects to auctions', () => {
    const confirmHandler = between('async function handleConfirmNewAuction()', 'async function handleEndAuction()');
    assert.equal((confirmHandler.match(/ArtSoulContracts\.createAuction/g) || []).length, 1);
    assert.doesNotMatch(confirmHandler, /confirmAuctionAction/);
    assert.match(confirmHandler, /gallery\.html#auctions/);
});

test('modal is limited to re-auction lifecycle states and contains required fields', () => {
    const eligibility = between('function canCreateNewAuctionForWallet', 'function v41InteractionKey');
    assert.match(eligibility, /ended_no_bids/);
    assert.match(eligibility, /unsettled/);
    assert.match(artwork, /New starting price \(ETH\)/);
    assert.match(artwork, /Fresh AI valuation/);
    assert.match(artwork, /\[24, 36, 48\]/);
});

test('upload valuation retry cap remains two manual retries after the initial request', () => {
    assert.match(upload, /const AI_MANUAL_RETRY_LIMIT = 2;/);
});
