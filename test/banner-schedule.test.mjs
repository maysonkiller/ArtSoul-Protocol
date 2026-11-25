import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkBannerSchedule } from '../scripts/check-banner-schedule.mjs';
import { previewHomepageBanners } from '../src/features/discovery/banner-preview.js';
import { sampleTime, sampleSchedule, sampleCreatives } from '../src/features/discovery/visual-lab-banner-sample.js';

const at = hour => '2030-03-01T' + String(hour).padStart(2, '0') + ':00:00Z';
const catalog = Object.freeze(Array.from({ length: 15 }, (_, i) => Object.freeze({ id: i + 1 })));
const preview = (schedule = sampleSchedule, creatives = sampleCreatives, when = sampleTime) =>
    previewHomepageBanners(catalog, schedule, creatives, when);
const positions = slots => slots.map(slot => slot.artwork.id);

test('banner delivery preview protects nine ranked positions and discloses exact banner consideration', () => {
    const slots = preview();
    assert.deepEqual(positions(slots), [1,2,3,4,5,6,7,8,9,13,14,15]);
    assert.ok(slots.slice(0,9).every(({promotion}) => !promotion));
    assert.deepEqual(slots.slice(9).map(slot => slot.promotion.consideration), [
        'Free partner placement', 'Winning banner bid of 0.025 ETH', 'Negotiated fee of 0.005 ETH plus workshop space'
    ]);
    assert.deepEqual(slots.slice(9).map(slot => slot.promotion.sponsor), ['Print Room','Studio Nine','Night School']);
    assert.ok(slots.every(slot => slot.artwork === catalog[slot.artwork.id - 1]));
    const schedule = structuredClone(sampleSchedule);
    schedule.placements[2].feeWei = '1';
    assert.match(preview(schedule)[11].promotion.consideration, /0\.000000000000000001 ETH/);
});

test('only the recorded terms can supply the visitor-facing sponsor identity', () => {
    const creatives = new Map(sampleCreatives);
    creatives.set('sample-partner', { ...creatives.get('sample-partner'), name:'Unreviewed alias', relationship:'Unknown' });
    assert.equal(preview(sampleSchedule, creatives)[9].promotion.sponsor, 'Print Room');
    const legacy = structuredClone(sampleSchedule);
    delete legacy.placements[0].sponsorName;
    delete legacy.placements[0].relationship;
    assert.equal(preview(legacy, creatives)[9].promotion, undefined);
    const halfNamed = structuredClone(sampleSchedule);
    delete halfNamed.awards[0].relationship;
    assert.throws(() => checkBannerSchedule(halfNamed, halfNamed, sampleTime), /public sponsor relationship/);
});

test('ineligible and unavailable promotion slots return to organic works in their original order', () => {
    const ids = catalog.slice(0,12).map(art => art.id);
    assert.deepEqual(positions(preview(null)), ids);
    assert.deepEqual(positions(preview(sampleSchedule, sampleCreatives, at(9))), ids);
    assert.deepEqual(positions(preview(sampleSchedule, sampleCreatives, '2030-03-02T10:00:00Z')), ids);
    assert.deepEqual(positions(preview({...sampleSchedule, placements:[...sampleSchedule.placements, sampleSchedule.placements[0]]})), ids);
    assert.deepEqual(positions(preview({...sampleSchedule, awards:[]})), [1,2,3,4,5,6,7,8,9,13,10,15]);
    const creatives = new Map(sampleCreatives);
    creatives.set('sample-partner', { ...creatives.get('sample-partner'), artworkId: 1 });
    creatives.set('sample-auction', { ...creatives.get('sample-auction'), sponsorGroup: 'someone-else' });
    creatives.set('sample-sponsor', { ...creatives.get('sample-sponsor'), artworkId: 99 });
    assert.deepEqual(positions(preview(sampleSchedule, creatives)), ids);
    assert.deepEqual(positions(previewHomepageBanners(catalog.slice(0,5),sampleSchedule,sampleCreatives,sampleTime)), ids.slice(0,5));
});
const empty = { placements: [], awards: [] };
const plan = (placements, awards = []) => ({ placements, awards });
const common = {
    id: 'launch', slot: 1, publishedAt: at(1), startsAt: at(9), endsAt: at(12),
    termsUrl: 'https://example.org/terms/launch', proposedBy: 'program', approvedBy: 'reviewer'
};
const auction = {
    ...common, kind: 'auction', opensAt: at(3), closesAt: at(7),
    reserveWei: '30', payee: 'ProtocolTreasury'
};
const free = {
    ...common, id: 'free', slot: 2, kind: 'free-partner', sponsorGroup: 'gallery',
    reason: 'Partner exhibition, provided without consideration.'
};
const deal = {
    ...common, id: 'deal', slot: 3, kind: 'negotiated', sponsorGroup: 'collective',
    reason: 'Festival sponsorship.', feeWei: '12', inKind: 'A venue for the public exhibition.',
    payee: 'ProtocolTreasury'
};
const award = {
    placementId: 'launch', sponsorGroup: 'studio', winningBidWei: '31',
    decidedAt: at(8), recordUrl: 'https://example.org/results/launch'
};

