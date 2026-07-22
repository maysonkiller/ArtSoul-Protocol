import { enqueueAIJob } from '../queue.js';
import cacheService from '../services/cache-service.js';
import {
    V41_EVENT_REQUIRED_FIELDS,
    V41_GLOBAL_STATS_EVENTS,
    canonicalArtworkId
} from './v4-1-event-schema.js';

// Structured failure raised when a historical range could not be fully
// processed. The caller must NOT advance any cursor for that range; the next
// poll re-queries the identical range and skips already-completed events
// through the event_processing_registry idempotency check.
export class IndexerRangeProcessingError extends Error {
    constructor({ fromBlock, toBlock, chainId, processedCount, failedCount, failures }) {
        super(
            `Indexer range ${fromBlock}-${toBlock} on chain ${chainId} had ${failedCount} ` +
            `unprocessed event(s); cursor not advanced`
        );
        this.name = 'IndexerRangeProcessingError';
        this.code = 'INDEXER_RANGE_INCOMPLETE';
        this.chainId = chainId;
        this.fromBlock = fromBlock;
        this.toBlock = toBlock;
        this.processedCount = processedCount;
        this.failedCount = failedCount;
        this.failures = failures;
    }
}

class IndexerSyncEngine {
    constructor(database, eventListener, metrics = null) {
        this.db = database;
        this.eventListener = eventListener;
        this.metrics = metrics;
        this.chainId = Number(eventListener?.chainId || process.env.ARTSOUL_INDEXER_CHAIN_ID || process.env.CHAIN_ID || 0);
        this.isRunning = false;

        console.log('[IndexerSyncEngine] Initialized');
    }

    /**
     * Helper: Convert event timestamp to milliseconds for PostgreSQL
     * PostgreSQL to_timestamp() expects seconds, so we pass milliseconds
     * and divide by 1000 in the SQL query
     */
    _getEventTimestamp(event) {
        return event.timestamp || Date.now();
    }

    /**
     * Helper: Safely serialize event data to JSON
     * Converts BigInt to string to avoid serialization errors
     */
    _serializeEventData(eventData) {
        return JSON.stringify(eventData, (key, value) =>
            typeof value === 'bigint' ? value.toString() : value
        );
    }

    _asString(value) {
        if (value === undefined || value === null) {
            return null;
        }
        return value.toString();
    }

    _asNumber(value) {
        if (value === undefined || value === null) {
            return null;
        }
        return Number(value);
    }

    _chainId() {
        return this.chainId;
    }

    _chainIdString() {
        return this.chainId.toString();
    }

    _eventTimestampSqlValue(event) {
        return this._getEventTimestamp(event);
    }

    _isZeroAddress(address) {
        return !address || address.toLowerCase() === '0x0000000000000000000000000000000000000000';
    }

    _getEventArtworkId(event) {
        return canonicalArtworkId(event.eventName, event.eventData);
    }

    /**
     * Compute deterministic state hash for a given block number.
     * Hashes the sequence of block hashes up to the specified block.
     */
    async _computeStateHash(blockNumber) {
        const blocks = await this.db.query(
            `SELECT block_hash FROM block_hashes
             WHERE chain_id = $1 AND block_number <= $2
             ORDER BY block_number ASC`,
            [this._chainIdString(), blockNumber]
        );

        const hashString = blocks.map(b => b.block_hash).join(',');

        const result = await this.db.query(
            `SELECT encode(digest($1, 'sha256'), 'hex') as hash`,
            [hashString]
        );

        return '0x' + result[0].hash;
    }

    async initialize(contractAddress, chainId, startBlock) {
        this.chainId = Number(chainId);

        if (!contractAddress || contractAddress === '0x0000000000000000000000000000000000000000') {
            throw new Error('[IndexerSyncEngine] Invalid contract address - cannot initialize with zero address');
        }

        if (!chainId || chainId === 0) {
            throw new Error('[IndexerSyncEngine] Invalid chainId - cannot initialize with zero or null');
        }

        const existing = await this.db.query(
            'SELECT * FROM indexer_state WHERE chain_id = $1',
            [this._chainIdString()]
        );

        if (existing.length === 0) {
            await this.db.query(
                `INSERT INTO indexer_state (
                    contract_address, chain_id, last_indexed_block,
                    last_confirmed_block, confirmation_depth,
                    last_indexed_at, started_at, status, state_hash
                ) VALUES ($1, $2, $3, $3, 12, NOW(), NOW(), 'initialized', $4)`,
                [contractAddress, chainId, startBlock, '0x0']
            );

            console.log(`[IndexerSyncEngine] Initialized at block ${startBlock}`);
            console.log(`  Contract: ${contractAddress}`);
            console.log(`  Chain ID: ${chainId}`);
        } else {
            console.log(`[IndexerSyncEngine] Already initialized at block ${existing[0].last_indexed_block}`);
            console.log(`  Contract: ${existing[0].contract_address}`);
            console.log(`  Chain ID: ${existing[0].chain_id}`);
        }
    }

    async start() {
        if (this.isRunning) {
            console.log('[IndexerSyncEngine] Already running');
            return;
        }

        // --- SELF-HEALING RECOVERY ENGINE ---
        const state = await this.getIndexerState();
        if (state && state.last_indexed_block > state.last_confirmed_block) {
            console.log(`[IndexerSyncEngine] Recovery detected: last_indexed (${state.last_indexed_block}) > last_confirmed (${state.last_confirmed_block})`);

            try {
                const { recoveryQueue } = await import('../queue.js');
                await recoveryQueue.add('system-recovery', { state });
                console.log('[IndexerSyncEngine] Recovery signal enqueued to recovery worker');
            } catch (error) {
                console.error(`[IndexerSyncEngine] Failed to enqueue recovery signal: ${error.message}`);
            }
        }

        this.isRunning = true;

        await this.db.query(
            `UPDATE indexer_state SET status = 'running', last_indexed_at = NOW() WHERE chain_id = $1`,
            [this._chainIdString()]
        );

        console.log('[IndexerSyncEngine] Started (polling mode with transactions)');
    }

    async recoverFromSafeBlock(state) {
        console.log(`[IndexerSyncEngine] Executing self-healing recovery from block ${state.last_confirmed_block}`);

        const safeBlock = state.last_confirmed_block;

        // 1. Rollback any unconfirmed data
        await this.db.query(`SELECT rollback_events_from_block($1, $2)`, [safeBlock + 1, this._chainIdString()]);
        await this.db.query(
            `DELETE FROM block_hashes WHERE chain_id = $1 AND block_number > $2`,
            [this._chainIdString(), safeBlock]
        );

        // --- CACHE PURGE ---
        // During recovery, we cannot trust any cached state
        const cacheService = (await import('../services/cache-service.js')).default;
        await cacheService.purge();
        // -------------------

        // 2. Reset state to safe block
        await this.db.query(
            `UPDATE indexer_state
             SET last_indexed_block = $1,
                 last_indexed_at = NOW()
             WHERE chain_id = $2`,
            [safeBlock, this._chainIdString()]
        );

        // 3. Reprocess missing blocks in batch
        const currentBlock = await this.eventListener.getCurrentBlock();
        if (currentBlock > safeBlock) {
            console.log(`[IndexerSyncEngine] Reprocessing blocks ${safeBlock + 1} to ${currentBlock}`);
            await this.syncHistoricalEvents(safeBlock + 1, currentBlock);
        }

        console.log(`[IndexerSyncEngine] Self-healing recovery complete.`);
    }

    async stop() {
        if (!this.isRunning) {
            console.log('[IndexerSyncEngine] Not running');
            return;
        }

        await this.eventListener.stopListening();
        this.isRunning = false;

        await this.db.query(
            `UPDATE indexer_state SET status = 'stopped', last_indexed_at = NOW() WHERE chain_id = $1`,
            [this._chainIdString()]
        );

        console.log('[IndexerSyncEngine] Stopped');
    }

