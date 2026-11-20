/**
 * Snapshot A — the community record of the public testnet.
 *
 * Bible section 16 point 1 requires an export that is versioned, reproducible,
 * machine-readable and durable; that carries the source cut-off, participating
 * addresses, qualifying public events with timestamps, aggregate counts and a
 * cryptographic manifest; and that is verified from at least two independent
 * durable locations. Point 2 requires proving it can be read and independently
 * validated **after the application database is reset**.
 *
 * Everything in this file follows from that last sentence. The export is the
 * only artifact that survives the reset, it is captured once on an announced
 * date, and it cannot be recaptured afterwards. So the format has to be
 * verifiable by someone holding the directory and nothing else - no database,
 * no API, no access to this repository.
 *
 * Two rules this file does not break:
 *
 * 1. **Snapshot A is a community record and creates no entitlement.** Not
 *    Genesis, not a token, not points, not an airdrop. The notice is written
 *    into the manifest rather than left to documentation, because the file will
 *    outlive every document around it. Testnet Genesis-eligibility tables are
 *    deliberately excluded: canon says testnet activity never qualifies for
 *    Genesis, and shipping an eligibility list inside a snapshot invites exactly
 *    the reading canon forbids.
 * 2. **Public projection data only.** The allowlist below is exhaustive and
 *    tested. Profiles, sessions, moderation complaints and anything carrying an
 *    email address stay out; the participating addresses canon asks for are
 *    already public chain facts and come from the event tables.
 */

// Bumped only when the on-disk shape changes in a way a reader must know about.
export const SNAPSHOT_SCHEMA_VERSION = 1;

export const ENTITLEMENT_NOTICE =
    'Snapshot A is a community record of the ArtSoul public testnet. It creates no Genesis, ' +
    'token, points, airdrop or other entitlement.';

/**
 * The exhaustive set of tables the export may read, and the columns kept from
 * each. An allowlist rather than a denylist: a column added to a table later
 * must be considered before it can reach a permanent public record.
 *
 * Every name here is checked against the migration that creates the table, by
 * test, because the first rehearsal against the real database found three that
 * were not real: `duration_seconds` for `duration`, `deposit` for
 * `deposit_amount`, and a `source` column on the floor history that has never
 * existed. The fixtures had been written from this list rather than from the
 * schema, so fifteen green tests could not see any of it, and the capture would
 * have failed on the announced cut-off date - the one day it cannot be retried.
 */
export const EXPORTED_TABLES = Object.freeze([
    Object.freeze({
        name: 'artworks',
        table: 'v41_artworks',
        timeColumn: 'indexed_at',
        columns: Object.freeze(['chain_id', 'artwork_id', 'creator', 'metadata_uri', 'minted', 'token_id', 'canonical_floor', 'indexed_at'])
    }),
    Object.freeze({
        name: 'auctions',
        table: 'v41_auctions',
        timeColumn: 'indexed_at',
        columns: Object.freeze(['chain_id', 'auction_id', 'artwork_id', 'creator', 'start_price', 'duration', 'end_time', 'status', 'winner', 'winning_bid', 'indexed_at'])
    }),
    Object.freeze({
        name: 'bids',
        table: 'v41_bids',
        timeColumn: 'indexed_at',
        columns: Object.freeze(['chain_id', 'auction_id', 'bidder', 'bid_amount', 'deposit_amount', 'block_number', 'transaction_hash', 'indexed_at'])
    }),
    Object.freeze({
        name: 'auction_endings',
        table: 'v41_auction_endings',
        timeColumn: 'indexed_at',
        columns: Object.freeze(['chain_id', 'auction_id', 'winner', 'winning_bid', 'settlement_deadline', 'transaction_hash', 'indexed_at'])
    }),
    Object.freeze({
        name: 'settlements',
        table: 'v41_settlements',
        timeColumn: 'indexed_at',
        columns: Object.freeze(['chain_id', 'auction_id', 'artwork_id', 'winner', 'final_price', 'token_id', 'settlement_status', 'transaction_hash', 'indexed_at'])
    }),
    Object.freeze({
        name: 'resales',
        table: 'v41_resale_history',
        timeColumn: 'indexed_at',
        columns: Object.freeze(['chain_id', 'token_id', 'seller', 'buyer', 'price', 'transaction_hash', 'indexed_at'])
    }),
    Object.freeze({
        name: 'floor_history',
        table: 'v41_floor_history',
        timeColumn: 'indexed_at',
        columns: Object.freeze(['chain_id', 'artwork_id', 'token_id', 'floor_price', 'indexed_at'])
    })
]);

