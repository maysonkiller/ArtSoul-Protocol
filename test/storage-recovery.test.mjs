import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkStorageRecovery } from '../scripts/check-storage-recovery.mjs';

const sha = input => createHash('sha256').update(input).digest('hex');
async function fixture(t) {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'artsoul-restored-')));
    t.after(() => rm(root, { recursive: true, force: true }));
    const restoredDirectory = join(root, 'restored');
    await mkdir(join(restoredDirectory, 'art', 'album'), { recursive: true });
    const project = 'recovery-test';
    const content = Buffer.from([12, 42, 9, 255]);
    const item = { bucket: 'art', name: 'album/é-sample', size: content.length,
        eTag: 'W/"multi-2"', sourceVersion: 'version', mimetype: 'image/png', sha256: sha(content) };
    const file = join(restoredDirectory, item.bucket, item.name);
    await writeFile(file, content);
    const data = JSON.stringify({ sourceProject: project, complete: true, failures: [], objects: [item], bytes: content.length });
    const manifestFile = join(root, 'manifest.json');
    await writeFile(manifestFile, data);
    const fields = ['art', 'album/é-sample', 'version', '4', 'multi-2', 'image/png'];
    const source = { observed_at: '2026-11-27T02:01:00Z', buckets: 1, public_buckets: 1, objects: 1, bytes: '4', incomplete: 0,
        inventory_sha256: sha(sha(fields.map(field => Buffer.from(field, 'utf8').toString('hex')).join(':'))) };
    const args = { project, manifestFile, manifestSha256: sha(data), restoredDirectory, source };
    return { args, data, file };
}

test('restored media matches its independently pinned manifest and complete versioned source inventory', async t => {
    const { args } = await fixture(t);
    const result = await checkStorageRecovery(args);
    assert.equal(result.objects, 1);
    assert.equal(result.bytes, 4);
    assert.equal(result.sourceObservedAt, args.source.observed_at);
    assert.doesNotMatch(JSON.stringify(result), /sample|version"|album/);
    for (const change of [{ public_buckets: 0 }, { buckets: 2 }, { objects: 0 }, { bytes: '5' }, { incomplete: 1 },
        { inventory_sha256: sha('a new exact version with the same count and size') }]) {
        await assert.rejects(checkStorageRecovery({ ...args, source: { ...args.source, ...change } }), /Current Storage|Incomplete/);
    }
    await assert.rejects(checkStorageRecovery({ ...args, project: 'other' }), /wrong source project/);
    await assert.rejects(checkStorageRecovery({ ...args, manifestSha256: sha('other') }), /independent digest/);
});

test('the source inventory observation identifies a real instant independent of local time', async t => {
    const { args } = await fixture(t);
    const verifyAt = observed_at => checkStorageRecovery({ ...args, source: { ...args.source, observed_at } });
    for (const timestamp of ['2026-02-30T02:01:00Z', '2026-11-27T02:01:00', ['2026-11-27T02:01:00Z']]) {
        await assert.rejects(verifyAt(timestamp), /source inventory/, JSON.stringify(timestamp));
    }
    const timestamp = '2024-02-29T07:31:00.123456+05:30';
    assert.equal((await verifyAt(timestamp)).sourceObservedAt, timestamp);
});

test('content changes at the same size, extra objects and missing restored bytes fail verification', async t => {
    const { args, file } = await fixture(t);
    const extra = join(args.restoredDirectory, 'art', 'extra');
    await writeFile(extra, 'extra');
    await assert.rejects(checkStorageRecovery(args), /unexpected restored files/);
    await rm(extra);
    await writeFile(file, Buffer.alloc(4));
    await assert.rejects(checkStorageRecovery(args), /content digest differs/);
    await rm(file);
    await assert.rejects(checkStorageRecovery(args), /Missing or unexpected/);
});

test('even an attested malformed archive cannot select paths outside the restore', async t => {
    const { args, data } = await fixture(t);
    const manifest = JSON.parse(data);
    manifest.objects[0].name = '../escaped';
    const altered = JSON.stringify(manifest);
    await writeFile(args.manifestFile, altered);
    await assert.rejects(checkStorageRecovery({ ...args, manifestSha256: sha(altered) }), /Invalid object version or restore key/);
});
