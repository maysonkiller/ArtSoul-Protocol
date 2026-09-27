import assert from 'node:assert/strict';
import test from 'node:test';
import { createDraft, createPhase, parseDraft, reviewConfig, reviewLocalContractCapabilities } from '../src/features/collections/launch-config.js';

const receiver = '0x1111111111111111111111111111111111111111';
const otherReceiver = '0x2222222222222222222222222222222222222222';
const root = '0x' + 'ab'.repeat(32);

function configured(count = 1) {
    const draft = createDraft();
    Object.assign(draft, { name: 'Local studies', description: 'Contract compatibility fixture.', maxSupply: count * 100, holderRights: 'Personal display only.' });
    draft.media.metadataBaseURI = 'ipfs://collection-fixture/';
    draft.phases = Array.from({ length: count }, (_, index) => ({
        ...createPhase(index + 1), id: `phase-${index}`, allocation: 100,
        startAt: new Date(Date.UTC(2027, 0, 1, index)).toISOString(),
        endAt: new Date(Date.UTC(2027, 0, 1, index + 1)).toISOString(),
        pricing: { priceEth: '0.001', sourcePhaseId: '', fallback: 'pause' }
    }));
    return draft;
}

function codes(draft) { return reviewLocalContractCapabilities(draft).map(finding => finding.code); }

test('compatible settings remain a read-only draft with no transaction or publish approval', () => {
    const draft = configured();
    const before = JSON.stringify(draft);
    const review = reviewConfig(draft);
    assert.deepEqual(review.findings, []);
    assert.deepEqual(review.contractCompatibility.findings, []);
    assert.equal(review.contractCompatibility.compatible, true);
    assert.equal(review.canPublish, false);
    assert.equal(JSON.stringify(draft), before);
    assert.equal('transaction' in review, false);
    assert.match(review.deploymentBlockers.join(' '), /royalty receiver.*zero royalties/);
    assert.match(review.deploymentBlockers.join(' '), /actual chain, collection address and phase/);
});

test('public, reviewed Merkle, auction-linked price and separate Forge settings fit local checks', () => {
    const draft = configured(3);
    const [free, auction, mint] = draft.phases;
    free.mechanism = 'claim';
    free.pricing.priceEth = '0';
    free.eligibility = { ...free.eligibility, kind: 'merkle', merkleRoot: root, note: 'Reviewed local fixture only.' };
    free.unusedSupply = 'next';
    auction.mechanism = 'uniform-auction';
    mint.pricing = { priceEth: '', sourcePhaseId: auction.id, fallback: 'pause' };
    draft.creatorEarnings = { bps: 550, recipients: [{ address: receiver, bps: 550 }] };
    draft.crafting = { enabled: true, inputCount: 10, outputMaxSupply: 30 };
    const review = reviewConfig(draft);
    assert.deepEqual(review.findings, []);
    assert.deepEqual(review.contractCompatibility.findings, []);
    assert.equal(review.contractCompatibility.compatible, true);
    assert.equal(review.canPublish, false);
    assert.match(review.contractCompatibility.notes.join(' '), /partially subscribed source does not qualify/);
    assert.match(review.contractCompatibility.notes.join(' '), /No Genesis right is created/);
});

test('draft capacity does not imply the local contract accepts more than 32 phases', () => {
    const draft = configured(32);
    assert.equal(reviewConfig(draft).contractCompatibility.compatible, true);
    const tooMany = configured(33);
    assert.deepEqual(reviewConfig(tooMany).findings, []);
    assert.ok(codes(tooMany).includes('CONTRACT_PHASE_LIMIT'));
    assert.equal(parseDraft(JSON.stringify(tooMany)).phases.length, 33, 'unsupported drafts remain editable without truncation');
});

