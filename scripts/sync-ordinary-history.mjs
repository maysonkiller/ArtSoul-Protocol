import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { ZeroAddress, ZeroHash, toQuantity } from 'ethers';
import pg from 'pg';
import { readOrdinaryResalePurchase, readOrdinarySettlement } from '../src/indexer/nft-deployment-proof.js';
import { checkOrdinaryHistoryContinuity, commitOrdinaryHistory, ordinaryHistoryProgress } from '../src/indexer/ordinary-nft-history.js';
import { checkOrdinaryTransferRange } from './read-ordinary-transfer-range.mjs';
import { InputError, readReviewedOrdinaryPair, verifyPairReading } from './read-reviewed-ordinary-pair.mjs';
import { sequencedRead } from './serve-rehearsal-review.mjs';
import { confirmFinalizedBlock, finalizedBlock, requireIndependentProviders } from './verify-treasury-safes.mjs';

const hash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value) && value !== ZeroHash;

async function readSnapshot(pool, read) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        await client.query('SET LOCAL row_security = off');
        const result = await read(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

export async function syncOrdinaryHistory({ pool, preview = false, pair, origin, providers, maxBlocks }) {
    if (pair.chainId !== 84532 || !Number.isSafeInteger(origin.fromBlock) || origin.fromBlock < 1 ||
        !hash(origin.previousBlockHash) || !Number.isSafeInteger(maxBlocks) || maxBlocks < 1 || maxBlocks > 10000) {
        throw new InputError('Supply a Base Sepolia pair, a reviewed zero-supply predecessor, and a range of 1 to 10000 blocks.');
    }
    requireIndependentProviders(providers);
    if (preview && !pool) throw new InputError('Select a private checkpoint database for the preview.');
    let next = { ...origin, bootstrap: true, supply: '0' };
    if (preview) next = await readSnapshot(pool, client => ordinaryHistoryProgress(client, pair, origin));
    else if (pool) next = await ordinaryHistoryProgress(pool, pair, origin);
    const heads = await Promise.all(providers.map(rpc => finalizedBlock(pair.chainId, rpc)));
    const common = BigInt(heads[0].number) <= BigInt(heads[1].number) ? heads[0] : heads[1];
    await Promise.all(providers.map((rpc, i) => confirmFinalizedBlock(rpc, heads[i], common)));
    const finalized = Number(BigInt(common.number));
    if (!Number.isSafeInteger(finalized) || next.fromBlock - 1 > finalized) throw new Error('Ordinary finalized head precedes the checkpoint');
    const blockNumber = Math.min(next.fromBlock + maxBlocks - 1, finalized);
    if (next.fromBlock > blockNumber) {
        if (common.hash.toLowerCase() !== next.previousBlockHash) throw new Error('Ordinary finalized head differs from the checkpoint');
        return { status: next.bootstrap ? 'awaiting-first-range' : 'caught-up', throughBlock: finalized, blockHash: common.hash };
    }
    const tag = toQuantity(blockNumber);
    const endpoint = blockNumber === finalized ? common : await providers[0]('eth_getBlockByNumber', [tag, false]);
    if (endpoint?.number !== tag || !hash(endpoint.hash)) throw new Error('Invalid ordinary range endpoint');
    const batch = await checkOrdinaryTransferRange(pair, { ...next, maxBlocks, blockNumber, blockHash: endpoint.hash, reviewResales: true }, providers);
    if (next.supply !== batch.mintCoverage.before) throw new Error('Ordinary NFT supply differs from the retained checkpoint');
    const sales = [];
    for (const event of batch.events) {
        if (event.eventData.from !== ZeroAddress) continue;
        sales.push(await verifyPairReading(pair, { tokenId: event.eventData.tokenId, transactionHash: event.transactionHash,
            blockNumber: event.blockNumber, blockHash: event.blockHash }, providers, readOrdinarySettlement));
    }
    const resales = [];
    for (const purchase of batch.purchases) {
        resales.push(await verifyPairReading(pair, purchase, providers, readOrdinaryResalePurchase));
    }
    const persist = pool && !preview;
    if (persist) await commitOrdinaryHistory(pool, pair, origin, batch, sales, resales);
    if (preview) await readSnapshot(pool, client => checkOrdinaryHistoryContinuity(client, pair, origin, batch));
    return { status: persist ? 'committed' : 'verified', fromBlock: batch.fromBlock, throughBlock: batch.blockNumber,
        ...(preview && { previousBlockHash: next.previousBlockHash }),
        blockHash: batch.blockHash, finalized, transfers: batch.events.length, primarySales: sales.length, resales: resales.length,
        supply: batch.mintCoverage.after };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    let pool;
    try {
        const [file, start, predecessor, mode = '--read-only', ...extra] = process.argv.slice(2);
        if (!file || !/^[1-9]\d*$/.test(start) || !hash(predecessor) || !['--read-only','--preview-next','--once','--follow'].includes(mode) || extra.length) {
            throw new InputError('Usage: node scripts/sync-ordinary-history.mjs PAIR FIRST_BLOCK PREDECESSOR_HASH [--read-only|--preview-next|--once|--follow]');
        }
        const pair = await readReviewedOrdinaryPair(file);
        const urls = [process.env.ARTSOUL_ORDINARY_RPC_URL, process.env.ARTSOUL_ORDINARY_RPC_CHECK_URL];
        if (!urls.every(Boolean)) throw new InputError('Configure both independent ordinary RPC endpoints.');
        const providers = urls.map(sequencedRead);
        const origin = { fromBlock: Number(start), previousBlockHash: predecessor.toLowerCase() };
        const maxBlocks = Number(process.env.ARTSOUL_ORDINARY_RANGE_BLOCKS ?? 1000);
        if (mode !== '--read-only') {
            const connectionString = process.env.ARTSOUL_ORDINARY_DATABASE_URL;
            if (!connectionString) throw new InputError('Set ARTSOUL_ORDINARY_DATABASE_URL for the selected private store.');
            pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 10000, statement_timeout: 30000 });
        }
        let retryMs = 5000;
        for (;;) {
            try {
                const result = await syncOrdinaryHistory({ pool, preview: mode === '--preview-next', pair, origin, providers, maxBlocks });
                console.log(JSON.stringify(result));
                if (mode !== '--follow') break;
                retryMs = 5000;
                await delay(result.status !== 'committed' || result.throughBlock === result.finalized ? 60000 : 1000);
            } catch (error) {
                const retryable = error.name === 'TimeoutError' || error.message === 'fetch failed' ||
                    /^RPC HTTP failure on eth_/.test(error.message) || error.message === 'Ordinary NFT history checkpoint changed' ||
                    ['40001','40P01','ECONNRESET','ECONNREFUSED','ETIMEDOUT'].includes(error.code);
                if (mode !== '--follow' || !retryable) throw error;
                console.error('Ordinary history temporarily unavailable. Retrying from the last committed range.');
                await delay(retryMs);
                retryMs = Math.min(retryMs * 2, 60000);
            }
        }
    } catch (error) {
        console.error(error instanceof InputError ? error.message :
            'Ordinary history stopped. Check the reviewed origin, finalized receipts, independent RPCs and private database before restarting.');
        process.exitCode = 1;
    } finally {
        await pool?.end();
    }
}