/** Addresses are compared and stored lowercase so a participant is counted once. */
function normalizeAddress(value) {
    const text = String(value == null ? '' : value).trim().toLowerCase();
    return /^0x[0-9a-f]{40}$/.test(text) ? text : '';
}

function isZeroAddress(address) {
    return address === '0x0000000000000000000000000000000000000000';
}

/**
 * Deterministic JSON. Object keys are emitted in sorted order and the text ends
 * with a newline, so the same rows always produce the same bytes and therefore
 * the same hash. Reproducibility is a canon requirement, not a nicety: a second
 * run that disagrees with the first cannot be told apart from a tampered copy.
 */
export function canonicalJson(value) {
    return `${JSON.stringify(sortDeep(value), null, 2)}\n`;
}

function sortDeep(value) {
    if (Array.isArray(value)) return value.map(sortDeep);
    if (value && typeof value === 'object' && !(value instanceof Date)) {
        const sorted = Object.create(null);
        for (const key of Object.keys(value).sort()) sorted[key] = sortDeep(value[key]);
        return sorted;
    }
    return value;
}

/** Rows are sorted by their own content so row order can never change a hash. */
function sortRows(rows) {
    return [...rows].sort((left, right) => {
        const a = JSON.stringify(sortDeep(left));
        const b = JSON.stringify(sortDeep(right));
        return a < b ? -1 : a > b ? 1 : 0;
    });
}

function pickColumns(row, columns) {
    const picked = {};
    for (const column of columns) {
        picked[column] = row[column] === undefined ? null : row[column];
    }
    return picked;
}

function timestampMicros(value) {
    // pg normally returns Date objects. Date#toString would discard their
    // milliseconds; ISO strings from the capture query retain microseconds.
    const ms = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : NaN;
    if (!Number.isFinite(ms)) return null;
    const fraction = typeof value === 'string' ? value.match(/\d{2}:\d{2}:\d{2}\.(\d+)/)?.[1] : '';
    return BigInt(ms) * 1000n + BigInt((fraction || '').padEnd(6, '0').slice(3, 6));
}

// New capture and final-cutover checks compare explicit instants at PostgreSQL precision.
// Date.parse normalizes invalid month-end dates and rounds sub-millisecond fractions down.
export function captureCutOffMicros(value) {
    if (typeof value !== 'string') return null;
    const match = /^(\d{4}-\d\d-\d\d)T(\d\d):\d\d:\d\d(?:\.(\d{1,6}))?(?:Z|[+-](\d\d):?\d\d)$/i.exec(value);
    if (!match || !Number.isFinite(Date.parse(value))) return null;
    const [, day, hour, fraction = '', offsetHour = '00'] = match;
    const midnight = new Date(day + 'T00:00:00Z');
    if (day.startsWith('0000-') || midnight.toISOString().slice(0, 10) !== day ||
        Number(offsetHour) >= 16 || (hour === '24' && /[1-9]/.test(fraction))) return null;
    return timestampMicros(value);
}

function withinCutOff(row, timeColumn, cutOffMicros) {
    if (cutOffMicros === null) return true;
    const stamp = timestampMicros(row[timeColumn]);
    // A row with no readable timestamp is kept: dropping data because a column
    // is malformed would silently shrink a permanent record.
    return stamp === null || stamp <= cutOffMicros;
}

/**
 * Every address that took part, from the event tables only. Canon asks for
 * participating addresses; it does not ask for profiles, and profiles carry
 * data that has no business in a permanent public file.
 */
function collectParticipants(sections) {
    const participants = new Set();
    const add = (value) => {
        const address = normalizeAddress(value);
        if (address && !isZeroAddress(address)) participants.add(address);
    };

    for (const row of sections.artworks || []) add(row.creator);
    for (const row of sections.auctions || []) { add(row.creator); add(row.winner); }
    for (const row of sections.bids || []) add(row.bidder);
    for (const row of sections.auction_endings || []) add(row.winner);
    for (const row of sections.settlements || []) add(row.winner);
    for (const row of sections.resales || []) { add(row.seller); add(row.buyer); }

    return [...participants].sort();
}

