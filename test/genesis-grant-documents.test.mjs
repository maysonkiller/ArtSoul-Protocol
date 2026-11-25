import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { keccak256 } from 'ethers';
import { checkGenesisGrantDocuments } from '../scripts/check-genesis-grant-documents.mjs';
import { review as reviewed } from './helpers/genesis-grant-rpc.mjs';

const policy = Buffer.from('fixture policy');
const founder = Buffer.from('founder');
const activity = Buffer.from([0xff, 0x00, 0x0d, 0x0a, 0xab]);
const cli = fileURLToPath(new URL('../scripts/check-genesis-grant-documents.mjs', import.meta.url));

async function fixture(t, hash = keccak256) {
    const folder = await mkdtemp(join(tmpdir(), 'artsoul-private-review-'));
    t.after(() => rm(folder, { recursive: true, force: true }));
    const review = structuredClone(reviewed);
    review.policyHash = hash(policy);
    review.grants[0].evidenceHash = hash(founder);
    review.grants[1].evidenceHash = hash(activity);
    const file = join(folder, 'independently-reviewed.json');
    await Promise.all([
        writeFile(file, JSON.stringify(review)),
        writeFile(join(folder, 'policy.bin'), policy),
        writeFile(join(folder, 'evidence-0.bin'), founder),
        writeFile(join(folder, 'evidence-201.bin'), activity)
    ]);
    return { folder, file, review };
}

test('matches every policy and private packet byte using only the selected digest', async t => {
    for (const [algorithm, hash] of [
        ['keccak256', keccak256],
        ['sha256', bytes => '0x' + createHash('sha256').update(bytes).digest('hex')]
    ]) {
        const { folder, file } = await fixture(t, hash);
        assert.deepEqual(await checkGenesisGrantDocuments(algorithm, file, folder), { checkedGrants: 2 });
        await assert.rejects(checkGenesisGrantDocuments(algorithm === 'sha256' ? 'keccak256' : 'sha256', file, folder), /policy bytes/);
        await writeFile(join(folder, 'evidence-201.bin'), founder);
        await assert.rejects(checkGenesisGrantDocuments(algorithm, file, folder), /Evidence bytes/);
        await writeFile(join(folder, 'policy.bin'), Buffer.concat([policy, Buffer.from('\r\n')]));
        await assert.rejects(checkGenesisGrantDocuments(algorithm, file, folder), /policy bytes/);
    }
});

test('validates the reviewed batch before reading documents and bounds regular file reads', async t => {
    const { folder, file, review } = await fixture(t);
    await assert.rejects(checkGenesisGrantDocuments('md5', file, folder), /keccak256 or sha256/);
    await assert.rejects(checkGenesisGrantDocuments('keccak256', file, '//server/share'), /local disk/);
    await assert.rejects(checkGenesisGrantDocuments('keccak256', file, file), /document folder/);
    await writeFile(join(folder, 'policy.bin'), Buffer.alloc(1024 * 1024 + 1));
    await assert.rejects(checkGenesisGrantDocuments('keccak256', file, folder), /size limit/);
    await writeFile(join(folder, 'policy.bin'), policy);
    await rm(join(folder, 'evidence-201.bin'));
    await assert.rejects(checkGenesisGrantDocuments('keccak256', file, folder), /missing/);
    await mkdir(join(folder, 'evidence-201.bin'));
    await assert.rejects(checkGenesisGrantDocuments('keccak256', file, folder), /unreadable/);
    review.grants[1].tokenId = 0;
    await writeFile(file, JSON.stringify(review));
    await assert.rejects(checkGenesisGrantDocuments('keccak256', file, folder), /batch is invalid/);
    await writeFile(file, Buffer.alloc(256 * 1024 + 1));
    await assert.rejects(checkGenesisGrantDocuments('keccak256', file, folder), /size limit/);
});

test('the CLI prints only a count on success and a generic error on invalid private input', async t => {
    const { folder, file, review } = await fixture(t);
    const run = () => spawnSync(process.execPath, [cli, 'keccak256', file, folder], { encoding: 'utf8' });
    const success = run();
    assert.equal(success.status, 0);
    assert.equal(success.stdout.trim(), '{"checkedGrants":2}');
    assert.equal(success.stderr, '');
    review.grants[1].recipient = 'private reviewer note';
    await writeFile(file, JSON.stringify(review));
    const failure = run();
    assert.equal(failure.status, 1);
    assert.equal(failure.stdout, '');
    assert.equal(failure.stderr.trim(), 'The reviewed Genesis batch is invalid.');
});
