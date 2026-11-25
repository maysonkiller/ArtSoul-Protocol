import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { homeSlots, readBannerSchedule, requireRule } from '../src/features/discovery/banner-schedule.js';

// A proposed publication is checked against the last independently retained public schedule.
// This tool has no signing, network, database or payment path.
function preserve(previous, next, recordType) {
    for (const [key, value] of previous) {
        requireRule(isDeepStrictEqual(value, next.get(key)), 'Previously published ' + recordType + ' changed or removed: ' + key);
    }
}

export function checkBannerSchedule(previous, proposed, asOfUtc) {
    const old = readBannerSchedule(previous, asOfUtc);
    const next = readBannerSchedule(proposed, asOfUtc);
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