    async syncHistoricalEvents(fromBlock, toBlock, options = {}) {
        console.log(`[IndexerSyncEngine] Syncing historical events from ${fromBlock} to ${toBlock}`);

        const events = await this.eventListener.queryAllHistoricalEvents(fromBlock, toBlock);

        // Store block hashes for reorg detection. Free RPC historical catch-up can
        // skip empty-range backfill and keep hashes only for blocks with events;
        // this reduces reorg protection for empty historical ranges only.
        if (this._shouldSkipEmptyBlockHashBackfill()) {
            const eventBlockNumbers = [...new Set(
                events
                    .map(event => Number(event.blockNumber))
                    .filter(Number.isSafeInteger)
            )].sort((a, b) => a - b);

            console.warn(
                `[IndexerSyncEngine] Skipping empty block hash backfill for historical catch-up ` +
                `${fromBlock}-${toBlock}; storing ${eventBlockNumbers.length} event block hashes only.`
            );

            await this._storeBlockHashesForBlocks(eventBlockNumbers);
        } else {
            await this._storeBlockHashes(fromBlock, toBlock);
        }

        // Record blocks processed
        if (this.metrics) {
            const blocksProcessed = toBlock - fromBlock + 1;
            for (let i = 0; i < blocksProcessed; i++) {
                this.metrics.recordBlockProcessed(true);
            }
        }

        // Batch processing with adaptive concurrency based on DB backpressure
        const BATCH_SIZE = 50;
        let CONCURRENCY = 5;

        // Check DB backpressure and adjust concurrency
        if (this.db.isBackpressure()) {
            CONCURRENCY = 2;
            console.warn('[IndexerSyncEngine] DB backpressure detected, reducing concurrency to 2');
        }

        // Update metrics
        if (this.metrics) {
            this.metrics.updateConcurrency(CONCURRENCY);
            this.metrics.updateBackpressure(this.db.isBackpressure());
        }

        let processedCount = 0;
        let failedCount = 0;
        const failures = [];

        // Process in batches
        for (let i = 0; i < events.length; i += BATCH_SIZE) {
            const batch = events.slice(i, i + BATCH_SIZE);

            // Recheck backpressure between batches
            if (this.db.isBackpressure() && CONCURRENCY > 2) {
                CONCURRENCY = 2;
                console.warn('[IndexerSyncEngine] DB backpressure detected mid-sync, reducing concurrency to 2');
                if (this.metrics) {
                    this.metrics.updateConcurrency(CONCURRENCY);
                    this.metrics.updateBackpressure(true);
                }
            } else if (!this.db.isBackpressure() && CONCURRENCY < 5) {
                CONCURRENCY = 5;
                console.log('[IndexerSyncEngine] DB backpressure cleared, restoring concurrency to 5');
                if (this.metrics) {
                    this.metrics.updateConcurrency(CONCURRENCY);
                    this.metrics.updateBackpressure(false);
                }
            }

            // Process batch with concurrency limit
            const results = await this._processBatchWithLimit(batch, CONCURRENCY);

            processedCount += results.filter(r => r.success).length;
            for (const result of results) {
                if (result.success) continue;
                failedCount += 1;
                failures.push({
                    transactionHash: result.event?.transactionHash,
                    logIndex: result.event?.logIndex,
                    eventName: result.event?.eventName,
                    blockNumber: result.event?.blockNumber,
                    error: result.error?.message
                });
            }
        }

        // FAIL CLOSED. Every event in the range is processed first so that all
        // recoverable work lands and every failure is durably recorded in
        // event_processing_registry, but no cursor may move while any event in
        // the range is unprocessed. Throwing here — before last_indexed_block,
        // last_confirmed_block, state_hash and total_events_indexed are
        // touched — makes the next poll re-query the identical range instead
        // of silently skipping the failed event. Already-completed events in
        // that range are skipped idempotently by the registry claim check.
        if (failedCount > 0) {
            const rangeError = new IndexerRangeProcessingError({
                fromBlock,
                toBlock,
                chainId: this._chainIdString(),
                processedCount,
                failedCount,
                failures
            });

            console.error(JSON.stringify({
                phase: 'sync_historical_events',
                action: 'range_incomplete',
                code: rangeError.code,
                chain_id: rangeError.chainId,
                from_block: fromBlock,
                to_block: toBlock,
                processed_count: processedCount,
                failed_count: failedCount,
                cursor_advanced: false,
                failures
            }));

            throw rangeError;
        }

        // Update state with toBlock (not fromBlock + events.length)
        // This ensures we track the actual block range processed
        await this.db.query(
            `UPDATE indexer_state
             SET last_indexed_block = $1,
                 last_indexed_at = NOW(),
                 total_events_indexed = total_events_indexed + $2
             WHERE chain_id = $3`,
            [toBlock, processedCount, this._chainIdString()]
        );

        // Update confirmation state if depth is reached
        const currentBlock = Number.isFinite(Number(options.currentBlock))
            ? Number(options.currentBlock)
            : await this.eventListener.getCurrentBlock();
        const state = await this.getIndexerState();
        const safeBlock = currentBlock - state.confirmation_depth;

        if (toBlock <= safeBlock && toBlock > state.last_confirmed_block) {
            const newStateHash = await this._computeStateHash(toBlock);
            await this.db.query(
                `UPDATE indexer_state
                 SET last_confirmed_block = $1,
                     state_hash = $2
                 WHERE chain_id = $3`,
                [toBlock, newStateHash, this._chainIdString()]
            );
            console.log(`[IndexerSyncEngine] Block ${toBlock} confirmed as safe. State hash updated.`);
        }

        // Reaching this point means every event in the range completed.
        console.log(`[IndexerSyncEngine] Synced ${processedCount}/${events.length} historical events`);

        return processedCount;
    }

    async _storeBlockHashes(fromBlock, toBlock) {
        // Store ALL block hashes for reliable reorg detection
        // This is critical for data integrity
        const blocks = [];
        for (let block = fromBlock; block <= toBlock; block++) {
            blocks.push(block);
        }

        await this._storeBlockHashesForBlocks(blocks);
    }

    _shouldSkipEmptyBlockHashBackfill() {
        const value = String(process.env.ARTSOUL_SKIP_EMPTY_BLOCK_HASH_BACKFILL || '').trim().toLowerCase();
        return value === '1' || value === 'true' || value === 'yes';
    }