test('one auction, one free partner and one negotiated sponsor leave at least nine organic slots', () => {
    const before = plan([auction, free, deal]);
    const after = plan(before.placements, [award]);
    assert.equal(checkBannerSchedule(empty, before, at(2)).scheduledPromoted, 0);
    assert.equal(checkBannerSchedule(before, after, at(8)).awards, 1);
    assert.deepEqual(checkBannerSchedule(after, after, at(10)), {
        asOf: at(10), placements: 3, awards: 1, scheduledPromoted: 3, availableOrganic: 9
    });
    assert.equal(checkBannerSchedule(after, after, at(12)).availableOrganic, 12);
    assert.equal(checkBannerSchedule(before, before, at(10)).availableOrganic, 10);
});

test('all kinds share three lanes and independent group occupancy across the same period', () => {
    const addFree = changes => plan([auction, free, deal, { ...free, id: 'more', ...changes }]);
    assert.throws(() => checkBannerSchedule(empty, addFree({ slot: 4 }), at(2)), /three promotion slots/);
    assert.throws(() => checkBannerSchedule(empty, addFree({ sponsorGroup: 'other' }), at(2)), /Overlapping slot/);
    assert.throws(() => checkBannerSchedule(empty, plan([free, { ...deal, sponsorGroup: free.sponsorGroup }]), at(2)), /Overlapping sponsorGroup/);
    const booked = plan([auction, free]);
    assert.throws(() => checkBannerSchedule(booked, plan(booked.placements, [{ ...award, sponsorGroup: free.sponsorGroup }]), at(8)), /Overlapping sponsorGroup/);
    assert.doesNotThrow(() => checkBannerSchedule(empty, addFree({ startsAt: at(12), endsAt: at(13) }), at(2)));
});

test('each new auction can set a publicly disclosed reserve and cannot reprice or replace an existing auction', () => {
    const previous = plan([auction]);
    const later = { ...auction, id: 'next-day', startsAt: at(12), endsAt: at(14), reserveWei: '18446744073709551617' };
    assert.doesNotThrow(() => checkBannerSchedule(previous, plan([later, auction]), at(2)));
    for (const change of [
        { reserveWei: '29' }, { termsUrl: 'https://example.org/private-revision' },
        { approvedBy: 'another-group' }, { endsAt: at(13) }, { id: 'replacement' }
    ]) {
        assert.throws(() => checkBannerSchedule(previous, plan([{ ...auction, ...change }]), at(2)), /changed or removed/);
    }
    assert.throws(() => checkBannerSchedule(previous, empty, at(5)), /changed or removed/);
    assert.throws(() => checkBannerSchedule(empty, previous, at(3)), /opening deadline/);
    assert.throws(() => checkBannerSchedule(empty, plan([{ ...auction, reserveWei: '29' }]), at(6)), /opening deadline/);
});

test('direct agreements publish exact cash and non-cash consideration before delivery; free is a separate mode', () => {
    const before = plan([deal]);
    assert.doesNotThrow(() => checkBannerSchedule(empty, plan([{ ...deal, feeWei: '0' }]), at(2)));
    assert.doesNotThrow(() => checkBannerSchedule(empty, plan([{ ...deal, inKind: null }]), at(2)));
    for (const terms of [
        { ...deal, feeWei: '0', inKind: null }, { ...deal, inKind: ' ' },
        { ...deal, reason: '' }, { ...deal, payee: 'Seller' }, { ...free, feeWei: '0' },
        { ...free, inKind: 'Private benefits' }, { ...auction, privateDiscountBps: 500 },
        { ...deal, guaranteedRanking: 1 }, { ...deal, guaranteedMint: true },
        { ...auction, sponsorGroup: 'preselected' }
    ]) assert.throws(() => checkBannerSchedule(empty, plan([terms]), at(2)));
    assert.throws(() => checkBannerSchedule(before, plan([{ ...deal, feeWei: '6' }]), at(3)), /changed or removed/);
    assert.throws(() => checkBannerSchedule(empty, before, at(9)), /opening deadline/);
});

