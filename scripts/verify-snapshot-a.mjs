#!/usr/bin/env node
//
// Validate a Snapshot A export from the files alone.
//
//   node scripts/verify-snapshot-a.mjs ../snapshot-a
//
// This is the script Bible section 16 point 2 asks for. It reads no database, no
// API and no table in this repository: give it a directory and it answers.
//
// That is deliberate, and it is the whole point of the format. Snapshot A has to
// survive the destructive reset that removes the data it describes, so its proof
// of integrity cannot depend on anything that reset takes away. Copy the
// directory to two independent durable locations and run this there - a copy
// nobody has verified in its own location is a copy nobody has verified.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';
import { verifySnapshot } from '../src/snapshot/snapshot-a.js';

const hashText = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

const usage = 'Usage: verify-snapshot-a.mjs <directory> [--expected-root <trusted SHA-256> [--second-copy <directory>]]';
let args;
try {
    args = parseArgs({ allowPositionals: true, options: {
        'expected-root': { type: 'string', multiple: true }, 'second-copy': { type: 'string', multiple: true }
    } });
} catch {
    console.error(usage);
    process.exit(1);
}
const roots = args.values['expected-root'] ?? [];
const copies = args.values['second-copy'] ?? [];
const [expectedRootHash] = roots;
if (args.positionals.length > 1 || roots.length > 1 || copies.length > 1 ||
    (roots.length && !/^[0-9a-f]{64}$/i.test(expectedRootHash)) ||
    (copies.length && (!copies[0] || !args.positionals[0] || !expectedRootHash))) {
    console.error(usage);
    process.exit(1);
}
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

const filesFromFirstCopy = new Set();
function verifyDirectory(dir, second) {
    const problems = [];
    const readFile = name => {
        if (name.includes('/') || name.includes('\\') || name.includes('..')) return undefined;
        const file = path.join(dir, name);
        try {
            if (expectedRootHash) {
                const stat = fs.lstatSync(file, { bigint: true });
                if (!stat.isFile()) {
                    problems.push(`${name} must be a regular restored file`);
                    return undefined;
                }
                if (copies.length) {
                    // Compare real paths and filesystem IDs for the two restored copies.
                    const ids = [fs.realpathSync.native(file)];
                    if (stat.ino !== 0n) ids.push(`${stat.dev}:${stat.ino}`);
                    if (second && ids.some(id => filesFromFirstCopy.has(id))) {
                        problems.push(`${name} points to the same file as the first copy`);
                    }
                    if (!second) for (const id of ids) filesFromFirstCopy.add(id);
                }
            }
            return utf8.decode(fs.readFileSync(file));
        } catch {
            return undefined;
        }
    };
    const result = verifySnapshot({ readFile, hashText, expectedRootHash });
    problems.push(...result.problems);
    if (expectedRootHash && result.ok) {
        try {
            const extras = fs.readdirSync(dir).filter(name =>
                name !== 'manifest.json' && !Object.hasOwn(result.manifest.files, name));
            if (extras.length) problems.push(`Directory contains unlisted archive entries (${extras.length})`);
        } catch {
            problems.push('Unable to list the archive directory');
        }
    }
    console.log(`snapshot : ${dir}`);
    if (problems.length) {
        console.log('INVALID:');
        for (const problem of problems) console.log(`  - ${problem}`);
        process.exitCode = 1;
        return;
    }
    const { manifest } = result;
    console.log(`chain    : ${manifest.chain_id}`);
    console.log(`root hash: ${manifest.root_hash}`);
    console.log(`cut-off  : ${manifest.source_cut_off || 'none'}`);
    console.log(`counts   : ${JSON.stringify(manifest.counts)}`);
    console.log('');
    console.log('VALID. Required sections, participant and aggregate counts, and hashes agree.');
    console.log(expectedRootHash
        ? 'The root hash also matches the independently supplied trusted capture record.'
        : 'Internal consistency only. Authenticity is NOT checked without --expected-root.');
}

verifyDirectory(path.resolve(args.positionals[0] || path.join('..', 'snapshot-a')), false);
if (copies.length) verifyDirectory(path.resolve(copies[0]), true);
if (process.exitCode) {
    console.log('Fetch another durable copy and verify it against the same trusted root.');
} else if (copies.length) {
    console.log('Both restored copies match the trusted capture root. Record the two retrieval sources separately.');
}
