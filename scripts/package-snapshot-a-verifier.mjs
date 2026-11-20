#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function main() {
    const [revision, destination, ...extra] = process.argv.slice(2);
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(revision || '') || !destination || extra.length) {
        throw new Error('Usage: package-snapshot-a-verifier.mjs <full-reviewed-commit> <new-directory>');
    }
    const git = (...args) => execFileSync('git', ['--no-replace-objects', ...args], {
        cwd: repo, env: { ...process.env, GIT_NO_LAZY_FETCH: '1' }
    });
    if (git('cat-file', '-t', revision).toString().trim() !== 'commit') {
        throw new Error('Expected a reviewed Git commit');
    }
    // Read committed bytes so local edits and checkout line endings cannot change the kit.
    const files = new Map([['package.json', Buffer.from('{"type":"module"}\n')]]);
    for (const name of ['scripts/verify-snapshot-a.mjs', 'src/snapshot/snapshot-a.js']) {
        files.set(name, git('cat-file', 'blob', `${revision}:${name}`));
    }
    const sums = Array.from(files, ([name, data]) => `${sha256(data)}  ${name}\n`).join('');
    files.set('SHA256SUMS', Buffer.from(sums));

    fs.mkdirSync(destination);
    for (const [name, bytes] of files) {
        const output = path.join(destination, name);
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.writeFileSync(output, bytes, { flag: 'wx' });
    }
    console.log(`Git commit: ${revision.toLowerCase()}`);
    console.log(`SHA256SUMS digest: ${sha256(sums)}`);
}

try {
    main();
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
