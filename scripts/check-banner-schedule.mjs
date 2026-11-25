import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';

// A proposed publication is checked against the last independently retained public schedule.
// This tool has no signing, network, database or payment path.
const homeSlots = 12;
const promotionSlots = 3;
const kinds = ['auction', 'free-partner', 'negotiated'];
const common = ['id', 'kind', 'slot', 'publishedAt', 'startsAt', 'endsAt', 'termsUrl', 'proposedBy', 'approvedBy'];
const direct = ['sponsorGroup', 'reason'];
const fields = {
    auction: ['opensAt', 'closesAt', 'reserveWei', 'payee'],
    'free-partner': direct,
    negotiated: [...direct, 'feeWei', 'inKind', 'payee']
};
const awardFields = ['placementId', 'sponsorGroup', 'winningBidWei', 'decidedAt', 'recordUrl'];

function requireRule(condition, message) {
    if (!condition) throw new Error(message);
}

function exactFields(record, expected, context) {
    requireRule(record && typeof record === 'object' && !Array.isArray(record), context + ' must be an object');
    requireRule(isDeepStrictEqual(Object.keys(record).sort(), [...expected].sort()), context + ' has missing or unknown fields');
}

function id(value, field) {
    requireRule(typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(value), 'Invalid ' + field);
}

function nonempty(value, field) {
    requireRule(typeof value === 'string' && value.trim().length > 0, 'Missing ' + field);
}

function time(value, field) {
    requireRule(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value), field + ' must be UTC with whole seconds');
    const instant = Date.parse(value);
    requireRule(Number.isFinite(instant) && new Date(instant).toISOString() === value.replace('Z', '.000Z'), 'Invalid ' + field);
    return instant;
}

function wei(value, field) {
    requireRule(typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < (1n << 256n), 'Invalid ' + field);
    return BigInt(value);
}

function publicLink(value, field) {
    const url = typeof value === 'string' && URL.canParse(value) ? new URL(value) : null;
    requireRule(url?.protocol === 'https:' && !url.username && !url.password, field + ' must be an HTTPS reference without credentials');
}

function validatePlacement(row, asOf) {
    requireRule(kinds.includes(row?.kind), 'Unknown placement kind');
    exactFields(row, [...common, ...fields[row.kind]], row.kind + ' terms');
    id(row.id, 'placement ID');
    id(row.proposedBy, 'proposer group');
    id(row.approvedBy, 'reviewer group');
    requireRule(row.proposedBy !== row.approvedBy, 'Independent review required for ' + row.id);
    requireRule(Number.isInteger(row.slot) && row.slot >= 1 && row.slot <= promotionSlots, 'Outside the three promotion slots');
    publicLink(row.termsUrl, 'termsUrl');
    const published = time(row.publishedAt, 'publishedAt');
    const start = time(row.startsAt, 'startsAt');
    const end = time(row.endsAt, 'endsAt');
    requireRule(published <= asOf && published < start && start < end, 'Invalid publication or occupancy interval for ' + row.id);
    if (row.kind === 'auction') {
        const opens = time(row.opensAt, 'opensAt');
        const closes = time(row.closesAt, 'closesAt');
        requireRule(published < opens && opens < closes && closes <= start, 'Auction terms must precede bidding and delivery');
        wei(row.reserveWei, 'reserveWei');
    } else {
        id(row.sponsorGroup, 'sponsor group');
        requireRule(row.sponsorGroup !== row.approvedBy, 'Reviewer has a sponsor conflict');
        nonempty(row.reason, 'public placement reason');
        if (row.kind === 'negotiated') {
            const fee = wei(row.feeWei, 'feeWei');
            requireRule(row.inKind === null || (typeof row.inKind === 'string' && row.inKind.trim()), 'Disclose the in-kind consideration or specify null');
            requireRule(fee > 0n || row.inKind !== null, 'Use free-partner for zero consideration');
        }
    }
    if (row.kind !== 'free-partner') requireRule(row.payee === 'ProtocolTreasury', 'Cash proceeds must go to ProtocolTreasury');
}

