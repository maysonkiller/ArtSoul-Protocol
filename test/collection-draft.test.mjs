import assert from 'node:assert/strict';
import test from 'node:test';
import { assetIdentity, createDraft, createOriginDraft, createPhase, DRAFT_KEY, feePreview, loadDraft, MAX_DRAFT_ITEMS, parseDraft, parseEth, reviewConfig, saveDraft, scheduleTimestamp } from '../src/features/collections/launch-config.js';
import { COLLECTION_NETWORKS } from '../src/config/collection-networks.js';

function configured() {
    const draft = createDraft();
    Object.assign(draft, { name: 'Garden Studies', description: 'Original color studies for a local draft.', maxSupply: 100, holderRights: 'Personal display rights; copyright remains with the creator.' });
    draft.media.metadataBaseURI = 'ipfs://bafyfixture/';
    Object.assign(draft.phases[0], { allocation: 100, startAt: '2027-01-01T12:00:00.000Z', endAt: '2027-01-02T12:00:00.000Z' });
    draft.phases[0].pricing.priceEth = '0.001';
    return draft;
}

function memoryStorage() {
    const values = new Map();
    return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test('malformed recipient entries are rejected before they can crash the builder review', () => {
    const draft = createDraft();
    draft.creatorEarnings.recipients = [null];
    assert.throws(() => parseDraft(JSON.stringify(draft)), /draft/i);
});

test('boolean supply is not a positive numeric quantity', () => {
    const draft = createDraft();
    draft.maxSupply = true;
    assert.ok(reviewConfig(draft).findings.some(item => item.code === 'SUPPLY_INVALID'));
});

test('prototype eligibility names cannot masquerade as declared eligibility rules', () => {
    const draft = createDraft();
    draft.phases[0].eligibility.kind = '__proto__';
    draft.phases[0].eligibility.note = 'Untrusted imported eligibility';
    assert.ok(reviewConfig(draft).findings.some(item => item.code === 'ELIGIBILITY_INVALID'));
});

test('asset identity rejects unsafe numeric token IDs instead of rounding them', () => {
    assert.throws(() => assetIdentity(84532, '0x1111111111111111111111111111111111111111', 9007199254740993));
});

test('blank generic drafts do not assume Origin supply or enable crafting', () => {
    const draft = createDraft();
    assert.equal(draft.maxSupply, '');
    assert.equal(draft.phases.length, 1);
    assert.equal(draft.phases[0].allocation, '');
    assert.equal(draft.crafting.enabled, false);
    assert.equal(draft.crafting.inputCount, '');
    assert.deepEqual(parseDraft(JSON.stringify(draft)), draft);
});

test('local persistence round-trips all fields including imported extension data', () => {
    const storage = memoryStorage();
    assert.equal(loadDraft(storage), null);
    const draft = createOriginDraft();
    draft.futureOptions = { custom: ['kept', 7], note: 'Preserve without interpreting' };
    draft.creatorEarnings = { bps: 100, recipients: [{ address: '0x1111111111111111111111111111111111111111', bps: 100 }] };
    saveDraft(storage, draft);
    assert.deepEqual(loadDraft(storage), draft);
    assert.equal(loadDraft(storage).status, 'draft');
    assert.equal(reviewConfig(loadDraft(storage)).canPublish, false);
});

test('failed import or save does not overwrite the last saved copy', () => {
    const storage = memoryStorage();
    saveDraft(storage, configured());
    const before = storage.getItem(DRAFT_KEY);
    const malformed = configured();
    malformed.creatorEarnings.recipients = [null];
    assert.throws(() => parseDraft(JSON.stringify(malformed)));
    assert.throws(() => saveDraft(storage, malformed));
    assert.equal(storage.getItem(DRAFT_KEY), before);
    const quotaStorage = { getItem: storage.getItem, setItem() { throw new Error('Quota exceeded'); } };
    assert.throws(() => saveDraft(quotaStorage, createDraft()), /Quota/);
    assert.equal(storage.getItem(DRAFT_KEY), before);
});

test('invalid stored JSON is reported without removing or replacing it', () => {
    const storage = memoryStorage();
    storage.setItem(DRAFT_KEY, '{broken');
    assert.throws(() => loadDraft(storage));
    assert.equal(storage.getItem(DRAFT_KEY), '{broken');
});

test('structural validation rejects malformed nested fields and oversized drafts', () => {
    for (const mutate of [
        d => { d.media = []; }, d => { d.links = 'wrong'; }, d => { delete d.media.bannerUrl; },
        d => { d.utilities = [null]; }, d => { d.phases = [null]; }, d => { d.phases[0].pricing = []; },
        d => { d.phases[0].eligibility.kind = {}; }, d => { d.crafting.enabled = 'true'; },
        d => { d.creatorEarnings.recipients = [{ address: null, bps: 100 }]; },
        d => { d.maxSupply = true; }, d => { d.phases[0].allocation = null; },
        d => { d.phases = Array.from({ length: MAX_DRAFT_ITEMS + 1 }, () => createPhase()); },
        d => { d.status = 'published'; }
    ]) {
        const draft = configured();
        mutate(draft);
        assert.throws(() => parseDraft(JSON.stringify(draft)), /draft/i);
    }
    assert.throws(() => parseDraft(' '.repeat(250001)), /large/);
});

test('valid configuration remains undeployed and unpublishable with transparent blockers', () => {
    const review = reviewConfig(configured());
    assert.deepEqual(review.findings, []);
    assert.equal(review.allocationTotal, '100');
    assert.equal(review.reserve, '0');
    assert.equal(review.passedFactors, review.factors.length);
    assert.equal(review.canPublish, false);
    assert.ok(review.deploymentBlockers.length > 0);
    assert.ok(COLLECTION_NETWORKS.every(network => network.testnet && !network.writeEnabled));
});

test('allocation quantities remain exact and malformed integer notation cannot crash review', () => {
    for (const value of [true, false, '', '1e3', '0x10', '1.0', 'not a number', '9007199254740992']) {
        const draft = configured();
        draft.phases[0].allocation = value;
        assert.ok(reviewConfig(draft).findings.some(item => item.code === 'ALLOCATION_INVALID'), String(value));
    }
    const draft = configured();
    draft.phases[0].allocation = 101;
    assert.ok(reviewConfig(draft).findings.some(item => item.code === 'OVERALLOCATED'));
    draft.phases[0].allocation = '100';
    draft.phases[0].walletLimit = 101;
    assert.ok(reviewConfig(draft).findings.some(item => item.code === 'WALLET_LIMIT_INVALID'));
});

test('phase edits and reordering expose overlapping schedules and broken price references', () => {
    const draft = configured();
    draft.phases[0].mechanism = 'uniform-auction';
    draft.phases[0].allocation = 50;
    const second = createPhase(2);
    Object.assign(second, { allocation: 50, startAt: draft.phases[0].endAt, endAt: '2027-01-03T12:00:00.000Z' });
    second.pricing.sourcePhaseId = draft.phases[0].id;
    draft.phases.push(second);
    assert.deepEqual(reviewConfig(draft).findings, []);
    second.startAt = draft.phases[0].startAt;
    assert.ok(reviewConfig(draft).findings.some(item => item.code === 'PHASE_OVERLAP'));
    draft.phases.reverse();
    assert.ok(reviewConfig(draft).findings.some(item => item.code === 'PRICE_SOURCE_INVALID'));
    draft.phases.pop();
    assert.ok(reviewConfig(draft).findings.some(item => item.code === 'PRICE_SOURCE_INVALID'));
});

test('schedules carry explicit timezones and reject impossible calendar dates', () => {
    assert.equal(scheduleTimestamp('2027-01-01T14:00:00+02:00'), scheduleTimestamp('2027-01-01T12:00:00.000Z'));
    for (const value of ['', '2027-01-01T12:00', '2027-02-31T12:00:00Z', '2027-01-01T25:00:00Z', '1Z']) assert.ok(Number.isNaN(scheduleTimestamp(value)), value);
    const draft = configured();
    draft.phases[0].startAt = '2027-01-01T12:00';
    assert.ok(reviewConfig(draft).findings.some(item => item.code === 'SCHEDULE_INVALID'));
});

test('draft pricing uses exact wei and does not invent missing clearing prices or fees', () => {
    assert.equal(parseEth('0.000000000000000001'), 1n);
    for (const price of ['', '0,001', '-1', 'NaN', '1e-3', '0.0000000000000000001']) assert.equal(parseEth(price), null);
    const draft = configured();
    draft.phases[0].pricing.sourcePhaseId = 'not-configured';
    draft.phases[0].pricing.fallback = 'use-default-price';
    const codes = reviewConfig(draft).findings.map(item => item.code);
    assert.ok(codes.includes('PRICE_SOURCE_INVALID'));
    assert.ok(codes.includes('AMBIGUOUS_PRICE'));
    assert.ok(codes.includes('FALLBACK_REQUIRED'));
    assert.deepEqual(feePreview(10000n, 100, 50), { creator: 100n, support: 50n, remainingBeforeMarketplaceFee: 9850n, marketplaceFee: null });
    assert.equal(feePreview(10000n, true, 50), null);
});

test('eligibility and unused allocation are explicit draft rules rather than inferred rights', () => {
    const draft = configured();
    const phase = draft.phases[0];
    phase.eligibility = { ...phase.eligibility, kind: 'discord', chainId: 84532, note: 'A proposed community role' };
    phase.unusedSupply = 'next';
    const codes = reviewConfig(draft).findings.map(item => item.code);
    assert.ok(codes.includes('OFFCHAIN_PROOF'));
    assert.ok(codes.includes('CROSS_CHAIN'));
    assert.ok(codes.includes('NEXT_MISSING'));
    draft.chainId = 4663;
    assert.ok(reviewConfig(draft).findings.some(item => item.code === 'TESTNET_REQUIRED'));
});