test('uint32 boundaries reject otherwise-valid safe integers without rounding', () => {
    const draft = configured();
    draft.maxSupply = '4294967295';
    draft.phases[0].allocation = '4294967295';
    draft.phases[0].walletLimit = '4294967295';
    assert.equal(reviewConfig(draft).contractCompatibility.compatible, true);
    draft.maxSupply = '4294967296';
    draft.phases[0].allocation = '4294967296';
    draft.phases[0].walletLimit = '4294967296';
    assert.deepEqual(reviewConfig(draft).findings, []);
    assert.ok(codes(draft).includes('CONTRACT_SUPPLY_WIDTH'));
    assert.ok(codes(draft).includes('CONTRACT_PHASE_WIDTH'));
    for (const invalid of [true, null, '', '1e3', '9007199254740993']) {
        draft.maxSupply = invalid;
        assert.ok(codes(draft).includes('CONTRACT_SUPPLY_WIDTH'));
    }
});

test('timestamps are never silently truncated or encoded as negative unsigned seconds', () => {
    const draft = configured();
    draft.phases[0].startAt = '2027-01-01T02:00:00.000+02:00';
    assert.ok(!codes(draft).includes('CONTRACT_TIMESTAMP'));
    draft.phases[0].startAt = '2027-01-01T00:00:00.001Z';
    assert.deepEqual(reviewConfig(draft).findings, []);
    assert.ok(codes(draft).includes('CONTRACT_TIMESTAMP'));
    draft.phases[0].startAt = '1969-12-31T23:59:59Z';
    assert.ok(codes(draft).includes('CONTRACT_TIMESTAMP'));
});

test('guaranteed allocation and burn/craft phases cannot masquerade as fixed mints', () => {
    const draft = configured();
    for (const mechanism of ['gtd', 'burn', 'craft', '__proto__', 'unknown']) {
        draft.phases[0].mechanism = mechanism;
        assert.ok(codes(draft).includes('CONTRACT_MECHANISM'), mechanism);
        assert.equal(reviewConfig(draft).contractCompatibility.compatible, false);
    }
    for (const mechanism of ['fixed', 'fcfs', 'free', 'claim']) {
        draft.phases[0].mechanism = mechanism;
        draft.phases[0].pricing.priceEth = ['free', 'claim'].includes(mechanism) ? '0' : '0.001';
        assert.equal(reviewConfig(draft).contractCompatibility.compatible, true, mechanism);
    }
});

test('unsupported eligibility stays blocked even with a plausible holder address or note', () => {
    const draft = configured();
    for (const kind of ['genesis', 'nft', 'trait', 'collection', 'profile', 'discord', 'auction-participant', 'auction-loser', 'previous-holder', 'previous-phase', 'partner', 'forged', '__proto__']) {
        draft.phases[0].eligibility = { kind, contractAddress: receiver, chainId: draft.chainId, note: 'Claimed eligibility source.', merkleRoot: '' };
        assert.ok(codes(draft).includes('CONTRACT_ELIGIBILITY'), kind);
        assert.equal(reviewConfig(draft).contractCompatibility.compatible, false);
    }
});

test('allowlists require a nonzero root and cannot be silently downgraded to public access', () => {
    const draft = configured();
    const eligibility = draft.phases[0].eligibility;
    eligibility.kind = 'wallet-allowlist';
    eligibility.note = 'Reviewed local fixture only.';
    for (const invalid of ['', '0x' + '00'.repeat(32), '0x1234']) {
        eligibility.merkleRoot = invalid;
        assert.ok(codes(draft).includes('CONTRACT_MERKLE_ROOT'));
    }
    eligibility.merkleRoot = root;
    assert.equal(reviewConfig(draft).contractCompatibility.compatible, true);
    eligibility.kind = 'public';
    assert.ok(codes(draft).includes('CONTRACT_PUBLIC_ROOT'));
    eligibility.merkleRoot = '';
    eligibility.contractAddress = receiver;
    assert.ok(codes(draft).includes('CONTRACT_HOLDER_RULE'));
});