function countAggregates(sections, participants) {
    const settled = (sections.settlements || []).filter(row => String(row.settlement_status) === 'completed');
    const settledVolume = settled.reduce((total, row) => {
        const value = BigInt(String(row.final_price ?? '0').trim() || '0');
        return total + value;
    }, 0n);

    return {
        artworks: (sections.artworks || []).length,
        auctions: (sections.auctions || []).length,
        bids: (sections.bids || []).length,
        settlements_completed: settled.length,
        resales: (sections.resales || []).length,
        participating_addresses: participants.length,
        // Kept as a decimal string: a wei total exceeds Number.MAX_SAFE_INTEGER
        // long before it becomes interesting, and JSON has no integer type that
        // survives it.
        settled_volume_wei: settledVolume.toString()
    };
}

/**
 * Build the complete export from already-read rows.
 *
 * `hashText` is injected so this module stays free of Node imports and can be
 * exercised without a filesystem or a database.
 */
export function buildSnapshot({ tables, cutOff = null, chainId, hashText }) {
    if (typeof hashText !== 'function') throw new Error('hashText is required');
    if (!chainId) throw new Error('chainId is required');

    const cutOffMicros = timestampMicros(cutOff);
    if (cutOff !== null && cutOffMicros === null) {
        throw new Error('cutOff must be an ISO-8601 timestamp');
    }

    const sections = {};
    for (const spec of EXPORTED_TABLES) {
        const rows = Array.isArray(tables?.[spec.table]) ? tables[spec.table] : [];
        sections[spec.name] = sortRows(
            rows
                .filter(row => withinCutOff(row, spec.timeColumn, cutOffMicros))
                .map(row => pickColumns(row, spec.columns))
        );
    }

    const participants = collectParticipants(sections);
    const files = {};
    for (const [name, rows] of Object.entries(sections)) {
        files[`${name}.json`] = canonicalJson({ section: name, count: rows.length, rows });
    }
    files['participants.json'] = canonicalJson({
        section: 'participants',
        count: participants.length,
        addresses: participants
    });

    const fileHashes = {};
    for (const name of Object.keys(files).sort()) {
        fileHashes[name] = hashText(files[name]);
    }

    // The root hash covers the file hashes rather than the file contents, so a
    // verifier can confirm the set is complete and unaltered by reading the
    // manifest and hashing each file once.
    const manifestBody = {
        schema_version: SNAPSHOT_SCHEMA_VERSION,
        chain_id: String(chainId),
        source_cut_off: cutOff,
        notice: ENTITLEMENT_NOTICE,
        entitlement: 'none',
        sections: Object.keys(files).sort(),
        counts: countAggregates(sections, participants),
        files: fileHashes
    };
    const rootHash = hashText(canonicalJson(manifestBody));

    files['manifest.json'] = canonicalJson({ ...manifestBody, root_hash: rootHash });
    return { files, rootHash };
}

/**
 * Validate an export using only the files themselves.
 *
 * This is the function that proves canon point 2. It never reads a database, an
 * API or this repository's tables: it takes a manifest, re-hashes what the
 * manifest lists, and reports every disagreement instead of stopping at the
 * first, so one corrupted copy can be compared against another in a single pass.
 */
