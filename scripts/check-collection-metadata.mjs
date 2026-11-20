import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { allowedArtworkUrl, fetchArtworkResource } from '../src/api/safe-artwork-fetch.js';
import { MAX_METADATA_BYTES } from '../src/config/upload-policy.js';
import { parseDraft, reviewConfig, safeUrl } from '../src/features/collections/launch-config.js';

// Read only the URI that the collection builder previews for its first ERC-721 token.
export async function checkCollectionMetadata(draftJson, expectedSha256) {
    if (expectedSha256 !== undefined && !/^[a-f0-9]{64}$/i.test(expectedSha256)) {
        throw new Error('The expected SHA-256 must be a 64-character hex digest.');
    }
    const draft = parseDraft(draftJson);
    const { tokenOneMetadataURI } = reviewConfig(draft);
    if (!tokenOneMetadataURI) throw new Error('Set a valid token metadata prefix in the collection draft.');
    if (!allowedArtworkUrl(tokenOneMetadataURI)) {
        throw new Error('This URI is outside the supported public artwork stores. Verify its response separately.');
    }
    const response = await fetchArtworkResource(tokenOneMetadataURI, { maxBytes: MAX_METADATA_BYTES, timeoutMs: 8000 });
    if (!response) throw new Error('Could not read a complete metadata response within the size and time limits.');
    const sha256 = createHash('sha256').update(response.data).digest('hex');
    if (expectedSha256 !== undefined && sha256 !== expectedSha256.toLowerCase()) {
        throw new Error('The served metadata differs from the expected SHA-256.');
    }
    const metadata = parseTokenMetadata(response.data, '1');
    return {
        chainId: draft.chainId, tokenId: '1', metadataURI: tokenOneMetadataURI, sha256,
        bytes: response.data.length, name: metadata.name, image: metadata.image,
        ...(metadata.animation_url !== undefined && { animation_url: metadata.animation_url })
    };
}

export function parseTokenMetadata(data, tokenId) {
    let metadata;
    try {
        metadata = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
    } catch {
        throw new Error(`Token ${tokenId} returned invalid UTF-8 or JSON.`);
    }
    if (!metadata || Array.isArray(metadata) || typeof metadata.name !== 'string' || !metadata.name.trim()) {
        throw new Error(`Token ${tokenId} must provide a JSON object with a display name.`);
    }
    for (const field of ['image', ...(metadata.animation_url === undefined ? [] : ['animation_url'])]) {
        const uri = metadata[field];
        if (typeof uri !== 'string' || !/^(?:https|ipfs):\/\//.test(uri) || /[\s\\]/.test(uri) ||
            !safeUrl(uri, true) || (uri.startsWith('ipfs:') && !allowedArtworkUrl(uri))) {
            throw new Error(`Token ${tokenId} needs a valid HTTPS or IPFS URL for ${field}.`);
        }
    }
    return metadata;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const [file, digest, ...extra] = process.argv.slice(2);
        if (!file || extra.length) throw new Error('Usage: node scripts/check-collection-metadata.mjs draft.json [expected-sha256]');
        const report = await checkCollectionMetadata(await readFile(file, 'utf8'), digest);
        console.log(JSON.stringify(report, null, 2));
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
