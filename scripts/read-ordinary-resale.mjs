import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { readOrdinaryResalePurchase } from '../src/indexer/nft-deployment-proof.js';
import { appendOrdinaryResalePurchase, withOrdinaryIssuer } from '../src/indexer/ordinary-settlement-intake.js';
import { InputError, readReviewedOrdinaryPair, verifyPairReading } from './read-reviewed-ordinary-pair.mjs';
import { readRpc } from './verify-treasury-safes.mjs';

// Only an agreed, finalized reading may reach the append-only table. No caller-supplied receipt is stored.
export async function ingestOrdinaryResale(pool, pair, location, providers) {
    const reviewed = { ...pair };
    const sale = await verifyPairReading(reviewed, { ...location }, providers, readOrdinaryResalePurchase);
    const source = { chainId: reviewed.chainId, contractAddress: reviewed.coreAddress, nftAddress: reviewed.nftAddress };
    const current = { isCurrent: () => Object.keys(reviewed).every(field => pair[field] === reviewed[field]) };
    const inserted = await withOrdinaryIssuer(pool, source, current, sale, client => appendOrdinaryResalePurchase(client, sale));
    return { inserted, sale };
}

async function main() {
    let pool;
    try {
        const [file, height, blockHash, transactionHash, index, ...extra] = process.argv.slice(2);
        const persist = extra.length === 1 && extra[0] === '--persist';
        if (!file || !/^[1-9]\d*$/.test(height) || !/^[1-9]\d*$/.test(index) || !blockHash || !transactionHash || (extra.length && !persist)) {
            throw new InputError('Usage: node scripts/read-ordinary-resale.mjs reviewed-pair.json BLOCK_NUMBER BLOCK_HASH TX_HASH PURCHASE_LOG_INDEX [--persist]');
        }
        const urls = [process.env.ARTSOUL_ORDINARY_RPC_URL, process.env.ARTSOUL_ORDINARY_RPC_CHECK_URL];
        if (!urls.every(Boolean)) throw new InputError('Configure the two independent ordinary RPC endpoints.');
        const connectionString = process.env.ARTSOUL_ORDINARY_DATABASE_URL;
        if (persist && !connectionString) throw new InputError('Set ARTSOUL_ORDINARY_DATABASE_URL to the intended database for --persist.');
        const pair = await readReviewedOrdinaryPair(file);
        const location = { blockNumber: Number(height), blockHash, transactionHash, logIndex: Number(index) };
        const providers = urls.map(readRpc);
        if (persist) {
            pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 10000 });
            console.log(JSON.stringify(await ingestOrdinaryResale(pool, pair, location, providers)));
        } else {
            console.log(JSON.stringify(await verifyPairReading(pair, location, providers, readOrdinaryResalePurchase)));
        }
    } catch (error) {
        const conflict = /^Conflicting finalized evidence in ordinary_(?:issuers|resale_purchases)$/.test(error.message);
        console.error(error instanceof InputError || conflict ? error.message : 'Could not verify or record the finalized ordinary resale. Check the receipt location, reviewed pair, both RPC endpoints and any selected database.');
        process.exitCode = 1;
    } finally {
        await pool?.end();
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