    async _storeBlockHashesForBlocks(blockNumbers) {
        const blocks = [...new Set(
            (blockNumbers || [])
                .map(blockNumber => Number(blockNumber))
                .filter(Number.isSafeInteger)
        )].sort((a, b) => a - b);

        if (blocks.length === 0) {
            return;
        }

        // Batch fetch blocks to reduce RPC calls
        const FETCH_BATCH_SIZE = 10;
        const INSERT_BATCH_SIZE = 50;

        let allBlockData = [];

        for (let i = 0; i < blocks.length; i += FETCH_BATCH_SIZE) {
            const batch = blocks.slice(i, i + FETCH_BATCH_SIZE);

            try {
                // Fetch blocks in parallel
                const blockPromises = batch.map(blockNumber =>
                    this.eventListener.getBlock(Number(blockNumber))
                        .catch(error => {
                            console.error(`[IndexerSyncEngine] Failed to fetch block ${blockNumber}:`, error.message);
                            return null;
                        })
                );

                const fetchedBlocks = await Promise.all(blockPromises);

                // Collect block data for batch insert
                for (let j = 0; j < fetchedBlocks.length; j++) {
                    const block = fetchedBlocks[j];
                    if (block) {
                        allBlockData.push([
                            this._chainIdString(),
                            batch[j],
                            block.hash,
                            block.parentHash,
                            block.timestamp
                        ]);
                    }
                }

                // Insert in batches when we have enough data
                if (allBlockData.length >= INSERT_BATCH_SIZE) {
                    const toInsert = allBlockData.splice(0, INSERT_BATCH_SIZE);
                    await this.db.batchInsert(
                        'block_hashes',
                        ['chain_id', 'block_number', 'block_hash', 'parent_hash', 'timestamp'],
                        toInsert,
                        '(chain_id, block_number) DO UPDATE SET block_hash = EXCLUDED.block_hash, parent_hash = EXCLUDED.parent_hash'
                    );
                }
            } catch (error) {
                console.error(`[IndexerSyncEngine] Failed to store block hash batch:`, error.message);
            }
        }

        // Insert remaining blocks
        if (allBlockData.length > 0) {
            try {
                await this.db.batchInsert(
                    'block_hashes',
                    ['chain_id', 'block_number', 'block_hash', 'parent_hash', 'timestamp'],
                    allBlockData,
                    '(chain_id, block_number) DO UPDATE SET block_hash = EXCLUDED.block_hash, parent_hash = EXCLUDED.parent_hash'
                );
            } catch (error) {
                console.error(`[IndexerSyncEngine] Failed to store remaining block hashes:`, error.message);
            }
        }
    }

    async detectReorg(options = {}) {
        const state = await this.getIndexerState();
        if (!state) return false;

        const configuredSampleSize = Number(options.sampleSize || process.env.INDEXER_REORG_SAMPLE_SIZE || 12);
        const sampleSize = Number.isSafeInteger(configuredSampleSize) && configuredSampleSize > 0
            ? configuredSampleSize
            : 12;

        // 1. Fast Path: State Hash Verification
        // Verify that the current chain's state hash at last_confirmed_block matches our record
        if (state.last_confirmed_block > 0) {
            const currentHash = await this._computeStateHash(state.last_confirmed_block);
            if (currentHash !== state.state_hash) {
                console.error(`[IndexerSyncEngine]  STATE HASH MISMATCH at block ${state.last_confirmed_block}`);
                console.error(`  Stored hash: ${state.state_hash}`);
                console.error(`  Current hash: ${currentHash}`);

                await this._handleReorg(state.last_confirmed_block);
                return true;
            }
        }

        // 2. Slow Path: sample the most recent stored hashes. A bounded sample
        // preserves reorg detection without re-reading hundreds of old blocks on
        // every poll.
        const storedBlocks = await this.db.query(
            `SELECT block_number, block_hash, parent_hash
             FROM (
                 SELECT block_number, block_hash, parent_hash
                 FROM block_hashes
                 WHERE chain_id = $1 AND block_number <= $2
                 ORDER BY block_number DESC
                 LIMIT $3
             ) recent_blocks
             ORDER BY block_number ASC`,
            [this._chainIdString(), state.last_indexed_block, sampleSize]
        );

        if (storedBlocks.length === 0) {
            return false;
        }

        // Check block hash mismatches
        for (const stored of storedBlocks) {
            try {
                const currentBlock = await this.eventListener.getBlock(Number(stored.block_number));

                if (currentBlock && currentBlock.hash !== stored.block_hash) {
                    console.error(`[IndexerSyncEngine]  REORG DETECTED at block ${stored.block_number}`);
                    console.error(`  Stored hash: ${stored.block_hash}`);
                    console.error(`  Current hash: ${currentBlock.hash}`);
                    console.error(`  Depth: ${state.last_indexed_block - stored.block_number} blocks`);

                    // Record reorg in metrics
                    if (this.metrics) {
                        const depth = state.last_indexed_block - stored.block_number;
                        this.metrics.recordReorg(depth);
                    }

                    await this._handleReorg(Number(stored.block_number));
                    return true;
                }
            } catch (error) {
                console.error(`[IndexerSyncEngine] Error checking block ${stored.block_number}:`, error.message);
            }
        }

        // Check parent chain continuity
        for (let i = 1; i < storedBlocks.length; i++) {
            const current = storedBlocks[i];
            const previous = storedBlocks[i - 1];

            // Check if current.parent_hash matches previous.block_hash
            if (Number(current.block_number) === Number(previous.block_number) + 1) {
                if (current.parent_hash !== previous.block_hash) {
                    console.error(`[IndexerSyncEngine]  PARENT CHAIN BREAK at block ${current.block_number}`);
                    console.error(`  Expected parent: ${previous.block_hash}`);
                    console.error(`  Actual parent: ${current.parent_hash}`);

                    // Record reorg in metrics
                    if (this.metrics) {
                        const depth = state.last_indexed_block - Number(current.block_number);
                        this.metrics.recordReorg(depth);
                    }

                    await this._handleReorg(Number(current.block_number));
                    return true;
                }
            }
        }

        return false;
    }

    async _handleReorg(reorgBlock) {
        console.log(`[IndexerSyncEngine] Handling reorg from block ${reorgBlock}`);

        // Rollback unconfirmed data
        const result = await this.db.query(
            `SELECT rollback_events_from_block($1, $2)`,
            [reorgBlock, this._chainIdString()]
        );

        console.log(`[IndexerSyncEngine] Rolled back events from block ${reorgBlock}`);
        console.log(`  Result:`, result[0]);

        // --- CACHE PURGE ---
        // Chain reorg means data we cached is now invalid
        const cacheService = (await import('../services/cache-service.js')).default;
        await cacheService.purge();
        // -------------------

        // Reset indexer state to reorg point
        await this.db.query(
            `UPDATE indexer_state
             SET last_indexed_block = $1,
                 last_confirmed_block = LEAST(last_confirmed_block, $1),
                 last_indexed_at = NOW()
             WHERE chain_id = $2`,
            [reorgBlock - 1, this._chainIdString()]
        );

        // Delete block hashes from reorg point
        await this.db.query(
            `DELETE FROM block_hashes WHERE chain_id = $1 AND block_number >= $2`,
            [this._chainIdString(), reorgBlock]
        );

        console.log(`[IndexerSyncEngine] Indexer state reset to block ${reorgBlock - 1}`);
    }

    async _processBatchWithLimit(events, concurrency) {
        const results = [];
        const executing = [];

        for (const event of events) {
            const promise = this._processEvent(event)
                .then(() => {
                    // Record successful event processing
                    if (this.metrics) {
                        this.metrics.recordEventProcessed(event.eventName, true);
                    }
                    return { success: true, event };
                })
                .catch(async (error) => {
                    console.error(`[IndexerSyncEngine] Failed to process event at block ${event.blockNumber}:`, error);

                    // Record failed event processing. The durable failure record
                    // itself is written by processEvent's rollback handler
                    // directly into event_processing_registry, which is the
                    // single source of truth for event-processing failures.
                    if (this.metrics) {
                        this.metrics.recordEventProcessed(event.eventName, false);
                    }

                    return { success: false, event, error };
                })
                .finally(() => {
                    // Remove from executing pool when done
                    const index = executing.indexOf(promise);
                    if (index > -1) {
                        executing.splice(index, 1);
                    }
                });

            results.push(promise);
            executing.push(promise);

            // Wait if we hit concurrency limit
            if (executing.length >= concurrency) {
                await Promise.race(executing);
            }
        }

        return await Promise.all(results);
    }

    async _processEvent(event) {
        return this.processEvent(event);
    }

