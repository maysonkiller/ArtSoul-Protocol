import { readFile } from 'node:fs/promises';
import { isAddress } from 'ethers';
import EventListener from '../src/indexer/event-listener.js';

let listener;
class InputError extends Error {}

try {
    const [pairFile, auctionId, height, blockHash, ...extra] = process.argv.slice(2);
    if (!pairFile || !auctionId || !/^([1-9]\d*|0)$/.test(height) || !blockHash || extra.length) {
        throw new InputError('Usage: node scripts/read-ordinary-runner-up.mjs reviewed-pair.json AUCTION_ID BLOCK_NUMBER BLOCK_HASH');
    }
    const rpcUrl = process.env.ARTSOUL_ORDINARY_RPC_URL;
    if (!rpcUrl) throw new InputError('Set ARTSOUL_ORDINARY_RPC_URL for the reviewed deployment.');
    const { chainId, coreAddress, nftAddress, expectedCoreCodeHash, expectedNftCodeHash } =
        JSON.parse((await readFile(pairFile, 'utf8')).trimStart());
    if (![84532, 8453].includes(chainId) || !isAddress(coreAddress) || !isAddress(nftAddress)) {
        throw new InputError('The reviewed pair must identify the Base chain and both contract addresses.');
    }
    listener = new EventListener({ chainId, contractAddress: coreAddress, nftAddress, rpcUrl });
    const result = await listener.readOrdinaryRunnerUpOffer({ chainId, coreAddress, nftAddress, expectedCoreCodeHash,
        expectedNftCodeHash, auctionId, blockNumber: Number(height), blockHash, isCurrent: () => true });
    console.log(JSON.stringify(result));
} catch (error) {
    const known = ['Invalid ordinary auction ID', 'Unknown ordinary auction', 'Ordinary deployment block is not finalized'];
    console.error(error instanceof InputError || known.includes(error.message) ? error.message
        : 'Could not verify this offer. Check the reviewed pair, block location and RPC configuration.');
    process.exitCode = 1;
} finally {
    listener?.provider.destroy();
    for (const provider of listener?.readProviders || []) provider.destroy();
}
