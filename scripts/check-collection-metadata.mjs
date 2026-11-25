import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { getAddress, Interface, isHexString, keccak256, ZeroAddress } from 'ethers';
import { allowedArtworkUrl, fetchArtworkResource } from '../src/api/safe-artwork-fetch.js';
import { MAX_METADATA_BYTES } from '../src/config/upload-policy.js';
import { hasFirstWorkMint, parseDraft, reviewConfig, safeUrl } from '../src/features/collections/launch-config.js';
import { confirmFinalizedBlock, finalizedBlock, readRpc } from './verify-treasury-safes.mjs';

// Read only the URI that the collection builder previews for its first ERC-721 token.
export async function checkCollectionMetadata(draftJson, expectedSha256) {
    const draft = parseDraft(draftJson);
    const { tokenOneMetadataURI } = reviewConfig(draft);
    if (!tokenOneMetadataURI) throw new Error('Set a valid token metadata prefix in the collection draft.');
    return { chainId: draft.chainId, ...await checkPublishedTokenMetadata(tokenOneMetadataURI, '1', expectedSha256) };
}

// A reviewed runtime identifies the template. An auction winner may mint to a
// different recipient, and the resulting NFT may have changed hands since.
export async function checkIssuedFirstWork(draftJson, collection, runtimeHash, expectedSha256, rpc) {
    const draft = parseDraft(draftJson);
    if (Number(draft.chainId) !== 84532 || !hasFirstWorkMint(draft)) throw new Error('Choose a Base Sepolia first-work draft.');
    const { tokenOneMetadataURI } = reviewConfig(draft);
    const address = getAddress(collection);
    if (!tokenOneMetadataURI || address === ZeroAddress || !isHexString(runtimeHash, 32) ||
        !/^[a-f0-9]{64}$/i.test(expectedSha256)) throw new Error('Supply a reviewed contract, runtime hash, metadata URI and SHA-256.');

    const block = await finalizedBlock(84532, rpc);
    const at = { blockHash: block.hash, requireCanonical: true };
    const code = await rpc('eth_getCode', [address, at]);
    if (code === '0x' || keccak256(code) !== runtimeHash.toLowerCase()) throw new Error('Collection runtime differs from the reviewed deployment.');
    const abi = new Interface([
        'function creator() view returns (address)', 'function firstCollector(uint256) view returns (address)',
        'function collectionFirstCollector() view returns (address)', 'function ownerOf(uint256) view returns (address)',
        'function tokenURI(uint256) view returns (string)', 'function mintPrice(uint256) view returns (uint256)'
    ]);
    async function read(name, args = []) {
        const result = await rpc('eth_call', [{ to: address, data: abi.encodeFunctionData(name, args) }, at]);
        return abi.decodeFunctionResult(name, result)[0];
    }
    const [creator, firstCollector, openingBuyer, owner, uri, price] = await Promise.all([
        read('creator'), read('firstCollector', [1]), read('collectionFirstCollector'),
        read('ownerOf', [1]), read('tokenURI', [1]), read('mintPrice', [1])
    ]);
    if ([creator, firstCollector, owner].includes(ZeroAddress) || firstCollector !== openingBuyer || price === 0n) {
        throw new Error('The issued first token and its paid opening auction do not agree.');
    }
    if (uri !== tokenOneMetadataURI) throw new Error('Issued token URI differs from the collection draft.');
    const metadata = await checkPublishedTokenMetadata(uri, '1', expectedSha256);
    await confirmFinalizedBlock(rpc, await finalizedBlock(84532, rpc), block);
    return { chainId: 84532, collection: address, runtimeHash: keccak256(code), block, creator, firstCollector,
        owner, publicMintPriceWei: price.toString(), metadata };
}

export async function checkPublishedTokenMetadata(metadataURI, tokenId, expectedSha256) {
    if (expectedSha256 !== undefined && !/^[a-f0-9]{64}$/i.test(expectedSha256)) {
        throw new Error('The expected SHA-256 must be a 64-character hex digest.');
    }
    if (!allowedArtworkUrl(metadataURI)) {
        throw new Error('This URI is outside the supported public artwork stores. Verify its response separately.');
    }
    const response = await fetchArtworkResource(metadataURI, { maxBytes: MAX_METADATA_BYTES, timeoutMs: 8000 });
    if (!response) throw new Error('Could not read a complete metadata response within the size and time limits.');
    const sha256 = createHash('sha256').update(response.data).digest('hex');
    if (expectedSha256 !== undefined && sha256 !== expectedSha256.toLowerCase()) {
        throw new Error('The served metadata differs from the expected SHA-256.');
    }
    const metadata = parseTokenMetadata(response.data, tokenId);
    return {
        tokenId, metadataURI, sha256,
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
        const args = process.argv.slice(2);
        const issued = args[0] === '--issued';
        const [file, digest, address, runtimeHash] = issued ? args.slice(1) : args;
        if (!file || (issued ? args.length !== 5 : args.length > 2)) throw new Error(
            'Usage: check-collection-metadata.mjs draft.json [sha256] | --issued draft.json sha256 address runtime-keccak256');
        const draft = await readFile(file, 'utf8');
        const report = issued
            ? await checkIssuedFirstWork(draft, address, runtimeHash, digest, readRpc(process.env.ARTSOUL_COLLECTION_RPC_URL))
            : await checkCollectionMetadata(draft, digest);
        console.log(JSON.stringify(report, null, 2));
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
