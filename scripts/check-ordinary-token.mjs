import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { isAddress } from 'ethers';
import EventListener from '../src/indexer/event-listener.js';
import { readOrdinaryToken } from '../src/indexer/nft-deployment-proof.js';
import { checkPublishedTokenMetadata } from './check-collection-metadata.mjs';

class InputError extends Error {}

export async function checkOrdinaryToken(listener, options, expectedSha256) {
    const token = await readOrdinaryToken(listener, options);
    if (expectedSha256 === undefined) return token;
    const metadata = await checkPublishedTokenMetadata(token.metadataURI, token.tokenId, expectedSha256);
    return { ...token, metadata };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    let listener;
    try {
        const [file, tokenId, height, blockHash, digest, ...extra] = process.argv.slice(2);
        if (!file || !tokenId || !/^(?:0|[1-9]\d*)$/.test(height) || !blockHash ||
            (digest !== undefined && !/^[a-f0-9]{64}$/i.test(digest)) || extra.length) {
            throw new InputError('Usage: node scripts/check-ordinary-token.mjs reviewed-pair.json TOKEN_ID BLOCK_NUMBER BLOCK_HASH [metadata-sha256]');
        }
        const { chainId, coreAddress, nftAddress, expectedCoreCodeHash, expectedNftCodeHash } =
            JSON.parse((await readFile(file, 'utf8')).trimStart());
        const rpcUrl = process.env.ARTSOUL_ORDINARY_RPC_URL;
        if (!rpcUrl) throw new InputError('Set ARTSOUL_ORDINARY_RPC_URL for the reviewed deployment.');
        if (![8453, 84532].includes(chainId) || !isAddress(coreAddress) || !isAddress(nftAddress)) {
            throw new InputError('The reviewed pair must identify the Base chain and both contract addresses.');
        }
        listener = new EventListener({ chainId, contractAddress: coreAddress, nftAddress, rpcUrl });
        const report = await checkOrdinaryToken(listener, { chainId, coreAddress, nftAddress, expectedCoreCodeHash,
            expectedNftCodeHash, tokenId, blockNumber: Number(height), blockHash, isCurrent: () => true }, digest);
        console.log(JSON.stringify(report));
    } catch (error) {
        console.error(error instanceof InputError ? error.message
            : 'Could not verify the token. Check the reviewed deployment, finalized block, token ID and metadata digest.');
        process.exitCode = 1;
    } finally {
        listener?.provider.destroy();
        for (const provider of listener?.readProviders || []) provider.destroy();
    }
}
