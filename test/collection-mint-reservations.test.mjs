import assert from 'node:assert/strict';
import test from 'node:test';
import { createMintReservationDraft, parseDraft, previewMintReservation, reservationPayout, reservationPublicMint, reviewConfig } from '../src/features/collections/launch-config.js';

function configuredDraft() {
    const draft = createMintReservationDraft();
    Object.assign(draft, { name: 'Prints', description: 'An edition of twenty prints.', maxSupply: 20, holderRights: 'Personal display.' });
    draft.media.metadataBaseURI = 'ipfs://example/';
    const [auction, mint] = draft.phases;
    Object.assign(auction, { allocation: 5, startAt: '2027-01-01T12:00Z', endAt: '2027-01-02T12:00Z' });
    auction.pricing.priceEth = '0.1';
    auction.reservation = { mintPriceEth: '0.8', redemptionHours: '36' };
    Object.assign(mint, { allocation: 15, startAt: auction.endAt, endAt: '2027-01-10T12:00Z' });
    mint.pricing.priceEth = '1';
    return draft;
}

test('a reservation draft counts reserved inventory once and stays outside the funded NFT auction contract', () => {
    const draft = configuredDraft();
    const review = reviewConfig(parseDraft(JSON.stringify(draft)));
    assert.deepEqual(review.findings, []);
    assert.equal(review.allocationTotal, '20');
    assert.equal(review.reserve, '0');
    assert.equal(review.canPublish, false);
    assert.deepEqual(review.contractCompatibility.findings.map(finding => finding.code), ['CONTRACT_MINT_RESERVATION']);
    draft.phases[1].allocation++;
    assert.ok(reviewConfig(draft).findings.some(finding => finding.code === 'OVERALLOCATED'));
});

test('both buyers see their own payment and the full separate redemption window', () => {
    const phase = configuredDraft().phases[0];
    assert.deepEqual(previewMintReservation(phase), {
        totalEth: '0.9', resaleEndsAt: '2027-01-03T12:00:00.000Z', redemptionEndsAt: '2027-01-05T00:00:00.000Z'
    });
    assert.equal(previewMintReservation(phase, '0.15').totalEth, '0.95');
    assert.equal(previewMintReservation(phase, '0.300000000000000001').totalEth, '1.100000000000000001');
    assert.equal(previewMintReservation(phase, '1e1').totalEth, null);
    phase.reservation.mintPriceEth = '0';
    assert.equal(previewMintReservation(phase, '1').totalEth, '1');
    phase.reservation.redemptionHours = '9007199254740991';
    assert.equal(previewMintReservation(phase).redemptionEndsAt, null);
});

test('reservation quotes use combined earned proceeds and give an exact half-wei to the creator', () => {
    assert.deepEqual(reservationPayout('0.1', '0.8'), { creatorEth: '0.8775', feeEth: '0.0225' });
    assert.deepEqual(reservationPayout('0.1', '0'), { creatorEth: '0.0975', feeEth: '0.0025' });
    const tenWei = '0.000000000000000010';
    assert.deepEqual(reservationPayout(tenWei, tenWei), { creatorEth: '0.00000000000000002', feeEth: '0' });
    assert.deepEqual(reservationPayout(tenWei, '0.000000000000000011'), {
        creatorEth: '0.00000000000000002', feeEth: '0.000000000000000001'
    });
    assert.equal(reservationPayout('0.1', ''), null);
    assert.equal(reservationPayout('', '0.8'), null);
});

test('drafts with additional phases identify the reservation escrow phase limit', () => {
    const draft = configuredDraft();
    draft.phases.push({ ...draft.phases[1], id: 'third', name: 'Later mint' });
    const review = reviewConfig(parseDraft(JSON.stringify(draft)));
    assert.ok(review.contractCompatibility.findings.some(finding => finding.code === 'CONTRACT_RESERVATION_PHASES'));
    assert.equal(review.canPublish, false);
});

test('review rejects a hidden or linked public price, early rollover, unknown premium and missing claim window', () => {
    const draft = configuredDraft();
    const [phase, mint] = draft.phases;
    phase.pricing.sourcePhaseId = 'external-price';
    phase.eligibility.kind = 'merkle';
    phase.unusedSupply = 'next';
    mint.pricing.sourcePhaseId = phase.id;
    delete phase.reservation;
    assert.equal(reservationPublicMint(draft.phases, 0), null);
    const findings = reviewConfig(draft).findings.map(finding => finding.code);
    for (const code of ['RESERVATION_MINIMUM', 'RESERVATION_PUBLIC_PRICE', 'RESERVATION_INVENTORY', 'RESERVATION_BIDDERS', 'RESERVATION_REDEMPTION', 'RESERVATION_MINT_PRICE']) {
        assert.ok(findings.includes(code), code);
    }
    mint.pricing.sourcePhaseId = '';
    mint.pricing.priceEth = '';
    assert.ok(reviewConfig(draft).findings.some(finding => finding.code === 'RESERVATION_PUBLIC_PRICE'));
});

test('incomplete reservation fields remain editable and invalid imported field types fail before rendering', () => {
    const draft = createMintReservationDraft();
    assert.deepEqual(parseDraft(JSON.stringify(draft)), draft);
    const [phase] = draft.phases;
    phase.reservation = { redemptionHours: '12' };
    assert.deepEqual(parseDraft(JSON.stringify(draft)), draft);
    for (const invalid of [null, [], { mintPriceEth: {} }, { redemptionHours: -1 }]) {
        phase.reservation = invalid;
        assert.throws(() => parseDraft(JSON.stringify(draft)), /reservation draft/);
    }
    phase.reservation = { mintPriceEth: '1' };
    phase.mechanism = 'fixed';
    assert.ok(reviewConfig(draft).contractCompatibility.findings.some(finding => finding.code === 'CONTRACT_MINT_RESERVATION'));
});