test('rejects conflicted reviewers and collection of auction proceeds by a different payee', () => {
    for (const row of [
        { ...auction, proposedBy: auction.approvedBy }, { ...free, sponsorGroup: free.approvedBy },
        { ...deal, approvedBy: deal.sponsorGroup }, { ...auction, payee: 'EcosystemTreasury' }
    ]) assert.throws(() => checkBannerSchedule(empty, plan([row]), at(2)));
    for (const group of [auction.proposedBy, auction.approvedBy]) {
        assert.throws(() => checkBannerSchedule(plan([auction]), plan([auction], [{ ...award, sponsorGroup: group }]), at(8)), /conflict/);
    }
});

test('requires one immutable auction result with independent sponsor, valid timing and a bid at least equal to the reserve', () => {
    const initial = plan([auction, free]);
    const finalized = plan(initial.placements, [award]);
    const candidates = [
        { ...award, placementId: 'free' }, { ...award, placementId: 'unknown' },
        { ...award, winningBidWei: '29' }, { ...award, decidedAt: at(6) },
        { ...award, decidedAt: at(10) }, { ...award, recordUrl: 'file:///tmp' }
    ];
    for (const result of candidates) {
        assert.throws(() => checkBannerSchedule(initial, plan(initial.placements, [result]), at(8)));
    }
    assert.throws(() => checkBannerSchedule(initial, finalized, at(7)), /decision window/);
    assert.throws(() => checkBannerSchedule(initial, finalized, at(10)), /after delivery began/);
    assert.throws(() => checkBannerSchedule(finalized, plan(initial.placements, [award, award]), at(8)), /Duplicate/);
    assert.throws(() => checkBannerSchedule(finalized, initial, at(8)), /changed or removed/);
    assert.throws(() => checkBannerSchedule(finalized, plan(initial.placements, [{ ...award, sponsorGroup: 'other' }]), at(8)), /changed or removed/);
    assert.doesNotThrow(() => checkBannerSchedule(initial, plan(initial.placements, [{ ...award, winningBidWei: auction.reserveWei }]), at(8)));
});

test('requires finite ordered UTC terms and one exact wei value per published price', () => {
    const invalid = [
        { publishedAt: at(3) }, { opensAt: at(1) }, { closesAt: at(10) }, { endsAt: at(9) },
        { startsAt: '2030-02-30T10:00:00Z' }, { endsAt: null }, { endsAt: 'forever' },
        { termsUrl: 'https://user:pass@example.org/terms' }, { slot: 1.5 },
        ...['1.5', 30, '01', '-1', '1e10', (2n ** 256n).toString(), undefined].map(reserveWei => ({ reserveWei }))
    ];
    for (const change of invalid) assert.throws(() => checkBannerSchedule(empty, plan([{ ...auction, ...change }]), at(2)));
    assert.doesNotThrow(() => checkBannerSchedule(empty, plan([{ ...auction, reserveWei: (2n ** 256n - 1n).toString() }]), at(2)));
    assert.throws(() => checkBannerSchedule(empty, plan([auction, auction]), at(2)), /Duplicate/);
    assert.throws(() => checkBannerSchedule({}, empty, at(2)), /fields/);
});

test('operator CLI reads retained files without changing them and returns an error for a bad successor', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'artsoul-banner-schedule-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const reference = join(dir, 'published.json');
    const proposed = join(dir, 'proposed.json');
    const publishedText = JSON.stringify(plan([auction]));
    await writeFile(reference, publishedText);
    await writeFile(proposed, JSON.stringify(plan([auction, free])));
    const cli = fileURLToPath(new URL('../scripts/check-banner-schedule.mjs', import.meta.url));
    const run = () => spawnSync(process.execPath, [cli, reference, proposed, at(2)], { encoding: 'utf8' });
    const checked = run();
    assert.equal(checked.status, 0, checked.stderr);
    assert.equal(JSON.parse(checked.stdout).placements, 2);
    await writeFile(proposed, JSON.stringify(empty));
    const denied = run();
    assert.equal(denied.status, 1);
    assert.match(denied.stderr, /changed or removed/);
    assert.equal(denied.stdout, '');
    assert.equal(await readFile(reference, 'utf8'), publishedText);
    assert.equal(await readFile(proposed, 'utf8'), JSON.stringify(empty));
});
