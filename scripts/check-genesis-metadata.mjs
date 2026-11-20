import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { fetchArtworkResource } from '../src/api/safe-artwork-fetch.js';
import { MAX_ARTWORK_UPLOAD_BYTES, MAX_METADATA_BYTES } from '../src/config/upload-policy.js';
import { parseTokenMetadata } from './check-collection-metadata.mjs';

const directory = /^ipfs:\/\/bafybei[a-h][a-z2-7]{50}[aeimquy4]\/$/;
const sha256 = data => createHash('sha256').update(data).digest('hex');

async function readReviewedFile(file, limit) {
    const handle = await open(file, 'r');
    try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size < 1 || stat.size > limit) throw new Error('Reviewed file has an invalid size');
        const bytes = Buffer.alloc(stat.size);
        let used = 0;
        while (used < bytes.length) {
            const { bytesRead } = await handle.read(bytes, used, bytes.length - used, used);
            if (!bytesRead) throw new Error('Reviewed file changed during verification');
            used += bytesRead;
        }
        if ((await handle.stat()).size !== stat.size) throw new Error('Reviewed file changed during verification');
        return bytes;
    } finally { await handle.close(); }
}

export async function checkGenesisMetadata(prefix, tokenId, files, { published = false } = {}) {
    if (typeof prefix !== 'string' || prefix.length !== 67 || !directory.test(prefix)) {
        throw new Error('Genesis requires an IPFS CIDv1 DAG-PB SHA2-256 directory root');
    }
    if (typeof tokenId !== 'string' || !/^(0|[1-9]\d{0,3})$/.test(tokenId) || String(Number(tokenId)) !== tokenId) {
        throw new Error('Choose a Genesis serial from 0 through 9999');
    }
    const metadataBytes = await readReviewedFile(files.metadata, MAX_METADATA_BYTES);
    const metadata = parseTokenMetadata(metadataBytes, tokenId);
    for (const field of ['image', 'animation_url']) {
        const uri = metadata[field];
        if (typeof uri !== 'string' || !uri.startsWith('ipfs://') || /[?#]/.test(uri) ||
            uri.split('/').some(segment => ['.', '..'].includes(decodeURIComponent(segment)))) {
            throw new Error(`Genesis ${field} must reference immutable IPFS content`);
        }
    }
    const resources = {};
    const reviewedUris = new Map();
    for (const [field, uri] of [['metadata', prefix + tokenId], ['image', metadata.image], ['animation_url', metadata.animation_url]]) {
        const data = field === 'metadata' ? metadataBytes : await readReviewedFile(files[field], MAX_ARTWORK_UPLOAD_BYTES);
        resources[field] = { uri, bytes: data.length, sha256: sha256(data) };
        const prior = reviewedUris.get(uri);
        if (prior && resources[prior].sha256 !== resources[field].sha256) throw new Error('Different local files claim the same IPFS URI');
        if (!prior) reviewedUris.set(uri, field);
    }
    if (published) {
        for (const field of reviewedUris.values()) {
            const expected = resources[field];
            const response = await fetchArtworkResource(expected.uri, { maxBytes: expected.bytes, timeoutMs: 20000 });
            if (!response || response.data.length !== expected.bytes || sha256(response.data) !== expected.sha256) {
                throw new Error(`Published ${field} is unavailable or differs from the reviewed bytes`);
            }
        }
    }
    return { chainId: 8453, tokenId, name: metadata.name, published, resources };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const [prefix, id, metadata, image, animation, mode, ...extra] = process.argv.slice(2);
        if (!animation || extra.length || (mode && mode !== '--published')) {
            throw new Error('Usage: node scripts/check-genesis-metadata.mjs <ipfs-prefix> <id> <metadata-file> <image-file> <animation-file> [--published]');
        }
        const result = await checkGenesisMetadata(prefix, id, {metadata, image, animation_url: animation}, {published: mode === '--published'});
        console.log(JSON.stringify(result, null, 2));
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
