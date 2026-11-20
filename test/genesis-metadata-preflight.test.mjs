import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkGenesisMetadata } from '../scripts/check-genesis-metadata.mjs';

const cid = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3pteozf5b6tk3twtpjfeqmczy';
const prefix = 'ipfs://' + cid + '/';
const poster = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS5kAAAAASUVORK5CYII=', 'base64');
const animation = Buffer.from('R0lGODlhAQABAAAAACwAAAAAAQABAAA=', 'base64');
const metadata = { name: 'Founder Genesis', image: prefix + 'poster.png', animation_url: prefix + 'art.gif' };

async function setup(t) {
    const dir = await mkdtemp(join(tmpdir(), 'artsoul-genesis-review-'));
    t.after(() => rm(dir, {recursive: true, force: true}));
    const files = {metadata: join(dir, '0'), image: join(dir, 'poster.png'), animation_url: join(dir, 'art.gif')};
    const bytes = Buffer.from(JSON.stringify(metadata));
    await Promise.all([writeFile(files.metadata, bytes), writeFile(files.image, poster), writeFile(files.animation_url, animation)]);
    return {files, bytes};
}

test('the founder serial and pilot serials can be reviewed offline without a gateway or wallet', async t => {
    const {files, bytes} = await setup(t);
    const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected gateway request'); });
    for (const id of ['0', '200', '9999']) {
        const result = await checkGenesisMetadata(prefix, id, files);
        assert.equal(result.resources.metadata.uri, prefix + id);
        assert.equal(result.resources.metadata.sha256, createHash('sha256').update(bytes).digest('hex'));
        assert.equal(result.resources.animation_url.bytes, animation.length);
        assert.equal(result.published, false);
    }
    for (const invalid of ['00', '1\n', '10000']) await assert.rejects(checkGenesisMetadata(prefix, invalid, files), /serial/);
    for (const invalid of ['ipfs://x/', prefix + 'folder/', prefix.replace('bafybei', 'bafkrei'), prefix.slice(0, -2) + 'z/']) {
        await assert.rejects(checkGenesisMetadata(invalid, '0', files), /directory root/);
    }
    for (const invalid of [undefined, 'https://example.org/valid.gif', prefix + 'art.gif?download=1', prefix + 'sub/../art.gif']) {
        await writeFile(files.metadata, JSON.stringify({...metadata, animation_url: invalid}));
        await assert.rejects(checkGenesisMetadata(prefix, '0', files), /animation_url/);
    }
    assert.equal(fetch.mock.callCount(), 0);
});

test('published checks match every byte of the exact token URI, poster and animation before accepting a pilot', async t => {
    const {files, bytes} = await setup(t);
    const resources = new Map([['/ipfs/' + cid + '/0', bytes], ['/ipfs/' + cid + '/poster.png', poster], ['/ipfs/' + cid + '/art.gif', animation]]);
    const fetch = t.mock.method(globalThis, 'fetch', (url, options) => {
        assert.equal(url.origin, 'https://ipfs.io');
        assert.equal(options.redirect, 'error');
        return new Response(resources.get(url.pathname));
    });
    const result = await checkGenesisMetadata(prefix, '0', files, {published:true});
    assert.equal(result.published, true);
    assert.equal(fetch.mock.callCount(), 3);
    for (const [path, original] of resources) {
        resources.set(path, Buffer.alloc(original.length));
        await assert.rejects(checkGenesisMetadata(prefix, '0', files, {published:true}), /differs from the reviewed/);
        resources.set(path, original);
    }
    const gifMetadata = Buffer.from(JSON.stringify({...metadata, image: metadata.animation_url}));
    await writeFile(files.metadata, gifMetadata);
    const before = fetch.mock.callCount();
    await assert.rejects(checkGenesisMetadata(prefix, '0', files, {published:true}), /same IPFS URI/);
    assert.equal(fetch.mock.callCount(), before);
    resources.set('/ipfs/' + cid + '/0', gifMetadata);
    await checkGenesisMetadata(prefix, '0', {...files, image: files.animation_url}, {published:true});
    assert.equal(fetch.mock.callCount(), before + 2);
});
