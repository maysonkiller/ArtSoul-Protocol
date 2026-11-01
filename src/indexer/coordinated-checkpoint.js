import { captureWriteContext, requireWriteAuthority, withWriteContext } from './write-fence.js';
import { prepareCoordinatedNftTransferRange, commitPreparedNftTransferRange } from './nft-transfer-sync.js';
import { readNftTransferProgress } from './nft-transfer-checkpoint.js';
import { claimEventProcessingLease, completeEventProcessingLease,
    recordEventProcessingFailure, EventProcessingLeaseUnavailableError } from './event-processing-lease.js';

const validHash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value) && !/^0x0{64}$/i.test(value);
const queryRows = client => ({ query: async (sql, values) => (await client.query(sql, values)).rows });

// Only used after historical NFT coverage reaches the existing Core boundary.
// RPC preparation is outside locks; projections, leases, notifications, headers,
// NFT journal and both cursors become visible in one fenced transaction.
export async function syncCoordinatedCheckpoint(engine, config, toBlock, currentBlock) {
    config = Object.freeze({ ...config });
    const context = await captureWriteContext(engine);
    const listener = engine.eventListener, database = engine.db;
    const donationAddress = listener.donationAddress;
    const fromBlock = context.lastIndexedBlock + 1;
    if (config.chainId !== 84532 || config.coreAddress.toLowerCase() !== context.contractAddress.toLowerCase() ||
        !Number.isSafeInteger(config.maxBlocks) || config.maxBlocks < 1 || config.maxBlocks > 100000 ||
        !Number.isSafeInteger(toBlock) || toBlock < fromBlock || toBlock - fromBlock >= config.maxBlocks ||
        !Number.isSafeInteger(currentBlock) || currentBlock < toBlock || context.recoveryCacheToken !== null) {
        throw new Error('Invalid coordinated checkpoint range');
    }
    const progress = await readNftTransferProgress(engine, config, {
        chain_id: context.chainId, contract_address: context.contractAddress,
        last_indexed_block: context.lastIndexedBlock, recovery_cache_token: context.recoveryCacheToken, revision: context.revision
    });
    if (!progress.ready) throw new Error('Coordinated checkpoint requires complete reviewed history');
    const stillCurrent = () => {
        requireWriteAuthority(context.authority);
        if (engine.db !== database || engine.eventListener !== listener ||
            String(engine.chainId) !== context.chainId || String(listener.chainId) !== context.chainId ||
            listener.donationAddress !== donationAddress || listener.contractAddress?.toLowerCase() !== config.coreAddress.toLowerCase()) {
            throw new Error('Coordinated checkpoint deployment changed');
        }
    };
    const header = async number => {
        stillCurrent();
        const block = await listener.getBlock(number);
        if (!block || Number(block.number) !== number || !validHash(block.hash) || !validHash(block.parentHash) ||
            !Number.isSafeInteger(Number(block.timestamp) * 1000) || Number(block.timestamp) < 0) {
            throw new Error('Invalid coordinated checkpoint header');
        }
        stillCurrent();
        return Object.freeze({ number, hash: block.hash.toLowerCase(), parentHash: block.parentHash.toLowerCase(), timestamp: Number(block.timestamp) });
    };
    const endpoint = await header(toBlock), predecessor = await header(fromBlock - 1);
    const supplied = await listener.queryAllHistoricalEvents(fromBlock, toBlock, { strict: true });
    if (!Array.isArray(supplied) || supplied.length > 1000) throw new Error('Coordinated event range exceeds its bound');
    const seen = new Set(), positions = new Set();
    const events = supplied.map(event => {
        if (!event || event.removed !== false || !Number.isSafeInteger(event.blockNumber) ||
            event.blockNumber < fromBlock || event.blockNumber > toBlock ||
            !Number.isSafeInteger(event.logIndex) || event.logIndex < 0 ||
            !Number.isSafeInteger(event.transactionIndex) || event.transactionIndex < 0 ||
            !validHash(event.transactionHash) || !validHash(event.blockHash) ||
            !event.eventData || typeof event.eventData !== 'object') throw new Error('Invalid coordinated event');
        const expectedSource = event.eventName === 'Donation' ? listener.donationAddress : config.coreAddress;
        if (!expectedSource || event.contractAddress?.toLowerCase() !== expectedSource.toLowerCase()) {
            throw new Error('Coordinated event has a different source');
        }
        const key = `${event.transactionHash.toLowerCase()}:${event.logIndex}`, position = `${event.blockNumber}:${event.logIndex}`;
        if (seen.has(key) || positions.has(position)) throw new Error('Duplicate coordinated event');
        seen.add(key); positions.add(position);
        return { ...event, contractAddress: event.contractAddress.toLowerCase(),
            transactionHash: event.transactionHash.toLowerCase(), blockHash: event.blockHash.toLowerCase(),
            eventData: Object.freeze(JSON.parse(engine._serializeEventData(event.eventData))) };
    }).sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
    const headers = new Map([[toBlock, endpoint]]);
    for (const number of new Set(events.map(event => event.blockNumber))) {
        if (!headers.has(number)) headers.set(number, await header(number));
    }
    for (const event of events) {
        const block = headers.get(event.blockNumber);
        if (event.blockHash !== block.hash) throw new Error('Coordinated event belongs to a different fork');
        event.timestamp = block.timestamp * 1000;
        Object.freeze(event);
    }
    const prepared = await prepareCoordinatedNftTransferRange(engine, { ...config, fromBlock,
        previousBlockHash: predecessor.hash, blockNumber: toBlock, blockHash: endpoint.hash, bootstrap: false }, context);
    const transactions = new Map(), transactionPositions = new Map(), logPositions = new Set();
    const combined = [...events, ...prepared.batch.events].sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
    for (let index = 0; index < combined.length; index++) {
        const event = combined[index], position = `${event.blockNumber}:${event.transactionIndex}`;
        const logPosition = `${event.blockNumber}:${event.logIndex}`, previous = combined[index - 1];
        if (logPositions.has(logPosition) ||
            (transactions.has(event.transactionHash) && transactions.get(event.transactionHash) !== position) ||
            (transactionPositions.has(position) && transactionPositions.get(position) !== event.transactionHash) ||
            (previous?.blockNumber === event.blockNumber && previous.transactionIndex > event.transactionIndex)) {
            throw new Error('Conflicting coordinated transaction positions');
        }
        logPositions.add(logPosition); transactions.set(event.transactionHash, position);
        transactionPositions.set(position, event.transactionHash);
    }
    // No current-block query, provider callback or other network work occurs in
    // the transaction. Hashes used by the legacy registry stay byte-identical.
    const claims = [];
    for (const event of events) claims.push(Object.freeze({ eventHash: await engine._computeEventHash(event),
        chainId: context.chainId, transactionHash: event.transactionHash, logIndex: event.logIndex,
        eventName: event.eventName, blockNumber: event.blockNumber,
        workerId: process.env.WORKER_ID || `worker-${process.pid}`, correlationId: `${event.transactionHash}-${event.logIndex}` }));
    stillCurrent();
    let failingClaim = null;
    const completed = [];
    try {
        await withWriteContext(database, context, async (client, state) => {
            stillCurrent();
            if (toBlock > currentBlock - Number(state.confirmation_depth)) throw new Error('Coordinated checkpoint is not confirmed');
            const startedAt = Date.now();
            const extra = await client.query(`SELECT 1 FROM public.contract_events e
                WHERE e.chain_id=$1 AND e.block_number BETWEEN $2 AND $3
                  AND (e.contract_address IS NULL OR e.contract_address=ANY($4::text[]))
                  AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset($5::jsonb)
                    AS r(transaction_hash text,log_index integer)
                    WHERE r.transaction_hash=e.transaction_hash AND r.log_index=e.log_index) LIMIT 1`,
            [context.chainId, fromBlock, toBlock, [config.coreAddress.toLowerCase(), listener.donationAddress?.toLowerCase()].filter(Boolean),
                JSON.stringify(events.map(event => ({ transaction_hash: event.transactionHash, log_index: event.logIndex })))]);
            if (extra.rows.length) throw new Error('Coordinated journal contains unverified range events');
            for (const block of headers.values()) {
                await client.query(`INSERT INTO public.block_hashes (chain_id,block_number,block_hash,parent_hash,timestamp)
                    VALUES ($1,$2,$3,$4,$5) ON CONFLICT (chain_id,block_number) DO NOTHING`,
                [context.chainId, block.number, block.hash, block.parentHash, block.timestamp]);
                const rows = (await client.query(`SELECT block_hash,parent_hash,timestamp FROM public.block_hashes
                    WHERE chain_id=$1 AND block_number=$2 FOR SHARE`, [context.chainId, block.number])).rows;
                if (rows.length !== 1 || rows[0].block_hash !== block.hash || rows[0].parent_hash !== block.parentHash ||
                    Number(rows[0].timestamp) !== block.timestamp) throw new Error('Coordinated header conflicts with retained history');
            }
            for (let index = 0; index < events.length; index++) {
                stillCurrent();
                if (Date.now() - startedAt > 30000) throw new Error('Coordinated transaction time bound exceeded');
                const event = events[index], claim = claims[index]; failingClaim = claim;
                const lease = await claimEventProcessingLease(queryRows(client), claim);
                if (!lease.acquired && lease.status !== 'completed') throw new EventProcessingLeaseUnavailableError(claim.eventHash, lease.status);
                const journal = (await client.query(`SELECT event_name,artwork_id,block_number,contract_address,event_data
                    FROM public.contract_events WHERE chain_id=$1 AND transaction_hash=$2 AND log_index=$3`,
                [context.chainId, event.transactionHash, event.logIndex])).rows;
                if (journal.length > 1 || (journal.length === 0 && !lease.acquired)) throw new Error('Completed event is missing its journal');
                if (journal.length) {
                    const row = journal[0];
                    // jsonb equality avoids depending on object-key order.
                    const equal = (await client.query('SELECT $1::jsonb = $2::jsonb AS equal',
                        [JSON.stringify(row.event_data), JSON.stringify(event.eventData)])).rows[0]?.equal === true;
                    if (!equal || row.event_name !== event.eventName || row.contract_address !== event.contractAddress ||
                        Number(row.block_number) !== event.blockNumber ||
                        String(row.artwork_id ?? '') !== String(engine._getEventArtworkId(event) ?? '')) {
                        throw new Error('Coordinated journal conflicts with verified event');
                    }
                    // A journal row cannot prove whether non-idempotent projections
                    // already ran. Recovery must reconcile the missing completion;
                    // replaying here could count settlement twice or restore an old bid.
                    if (lease.acquired) throw new Error('Retained event is missing its completed processing record');
                }
                if (lease.acquired) {
                    await engine._applyEventProjectionTx(event, client);
                    await completeEventProcessingLease(client, lease);
                    completed.push({ event, claim });
                }
                failingClaim = null;
            }
            await commitPreparedNftTransferRange(client, prepared, { coreRangeEmpty: events.length === 0 });
            const digest = await engine._computeStateHash(toBlock, client);
            await client.query(`UPDATE public.indexer_state SET last_indexed_block=$1,last_confirmed_block=$1,
                state_hash=$2,last_indexed_at=NOW(),total_events_indexed=total_events_indexed+$3 WHERE chain_id=$4`,
            [toBlock, digest, completed.length, context.chainId]);
            if (Date.now() - startedAt > 30000) throw new Error('Coordinated transaction time bound exceeded');
            stillCurrent();
        });
    } catch (error) {
        // The range rolled back, including its lease claims. Persist only the
        // failing event's retry record, never a partial projection or completion.
        if (failingClaim && error.code !== 'INDEXER_WRITE_FENCE_LOST') {
            try {
                await withWriteContext(database, context, async client => {
                    const lease = await claimEventProcessingLease(queryRows(client), failingClaim);
                    if (lease.acquired) await recordEventProcessingFailure(queryRows(client), lease,
                        { status: lease.retryCount >= 5 ? 'dead' : 'failed', error });
                });
            } catch { /* Preserve the original failure; stale writers cannot record it. */ }
        }
        throw error;
    }
    try {
        // Make the verified boundary readable before optional enrichment. A
        // slow AI queue must not keep an already committed owner unavailable.
        await engine._purgeRecoveryCache(context.authority);
    } finally {
        for (const { event, claim } of completed) {
            // A delivery failure cannot undo a committed checkpoint or repeat
            // its projections. Lifecycle notifications are in the durable outbox.
            try { await engine._afterEventCommit(event, claim.workerId, claim.correlationId); }
            catch { console.warn('[IndexerSyncEngine] Post-commit enrichment failed'); }
            engine.metrics?.recordEventProcessed(event.eventName, true);
        }
    }
    return Object.freeze({ fromBlock, throughBlock: toBlock, processedCount: completed.length });
}
