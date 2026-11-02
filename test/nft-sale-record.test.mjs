import assert from 'node:assert/strict';
import test from 'node:test';
import { readRecordedNftSale } from '../src/features/artwork/nft-sale-record.js';

const primary = { type: 'settlement_completed', token_id: '7', block_number: 10, log_index: 1, final_price: '0.000000000000000001' };
const resale = { type: 'resale_completed', token_id: '7', block_number: 20, log_index: 2, price: '1.123456789012345678' };
const read = (events, overrides = {}) => readRecordedNftSale({ status: 'ready', complete: true, events, ...overrides }, '7');

test('primary and resale receipts retain exact decimal prices and identify the venue', () => {
    assert.equal(read([primary]).amount, '0.000000000000000001');
    assert.equal(read([primary]).venue, 'ArtSoul primary auction');
    assert.equal(read([resale, primary]).amount, resale.price);
    assert.equal(read([resale, primary]).venue, 'ArtSoul marketplace');
});

test('listings, bids, transfers and other token sales cannot replace a recorded sale', () => {
    const unrelated = ['resale_listed', 'auction_started', 'auction_ended', 'settlement_pending', 'settlement_defaulted', 'nft_transferred']
        .map(type => ({ ...resale, type, block_number: 30, price: '999', final_price: '999' }));
    assert.equal(read([...unrelated, { ...resale, token_id: '8', block_number: 40 }]), null);
    assert.equal(read([primary, ...unrelated]).event, primary);
});

test('buybacks and same-block sales use chain order rather than response or timestamp order', () => {
    const buyback = { ...resale, block_number: 20, log_index: 3, price: '2' };
    assert.equal(read([buyback, resale, primary]).amount, '2');
});

test('loading, failed, partial and missing histories never imply a known last sale', () => {
    for (const overrides of [{ status: 'loading' }, { status: 'unavailable' }, { complete: false }]) {
        assert.equal(read([primary, resale], overrides), null);
    }
    assert.equal(read([]), null);
    assert.equal(read(null), null);
});

test('a missing latest amount stays unknown rather than falling back to an earlier price or zero', () => {
    for (const price of [null, undefined, '', '-1', '1e-18', 0.1]) {
        assert.equal(read([primary, { ...resale, price }]).amount, null);
    }
    assert.equal(read([{ ...resale, price: '0' }]).amount, '0');
    assert.equal(read([{ ...resale, block_number: 'bad' }]), null);
});
