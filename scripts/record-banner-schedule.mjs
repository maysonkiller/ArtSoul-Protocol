import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { withEvidenceTransaction } from '../src/indexer/finalized-evidence.js';
import { checkBannerSchedule } from './check-banner-schedule.mjs';

// Private operator intake. See the schedule runbook for the separate publication
// and settlement gates. Never accept the previous schedule or a clock from the caller.
export async function recordBannerSchedule(pool, expectedRevision, proposed) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('Invalid expected revision');
    return withEvidenceTransaction(pool, async client => {
        await client.query('SET LOCAL row_security = off');
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('artsoul.banner_schedule_revisions', 0))");
        const history = await client.query('SELECT revision, placements, awards FROM artsoul_private.banner_schedule_revisions ORDER BY revision');
        const revision = history.rows.at(-1)?.revision ?? 0;
        if (expectedRevision !== revision && expectedRevision + 1 !== revision) throw new Error('Stale banner schedule revision');
        const previous = {
            placements: history.rows.flatMap(row => row.placements),
            awards: history.rows.flatMap(row => row.awards)
        };
        const { rows: [clock] } = await client.query("SELECT date_trunc('second', clock_timestamp()) AS instant");
        const asOf = clock.instant.toISOString().replace('.000Z', 'Z');
        checkBannerSchedule(previous, proposed, asOf);
        const knownPlacements = new Set(previous.placements.map(row => row.id));
        const knownAwards = new Set(previous.awards.map(row => row.placementId));
        const placements = proposed.placements.filter(row => !knownPlacements.has(row.id));
        const awards = proposed.awards.filter(row => !knownAwards.has(row.placementId));
        if (!placements.length && !awards.length) return { revision, inserted: false };
        if (expectedRevision !== revision) throw new Error('Stale banner schedule revision');
        // Check the database clock again at insertion, including subsecond boundaries.
        const firstOpening = placements.map(row => row.kind === 'auction' ? row.opensAt : row.startsAt).sort()[0];
        const startsById = new Map(proposed.placements.map(row => [row.id, row.startsAt]));
        const firstDelivery = awards.map(row => startsById.get(row.placementId)).sort()[0];
        const recorded = await client.query(`
            INSERT INTO artsoul_private.banner_schedule_revisions (revision, placements, awards, recorded_at)
            SELECT $1, $2::jsonb, $3::jsonb, stamp FROM (SELECT clock_timestamp() AS stamp) clock
            WHERE ($4::timestamptz IS NULL OR stamp < $4)
              AND ($5::timestamptz IS NULL OR stamp <= $5)`,
        [revision + 1, JSON.stringify(placements), JSON.stringify(awards), firstOpening ?? null, firstDelivery ?? null]);
        if (recorded.rowCount !== 1) throw new Error('Banner submission deadline has passed');
        return { revision: revision + 1, inserted: true };
    });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    let pool;
    try {
        const [revision, file, persist, ...extra] = process.argv.slice(2);
        if (!/^(0|[1-9]\d*)$/.test(revision) || !file || persist !== '--persist' || extra.length) {
            throw new Error('Usage: node scripts/record-banner-schedule.mjs EXPECTED_REVISION proposed.json --persist');
        }
        const connectionString = process.env.ARTSOUL_BANNER_DATABASE_URL;
        if (!connectionString) throw new Error('Set ARTSOUL_BANNER_DATABASE_URL to the intended private database');
        const schedule = JSON.parse(await readFile(file, 'utf8'));
        pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 10000, statement_timeout: 15000 });
        console.log(JSON.stringify(await recordBannerSchedule(pool, Number(revision), schedule)));
    } catch (error) {
        console.error(error.code ? 'Could not record this schedule in the selected database' : error.message);
        process.exitCode = 1;
    } finally {
        await pool?.end();
    }
}