    /**
     * Durably record an event-processing failure in event_processing_registry,
     * the single source of truth for event failures.
     *
     * Runs on a pool connection AFTER the processing transaction rolled back,
     * so it must UPSERT rather than UPDATE: on the first failure the claim row
     * was created inside that transaction and no longer exists.
     *
     * Identity is chain_id + transaction_hash + log_index (the chain-scoped
     * unique index from migration 013). The write is idempotent — replaying the
     * same failure yields the same row — and monotonic in retry_count, so a
     * concurrent worker can never lower it. A record that another worker has
     * already completed is never downgraded.
     */
    async _recordEventFailure({ event, eventHash, workerId, correlationId, retryCount, status, error }) {
        try {
            const rows = await this.db.query(
                `INSERT INTO event_processing_registry (
                    event_hash, chain_id, transaction_hash, log_index, event_name,
                    block_number, processing_status, processing_started_at,
                    processing_error, retry_count, owner_worker_id,
                    last_heartbeat_at, correlation_id
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9, $10, NOW(), $11)
                ON CONFLICT (chain_id, transaction_hash, log_index) DO UPDATE SET
                    event_hash = CASE
                        WHEN event_processing_registry.processing_status = 'completed'
                        THEN event_processing_registry.event_hash
                        ELSE EXCLUDED.event_hash END,
                    processing_status = CASE
                        WHEN event_processing_registry.processing_status = 'completed'
                        THEN 'completed'
                        ELSE EXCLUDED.processing_status END,
                    processing_error = CASE
                        WHEN event_processing_registry.processing_status = 'completed'
                        THEN event_processing_registry.processing_error
                        ELSE EXCLUDED.processing_error END,
                    retry_count = CASE
                        WHEN event_processing_registry.processing_status = 'completed'
                        THEN event_processing_registry.retry_count
                        ELSE GREATEST(event_processing_registry.retry_count, EXCLUDED.retry_count) END,
                    owner_worker_id = CASE
                        WHEN event_processing_registry.processing_status = 'completed'
                        THEN event_processing_registry.owner_worker_id
                        ELSE EXCLUDED.owner_worker_id END,
                    correlation_id = CASE
                        WHEN event_processing_registry.processing_status = 'completed'
                        THEN event_processing_registry.correlation_id
                        ELSE EXCLUDED.correlation_id END
                RETURNING processing_status, retry_count`,
                [
                    eventHash,
                    this._chainIdString(),
                    event.transactionHash,
                    event.logIndex,
                    event.eventName,
                    event.blockNumber,
                    status,
                    String(error?.message || 'Unknown event processing error').slice(0, 2000),
                    retryCount,
                    workerId,
                    correlationId
                ]
            );

            return rows?.[0] || null;
        } catch (registryError) {
            // The failure record itself could not be written. The range still
            // fails closed, so the cursor does not move and the event is
            // retried; surface this loudly because health would otherwise not
            // see this specific failure.
            console.error(JSON.stringify({
                event_hash: eventHash,
                chain_id: this._chainIdString(),
                transaction_hash: event.transactionHash,
                log_index: event.logIndex,
                phase: 'registry_failure_record_failed',
                error: registryError.message
            }));
            return null;
        }
    }

    /**
     * Authoritative unresolved event-failure counts for the active chain.
     * 'failed' is retryable; 'dead' exceeded the retry policy and needs an
     * operator. Both keep /health degraded.
     *
     * Deliberately an aggregate: it returns two integers on an indexed,
     * chain-scoped GROUP BY instead of selecting every failed row into memory,
     * so a large backlog can never inflate the health response or its cost.
     * Per-row detail is an operator SQL query documented in the A9 runbook,
     * not part of the public health payload.
     */
    async getEventFailureCounts() {
        const rows = await this.db.query(
            `SELECT processing_status, COUNT(*)::BIGINT AS count
             FROM event_processing_registry
             WHERE chain_id = $1
               AND processing_status IN ('failed', 'dead')
             GROUP BY processing_status`,
            [this._chainIdString()]
        );

        const counts = { failed: 0, dead: 0 };
        for (const row of rows || []) {
            if (row.processing_status in counts) {
                counts[row.processing_status] = Number(row.count || 0);
            }
        }
        return counts;
    }

