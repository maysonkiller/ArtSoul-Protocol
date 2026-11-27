import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { getAddress, Interface, isHexString, keccak256, ZeroAddress } from 'ethers';
import { allowedArtworkUrl, fetchArtworkResource } from '../src/api/safe-artwork-fetch.js';
import { MAX_METADATA_BYTES } from '../src/config/upload-policy.js';
import { hasFirstWorkMint, parseDraft, parseEth, reviewConfig, safeUrl } from '../src/features/collections/launch-config.js';
import { confirmFinalizedBlock, finalizedBlock, readRpc, requireIndependentProviders } from './verify-treasury-safes.mjs';
import { readCollectionOpeningReceipts } from './read-collection-opening-receipts.mjs';
import { rehearsalCore } from './rehearsal-review/deployment.mjs';

// Read only the URI that the collection builder previews for its first ERC-721 token.
export async function checkCollectionMetadata(draftJson, expectedSha256) {
    const draft = parseDraft(draftJson);
    const { tokenOneMetadataURI } = reviewConfig(draft);
    if (!tokenOneMetadataURI) throw new Error('Set a valid token metadata prefix in the collection draft.');
    return { chainId: draft.chainId, ...await checkPublishedTokenMetadata(tokenOneMetadataURI, '1', expectedSha256) };
}

// A reviewed runtime identifies the template. An auction winner may mint to a
// different recipient, and the resulting NFT may have changed hands since.
export async function checkIssuedFirstWork(draftJson, collection, runtimeHash, expectedSha256, providers, receiptHashes) {
    requireIndependentProviders(providers);
    const transactions = receiptHashes === undefined ? undefined :
        { settlement: receiptHashes.settlement, issuance: receiptHashes.issuance };
    const draft = parseDraft(draftJson);
    if (Number(draft.chainId) !== 84532 || !hasFirstWorkMint(draft)) throw new Error('Choose a Base Sepolia first-work draft.');
    const { tokenOneMetadataURI } = reviewConfig(draft);
    const address = getAddress(collection);
    if (!tokenOneMetadataURI || address === ZeroAddress || !isHexString(runtimeHash, 32) ||
        !/^[a-f0-9]{64}$/i.test(expectedSha256)) throw new Error('Supply a reviewed contract, runtime hash, metadata URI and SHA-256.');

    const reserve = parseEth(draft.phases[0].pricing.priceEth);
    const supply = Number(draft.maxSupply);
    if (draft.phases[1].pricing.sourcePhaseId !== draft.phases[0].id || draft.phases[1].pricing.fallback !== 'pause' ||
        Number(draft.creatorEarnings.bps) !== 550 || draft.creatorEarnings.recipients.length) {
        throw new Error('The draft must use its settled opening price and the 5.5% creator royalty.');
    }
    if (!Number.isSafeInteger(supply) || supply < 2 || supply > 0xffffffff ||
        Number(draft.phases[0].allocation) !== 1 || Number(draft.phases[1].allocation) !== supply - 1 || !reserve) {
        throw new Error('The reviewed draft must specify its supply, complete allocations and positive opening reserve.');
    }
    const heads = await Promise.all(providers.map(rpc => finalizedBlock(84532, rpc)));
    const block = BigInt(heads[0].number) <= BigInt(heads[1].number) ? heads[0] : heads[1];
    await Promise.all(providers.map((rpc, i) => confirmFinalizedBlock(rpc, heads[i], block)));
    const [first, second] = await Promise.all(providers.map(rpc => readFirstWork(rpc, address, runtimeHash, block)));
    if (!isDeepStrictEqual(first, second)) throw new Error('Independent providers disagree on the issued first work.');
    if (first.uri !== tokenOneMetadataURI) throw new Error('Issued token URI differs from the collection draft.');
    if (!first.locked || first.supply !== BigInt(supply) || first.allocated !== first.supply ||
        first.openingReserve !== reserve || first.price < reserve) {
        throw new Error('Locked collection supply, allocation or opening price differs from the reviewed draft.');
    }
    if (first.marketplaceRegistry !== rehearsalCore) throw new Error('Collection does not bind the reviewed Base Sepolia marketplace registry.');
    if (first.protocolTreasury === ZeroAddress || first.protocolReceiver !== first.protocolTreasury) {
        throw new Error('The collection fee receiver differs from the reviewed Base Sepolia protocol treasury.');
    }
    if (first.creator === ZeroAddress || first.owner === ZeroAddress || first.firstCollector === ZeroAddress ||
        first.firstCollector !== first.openingBuyer) throw new Error('The issued first token and its paid opening auction do not agree.');
    if (first.royaltyReceiver !== first.creator || first.royaltyAmount !== 550n) {
        throw new Error('The issued NFT does not report the reviewed 5.5% creator royalty.');
    }
    let provenance;
    if (transactions) {
        const readings = await Promise.all(providers.map(rpc =>
            readCollectionOpeningReceipts(rpc, block, address, runtimeHash, first, transactions)));
        if (!isDeepStrictEqual(readings[0], readings[1])) throw new Error('Independent providers disagree on collection provenance.');
        provenance = readings[0];
    }
    const metadata = await checkPublishedTokenMetadata(first.uri, '1', expectedSha256);
    await Promise.all(providers.map(async rpc => confirmFinalizedBlock(rpc, await finalizedBlock(84532, rpc), block)));
    return { chainId: 84532, collection: address, runtimeHash: runtimeHash.toLowerCase(), block, rpcReadings: 2,
        creator: first.creator, firstCollector: first.firstCollector, owner: first.owner, supply, marketplaceRegistry: first.marketplaceRegistry,
        protocolTreasury: first.protocolTreasury, openingReserveWei: reserve.toString(), publicMintPriceWei: first.price.toString(), metadata,
        ...(provenance && { provenance }) };
}

