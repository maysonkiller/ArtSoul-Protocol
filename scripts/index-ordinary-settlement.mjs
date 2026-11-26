import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { readOrdinarySettlement } from '../src/indexer/nft-deployment-proof.js';
import { persistOrdinarySettlement } from '../src/indexer/ordinary-settlement-intake.js';
import { InputError, readReviewedOrdinaryPair, verifyPairReading } from './read-reviewed-ordinary-pair.mjs';
import { sequencedRead } from './serve-rehearsal-review.mjs';

let pool;
try {
    const [pairFile, receiptFile, ...extra] = process.argv.slice(2);
    const readOnly = extra.length === 1 && extra[0] === '--read-only';
    if (!pairFile || !receiptFile || (extra.length && !readOnly)) throw new InputError('Usage: node scripts/index-ordinary-settlement.mjs reviewed-pair.json receipt-location.json [--read-only]');
    const pair = await readReviewedOrdinaryPair(pairFile);
    const urls = [process.env.ARTSOUL_ORDINARY_RPC_URL, process.env.ARTSOUL_ORDINARY_RPC_CHECK_URL];
    if (!urls.every(Boolean)) throw new InputError('Configure both independent ordinary RPC endpoints.');
    const connectionString = process.env.ARTSOUL_ORDINARY_DATABASE_URL;
    if (!readOnly && !connectionString) throw new InputError('Set ARTSOUL_ORDINARY_DATABASE_URL for settlement intake.');
    const { blockNumber, blockHash, transactionHash, auctionId } = JSON.parse((await readFile(receiptFile, 'utf8')).trimStart());
    const location = { blockNumber, blockHash, transactionHash, auctionId };
    const sale = await verifyPairReading(pair, location, urls.map(sequencedRead), readOrdinarySettlement);
    let result = { sale };
    if (!readOnly) {
        pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 10000 });
        result = await persistOrdinarySettlement(pool, { chainId: pair.chainId, contractAddress: pair.coreAddress,
            nftAddress: pair.nftAddress }, { isCurrent: () => true }, sale);
    }
    console.log(JSON.stringify(result));
} catch (error) {
    // SDKs can include a full request, response or credential in an error.
    const safeDetail = /^(?:Ordinary deployment block is not finalized|Conflicting finalized evidence in ordinary_(?:issuers|settlements|primary_credits))$/.test(error.message);
    console.error(error instanceof InputError || safeDetail ? error.message : 'Could not verify or persist this settlement. Check the reviewed pair, receipt location, RPC and database configuration.');
    process.exitCode = 1;
} finally {
    await pool?.end();
}
