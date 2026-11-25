#!/usr/bin/env node
//
// Validate a Snapshot A export from the files alone.
//
//   node scripts/verify-snapshot-a.mjs ../snapshot-a
//
// Read an optional historical archive offline. This utility does not verify a
// full database or Storage backup and does not authorize a destructive change.
//
// For a previously saved archive, a trusted root lets each retrieved copy be
// checked independently of the original application.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';
import { captureCutOffMicros, verifySnapshot } from '../src/snapshot/snapshot-a.js';

const hashText = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

const usage = 'Usage: verify-snapshot-a.mjs <directory> [--expected-root <trusted SHA-256> [--second-copy <directory>] [--expected-cut-off <ISO-8601>]]';
let args;
try {
    args = parseArgs({ allowPositionals: true, options: {
        'expected-root': { type: 'string', multiple: true }, 'second-copy': { type: 'string', multiple: true },
        'expected-cut-off': { type: 'string', multiple: true },
        'announced-cut-off': { type: 'string', multiple: true }, // Historical command alias.
        'notice-published-at': { type: 'string', multiple: true }
    } });
} catch {
    console.error(usage);
    process.exit(1);
}
const roots = args.values['expected-root'] ?? [];
const copies = args.values['second-copy'] ?? [];
const cutOffs = [...(args.values['expected-cut-off'] ?? []), ...(args.values['announced-cut-off'] ?? [])];
const announcedMicros = captureCutOffMicros(cutOffs[0]);
const notices = args.values['notice-published-at'] ?? [];
const publicationMicros = captureCutOffMicros(notices[0]);
const [expectedRootHash] = roots;
if (args.positionals.length > 1 || roots.length > 1 || copies.length > 1 || cutOffs.length > 1 ||
    (roots.length && !/^[0-9a-f]{64}$/i.test(expectedRootHash)) ||
    (cutOffs.length && (!expectedRootHash || announcedMicros === null)) ||
    notices.length > 1 || (notices.length && (publicationMicros === null || !cutOffs.length)) ||
    (copies.length && (!copies[0] || !args.positionals[0] || !expectedRootHash))) {
    console.error(usage);
    process.exit(1);
}
if (announcedMicros !== null && announcedMicros > BigInt(Date.now()) * 1000n) {
    console.error('The expected archive cut-off has not occurred yet.');
    process.exit(1);
}
if (publicationMicros !== null && announcedMicros - publicationMicros < 14n * 86400n * 1000000n) {
    console.error('The supplied public notice must precede the cut-off by at least 14 full days.');
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
    if (result.ok && announcedMicros !== null &&
        (result.manifest.chain_id !== '84532' || captureCutOffMicros(result.manifest.source_cut_off) !== announcedMicros)) {
        problems.push('Archive does not match the expected Base Sepolia cut-off.');
    }
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
if (!process.exitCode && publicationMicros !== null) {
    console.log('The supplied timestamps meet the historical 14-day public notice rule for this archive.');
}