async function readFirstWork(rpc, address, runtimeHash, block) {
    const at = { blockHash: block.hash, requireCanonical: true };
    const code = await rpc('eth_getCode', [address, at]);
    if (code === '0x' || keccak256(code) !== runtimeHash.toLowerCase()) throw new Error('Collection runtime differs from the reviewed deployment.');
    const abi = new Interface([
        'function creator() view returns (address)', 'function firstCollector(uint256) view returns (address)',
        'function collectionFirstCollector() view returns (address)', 'function ownerOf(uint256) view returns (address)',
        'function tokenURI(uint256) view returns (string)', 'function mintPrice(uint256) view returns (uint256)',
        'function configurationLocked() view returns (bool)', 'function maxSupply() view returns (uint32)',
        'function allocatedSupply() view returns (uint256)', 'function royaltyInfo(uint256,uint256) view returns (address,uint256)',
        'function marketplaceRegistry() view returns (address)', 'function protocolReceiver() view returns (address)',
        'function protocolTreasury() view returns (address)'
    ]);
    async function read(name, args = [], target = address) {
        const result = await rpc('eth_call', [{ to: target, data: abi.encodeFunctionData(name, args) }, at]);
        const decoded = abi.decodeFunctionResult(name, result);
        return decoded.length === 1 ? decoded[0] : decoded;
    }
    const [creator, firstCollector, openingBuyer, owner, uri, price, locked, supply, allocated, openingReserve,
        [royaltyReceiver, royaltyAmount], marketplaceRegistry, protocolReceiver, protocolTreasury] = await Promise.all([
        read('creator'), read('firstCollector', [1]), read('collectionFirstCollector'),
        read('ownerOf', [1]), read('tokenURI', [1]), read('mintPrice', [1]), read('configurationLocked'),
        read('maxSupply'), read('allocatedSupply'), read('mintPrice', [0]), read('royaltyInfo', [1, 10000]), read('marketplaceRegistry'),
        read('protocolReceiver'), read('protocolTreasury', [], rehearsalCore)
    ]);
    return { creator, firstCollector, openingBuyer, owner, uri, price, locked, supply, allocated, openingReserve,
        royaltyReceiver, royaltyAmount, marketplaceRegistry, protocolReceiver, protocolTreasury };
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
        const [file, digest, address, runtimeHash, settlement, issuance] = issued ? args.slice(1) : args;
        if (!file || (issued ? ![5, 7].includes(args.length) : args.length > 2)) throw new Error(
            'Usage: check-collection-metadata.mjs draft.json [sha256] | --issued draft.json sha256 address runtime-keccak256 [settlement-tx mint-tx]');
        const draft = await readFile(file, 'utf8');
        const report = issued
            ? await checkIssuedFirstWork(draft, address, runtimeHash, digest,
                [readRpc(process.env.ARTSOUL_COLLECTION_RPC_URL), readRpc(process.env.ARTSOUL_COLLECTION_RPC_CHECK_URL)],
                settlement === undefined ? undefined : { settlement, issuance })
            : await checkCollectionMetadata(draft, digest);
        console.log(JSON.stringify(report, null, 2));
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