    async processEvent(event) {
        // Compute event hash for idempotency
        const eventHash = await this._computeEventHash(event);

        // Wrap in transaction for atomicity
        const client = await this.db.pool.connect();
        const workerId = process.env.WORKER_ID || `worker-${process.pid}`;
        const correlationId = `${event.transactionHash}-${event.logIndex}`;
        const startTime = Date.now();

        await client.query('BEGIN');

            // Try to acquire lock on event (atomic ownership)
            const lock = await client.query(
                `INSERT INTO event_processing_registry (
                    event_hash, chain_id, transaction_hash, log_index, event_name, block_number,
                    processing_status, processing_started_at, owner_worker_id,
                    last_heartbeat_at, correlation_id
                ) VALUES ($1, $2, $3, $4, $5, $6, 'processing', NOW(), $7, NOW(), $8)
                ON CONFLICT (chain_id, transaction_hash, log_index) DO UPDATE SET
                    event_hash = EXCLUDED.event_hash,
                    processing_status = CASE
                        WHEN event_processing_registry.processing_status = 'completed' THEN 'completed'
                        WHEN event_processing_registry.processing_status = 'processing'
                             AND event_processing_registry.last_heartbeat_at > NOW() - INTERVAL '2 minutes'
                             THEN event_processing_registry.processing_status
                        ELSE 'processing'
                    END,
                    owner_worker_id = CASE
                        WHEN event_processing_registry.processing_status = 'completed' THEN event_processing_registry.owner_worker_id
                        WHEN event_processing_registry.processing_status = 'processing'
                             AND event_processing_registry.last_heartbeat_at > NOW() - INTERVAL '2 minutes'
                             THEN event_processing_registry.owner_worker_id
                        ELSE $7
                    END,
                    processing_started_at = CASE
                        WHEN event_processing_registry.processing_status = 'completed' THEN event_processing_registry.processing_started_at
                        WHEN event_processing_registry.processing_status = 'processing'
                             AND event_processing_registry.last_heartbeat_at > NOW() - INTERVAL '2 minutes'
                             THEN event_processing_registry.processing_started_at
                        ELSE NOW()
                    END,
                    last_heartbeat_at = CASE
                        WHEN event_processing_registry.processing_status = 'completed' THEN event_processing_registry.last_heartbeat_at
                        WHEN event_processing_registry.processing_status = 'processing'
                             AND event_processing_registry.last_heartbeat_at > NOW() - INTERVAL '2 minutes'
                             THEN event_processing_registry.last_heartbeat_at
                        ELSE NOW()
                    END,
                    retry_count = CASE
                        WHEN event_processing_registry.processing_status = 'completed' THEN event_processing_registry.retry_count
                        ELSE event_processing_registry.retry_count + 1
                    END
                RETURNING processing_status, retry_count, owner_worker_id`,
                [
                    eventHash,
                    this._chainIdString(),
                    event.transactionHash,
                    event.logIndex,
                    event.eventName,
                    event.blockNumber,
                    workerId,
                    correlationId
                ]
            );

            const status = lock.rows[0].processing_status;
            const retryCount = lock.rows[0].retry_count;
            const ownerWorkerId = lock.rows[0].owner_worker_id;

            // Structured logging
            const logData = {
                event_hash: eventHash,
                tx_hash: event.transactionHash,
                log_index: event.logIndex,
                event_name: event.eventName,
                block_number: event.blockNumber,
                worker_id: workerId,
                owner_worker_id: ownerWorkerId,
                processing_status: status,
                retry_count: retryCount,
                correlation_id: correlationId,
                phase: 'acquire_lock'
            };

            // If already completed, skip
            if (status === 'completed') {
                await client.query('ROLLBACK');
                client.release();
                console.log(JSON.stringify({
                    ...logData,
                    phase: 'skip',
                    reason: 'already_completed',
                    duration_ms: Date.now() - startTime
                }));
                return;
            }

            // If currently processing by another worker, skip
            if (status === 'processing' && ownerWorkerId !== workerId) {
                await client.query('ROLLBACK');
                client.release();
                console.log(JSON.stringify({
                    ...logData,
                    phase: 'skip',
                    reason: 'owned_by_other_worker',
                    duration_ms: Date.now() - startTime
                }));
                return;
            }

            // Now we have exclusive ownership within this transaction
            console.log(JSON.stringify({
                ...logData,
                phase: 'process',
                message: 'Processing event'
            }));

            // Start heartbeat loop for long-running processing
            let isShuttingDown = false;

            // Heartbeat loop (async, no setInterval issues)
            const heartbeatLoop = async () => {
                while (!isShuttingDown) {
                    await new Promise(resolve => setTimeout(resolve, 30000)); // 30 seconds

                    if (isShuttingDown) break;

                    try {
                        const result = await this.db.query(
                            `UPDATE event_processing_registry
                             SET last_heartbeat_at = NOW()
                             WHERE event_hash = $1 AND owner_worker_id = $2`,
                            [eventHash, workerId]
                        );

                        // Check if we still own this event
                        if (result.rowCount === 0) {
                            console.error(JSON.stringify({
                                event_hash: eventHash,
                                worker_id: workerId,
                                phase: 'heartbeat_lost_ownership',
                                message: 'Lost ownership, stopping heartbeat'
                            }));
                            isShuttingDown = true;
                            break;
                        }
                    } catch (error) {
                        console.error(JSON.stringify({
                            event_hash: eventHash,
                            worker_id: workerId,
                            phase: 'heartbeat_error',
                            error: error.message
                        }));
                    }
                }
            };

            // Start heartbeat in background
            const heartbeatPromise = heartbeatLoop();

            try {
                // Schema validation
                if (!event.eventData) {
                    throw new Error('Invalid event structure: missing eventData');
                }

                // Validate required fields based on the canonical V4.1 event schema.
                const required = V41_EVENT_REQUIRED_FIELDS[event.eventName];
                if (required) {
                    for (const field of required) {
                        if (event.eventData[field] === undefined) {
                            throw new Error(`Invalid event structure: missing required field '${field}' for ${event.eventName}`);
                        }
                    }
                }

                // Store raw event
                await client.query(
                    `INSERT INTO contract_events (chain_id, event_name, artwork_id, block_number, transaction_hash, log_index, event_data, indexed_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                     ON CONFLICT (chain_id, transaction_hash, log_index) DO NOTHING`,
                    [
                        this._chainIdString(),
                        event.eventName,
                        this._getEventArtworkId(event),
                        event.blockNumber,
                        event.transactionHash,
                        event.logIndex,
                        this._serializeEventData(event.eventData),
                        new Date(this._getEventTimestamp(event))
                    ]
                );

                // Process event-specific logic
                const handlers = {
                    'ArtworkRegistered': this._handleArtworkRegisteredTx.bind(this),
                    'AuctionCreated': this._handleAuctionCreatedTx.bind(this),
                    'BidPlaced': this._handleBidPlacedTx.bind(this),
                    'BidDepositWithdrawn': this._handleBidDepositWithdrawnTx.bind(this),
                    'AuctionExtended': this._handleAuctionExtendedTx.bind(this),
                    'AuctionEnded': this._handleAuctionEndedTx.bind(this),
                    'SettlementCompleted': this._handleSettlementCompletedTx.bind(this),
                    'SettlementDefaulted': this._handleSettlementDefaultedTx.bind(this),
                    'CanonicalFloorUpdated': this._handleCanonicalFloorUpdatedTx.bind(this),
                    'ResaleListed': this._handleResaleListedTx.bind(this),
                    'ResaleCompleted': this._handleResaleCompletedTx.bind(this),
                    'ProjectNFTEligibilityAchieved': this._handleProjectNFTEligibilityAchievedTx.bind(this),
                    'ProjectNFTMinted': this._handleProjectNFTMintedTx.bind(this)
                };

                const handler = handlers[event.eventName];
                if (handler) {
                    await handler(event, client);
                }

                // Mark as completed (atomic with transaction)
                await client.query(
                    `UPDATE event_processing_registry
                     SET processing_status = 'completed',
                         processing_completed_at = NOW()
                     WHERE event_hash = $1`,
                    [eventHash]
                );

                await client.query('COMMIT');

                const duration = Date.now() - startTime;
                console.log(JSON.stringify({
                    ...logData,
                    phase: 'commit',
                    processing_status: 'completed',
                    duration_ms: duration,
                    message: 'Event processed successfully'
                }));

                // --- CACHE INVALIDATION LAYER ---
                // Invalidate related cache keys after successful commit
                const artworkId = this._getEventArtworkId(event);
                if (artworkId) {
                    await cacheService.invalidateAuctionState(`${this._chainIdString()}:artwork:${artworkId}`);
                }

                // Invalidate global stats if this event affects them
                if (V41_GLOBAL_STATS_EVENTS.has(event.eventName)) {
                    await cacheService.del(cacheService.keys.stats(`global:${this._chainIdString()}`));
                }
                // ---------------------------------

                // Trigger AI analysis after successful indexing
                await enqueueAIJob(
                    event.eventName,
                    event.eventData,
                    workerId,
                    correlationId
                );
            } catch (error) {
                await client.query('ROLLBACK');

                const duration = Date.now() - startTime;

                // Determine if this should go to DLQ (after max retries)
                const maxRetries = 5;
                const shouldDLQ = retryCount >= maxRetries;

                // Durably record the failure on a POOL connection, outside the
                // rolled-back transaction. A plain UPDATE was silently a no-op
                // on the first-ever failure: the claim INSERT lives inside the
                // transaction that just rolled back, so no row existed to
                // update and the failure vanished. UPSERT on the chain-scoped
                // identity recreates it.
                await this._recordEventFailure({
                    event,
                    eventHash,
                    workerId,
                    correlationId,
                    retryCount,
                    status: shouldDLQ ? 'dead' : 'failed',
                    error
                });

                console.error(JSON.stringify({
                    ...logData,
                    phase: 'rollback',
                    processing_status: shouldDLQ ? 'dead' : 'failed',
                    error_type: error.name,
                    error_message: error.message,
                    duration_ms: duration,
                    will_retry: !shouldDLQ
                }));

                throw error;
            } finally {
                // Always stop heartbeat on exit (success, error, or return)
                isShuttingDown = true;

                // Wait for heartbeat loop to finish cleanly
                await heartbeatPromise;

                client.release();
            }
    }

    /**
     * Write side effect to outbox (inside transaction)
     * Ensures side effects only execute after successful commit
     */
    async _writeToOutbox(client, eventType, aggregateType, aggregateId, payload, correlationId) {
        const scopedCorrelationId = `${this._chainIdString()}-${correlationId}`;
        const idempotencyKey = `${scopedCorrelationId}-${eventType}`;

        await client.query(
            `INSERT INTO outbox_events (
                aggregate_type, aggregate_id, event_type, payload,
                correlation_id, idempotency_key, processing_status
            ) VALUES ($1, $2, $3, $4, $5, $6, 'pending')
            ON CONFLICT (idempotency_key) DO NOTHING`,
            [
                aggregateType,
                aggregateId,
                eventType,
                JSON.stringify(payload),
                scopedCorrelationId,
                idempotencyKey
            ]
        );
    }

    /**
     * Compute deterministic event hash for idempotency
     * Uses only immutable fields to avoid JSON serialization issues
     */
    async _computeEventHash(event) {
        // Use only immutable blockchain fields (not event_data)
        // This prevents issues with:
        // - JSON key ordering
        // - RPC format changes
        // - BigInt serialization differences
        const result = await this.db.query(
            `SELECT encode(
                digest(
                    $1::TEXT || ':' || $2 || ':' || $3::TEXT || ':' || $4 || ':' || $5::TEXT,
                    'sha256'
                ),
                'hex'
            ) as hash`,
            [
                this._chainIdString(),
                event.transactionHash,
                event.logIndex,
                event.eventName,
                event.blockNumber
            ]
        );
        return '0x' + result[0].hash;
    }

