#!/usr/bin/env node
//
// Capture Snapshot A from the live projection.
//
//   node scripts/export-snapshot-a.mjs --out ../snapshot-a --cut-off 2026-10-01T00:00:00Z
//
// Reads DATABASE_URL. The output directory is written outside the repository by
// default and must never be committed: it is a data export, not source.
//
// Repeated captures of the same stabilized source must print the same root.
// A cut-off alone does not freeze mutable projections; use the capture runbook.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { buildSnapshot, EXPORTED_TABLES, SNAPSHOT_SCHEMA_VERSION } from '../src/snapshot/snapshot-a.js';

function readFlag(name, fallback = null) {
    const index = process.argv.indexOf(`--${name}`);
    if (index === -1) return fallback;
    const value = process.argv[index + 1];
    return value && !value.startsWith('--') ? value : fallback;
}

const hashText = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

export async function readSnapshotTables(client, chainId) {
    const tables = {};
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
        for (const spec of EXPORTED_TABLES) {
            const columns = spec.columns.map(column => `"${column}"`).join(', ');
            const result = await client.query(
                `SELECT ${columns} FROM ${spec.table} WHERE chain_id = $1`,
                [String(chainId)]
            );
            tables[spec.table] = result.rows;
        }
        await client.query('COMMIT');
        return tables;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
}

export function writeSnapshotFiles(outDir, files) {
    // A new directory is mandatory. A retry must never replace a retained copy;
    // a failed partial write remains inspectable and cannot pass verification.
    fs.mkdirSync(outDir);
    for (const [name, content] of Object.entries(files)) {
        fs.writeFileSync(path.join(outDir, name), content, { encoding: 'utf8', flag: 'wx' });
    }
}

async function main() {
    const outDir = path.resolve(readFlag('out', path.join('..', 'snapshot-a')));
    const cutOff = readFlag('cut-off');
    const chainId = readFlag('chain-id', process.env.ARTSOUL_INDEXER_CHAIN_ID || '84532');
    const connectionString = process.env.DATABASE_URL;

    if (fs.existsSync(outDir)) throw new Error('Output directory already exists; choose a new directory');
    if (!cutOff || !Number.isFinite(Date.parse(cutOff))) throw new Error('An explicit ISO-8601 --cut-off is required');
    if (!connectionString) throw new Error('DATABASE_URL is required');

    const client = new pg.Client({ connectionString });
    await client.connect();

    let tables;
    try {
        tables = await readSnapshotTables(client, chainId);
    } finally {
        await client.end();
    }

    const { files, rootHash } = buildSnapshot({ tables, cutOff, chainId, hashText });

    writeSnapshotFiles(outDir, files);

    console.log('');
    console.log(`schema version : ${SNAPSHOT_SCHEMA_VERSION}`);
    console.log(`chain          : ${chainId}`);
    console.log(`cut-off        : ${cutOff || 'none (everything indexed so far)'}`);
    console.log(`written to     : ${outDir}`);
    console.log(`root hash      : ${rootHash}`);
    console.log('');
    console.log('Next: verify this directory with scripts/verify-snapshot-a.mjs, copy it to two');
    console.log('independent durable locations, and verify each copy there. Record the root hash');
    console.log('in the migration runbook - it is what a later reader compares against.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
