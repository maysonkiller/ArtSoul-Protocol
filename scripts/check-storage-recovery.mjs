import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { captureCutOffMicros } from '../src/snapshot/snapshot-a.js';
import { readReviewedFile } from './security/read-reviewed-file.mjs';

const digest = input => createHash('sha256').update(input).digest('hex');
const isDigest = input => typeof input === 'string' && /^[a-f0-9]{64}$/.test(input);
function check(ok, message) { if (!ok) throw new Error(message); }

async function listRestoredKeys(directory, prefix = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    const keys = [];
    for (const entry of entries) {
        const key = prefix + entry.name;
        if (entry.isDirectory()) keys.push(...await listRestoredKeys(join(directory, entry.name), key + '/'));
        else {
            check(entry.isFile(), 'The restore contains a link or special entry');
            keys.push(key);
        }
    }
    return keys;
}

export async function checkStorageRecovery({ manifestFile, manifestSha256, source, restoredDirectory, project }) {
    check(isDigest(manifestSha256) && isDigest(source?.inventory_sha256), 'Supply the dated source inventory and independently retained manifest digest');
    check(captureCutOffMicros(source.observed_at) !== null, 'Supply a valid ISO-8601 source inventory observation time with a time zone');
    const manifestBytes = await readReviewedFile(manifestFile, 16 * 1024 * 1024);
    check(digest(manifestBytes) === manifestSha256, 'The retained manifest differs from its independent digest');
    const m = JSON.parse(manifestBytes);
    check(m.complete === true && Array.isArray(m.failures) && !m.failures.length && Array.isArray(m.objects) &&
        project && m.sourceProject === project && source.incomplete === 0, 'Incomplete inventory or wrong source project');
    const directory = resolve(restoredDirectory);
    check(await realpath(directory) === directory, 'The restore directory is redirected');
    const fingerprints = [];
    const expected = new Set();
    const buckets = new Set();
    let bytes = 0;
    for (const item of m.objects) {
        const key = item.bucket + '/' + item.name;
        check(typeof item.name === 'string' && typeof item.bucket === 'string' && !item.bucket.includes('/') &&
            key.split('/').every(part => part && part !== '.' && part !== '..' && !/[\\:\x00-\x1f]/.test(part)) &&
            !expected.has(key) && Number.isSafeInteger(item.size) && item.size >= 0 && isDigest(item.sha256) &&
            [item.sourceVersion, item.eTag, item.mimetype].every(value => typeof value === 'string' && value),
        'Invalid object version or restore key');
        expected.add(key);
        buckets.add(item.bucket);
        bytes += item.size;
        // Match the hosted aggregate one UTF-8 field at a time, including exact key and object version.
        const fields = [item.bucket, item.name, item.sourceVersion, String(item.size), item.eTag.replace(/^W\//, '').replace(/^"|"$/g, ''), item.mimetype];
        fingerprints.push(digest(fields.map(field => Buffer.from(field).toString('hex')).join(':')));
    }
    check(source.objects === expected.size && source.buckets === buckets.size && source.public_buckets === buckets.size &&
        Number.isSafeInteger(bytes) && m.bytes === bytes && source.bytes === String(bytes) &&
        digest(fingerprints.sort().join('')) === source.inventory_sha256, 'Current Storage keys, versions, metadata or visibility differ from the archive');
    // The historical restoration keeps evidence.json at the root, alongside the restored bucket directories.
    const keys = await listRestoredKeys(directory);
    const originals = keys.filter(key => key !== 'evidence.json');
    check(originals.length === expected.size && originals.every(key => expected.has(key)), 'Missing or unexpected restored files');
    for (const item of m.objects) {
        const file = join(directory, item.bucket, item.name);
        const stat = await lstat(file);
        check(stat.isFile() && stat.size === item.size && await realpath(file) === file, 'Restored object path or size differs');
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(file)) hash.update(chunk);
        check(hash.digest('hex') === item.sha256, 'Restored content digest differs');
    }
    return { checkedAt: new Date().toISOString(), sourceObservedAt: source.observed_at, objects: expected.size,
        bytes, buckets: buckets.size, manifestSha256, inventorySha256: source.inventory_sha256 };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    try {
        const [project, manifestFile, manifestSha256, restoredDirectory, inventoryFile, ...extra] = process.argv.slice(2);
        check(inventoryFile && !extra.length, 'Supply project, manifest, independent SHA-256, restored directory and current aggregate JSON');
        const source = JSON.parse(await readReviewedFile(inventoryFile, 8192));
        console.log(JSON.stringify(await checkStorageRecovery({ project, manifestFile, manifestSha256, restoredDirectory, source })));
    } catch (error) {
        console.error(error.code || error instanceof SyntaxError ? 'Could not read all recovery inputs' : error.message);
        process.exitCode = 1;
    }
}
