import { pathToFileURL } from 'node:url';
import { readOrdinaryTransferRange } from '../src/indexer/nft-deployment-proof.js';
import { InputError, readReviewedOrdinaryPair, verifyPairReading } from './read-reviewed-ordinary-pair.mjs';
import { readRpc } from './verify-treasury-safes.mjs';

export async function checkOrdinaryTransferRange(pair, range, providers) {
    return verifyPairReading(pair, range, providers, readOrdinaryTransferRange);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const [file, mode, from, previousBlockHash, to, blockHash, ...extra] = process.argv.slice(2);
        if (!file || !['bootstrap','continuation'].includes(mode) || ![from,to].every(height => /^[1-9]\d*$/.test(height)) ||
            !previousBlockHash || !blockHash || extra.length) {
            throw new InputError('Usage: node scripts/read-ordinary-transfer-range.mjs reviewed-pair.json bootstrap|continuation FROM PREDECESSOR_HASH TO END_HASH');
        }
        const urls = [process.env.ARTSOUL_ORDINARY_RPC_URL, process.env.ARTSOUL_ORDINARY_RPC_CHECK_URL];
        if (!urls.every(Boolean)) throw new InputError('Set ARTSOUL_ORDINARY_RPC_URL and ARTSOUL_ORDINARY_RPC_CHECK_URL to independent HTTPS endpoints.');
        const pair = await readReviewedOrdinaryPair(file);
        const range = { fromBlock: Number(from), previousBlockHash, blockNumber: Number(to), blockHash, bootstrap: mode === 'bootstrap' };
        const report = await checkOrdinaryTransferRange(pair, range, urls.map(readRpc));
        console.log(JSON.stringify(report));
    } catch (error) {
        console.error(error instanceof InputError ? error.message : 'Could not verify the finalized transfer range. Check the reviewed pair, block hashes, origin supply and both RPC endpoints.');
        process.exitCode = 1;
    }
}
