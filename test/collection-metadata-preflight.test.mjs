import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { checkCollectionMetadata } from '../scripts/check-collection-metadata.mjs';
import { createDraft } from '../src/features/collections/launch-config.js';
import { MAX_METADATA_BYTES } from '../src/config/upload-policy.js';

const cid = 'Qm' + 'a'.repeat(44);
const prefix = `ipfs://${cid}/items/`;
const metadata = { name: 'First work', image: `ipfs://${cid}/cover.png`, animation_url: 'https://art.example/work.webm' };

function draft(uri = prefix) {
    const config = createDraft();
    config.media.metadataBaseURI = uri;
    return JSON.stringify(config);
}

test('a saved collection draft checks exactly token 1 and retains the fingerprint of the served bytes', async t => {
    const body = JSON.stringify(metadata, null, 2) + '\n';
    const sha256 = createHash('sha256').update(body).digest('hex');
    const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
        assert.equal(url.href, `https://ipfs.io/ipfs/${cid}/items/1`);
        assert.equal(options.redirect, 'error');
        return new Response(body);
    });
    const report = await checkCollectionMetadata(draft(), sha256.toUpperCase());
    assert.equal(report.metadataURI, prefix + '1');
    assert.equal(report.sha256, sha256);
    assert.equal(report.bytes, Buffer.byteLength(body));
    assert.equal(report.image, metadata.image);
    assert.equal(report.animation_url, metadata.animation_url);
    assert.equal(report.tokenId, '1');
    assert.equal(fetch.mock.callCount(), 1, 'only the metadata document is requested');
    await assert.rejects(checkCollectionMetadata(draft(), '0'.repeat(64)), /differs from the expected/);
});

test('invalid prefixes, unsupported stores and malformed digests stop before any network read', async t => {
    const fetch = t.mock.method(globalThis, 'fetch');
    await assert.rejects(checkCollectionMetadata(draft('ipfs://')), /valid token metadata prefix/);
    await assert.rejects(checkCollectionMetadata(draft('https://example.com/items/')), /outside the supported/);
    await assert.rejects(checkCollectionMetadata(draft(), 'bad'), /64-character hex/);
    assert.equal(fetch.mock.callCount(), 0);
});

test('an unreadable, oversized or malformed response never produces a metadata check result', async t => {
    const cases = [
        [() => new Response('missing', { status: 404 }), /complete metadata response/],
        [() => new Response(new Uint8Array(MAX_METADATA_BYTES + 1)), /complete metadata response/],
        [() => new Response('not JSON'), /invalid UTF-8 or JSON/],
        [() => new Response(Uint8Array.of(0xff)), /invalid UTF-8 or JSON/],
        [() => Response.json({ image: metadata.image }), /display name/],
        [() => Response.json({ name: 'First work' }), /for image/],
        [() => Response.json({ ...metadata, animation_url: 'ipfs://invalid/work.mp4' }), /for animation_url/]
    ];
    for (const [response, message] of cases) {
        const mock = t.mock.method(globalThis, 'fetch', response);
        try { await assert.rejects(checkCollectionMetadata(draft()), message); }
        finally { mock.mock.restore(); }
    }
});
