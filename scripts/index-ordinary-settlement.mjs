import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { isAddress } from 'ethers';
import EventListener from '../src/indexer/event-listener.js';
import { ingestOrdinarySettlement } from '../src/indexer/ordinary-settlement-intake.js';

let pool, listener;
class InputError extends Error {}
try {
    const [pairFile, receiptFile, ...extra] = process.argv.slice(2);
    if (!pairFile || !receiptFile || extra.length) throw new InputError('Usage: node scripts/index-ordinary-settlement.mjs reviewed-pair.json receipt-location.json');
    const rpcUrl = process.env.ARTSOUL_ORDINARY_RPC_URL;
    const connectionString = process.env.ARTSOUL_ORDINARY_DATABASE_URL;
    if (!rpcUrl || !connectionString) throw new InputError('Set ARTSOUL_ORDINARY_RPC_URL and ARTSOUL_ORDINARY_DATABASE_URL for this intake.');
    const readJson = async file => JSON.parse((await readFile(file, 'utf8')).trimStart());
    const { chainId, coreAddress, nftAddress, expectedCoreCodeHash, expectedNftCodeHash } = await readJson(pairFile);
    const { blockNumber, blockHash, transactionHash, auctionId } = await readJson(receiptFile);
    if (![84532, 8453].includes(chainId) || !isAddress(coreAddress) || !isAddress(nftAddress)) {
        throw new InputError('The reviewed pair must identify the Base chain and both contract addresses.');
    }
    listener = new EventListener({ chainId, contractAddress: coreAddress, nftAddress, rpcUrl });
    pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 10000 });
    const result = await ingestOrdinarySettlement(pool, listener, { chainId, coreAddress, nftAddress, expectedCoreCodeHash,
        expectedNftCodeHash, blockNumber, blockHash, transactionHash, auctionId, isCurrent: () => true });
    console.log(JSON.stringify(result));
} catch (error) {
    // SDKs can include a full request, response or credential in an error.
    const safeDetail = /^(?:Ordinary deployment block is not finalized|Conflicting finalized evidence in ordinary_(?:issuers|settlements))$/.test(error.message);
    console.error(error instanceof InputError || safeDetail ? error.message : 'Could not verify or persist this settlement. Check the reviewed pair, receipt location, RPC and database configuration.');
    process.exitCode = 1;
} finally {
    await pool?.end();
    listener?.provider.destroy();
    for (const provider of listener?.readProviders || []) provider.destroy();
}
