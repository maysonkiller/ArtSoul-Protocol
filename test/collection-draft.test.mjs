import assert from 'node:assert/strict';
import test from 'node:test';
import { assetIdentity, changeDraftSupply, createAuctionMintDraft, createDraft, createFirstArtworkDraft, createOriginDraft, createPhase, DRAFT_KEY, feePreview, loadDraft, MAX_DRAFT_ITEMS, parseDraft, parseEth, reviewConfig, saveDraft, scheduleTimestamp } from '../src/features/collections/launch-config.js';
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

test('metadata review previews the exact ERC-721 token URI and flags ambiguous prefixes in saved drafts', () => {
    const draft = configured();
    for (const prefix of ['ipfs://bafyfixture/', 'ipfs://bafyfixture/metadata/token-', 'https://example.com/tokens/', 'https://example.com?token=']) {
        draft.media.metadataBaseURI = prefix;
        const review = reviewConfig(draft);
        assert.equal(review.tokenOneMetadataURI, prefix + '1');
        assert.ok(!review.findings.some(f => f.code === 'METADATA_REQUIRED'));
    }
    for (const prefix of ['ipfs://bafyfixture', 'https://example.com', 'ipfs://bafyfixture/?token=', 'https://example.com/tokens/#id', 'https://example.com/tokens/#', 'https://user@example.com/tokens/', ' https://example.com/tokens/']) {
        draft.media.metadataBaseURI = prefix;
        const imported = parseDraft(JSON.stringify(draft));
        assert.equal(imported.media.metadataBaseURI, prefix);
        const review = reviewConfig(imported);
        assert.equal(review.tokenOneMetadataURI, '');
        assert.ok(review.findings.some(f => f.code === 'METADATA_REQUIRED'), prefix);
    }
});

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

test('the edition template links the public mint to its own auction and leaves monetary terms to the creator', () => {
    const draft = createAuctionMintDraft();
    const [auction, mint] = draft.phases;
    assert.equal(draft.chainId, 84532);
    assert.equal(draft.maxSupply, '');
    assert.equal(auction.mechanism, 'uniform-auction');
    assert.equal(auction.walletLimit, 1);
    assert.equal(mint.mechanism, 'fixed');
    assert.equal(mint.pricing.sourcePhaseId, auction.id);
    assert.equal(mint.pricing.fallback, 'pause');
    for (const phase of draft.phases) {
        assert.equal(phase.allocation, '');
        assert.equal(phase.pricing.priceEth, '');
        assert.equal(phase.startAt, '');
        assert.equal(phase.endAt, '');
    }
    assert.deepEqual(parseDraft(JSON.stringify(draft)), draft);
    assert.equal(reviewConfig(draft).canPublish, false);
});