test('auction checks reject multi-unit and allowlist bids that the contract cannot enforce', () => {
    const draft = configured();
    const phase = draft.phases[0];
    phase.mechanism = 'uniform-auction';
    phase.walletLimit = 2;
    assert.deepEqual(reviewConfig(draft).findings, []);
    assert.ok(codes(draft).includes('CONTRACT_AUCTION_LIMIT'));
    phase.walletLimit = '1';
    phase.eligibility = { ...phase.eligibility, kind: 'merkle', merkleRoot: root, note: 'Allowlisted auction proposal.' };
    assert.deepEqual(reviewConfig(draft).findings, []);
    assert.ok(codes(draft).includes('CONTRACT_AUCTION_ELIGIBILITY'));
});

test('free phases and auctions cannot inherit another auction price', () => {
    const draft = configured(2);
    draft.phases[0].mechanism = 'uniform-auction';
    const linked = draft.phases[1];
    linked.pricing = { priceEth: '', sourcePhaseId: draft.phases[0].id, fallback: 'pause' };
    for (const mechanism of ['free', 'claim']) {
        linked.mechanism = mechanism;
        assert.deepEqual(reviewConfig(draft).findings, []);
        assert.ok(codes(draft).includes('CONTRACT_FREE_PRICE_SOURCE'));
    }
    linked.mechanism = 'uniform-auction';
    assert.ok(codes(draft).includes('CONTRACT_AUCTION_PRICE_SOURCE'));
    linked.mechanism = 'fixed';
    linked.pricing.fallback = 'fixed-price';
    assert.ok(codes(draft).includes('CONTRACT_FALLBACK_POLICY'));
});

test('unused allocation destinations do not invent reserve administration or phase skipping', () => {
    const draft = configured(2);
    for (const destination of ['reserve', 'public']) {
        draft.phases[0].unusedSupply = destination;
        assert.deepEqual(reviewConfig(draft).findings, []);
        assert.ok(codes(draft).includes('CONTRACT_UNUSED_SUPPLY'));
    }
    draft.phases[0].unusedSupply = 'next';
    assert.equal(reviewConfig(draft).contractCompatibility.compatible, true);
    draft.phases[1].unusedSupply = 'next';
    assert.ok(codes(draft).includes('CONTRACT_FINAL_ROLLOVER'));
});

test('single-receiver royalties and absent support routing are independent of proposed fee totals', () => {
    const draft = configured();
    draft.creatorEarnings = { bps: 550, recipients: [{ address: receiver, bps: 300 }, { address: otherReceiver, bps: 250 }] };
    assert.deepEqual(reviewConfig(draft).findings, []);
    assert.ok(codes(draft).includes('CONTRACT_ROYALTY_SPLIT'));
    draft.creatorEarnings.recipients = [{ address: receiver, bps: 550 }];
    assert.equal(reviewConfig(draft).contractCompatibility.compatible, true);
    draft.support.bps = 1;
    assert.deepEqual(reviewConfig(draft).findings, []);
    assert.ok(codes(draft).includes('CONTRACT_SUPPORT'));
});

test('Forge recipe input bounds are enforced independently of the draft supply equation', () => {
    const draft = configured();
    draft.crafting = { enabled: true, inputCount: 1, outputMaxSupply: 1 };
    for (const inputCount of [1, 33, 100]) {
        draft.crafting.inputCount = inputCount;
        assert.deepEqual(reviewConfig(draft).findings, []);
        assert.ok(codes(draft).includes('CONTRACT_FORGE_INPUTS'));
    }
    for (const inputCount of [2, 32]) {
        draft.crafting.inputCount = inputCount;
        assert.equal(reviewConfig(draft).contractCompatibility.compatible, true);
    }
});

test('compatibility never hides general draft invalidity or interprets imported extension fields', () => {
    const draft = configured();
    draft.extensionProposal = { customReceiver: otherReceiver, futurePrice: '1000' };
    const roundTrip = parseDraft(JSON.stringify(draft));
    assert.deepEqual(roundTrip.extensionProposal, draft.extensionProposal);
    assert.equal(reviewConfig(roundTrip).canPublish, false);
    roundTrip.name = '';
    const review = reviewConfig(roundTrip);
    assert.deepEqual(review.contractCompatibility.findings, []);
    assert.equal(review.contractCompatibility.compatible, false);
});
