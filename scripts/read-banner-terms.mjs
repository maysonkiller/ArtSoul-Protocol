import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { readBannerSchedule } from '../src/features/discovery/banner-schedule.js';

const ledger = 'artsoul_private.banner_schedule_revisions';
const utcTimestamp = field => `to_char(${field} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const wholeSecond = utc => utc.replace('Z', '.000000Z');

// The caller picks one recorded revision and placement. Return at most two rows
// of each kind internally so duplicate records fail instead of being hidden.
function recordedEntries(column, key) {
    return `(SELECT jsonb_agg(matched) FROM (
        SELECT CASE WHEN octet_length(item::text) <= 16384 THEN item END AS item, ${utcTimestamp('r.recorded_at')} AS "recordedAt" FROM ${ledger} r
        CROSS JOIN LATERAL jsonb_array_elements(r.${column}) item
        WHERE r.revision <= snapshot.revision AND r.${column} @> jsonb_build_array(jsonb_build_object('${key}', $2::text))
            AND item->>'${key}' = $2
        LIMIT 2
    ) matched)`;
}
const query = `SELECT row_security_active('${ledger}') AS filtered, ${utcTimestamp('snapshot.recorded_at')} AS instant,
    ${recordedEntries('placements', 'id')} AS terms, ${recordedEntries('awards', 'placementId')} AS awards
    FROM (VALUES (1)) anchor(n) LEFT JOIN ${ledger} snapshot ON snapshot.revision = $1 AND snapshot.recorded_at <= statement_timestamp()`;

function publicSponsor(entry) {
    if (!entry.sponsorName || !entry.relationship) throw new Error('The recorded sponsor has no reviewed public name and relationship');
    return { name: entry.sponsorName, relationship: entry.relationship };
}

export async function readBannerTerms(client, revision, placementId) {
    if (!Number.isInteger(revision) || revision < 1 || revision > 2147483647 ||
        typeof placementId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(placementId)) {
        throw new Error('Supply a positive recorded revision and one placement ID');
    }
    const { rows: [row] } = await client.query(query, [revision, placementId]);
    if (row.filtered) throw new Error('The reader cannot see the whole private schedule');
    if (!row.instant || !row.terms?.length) throw new Error('No recorded terms at that revision');
    if ([...row.terms, ...(row.awards ?? [])].some(r => !r.item)) throw new Error('A record exceeds the 16 KiB preview limit');
    const schedule = { placements: row.terms.map(r => r.item), awards: (row.awards ?? []).map(r => r.item) };
    const { placements, awards } = readBannerSchedule(schedule, row.instant.replace(/\.\d{6}Z$/, 'Z'));
    const p = placements.get(placementId);
    const recorded = row.terms[0].recordedAt;
    if (!(recorded >= wholeSecond(p.publishedAt) && recorded < wholeSecond(p.opensAt ?? p.startsAt) && recorded <= row.instant)) {
        throw new Error('The stored terms missed their recording window');
    }
    const terms = { id: p.id, kind: p.kind, slot: p.slot, startsAt: p.startsAt, endsAt: p.endsAt,
        termsUrl: p.termsUrl, recordedAt: recorded };
    if (p.kind === 'auction') {
        Object.assign(terms, { opensAt: p.opensAt, closesAt: p.closesAt, reserveWei: p.reserveWei, payee: p.payee });
    } else {
        Object.assign(terms, { sponsor: publicSponsor(p), reason: p.reason,
            feeWei: p.kind === 'free-partner' ? '0' : p.feeWei, inKind: p.kind === 'free-partner' ? null : p.inKind });
        if (p.kind === 'negotiated') terms.payee = p.payee;
    }
    const a = awards.get(placementId);
    if (a) {
        const awardRecorded = row.awards[0].recordedAt;
        if (!(awardRecorded >= wholeSecond(a.decidedAt) && awardRecorded <= wholeSecond(p.startsAt) && awardRecorded <= row.instant)) {
            throw new Error('The stored award missed its recording window');
        }
    }
    const award = a ? { sponsor: publicSponsor(a), winningBidWei: a.winningBidWei, decidedAt: a.decidedAt,
        recordedAt: row.awards[0].recordedAt, recordUrl: a.recordUrl } : null;
    return { status: 'recorded_terms_preview', revision, terms, award };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    let pool;
    try {
        const [version, id, ...extra] = process.argv.slice(2);
        if (!/^[1-9]\d{0,9}$/.test(version) || !id || extra.length) throw new Error('Usage: node scripts/read-banner-terms.mjs REVISION PLACEMENT_ID');
        if (!process.env.ARTSOUL_BANNER_DATABASE_URL) throw new Error('Set ARTSOUL_BANNER_DATABASE_URL for the private reader');
        pool = new pg.Pool({ connectionString: process.env.ARTSOUL_BANNER_DATABASE_URL, max: 1,
            statement_timeout: 10000, connectionTimeoutMillis: 5000 });
        console.log(JSON.stringify(await readBannerTerms(pool, Number(version), id), null, 2));
    } catch (error) {
        console.error(error.code ? 'Could not read the selected private schedule' : error.message);
        process.exitCode = 1;
    } finally {
        await pool?.end();
    }
}