test('any creator can save a first artwork launch with one reserved work and linked remaining mint prices', () => {
    const draft = configured();
    draft.chainId = 84532;
    draft.phases = createFirstArtworkDraft().phases;
    const [opening, mint] = draft.phases;
    assert.equal(opening.mechanism, 'first-artwork-auction');
    assert.equal(opening.allocation, 1);
    assert.equal(opening.eligibility.kind, 'public');
    assert.equal(mint.pricing.sourcePhaseId, opening.id);
    Object.assign(opening, { startAt: '2027-01-01T12:00:00Z', endAt: '2027-01-02T12:00:00Z' });
    opening.pricing.priceEth = '1';
    Object.assign(mint, { allocation: 99, startAt: opening.endAt, endAt: '2027-01-03T12:00:00Z' });
    const reviewed = reviewConfig(parseDraft(JSON.stringify(draft)));
    assert.deepEqual(reviewed.findings, []);
    assert.equal(reviewed.contractCompatibility.compatible, true);
    assert.equal(reviewed.canPublish, false);
    mint.pricing.sourcePhaseId = '';
    mint.pricing.priceEth = '10';
    assert.ok(reviewConfig(draft).findings.some(item => item.code === 'FIRST_ARTWORK_MINT_PRICE'));
    opening.allocation = 2;
    assert.ok(reviewConfig(draft).findings.some(item => item.code === 'FIRST_ARTWORK_TERMS'));
    draft.phases = [opening];
    assert.ok(reviewConfig(draft).findings.some(item => item.code === 'FIRST_ARTWORK_MINT_REQUIRED'));
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

test('only an explicitly selected first-work template uses the restricted local artifact and creator royalty', () => {
    const settings = configured();
    const draft = createFirstArtworkDraft();
    Object.assign(draft, { name: settings.name, description: settings.description, holderRights: settings.holderRights,
        media: settings.media, maxSupply: 100 });
    const [first, mint] = draft.phases;
    Object.assign(first, { startAt: '2027-01-01T12:00:00Z', endAt: '2027-01-02T12:00:00Z' });
    first.pricing.priceEth = '0.1';
    Object.assign(mint, { allocation: 99, startAt: first.endAt, endAt: '2027-01-03T12:00:00Z' });
    const storage = memoryStorage();
    saveDraft(storage, draft);
    const review = reviewConfig(loadDraft(storage));
    assert.equal(review.contractCompatibility.firstWorkArtifact, 'PartnerFirstWorkLaunch');
    assert.equal(review.contractCompatibility.compatible, true);
    assert.equal(review.canPublish, false);
    assert.equal(draft.creatorEarnings.bps, 550);
    for (const [edit, code] of [
        [d => { d.phases.push(createPhase()); }, 'FIRST_WORK_PHASES'],
        [d => { d.phases[1].eligibility.kind = 'merkle'; }, 'FIRST_WORK_PHASES'],
        [d => { d.phases[0].mechanism = 'uniform-auction'; }, 'FIRST_WORK_PHASES'],
        [d => { d.phases[1].allocation = 98; }, 'FIRST_WORK_REMAINDER'],
        [d => { d.maxSupply = 1; }, 'FIRST_WORK_REMAINDER'],
        [d => { d.creatorEarnings.bps = 0; }, 'FIRST_WORK_ROYALTY'],
        [d => { d.creatorEarnings.recipients = [{ address: '0x' + 'a'.repeat(40), bps: 550 }]; }, 'FIRST_WORK_ROYALTY']
    ]) {
        const changed = structuredClone(draft);
        edit(changed);
        const result = reviewConfig(changed);
        assert.ok(result.contractCompatibility.findings.some(f => f.code === code));
        assert.equal(result.contractCompatibility.compatible, false);
    }
    const legacy = structuredClone(draft);
    delete legacy.launchTemplate;
    legacy.creatorEarnings.bps = 0;
    legacy.phases[1].allocation = 98;
    assert.equal(reviewConfig(parseDraft(JSON.stringify(legacy))).contractCompatibility.compatible, true);
    for (const other of [legacy, createAuctionMintDraft(), createOriginDraft()]) {
        assert.equal(reviewConfig(other).contractCompatibility.firstWorkArtifact, null);
    }
});

test('editing first-work supply reserves one opening NFT and resizes only the public allocation', () => {
    const draft = createFirstArtworkDraft();
    const [opening, mint] = draft.phases;
    mint.walletLimit = 2;
    for (const [supply, remainder] of [['100', 99], ['2', 1], ['4294967295', 4294967294],
        ['', ''], ['1', ''], ['1.5', ''], ['4294967296', '']]) {
        const sized = changeDraftSupply(draft, supply);
        assert.equal(sized.maxSupply, supply);
        assert.deepEqual(sized.phases, [{ ...opening, allocation: 1 }, { ...mint, allocation: remainder }]);
    }
    const resized = changeDraftSupply(changeDraftSupply(draft, '100'), '12');
    const store = memoryStorage();
    saveDraft(store, resized);
    assert.deepEqual(loadDraft(store), resized);
    assert.equal(resized.phases[1].allocation, 11);
    assert.equal(draft.phases[1].allocation, '');

    const legacy = structuredClone(resized);
    delete legacy.launchTemplate;
    const reordered = { ...resized, phases: [...resized.phases].reverse() };
    for (const custom of [legacy, reordered, createAuctionMintDraft(), createOriginDraft()]) {
        assert.deepEqual(changeDraftSupply(custom, '50').phases, custom.phases);
    }
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