    async _handleArtworkRegisteredTx(event, client) {
        const { artworkId, creator, metadataURI } = event.eventData;

        await client.query(
            `INSERT INTO v41_artworks (
                chain_id, artwork_id, creator, metadata_uri, minted, canonical_floor,
                block_number, transaction_hash, log_index, indexed_at, last_updated_block, last_updated_at
            ) VALUES ($1, $2, $3, $4, FALSE, 0, $5, $6, $7, to_timestamp($8 / 1000.0), $5, to_timestamp($8 / 1000.0))
            ON CONFLICT (chain_id, artwork_id) DO UPDATE SET
                metadata_uri = EXCLUDED.metadata_uri,
                last_updated_block = EXCLUDED.last_updated_block,
                last_updated_at = EXCLUDED.last_updated_at`,
            [
                this._chainIdString(),
                this._asString(artworkId),
                creator,
                metadataURI,
                event.blockNumber,
                event.transactionHash,
                event.logIndex,
                this._eventTimestampSqlValue(event)
            ]
        );

        await this._writeToOutbox(
            client,
            'webhook',
            'artwork',
            this._asString(artworkId),
            {
                event: 'artwork.registered',
                data: {
                    artworkId: this._asString(artworkId),
                    creator,
                    metadataURI,
                    blockNumber: event.blockNumber,
                    transactionHash: event.transactionHash
                }
            },
            `${event.transactionHash}-${event.logIndex}`
        );

        console.log(`[IndexerSyncEngine] Indexed ArtworkRegistered for artwork ${artworkId}`);
    }

    async _handleAuctionCreatedTx(event, client) {
        const { auctionId, artworkId, creator, startPrice, duration, endTime } = event.eventData;
        const timestamp = this._eventTimestampSqlValue(event);

        await client.query(
            `INSERT INTO v41_auctions (
                auction_id, artwork_id, creator, start_price, duration, original_end_time, end_time,
                chain_id, status, current_bid, current_bidder, block_number, transaction_hash,
                log_index, indexed_at, last_updated_block, last_updated_at
            ) VALUES ($1, $2, $3, $4, $5, to_timestamp($6), to_timestamp($6), $7, 'active', 0, NULL, $8, $9, $10, to_timestamp($11 / 1000.0), $8, to_timestamp($11 / 1000.0))
            ON CONFLICT (chain_id, auction_id) DO UPDATE SET
                status = 'active',
                start_price = EXCLUDED.start_price,
                duration = EXCLUDED.duration,
                end_time = EXCLUDED.end_time,
                chain_id = EXCLUDED.chain_id,
                last_updated_block = EXCLUDED.last_updated_block,
                last_updated_at = EXCLUDED.last_updated_at`,
            [
                this._asString(auctionId),
                this._asString(artworkId),
                creator,
                this._asString(startPrice),
                this._asString(duration),
                this._asNumber(endTime),
                this._chainIdString(),
                event.blockNumber,
                event.transactionHash,
                event.logIndex,
                timestamp
            ]
        );

        await client.query(
            `UPDATE v41_artworks
             SET active_auction_id = $1,
                 last_updated_block = $2,
                 last_updated_at = to_timestamp($3 / 1000.0)
             WHERE chain_id = $4 AND artwork_id = $5`,
            [
                this._asString(auctionId),
                event.blockNumber,
                timestamp,
                this._chainIdString(),
                this._asString(artworkId)
            ]
        );

        const correlationId = `${event.transactionHash}-${event.logIndex}`;
        await this._writeToOutbox(
            client,
            'notification',
            'auction',
            this._asString(auctionId),
            {
                type: 'auction_created',
                recipient: creator,
                auctionId: this._asString(auctionId),
                artworkId: this._asString(artworkId),
                startPrice: this._asString(startPrice),
                endTime: this._asNumber(endTime)
            },
            correlationId
        );

        console.log(`[IndexerSyncEngine] Indexed AuctionCreated ${auctionId} for artwork ${artworkId}`);
    }

    async _handleBidPlacedTx(event, client) {
        const { auctionId, bidder, bidAmount, depositAmount } = event.eventData;
        const timestamp = this._eventTimestampSqlValue(event);

        const auctionResult = await client.query(
            `SELECT artwork_id, current_bidder FROM v41_auctions WHERE chain_id = $1 AND auction_id = $2`,
            [this._chainIdString(), this._asString(auctionId)]
        );
        const auction = auctionResult.rows[0];
        const artworkId = auction?.artwork_id ?? null;
        const previousBidder = auction?.current_bidder ?? null;

        await client.query(
            `INSERT INTO v41_bids (
                chain_id, auction_id, artwork_id, bidder, bid_amount, deposit_amount,
                block_number, transaction_hash, log_index, indexed_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, to_timestamp($10 / 1000.0))
            ON CONFLICT (chain_id, transaction_hash, log_index) DO NOTHING`,
            [
                this._chainIdString(),
                this._asString(auctionId),
                artworkId,
                bidder,
                this._asString(bidAmount),
                this._asString(depositAmount),
                event.blockNumber,
                event.transactionHash,
                event.logIndex,
                timestamp
            ]
        );

        await client.query(
            `UPDATE v41_auctions
             SET current_bid = $1,
                 current_bidder = $2,
                 last_updated_block = $3,
                 last_updated_at = to_timestamp($4 / 1000.0)
             WHERE chain_id = $5 AND auction_id = $6`,
            [
                this._asString(bidAmount),
                bidder,
                event.blockNumber,
                timestamp,
                this._chainIdString(),
                this._asString(auctionId)
            ]
        );

        if (previousBidder && previousBidder.toLowerCase() !== bidder.toLowerCase()) {
            await this._writeToOutbox(
                client,
                'notification',
                'bid',
                this._asString(auctionId),
                {
                    type: 'outbid',
                    recipient: previousBidder,
                    auctionId: this._asString(auctionId),
                    artworkId,
                    newBidder: bidder,
                    newAmount: this._asString(bidAmount)
                },
                `${event.transactionHash}-${event.logIndex}`
            );
        }

        console.log(`[IndexerSyncEngine] Indexed BidPlaced for auction ${auctionId}`);
    }

    async _handleBidDepositWithdrawnTx(event, client) {
        const { auctionId, bidder, amount } = event.eventData;

        await client.query(
            `INSERT INTO v41_bid_withdrawals (
                chain_id, auction_id, bidder, amount, block_number, transaction_hash, log_index, indexed_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8 / 1000.0))
            ON CONFLICT (chain_id, transaction_hash, log_index) DO NOTHING`,
            [
                this._chainIdString(),
                this._asString(auctionId),
                bidder,
                this._asString(amount),
                event.blockNumber,
                event.transactionHash,
                event.logIndex,
                this._eventTimestampSqlValue(event)
            ]
        );

        console.log(`[IndexerSyncEngine] Indexed BidDepositWithdrawn for auction ${auctionId}`);
    }

