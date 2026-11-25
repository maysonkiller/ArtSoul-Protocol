import { readFile } from 'node:fs/promises';
import pg from 'pg';
import EventListener from '../src/indexer/event-listener.js';
import { ingestOrdinarySettlement } from '../src/indexer/ordinary-settlement-intake.js';
import { InputError, readReviewedOrdinaryPair } from './read-reviewed-ordinary-pair.mjs';

let pool, listener;
try {
    const [pairFile, receiptFile, ...extra] = process.argv.slice(2);
    if (!pairFile || !receiptFile || extra.length) throw new InputError('Usage: node scripts/index-ordinary-settlement.mjs reviewed-pair.json receipt-location.json');
    const rpcUrl = process.env.ARTSOUL_ORDINARY_RPC_URL;
    const connectionString = process.env.ARTSOUL_ORDINARY_DATABASE_URL;
    if (!rpcUrl || !connectionString) throw new InputError('Set ARTSOUL_ORDINARY_RPC_URL and ARTSOUL_ORDINARY_DATABASE_URL for this intake.');
    const pair = await readReviewedOrdinaryPair(pairFile);
    const { chainId, coreAddress, nftAddress } = pair;
    const { blockNumber, blockHash, transactionHash, auctionId } = JSON.parse((await readFile(receiptFile, 'utf8')).trimStart());
    listener = new EventListener({ chainId, contractAddress: coreAddress, nftAddress, rpcUrl });
    pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 10000 });
    const result = await ingestOrdinarySettlement(pool, listener, { ...pair, blockNumber, blockHash,
        transactionHash, auctionId, isCurrent: () => true });
    console.log(JSON.stringify(result));
} catch (error) {
    // SDKs can include a full request, response or credential in an error.
    const safeDetail = /^(?:Ordinary deployment block is not finalized|Conflicting finalized evidence in ordinary_(?:issuers|settlements|primary_credits))$/.test(error.message);
    console.error(error instanceof InputError || safeDetail ? error.message : 'Could not verify or persist this settlement. Check the reviewed pair, receipt location, RPC and database configuration.');
    process.exitCode = 1;
} finally {
    await pool?.end();
    listener?.provider.destroy();
    for (const provider of listener?.readProviders || []) provider.destroy();
}