export function verifySnapshot({ readFile, hashText, expectedRootHash = null }) {
    if (typeof readFile !== 'function') throw new Error('readFile is required');
    if (typeof hashText !== 'function') throw new Error('hashText is required');

    const problems = [];
    let manifest = null;

    const manifestText = readFile('manifest.json');
    if (typeof manifestText !== 'string') {
        return { ok: false, problems: ['manifest.json is missing or unreadable'] };
    }

    try {
        manifest = JSON.parse(manifestText);
    } catch {
        return { ok: false, problems: ['manifest.json is not valid JSON'] };
    }

    const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    if (!isObject(manifest)) {
        return { ok: false, problems: ['manifest.json must be a JSON object'] };
    }
    const requiredFiles = [...EXPORTED_TABLES.map(spec => `${spec.name}.json`), 'participants.json'].sort();
    const sameNames = (actual, expected) => Array.isArray(actual) && actual.every(name => typeof name === 'string') &&
        canonicalJson([...actual].sort()) === canonicalJson(expected);

    if (manifest.schema_version !== SNAPSHOT_SCHEMA_VERSION) {
        problems.push(`schema_version ${manifest.schema_version} is not ${SNAPSHOT_SCHEMA_VERSION}`);
    }
    if (manifest.notice !== ENTITLEMENT_NOTICE) {
        problems.push('the entitlement notice is missing or altered');
    }
    if (manifest.entitlement !== 'none') problems.push('entitlement must be none');
    if (typeof manifest.chain_id !== 'string' || !/^[1-9]\d*$/.test(manifest.chain_id)) {
        problems.push('chain_id must be a positive decimal string');
    }
    if (manifest.source_cut_off !== null && (typeof manifest.source_cut_off !== 'string' ||
        !Number.isFinite(Date.parse(manifest.source_cut_off)))) {
        problems.push('source_cut_off must be a timestamp or null');
    }

    const { root_hash: recordedRoot, ...body } = manifest;
    if (hashText(canonicalJson(body)) !== recordedRoot) {
        problems.push('root_hash does not match the manifest body');
    }
    // A hash stored beside its data proves consistency, not authenticity. The
    // reference must come from a separately retained, trusted capture record.
    if (expectedRootHash !== null) {
        if (typeof expectedRootHash !== 'string' || !/^[0-9a-f]{64}$/i.test(expectedRootHash)) {
            problems.push('trusted root hash must contain 64 hexadecimal characters');
        } else if (recordedRoot !== expectedRootHash.toLowerCase()) {
            problems.push('root_hash does not match the trusted root hash');
        }
    }

    if (!isObject(manifest.files) || !sameNames(Object.keys(manifest.files), requiredFiles) ||
        !sameNames(manifest.sections, requiredFiles)) {
        problems.push('the manifest must list exactly the required snapshot files');
        return { ok: false, problems };
    }

    const contents = {};
    // Read only schema-known filenames, never an arbitrary manifest path.
    for (const name of requiredFiles) {
        const content = readFile(name);
        if (typeof content !== 'string') {
            problems.push(`${name} is listed in the manifest but missing or unreadable`);
            continue;
        }
        if (hashText(content) !== manifest.files[name]) {
            problems.push(`${name} does not match its recorded hash`);
        }
        contents[name] = content;
    }
    if (problems.length) return { ok: false, problems };

    // Old v1 archives can lack a cut-off or an explicit zone. Only compare
    // instants whose boundary is independent of this verifier's local time.
    const cutOffMicros = /(?:Z|[+-]\d\d:?\d\d)$/i.test(manifest.source_cut_off || '')
        ? timestampMicros(manifest.source_cut_off) : null;
    const sections = {};
    for (const spec of EXPORTED_TABLES) {
        const name = `${spec.name}.json`;
        let section;
        try { section = JSON.parse(contents[name]); } catch {
            problems.push(`${name} is not valid JSON`);
            continue;
        }
        if (!isObject(section) || !sameNames(Object.keys(section), ['count', 'rows', 'section']) ||
            section.section !== spec.name || !Array.isArray(section.rows) ||
            section.count !== section.rows.length) {
            problems.push(`${name} has an invalid section or row count`);
            continue;
        }
        if (section.rows.some(row => !isObject(row) ||
            !sameNames(Object.keys(row), [...spec.columns].sort()) ||
            Object.values(row).some(value => value !== null && !['string', 'number', 'boolean'].includes(typeof value)) ||
            String(row.chain_id) !== manifest.chain_id)) {
            problems.push(`${name} contains invalid columns or a different chain`);
            continue;
        }
        if (section.rows.some(row => !withinCutOff(row, spec.timeColumn, cutOffMicros))) {
            problems.push(`${name} contains a row after the source cut-off`);
            continue;
        }
        sections[spec.name] = section.rows;
    }
    if (problems.length) return { ok: false, problems };

    const participants = collectParticipants(sections);
    try {
        const section = JSON.parse(contents['participants.json']);
        if (!isObject(section) || !sameNames(Object.keys(section), ['addresses', 'count', 'section']) ||
            section.section !== 'participants' || section.count !== participants.length ||
            canonicalJson(section.addresses) !== canonicalJson(participants)) {
            problems.push('participants.json does not match the exported participants');
        }
    } catch { problems.push('participants.json is not valid JSON'); }
    try {
        if (canonicalJson(manifest.counts) !== canonicalJson(countAggregates(sections, participants))) {
            problems.push('aggregate counts do not match the exported rows');
        }
    } catch { problems.push('settlement values cannot be aggregated'); }

    if (problems.length) return { ok: false, problems };
    return { ok: true, problems, manifest };
}
