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
import { verifySnapshot } from '../src/snapshot/snapshot-a.js';

const hashText = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

const [directory, flag, expectedRootHash, ...extra] = process.argv.slice(2);
if ((flag !== undefined && flag !== '--expected-root') ||
    (flag === '--expected-root' && !/^[0-9a-f]{64}$/i.test(expectedRootHash || '')) || extra.length) {
    console.error('Usage: verify-snapshot-a.mjs <directory> [--expected-root <trusted SHA-256>]');
    process.exit(1);
}
const dir = path.resolve(directory || path.join('..', 'snapshot-a'));

const readFile = (name) => {
    // Names come from the manifest, which is untrusted input until it verifies.
    // A traversal attempt is a verification failure, not a file read.
    if (name.includes('/') || name.includes('\\') || name.includes('..')) return undefined;
    try {
        return fs.readFileSync(path.join(dir, name), 'utf8');
    } catch {
        return undefined;
    }
};

const result = verifySnapshot({ readFile, hashText, expectedRootHash });

console.log(`snapshot : ${dir}`);

if (result.ok) {
    const manifest = JSON.parse(readFile('manifest.json'));
    console.log(`root hash: ${manifest.root_hash}`);
    console.log(`cut-off  : ${manifest.source_cut_off || 'none'}`);
    console.log(`counts   : ${JSON.stringify(manifest.counts)}`);
    console.log('');
    console.log('VALID. Required sections, participant and aggregate counts, and hashes agree.');
    console.log(expectedRootHash
        ? 'The root hash also matches the independently supplied trusted capture record.'
        : 'Internal consistency only. Authenticity is NOT checked without --expected-root.');
} else {
    console.log('');
    console.log('INVALID:');
    for (const problem of result.problems) console.log(`  - ${problem}`);
    console.log('');
    console.log('Do not repair a copy by hand. Fetch another durable copy and verify that one.');
    process.exitCode = 1;
}
