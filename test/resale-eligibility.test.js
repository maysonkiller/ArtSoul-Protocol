import test from 'node:test';
import assert from 'node:assert/strict';
import { getOwnerResaleEligibility } from '../src/features/marketplace/resale-eligibility.js';

const OWNER = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';

function eligible(overrides = {}) {
    return getOwnerResaleEligibility({
        walletSettled: true,
        walletAddress: OWNER,
        walletChainId: 84532,
        currentOwnerAddress: OWNER.toUpperCase(),
        minted: true,
        tokenId: '13',
        floorPrice: '0.01',
        activeListing: false,
        activeAuction: false,
        ...overrides
    });
}

test('active auction never exposes the owner resale action', () => {
    assert.deepEqual(eligible({ activeAuction: true }), {
        canList: false,
        showOwnerAction: false,
        reason: 'auction_active'
    });
});

test('unminted artwork cannot be listed', () => {
    assert.equal(eligible({ minted: false, tokenId: '' }).showOwnerAction, false);
});

test('minted current owner can list on Base Sepolia', () => {
    assert.deepEqual(eligible(), {
        canList: true,
        showOwnerAction: true,
        reason: ''
    });
});

test('minted non-owner cannot list', () => {
    assert.equal(eligible({ walletAddress: OTHER }).showOwnerAction, false);
});

test('wrong chain keeps the owner control visible but disabled', () => {
    assert.deepEqual(eligible({ walletChainId: 1 }), {
        canList: false,
        showOwnerAction: true,
        reason: 'wrong_chain'
    });
});

test('active resale listing cannot be duplicated', () => {
    assert.deepEqual(eligible({ activeListing: true }), {
        canList: false,
        showOwnerAction: false,
        reason: 'already_listed'
    });
});

test('owner action stays visible but disabled while canonical floor is unavailable', () => {
    assert.deepEqual(eligible({ floorPrice: '0' }), {
        canList: false,
        showOwnerAction: true,
        reason: 'floor_unavailable'
    });
});

test('wallet state must be settled before showing an owner action', () => {
    assert.equal(eligible({ walletSettled: false }).showOwnerAction, false);
});