    async _handleAuctionExtendedTx(event, client) {
        const { auctionId, oldEndTime, newEndTime } = event.eventData;

        await client.query(
            `INSERT INTO v41_auction_extensions (
                chain_id, auction_id, old_end_time, new_end_time, block_number, transaction_hash, log_index, indexed_at
            ) VALUES ($1, $2, to_timestamp($3), to_timestamp($4), $5, $6, $7, to_timestamp($8 / 1000.0))
            ON CONFLICT (chain_id, transaction_hash, log_index) DO NOTHING`,
            [
                this._chainIdString(),
                this._asString(auctionId),
                this._asNumber(oldEndTime),
                this._asNumber(newEndTime),
                event.blockNumber,
                event.transactionHash,
                event.logIndex,
                this._eventTimestampSqlValue(event)
            ]
        );

        await client.query(
            `UPDATE v41_auctions
             SET end_time = to_timestamp($1),
                 total_extension_seconds = EXTRACT(EPOCH FROM (to_timestamp($1) - original_end_time))::BIGINT,
                 last_updated_block = $2,
                 last_updated_at = to_timestamp($3 / 1000.0)
             WHERE chain_id = $4 AND auction_id = $5`,
            [
                this._asNumber(newEndTime),
                event.blockNumber,
                this._eventTimestampSqlValue(event),
                this._chainIdString(),
                this._asString(auctionId)
            ]
        );

        console.log(`[IndexerSyncEngine] Indexed AuctionExtended for auction ${auctionId}`);
    }

    async _handleAuctionEndedTx(event, client) {
        const { auctionId, winner, winningBid, settlementDeadline } = event.eventData;
        const status = this._isZeroAddress(winner) ? 'defaulted_no_bids' : 'settlement_pending';

        await client.query(
            `INSERT INTO v41_auction_endings (
                chain_id, auction_id, winner, winning_bid, settlement_deadline, block_number, transaction_hash, log_index, indexed_at
            ) VALUES ($1, $2, $3, $4, to_timestamp($5), $6, $7, $8, to_timestamp($9 / 1000.0))
            ON CONFLICT (chain_id, transaction_hash, log_index) DO NOTHING`,
            [
                this._chainIdString(),
                this._asString(auctionId),
                winner,
                this._asString(winningBid),
                this._asNumber(settlementDeadline),
                event.blockNumber,
                event.transactionHash,
                event.logIndex,
                this._eventTimestampSqlValue(event)
            ]
        );

        await client.query(
            `UPDATE v41_auctions
             SET status = $1,
                 winner = $2,
                 winning_bid = $3,
                 settlement_deadline = CASE WHEN $4::BIGINT = 0 THEN NULL ELSE to_timestamp($4) END,
                 last_updated_block = $5,
                 last_updated_at = to_timestamp($6 / 1000.0)
             WHERE chain_id = $7 AND auction_id = $8`,
            [
                status,
                this._isZeroAddress(winner) ? null : winner,
                this._asString(winningBid),
                this._asNumber(settlementDeadline),
                event.blockNumber,
                this._eventTimestampSqlValue(event),
                this._chainIdString(),
                this._asString(auctionId)
            ]
        );

        console.log(`[IndexerSyncEngine] Indexed AuctionEnded for auction ${auctionId}`);
    }

    async _handleSettlementCompletedTx(event, client) {
        const { auctionId, artworkId, winner, finalPrice, tokenId } = event.eventData;
        const timestamp = this._eventTimestampSqlValue(event);

        await client.query(
            `INSERT INTO v41_settlements (
                chain_id, auction_id, artwork_id, winner, final_price, token_id, settlement_status,
                block_number, transaction_hash, log_index, indexed_at
            ) VALUES ($1, $2, $3, $4, $5, $6, 'completed', $7, $8, $9, to_timestamp($10 / 1000.0))
            ON CONFLICT (chain_id, auction_id) DO UPDATE SET
                final_price = EXCLUDED.final_price,
                token_id = EXCLUDED.token_id,
                settlement_status = EXCLUDED.settlement_status,
                block_number = EXCLUDED.block_number,
                transaction_hash = EXCLUDED.transaction_hash,
                log_index = EXCLUDED.log_index,
                indexed_at = EXCLUDED.indexed_at`,
            [
                this._chainIdString(),
                this._asString(auctionId),
                this._asString(artworkId),
                winner,
                this._asString(finalPrice),
                this._asString(tokenId),
                event.blockNumber,
                event.transactionHash,
                event.logIndex,
                timestamp
            ]
        );

        await client.query(
            `UPDATE v41_auctions
             SET status = 'settled',
                 final_price = $1,
                 token_id = $2,
                 last_updated_block = $3,
                 last_updated_at = to_timestamp($4 / 1000.0)
             WHERE chain_id = $5 AND auction_id = $6`,
            [
                this._asString(finalPrice),
                this._asString(tokenId),
                event.blockNumber,
                timestamp,
                this._chainIdString(),
                this._asString(auctionId)
            ]
        );

        await client.query(
            `UPDATE v41_artworks
             SET minted = TRUE,
                 token_id = $1,
                 canonical_floor = $2,
                 active_auction_id = NULL,
                 last_updated_block = $3,
                 last_updated_at = to_timestamp($4 / 1000.0)
             WHERE chain_id = $5 AND artwork_id = $6`,
            [
                this._asString(tokenId),
                this._asString(finalPrice),
                event.blockNumber,
                timestamp,
                this._chainIdString(),
                this._asString(artworkId)
            ]
        );

        await client.query(
            `INSERT INTO v41_trust_signals (chain_id, user_address, successful_settlements, last_updated_block, last_updated_at)
             VALUES ($1, $2, 1, $3, to_timestamp($4 / 1000.0))
             ON CONFLICT (chain_id, user_address) DO UPDATE SET
                 successful_settlements = v41_trust_signals.successful_settlements + 1,
                 last_updated_block = EXCLUDED.last_updated_block,
                 last_updated_at = EXCLUDED.last_updated_at`,
            [this._chainIdString(), winner, event.blockNumber, timestamp]
        );

        console.log(`[IndexerSyncEngine] Indexed SettlementCompleted for auction ${auctionId}`);
    }

    async _handleSettlementDefaultedTx(event, client) {
        const { auctionId, winner, artistAmount, platformAmount } = event.eventData;
        const timestamp = this._eventTimestampSqlValue(event);

        const auctionResult = await client.query(
            `SELECT artwork_id FROM v41_auctions WHERE chain_id = $1 AND auction_id = $2`,
            [this._chainIdString(), this._asString(auctionId)]
        );
        const artworkId = auctionResult.rows[0]?.artwork_id ?? null;

        await client.query(
            `INSERT INTO v41_settlements (
                chain_id, auction_id, artwork_id, winner, artist_amount, platform_amount, settlement_status,
                block_number, transaction_hash, log_index, indexed_at
            ) VALUES ($1, $2, $3, $4, $5, $6, 'defaulted', $7, $8, $9, to_timestamp($10 / 1000.0))
            ON CONFLICT (chain_id, auction_id) DO UPDATE SET
                artist_amount = EXCLUDED.artist_amount,
                platform_amount = EXCLUDED.platform_amount,
                settlement_status = EXCLUDED.settlement_status,
                block_number = EXCLUDED.block_number,
                transaction_hash = EXCLUDED.transaction_hash,
                log_index = EXCLUDED.log_index,
                indexed_at = EXCLUDED.indexed_at`,
            [
                this._chainIdString(),
                this._asString(auctionId),
                artworkId,
                this._isZeroAddress(winner) ? null : winner,
                this._asString(artistAmount),
                this._asString(platformAmount),
                event.blockNumber,
                event.transactionHash,
                event.logIndex,
                timestamp
            ]
        );

        await client.query(
            `UPDATE v41_auctions
             SET status = 'defaulted',
                 default_artist_amount = $1,
                 default_platform_amount = $2,
                 last_updated_block = $3,
                 last_updated_at = to_timestamp($4 / 1000.0)
             WHERE chain_id = $5 AND auction_id = $6`,
            [
                this._asString(artistAmount),
                this._asString(platformAmount),
                event.blockNumber,
                timestamp,
                this._chainIdString(),
                this._asString(auctionId)
            ]
        );

        if (artworkId) {
            await client.query(
                `UPDATE v41_artworks
                 SET active_auction_id = NULL,
                     last_updated_block = $1,
                     last_updated_at = to_timestamp($2 / 1000.0)
                 WHERE chain_id = $3 AND artwork_id = $4`,
                [event.blockNumber, timestamp, this._chainIdString(), artworkId]
            );
        }

        if (!this._isZeroAddress(winner)) {
            await client.query(
                `INSERT INTO v41_trust_signals (chain_id, user_address, failed_settlements, last_updated_block, last_updated_at)
                 VALUES ($1, $2, 1, $3, to_timestamp($4 / 1000.0))
                 ON CONFLICT (chain_id, user_address) DO UPDATE SET
                     failed_settlements = v41_trust_signals.failed_settlements + 1,
                     last_updated_block = EXCLUDED.last_updated_block,
                     last_updated_at = EXCLUDED.last_updated_at`,
                [this._chainIdString(), winner, event.blockNumber, timestamp]
            );
        }

        console.log(`[IndexerSyncEngine] Indexed SettlementDefaulted for auction ${auctionId}`);
    }

