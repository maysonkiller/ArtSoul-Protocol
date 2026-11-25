import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Interface } from 'ethers';
import { fetchArtworkResource } from '../src/api/safe-artwork-fetch.js';
import { MAX_ARTWORK_UPLOAD_BYTES, MAX_METADATA_BYTES } from '../src/config/upload-policy.js';
import { parseTokenMetadata } from './check-collection-metadata.mjs';
import { readReviewedFile } from './security/read-reviewed-file.mjs';
import { verifyGenesisGrants } from './verify-genesis-grants.mjs';
import { confirmFinalizedBlock, finalizedBlock, readRpc } from './verify-treasury-safes.mjs';

const directory = /^ipfs:\/\/bafybei[a-h][a-z2-7]{50}[aeimquy4]\/$/;
const sha256 = data => createHash('sha256').update(data).digest('hex');
const tokenViews = new Interface([
    'function tokenURI(uint256) view returns (string)',
    'function ownerOf(uint256) view returns (address)',
    'function locked(uint256) view returns (bool)'
]);

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

// A directory check alone cannot establish which media the issued token points to.
export async function checkIssuedGenesisMedia(review, hash, prefix, tokenId, files, providers) {
    const proof = await verifyGenesisGrants(review, hash, providers);
    const grant = proof.grants.find(entry => String(entry.tokenId) === tokenId);
    if (!grant) throw new Error('The reviewed receipt does not grant this Genesis serial');
    const at = { blockHash: proof.block.hash, requireCanonical: true };
    await Promise.all(providers.map(async rpc => {
        for (const [name, expected] of [['ownerOf', grant.recipient], ['locked', true], ['tokenURI', prefix + tokenId]]) {
            const value = await rpc('eth_call', [{ to: proof.genesis, data: tokenViews.encodeFunctionData(name, [grant.tokenId]) }, at]);
            if (value?.toLowerCase() !== tokenViews.encodeFunctionResult(name, [expected])) {
                throw new Error('Issued Genesis ' + name + ' differs from the reviewed grant or media');
            }
        }
    }));
    const media = await checkGenesisMetadata(prefix, tokenId, files, { published: true });
    await Promise.all(providers.map(async rpc => confirmFinalizedBlock(rpc, await finalizedBlock(8453, rpc), proof.block)));
    return { ...media, genesis: proof.genesis, recipient: grant.recipient, decisionHash: grant.decisionHash,
        transactionHash: proof.transactionHash, block: proof.block, rpcReadings: providers.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const [prefix, id, metadata, image, animation, mode, ...extra] = process.argv.slice(2);
        const validMode = mode === '--issued'
            ? extra.length === 2
            : extra.length === 0 && (mode === undefined || mode === '--published');
        if (!animation || !validMode) {
            throw new Error('Usage: node scripts/check-genesis-metadata.mjs <ipfs-prefix> <id> <metadata-file> <image-file> <animation-file> [--published | --issued reviewed-grants.json TX_HASH]');
        }
        const files = { metadata, image, animation_url: animation };
        const result = mode === '--issued'
            ? await checkIssuedGenesisMedia(JSON.parse(await readFile(extra[0], 'utf8')), extra[1], prefix, id, files,
                [process.env.ARTSOUL_CUSTODY_RPC_URL, process.env.ARTSOUL_CUSTODY_RPC_CHECK_URL].map(readRpc))
            : await checkGenesisMetadata(prefix, id, files, { published: mode === '--published' });
        console.log(JSON.stringify(result, null, 2));
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