function recordBy(rows, key) {
    const indexed = new Map();
    for (const row of rows) {
        requireRule(!indexed.has(row[key]), 'Duplicate ' + key + ' ' + row[key]);
        indexed.set(row[key], row);
    }
    return indexed;
}

function checkOccupancy(entries, key) {
    const groups = new Map();
    for (const entry of entries) {
        if (!groups.has(entry[key])) groups.set(entry[key], []);
        groups.get(entry[key]).push(entry);
    }
    for (const periods of groups.values()) {
        periods.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
        for (let i = 1; i < periods.length; i++) {
            requireRule(periods[i - 1].endsAt <= periods[i].startsAt, 'Overlapping ' + key + ' for ' + periods[i].id);
        }
    }
}

function readSchedule(schedule, asOf) {
    exactFields(schedule, ['placements', 'awards'], 'schedule');
    requireRule(Array.isArray(schedule.placements) && Array.isArray(schedule.awards), 'placements and awards must be arrays');
    for (const row of schedule.placements) validatePlacement(row, asOf);
    const placements = recordBy(schedule.placements, 'id');
    const sponsors = schedule.placements.filter(row => row.kind !== 'auction');
    for (const award of schedule.awards) {
        exactFields(award, awardFields, 'award');
        const placement = placements.get(award.placementId);
        requireRule(placement?.kind === 'auction', 'Award must identify a published auction');
        id(award.sponsorGroup, 'awarded sponsor group');
        requireRule(award.sponsorGroup !== placement.approvedBy && award.sponsorGroup !== placement.proposedBy, 'Operator conflict in auction award');
        requireRule(wei(award.winningBidWei, 'winningBidWei') >= BigInt(placement.reserveWei), 'Award below the published reserve');
        const decided = time(award.decidedAt, 'decidedAt');
        requireRule(placement.closesAt <= award.decidedAt && award.decidedAt <= placement.startsAt && decided <= asOf, 'Award outside the decision window');
        publicLink(award.recordUrl, 'recordUrl');
        sponsors.push({ ...placement, sponsorGroup: award.sponsorGroup });
    }
    const awards = recordBy(schedule.awards, 'placementId');
    checkOccupancy(schedule.placements, 'slot');
    checkOccupancy(sponsors, 'sponsorGroup');
    return { placements, awards };
}

function preserve(previous, next, recordType) {
    for (const [key, value] of previous) {
        requireRule(isDeepStrictEqual(value, next.get(key)), 'Previously published ' + recordType + ' changed or removed: ' + key);
    }
}

export function checkBannerSchedule(previous, proposed, asOfUtc) {
    const asOf = time(asOfUtc, 'asOf');
    const old = readSchedule(previous, asOf);
    const next = readSchedule(proposed, asOf);
    preserve(old.placements, next.placements, 'terms');
    preserve(old.awards, next.awards, 'award');
    for (const row of next.placements.values()) {
        if (old.placements.has(row.id)) continue;
        const deadline = row.kind === 'auction' ? row.opensAt : row.startsAt;
        requireRule(asOfUtc < deadline, 'New terms cannot be introduced after the opening deadline: ' + row.id);
    }
    for (const [key] of next.awards) {
        if (!old.awards.has(key)) {
            requireRule(asOfUtc <= next.placements.get(key).startsAt, 'New award submitted after delivery began: ' + key);
        }
    }
    const occupied = [...next.placements.values()].filter(row =>
        row.startsAt <= asOfUtc && asOfUtc < row.endsAt && (row.kind !== 'auction' || next.awards.has(row.id))
    ).length;
    return { asOf: asOfUtc, placements: next.placements.size, awards: next.awards.size, scheduledPromoted: occupied, availableOrganic: homeSlots - occupied };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    try {
        const [previous, proposed, asOf, ...extra] = process.argv.slice(2);
        requireRule(previous && proposed && !extra.length, 'Usage: node scripts/check-banner-schedule.mjs previous.json proposed.json [UTC-timestamp]');
        const files = await Promise.all([previous, proposed].map(path => readFile(path, 'utf8')));
        const current = asOf ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
        console.log(JSON.stringify(checkBannerSchedule(JSON.parse(files[0]), JSON.parse(files[1]), current), null, 2));
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
