import { readNftTransferRange } from './nft-deployment-proof.js';
import { captureWriteContext, withWriteContext } from './write-fence.js';

const coverageColumns = ['chain_id','core_address','nft_address','from_block','origin_block_hash',
    'covered_through','covered_hash','core_code_hash','nft_code_hash'];
const sameCoverage = (a, b) => a === null || b === null ? a === b :
    coverageColumns.every(key => String(a[key]) === String(b[key]));
const scopeSql = 'chain_id=$1 AND core_address=$2 AND nft_address=$3';

// Dormant until a reviewed runner supplies a verified historical origin.
// A whole range, its journal facts and its coverage commit together. This never
// advances the Core cursor or runs mint, sale, metric, AI or notification handlers.
export async function syncNftTransferRange(engine, options) {
    const input = Object.freeze({ ...options });
    const listener = engine.eventListener, database = engine.db;
    const context = await captureWriteContext(engine);
    if (input.chainId !== 84532 || String(input.chainId) !== context.chainId ||
        typeof input.coreAddress !== 'string' || input.coreAddress.toLowerCase() !== context.contractAddress.toLowerCase() ||
        typeof input.nftAddress !== 'string' || !Number.isSafeInteger(input.blockNumber) ||
        input.blockNumber > context.lastIndexedBlock) throw new Error('NFT range exceeds its Core deployment checkpoint');
    const scope = [context.chainId, input.coreAddress.toLowerCase(), input.nftAddress.toLowerCase()];
    const previousRows = await database.query(`SELECT ${coverageColumns.join(',')} FROM public.nft_transfer_coverage
        WHERE ${scopeSql}`, scope);
    const previous = previousRows.length === 1 ? Object.freeze({ ...previousRows[0] }) : null;
    if (previousRows.length > 1 || typeof input.bootstrap !== 'boolean' ||
        (input.bootstrap ? previous !== null : previous === null)) throw new Error('NFT coverage bootstrap state changed');
    if (previous && (Number(previous.covered_through) + 1 !== input.fromBlock ||
        previous.covered_hash !== input.previousBlockHash?.toLowerCase() ||
        previous.core_code_hash !== input.expectedCoreCodeHash?.toLowerCase() ||
        previous.nft_code_hash !== input.expectedNftCodeHash?.toLowerCase())) {
        throw new Error('NFT range is not contiguous with its deployment coverage');
    }
    const isCurrent = () => context.authority.isCurrent() === true &&
        engine.eventListener === listener && engine.db === database &&
        String(engine.chainId) === context.chainId && listener.chainId === input.chainId &&
        listener.contractAddress?.toLowerCase() === scope[1] &&
        (!listener.nftAddress || listener.nftAddress.toLowerCase() === scope[2]);
    const batch = await readNftTransferRange(listener, { ...input, isCurrent });
    const records = batch.events.map(event => ({ event_name: 'Transfer',
        contract_address: event.contractAddress, block_number: event.blockNumber,
        transaction_hash: event.transactionHash, log_index: event.logIndex,
        event_data: { ...event.eventData, blockHash: event.blockHash, transactionIndex: event.transactionIndex },
        indexed_at: new Date(event.timestamp).toISOString() }));
    const payload = JSON.stringify(records);
    // An empty final range can make previously partial history available for
    // the first time. It needs a purge even though no owner moved in that range.
    const invalidate = input.bootstrap || records.length > 0 || batch.blockNumber === context.lastIndexedBlock;
    return withWriteContext(database, context, async client => {
        if (!isCurrent() || listener.contractAddress?.toLowerCase() !== scope[1] ||
            (listener.nftAddress && listener.nftAddress.toLowerCase() !== scope[2])) {
            throw new Error('NFT range authority changed before commit');
        }
        const current = (await client.query(`SELECT ${coverageColumns.join(',')} FROM public.nft_transfer_coverage
            WHERE ${scopeSql} FOR UPDATE`, scope)).rows;
        if (current.length > 1 || !sameCoverage(previous, current[0] || null)) {
            throw new Error('NFT coverage changed after range read');
        }
        // Retained facts may be replayed after coverage invalidation, but their
        // source, identity, payload and chain timestamp must match exactly.
        await client.query(`INSERT INTO public.contract_events
            (chain_id,event_name,contract_address,block_number,transaction_hash,log_index,event_data,indexed_at)
            SELECT $1,event_name,contract_address,block_number,transaction_hash,log_index,event_data,indexed_at
            FROM jsonb_to_recordset($2::jsonb) AS r(event_name text,contract_address text,block_number bigint,
                transaction_hash text,log_index integer,event_data jsonb,indexed_at timestamptz)
            ON CONFLICT (chain_id,transaction_hash,log_index) DO NOTHING`, [context.chainId, payload]);
        const conflicts = await client.query(`SELECT 1 FROM jsonb_to_recordset($2::jsonb)
            AS r(event_name text,contract_address text,block_number bigint,transaction_hash text,
                log_index integer,event_data jsonb,indexed_at timestamptz)
            LEFT JOIN public.contract_events e ON e.chain_id=$1 AND e.transaction_hash=r.transaction_hash AND e.log_index=r.log_index
            WHERE e.id IS NULL OR e.event_name IS DISTINCT FROM r.event_name
                OR e.contract_address IS DISTINCT FROM r.contract_address OR e.artwork_id IS NOT NULL
                OR e.block_number IS DISTINCT FROM r.block_number OR e.event_data IS DISTINCT FROM r.event_data
                OR e.indexed_at IS DISTINCT FROM r.indexed_at LIMIT 1`, [context.chainId, payload]);
        if (conflicts.rows.length) throw new Error('NFT journal conflicts with verified range');
        const extra = await client.query(`SELECT 1 FROM public.contract_events e
            WHERE e.chain_id=$1 AND e.contract_address=$2 AND e.event_name='Transfer'
                AND e.block_number BETWEEN $3 AND $4 AND NOT EXISTS (
                    SELECT 1 FROM jsonb_to_recordset($5::jsonb) AS r(transaction_hash text,log_index integer)
                    WHERE r.transaction_hash=e.transaction_hash AND r.log_index=e.log_index) LIMIT 1`,
        [context.chainId, batch.nftAddress, batch.fromBlock, batch.blockNumber, payload]);
        if (extra.rows.length) throw new Error('NFT journal contains unverified range events');
        // Reuse the existing durable purge obligation. It is conservative and
        // must be acknowledged by the existing cache recovery path before the
        // next configured-cache write. Even empty ranges change xmin so older
        // buffered writers cannot commit against a superseded state snapshot.
        await client.query(`UPDATE public.indexer_state SET last_indexed_block=last_indexed_block${
            invalidate ? ',recovery_cache_token=gen_random_uuid()' : ''} WHERE chain_id=$1`, [context.chainId]);
        const values = [context.chainId, batch.coreAddress, batch.nftAddress,
            previous?.from_block ?? batch.fromBlock, previous?.origin_block_hash ?? batch.previousBlockHash,
            batch.blockNumber, batch.blockHash, batch.coreCodeHash, batch.nftCodeHash];
        if (invalidate) {
            // The token-rotation trigger removed stale coverage in this same
            // transaction. Preserve the validated origin when continuing it.
            await client.query(`INSERT INTO public.nft_transfer_coverage (${coverageColumns.join(',')})
                VALUES (${values.map((_, index) => `$${index+1}`).join(',')})`, values);
        } else {
            const updated = await client.query(`UPDATE public.nft_transfer_coverage SET covered_through=$4,covered_hash=$5
                WHERE ${scopeSql}`, [...scope, batch.blockNumber, batch.blockHash]);
            if (updated.rowCount !== 1) throw new Error('NFT coverage disappeared before commit');
        }
        if (!isCurrent()) throw new Error('NFT range authority changed during commit');
        return Object.freeze({ chainId: batch.chainId, nftAddress: batch.nftAddress,
            fromBlock: batch.fromBlock, throughBlock: batch.blockNumber,
            eventCount: records.length, cacheInvalidationPending: invalidate || context.recoveryCacheToken != null });
    });
}
