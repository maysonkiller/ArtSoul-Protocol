import { readFile } from 'node:fs/promises';
import { isAddress } from 'ethers';
import EventListener from '../src/indexer/event-listener.js';
import { ingestOrdinaryRunnerUpOffer } from '../src/indexer/ordinary-runner-up-intake.js';

let listener, pool;
class InputError extends Error {}

try {
    const [pairFile, auctionId, height, blockHash, ...extra] = process.argv.slice(2);
    const persist = extra.length === 1 && extra[0] === '--persist';
    if (!pairFile || !auctionId || !/^([1-9]\d*|0)$/.test(height) || !blockHash || (extra.length && !persist)) {
        throw new InputError('Usage: node scripts/read-ordinary-runner-up.mjs reviewed-pair.json AUCTION_ID BLOCK_NUMBER BLOCK_HASH [--persist]');
    }
    const rpcUrl = process.env.ARTSOUL_ORDINARY_RPC_URL;
    if (!rpcUrl) throw new InputError('Set ARTSOUL_ORDINARY_RPC_URL for the reviewed deployment.');
    const { chainId, coreAddress, nftAddress, expectedCoreCodeHash, expectedNftCodeHash } =
        JSON.parse((await readFile(pairFile, 'utf8')).trimStart());
    if (![84532, 8453].includes(chainId) || !isAddress(coreAddress) || !isAddress(nftAddress)) {
        throw new InputError('The reviewed pair must identify the Base chain and both contract addresses.');
    }
    listener = new EventListener({ chainId, contractAddress: coreAddress, nftAddress, rpcUrl });
    const options = { chainId, coreAddress, nftAddress, expectedCoreCodeHash, expectedNftCodeHash,
        auctionId, blockNumber: Number(height), blockHash, isCurrent: () => true };
    if (persist) {
        const connectionString = process.env.ARTSOUL_ORDINARY_DATABASE_URL;
        if (!connectionString) throw new InputError('Set ARTSOUL_ORDINARY_DATABASE_URL for the requested private intake.');
        const { default: pg } = await import('pg');
        pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 10000 });
    }
    const result = persist ? await ingestOrdinaryRunnerUpOffer(pool, listener, options) : await listener.readOrdinaryRunnerUpOffer(options);
    console.log(JSON.stringify(result));
} catch (error) {
    const known = ['Invalid ordinary auction ID', 'Unknown ordinary auction', 'Ordinary deployment block is not finalized',
        'Stale runner-up observation', 'Conflicting runner-up observation', 'Inconsistent runner-up transition'];
    console.error(error instanceof InputError || known.includes(error.message) ? error.message
        : 'Could not process this offer. Check the reviewed pair, block location, RPC and any selected database.');
    process.exitCode = 1;
} finally {
    await pool?.end();
    listener?.provider.destroy();
    for (const provider of listener?.readProviders || []) provider.destroy();
}