    async _handleCanonicalFloorUpdatedTx(event, client) {
        const { artworkId, tokenId, floorPrice } = event.eventData;

        await client.query(
            `INSERT INTO v41_floor_history (
                chain_id, artwork_id, token_id, floor_price, block_number, transaction_hash, log_index, indexed_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8 / 1000.0))
            ON CONFLICT (chain_id, transaction_hash, log_index) DO NOTHING`,
            [
                this._chainIdString(),
                this._asString(artworkId),
                this._asString(tokenId),
                this._asString(floorPrice),
                event.blockNumber,
                event.transactionHash,
                event.logIndex,
                this._eventTimestampSqlValue(event)
            ]
        );

        await client.query(
            `UPDATE v41_artworks
             SET canonical_floor = $1,
                 token_id = $2,
                 last_updated_block = $3,
                 last_updated_at = to_timestamp($4 / 1000.0)
             WHERE chain_id = $5 AND artwork_id = $6`,
            [
                this._asString(floorPrice),
                this._asString(tokenId),
                event.blockNumber,
                this._eventTimestampSqlValue(event),
                this._chainIdString(),
                this._asString(artworkId)
            ]
        );

        console.log(`[IndexerSyncEngine] Indexed CanonicalFloorUpdated for artwork ${artworkId}`);
    }

    async _handleResaleListedTx(event, client) {
        const { tokenId, seller, price } = event.eventData;

        await client.query(
            `INSERT INTO v41_resale_listings (
                chain_id, token_id, seller, price, active, block_number, transaction_hash, log_index, indexed_at, last_updated_block, last_updated_at
            ) VALUES ($1, $2, $3, $4, TRUE, $5, $6, $7, to_timestamp($8 / 1000.0), $5, to_timestamp($8 / 1000.0))
            ON CONFLICT (chain_id, token_id) DO UPDATE SET
                seller = EXCLUDED.seller,
                price = EXCLUDED.price,
                active = TRUE,
                last_updated_block = EXCLUDED.last_updated_block,
                last_updated_at = EXCLUDED.last_updated_at`,
            [
                this._chainIdString(),
                this._asString(tokenId),
                seller,
                this._asString(price),
                event.blockNumber,
                event.transactionHash,
                event.logIndex,
                this._eventTimestampSqlValue(event)
            ]
        );

        console.log(`[IndexerSyncEngine] Indexed ResaleListed for token ${tokenId}`);
    }

    async _handleResaleCompletedTx(event, client) {
        const { tokenId, seller, buyer, price, royaltyAmount, platformFee } = event.eventData;

        await client.query(
            `INSERT INTO v41_resale_history (
                chain_id, token_id, seller, buyer, price, royalty_amount, platform_fee,
                block_number, transaction_hash, log_index, indexed_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, to_timestamp($11 / 1000.0))
            ON CONFLICT (chain_id, transaction_hash, log_index) DO NOTHING`,
            [
                this._chainIdString(),
                this._asString(tokenId),
                seller,
                buyer,
                this._asString(price),
                this._asString(royaltyAmount),
                this._asString(platformFee),
                event.blockNumber,
                event.transactionHash,
                event.logIndex,
                this._eventTimestampSqlValue(event)
            ]
        );

        await client.query(
            `UPDATE v41_resale_listings
                 SET active = FALSE,
                     last_updated_block = $1,
                     last_updated_at = to_timestamp($2 / 1000.0)
             WHERE chain_id = $3 AND token_id = $4`,
            [
                event.blockNumber,
                this._eventTimestampSqlValue(event),
                this._chainIdString(),
                this._asString(tokenId)
            ]
        );

        console.log(`[IndexerSyncEngine] Indexed ResaleCompleted for token ${tokenId}`);
    }

    async _handleProjectNFTEligibilityAchievedTx(event, client) {
        const { user, eligibilityHash } = event.eventData;

        await client.query(
            `INSERT INTO v41_project_eligibility (
                chain_id, user_address, eligibility_hash, achieved, block_number, transaction_hash, log_index, indexed_at
            ) VALUES ($1, $2, $3, TRUE, $4, $5, $6, to_timestamp($7 / 1000.0))
            ON CONFLICT (chain_id, user_address) DO UPDATE SET
                eligibility_hash = EXCLUDED.eligibility_hash,
                achieved = TRUE,
                block_number = EXCLUDED.block_number,
                transaction_hash = EXCLUDED.transaction_hash,
                log_index = EXCLUDED.log_index,
                indexed_at = EXCLUDED.indexed_at`,
            [
                this._chainIdString(),
                user,
                eligibilityHash,
                event.blockNumber,
                event.transactionHash,
                event.logIndex,
                this._eventTimestampSqlValue(event)
            ]
        );

        console.log(`[IndexerSyncEngine] Indexed ProjectNFTEligibilityAchieved for ${user}`);
    }

    async _handleProjectNFTMintedTx(event, client) {
        const { user, tokenId, eligibilityHash } = event.eventData;

        await client.query(
            `INSERT INTO v41_genesis_holders (
                chain_id, user_address, token_id, eligibility_hash, block_number, transaction_hash, log_index, indexed_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8 / 1000.0))
            ON CONFLICT (chain_id, user_address) DO UPDATE SET
                token_id = EXCLUDED.token_id,
                eligibility_hash = EXCLUDED.eligibility_hash,
                block_number = EXCLUDED.block_number,
                transaction_hash = EXCLUDED.transaction_hash,
                log_index = EXCLUDED.log_index,
                indexed_at = EXCLUDED.indexed_at`,
            [
                this._chainIdString(),
                user,
                this._asString(tokenId),
                eligibilityHash,
                event.blockNumber,
                event.transactionHash,
                event.logIndex,
                this._eventTimestampSqlValue(event)
            ]
        );

        console.log(`[IndexerSyncEngine] Indexed ProjectNFTMinted for ${user}`);
    }

    async getIndexerState() {
        const state = await this.db.query(
            'SELECT * FROM indexer_state WHERE chain_id = $1',
            [this._chainIdString()]
        );
        if (!state[0]) return null;

        // Convert BIGINT strings to numbers
        return {
            ...state[0],
            last_indexed_block: parseInt(state[0].last_indexed_block),
            last_confirmed_block: parseInt(state[0].last_confirmed_block),
            confirmation_depth: parseInt(state[0].confirmation_depth)
        };
    }

    async getUnresolvedErrors() {
        return await this.db.query(
            'SELECT * FROM indexer_errors WHERE chain_id = $1 AND resolved = false ORDER BY occurred_at DESC',
            [this._chainIdString()]
        );
    }
}

export default IndexerSyncEngine;

if (typeof window !== 'undefined') {
    window.IndexerSyncEngine = IndexerSyncEngine;
}
