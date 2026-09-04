#!/usr/bin/env node
//
// Capture Snapshot A from the live projection.
//
//   node scripts/export-snapshot-a.mjs --out ../snapshot-a --cut-off 2026-10-01T00:00:00Z
//
// Reads DATABASE_URL. The output directory is written outside the repository by
// default and must never be committed: it is a data export, not source.
//
// Run it more than once. The export is reproducible, so a second run against the
// same cut-off must print the same root hash, and that equality is the cheapest
// evidence that the capture is sound.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import { buildSnapshot, EXPORTED_TABLES, SNAPSHOT_SCHEMA_VERSION } from '../src/snapshot/snapshot-a.js';

function readFlag(name, fallback = null) {
    const index = process.argv.indexOf(`--${name}`);
    if (index === -1) return fallback;
    const value = process.argv[index + 1];
    return value && !value.startsWith('--') ? value : fallback;
}

const hashText = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

async function main() {
    const outDir = path.resolve(readFlag('out', path.join('..', 'snapshot-a')));
    const cutOff = readFlag('cut-off');
    const chainId = readFlag('chain-id', process.env.ARTSOUL_INDEXER_CHAIN_ID || '84532');
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) throw new Error('DATABASE_URL is required');

    const client = new pg.Client({ connectionString });
    await client.connect();

    const tables = {};
    try {
        for (const spec of EXPORTED_TABLES) {
            const columns = spec.columns.map(column => `"${column}"`).join(', ');
            // Chain-scoped: a snapshot of the public testnet must not silently
            // absorb rows from the retired legacy chain.
            const result = await client.query(
                `SELECT ${columns} FROM ${spec.table} WHERE chain_id = $1`,
                [String(chainId)]
            );
            tables[spec.table] = result.rows;
            console.log(`read ${spec.table}: ${result.rows.length} rows`);
        }
    } finally {
        await client.end();
    }

    const { files, rootHash } = buildSnapshot({ tables, cutOff, chainId, hashText });

    fs.mkdirSync(outDir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
        fs.writeFileSync(path.join(outDir, name), content, 'utf8');
    }

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

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
