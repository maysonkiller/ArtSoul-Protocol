import { readOrdinaryResalePurchase } from '../src/indexer/nft-deployment-proof.js';
import { InputError, readReviewedOrdinaryPair, verifyPairReading } from './read-reviewed-ordinary-pair.mjs';
import { readRpc } from './verify-treasury-safes.mjs';

try {
    const [file, height, blockHash, transactionHash, index, ...extra] = process.argv.slice(2);
    if (!file || !/^[1-9]\d*$/.test(height) || !/^[1-9]\d*$/.test(index) || !blockHash || !transactionHash || extra.length) {
        throw new InputError('Usage: node scripts/read-ordinary-resale.mjs reviewed-pair.json BLOCK_NUMBER BLOCK_HASH TX_HASH PURCHASE_LOG_INDEX');
    }
    const urls = [process.env.ARTSOUL_ORDINARY_RPC_URL, process.env.ARTSOUL_ORDINARY_RPC_CHECK_URL];
    if (!urls.every(Boolean)) throw new InputError('Configure the two independent ordinary RPC endpoints.');
    const pair = await readReviewedOrdinaryPair(file);
    const location = { blockNumber: Number(height), blockHash, transactionHash, logIndex: Number(index) };
    console.log(JSON.stringify(await verifyPairReading(pair, location, urls.map(readRpc), readOrdinaryResalePurchase)));
} catch (error) {
    console.error(error instanceof InputError ? error.message : 'Could not verify the finalized ordinary resale. Check the purchase log position, reviewed pair and both RPC endpoints.');
    process.exitCode = 1;
}
