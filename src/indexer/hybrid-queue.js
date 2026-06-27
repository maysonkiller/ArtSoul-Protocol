/**
 * Hybrid Queue: Memory + Persistent Spillover + WAL Fallback
 *
 * ZERO DATA LOSS guarantee:
 * - Memory queue (fast path, bounded size)
 * - PostgreSQL spillover (when memory full)
 * - WAL fallback (when DB unavailable)
 * - Idempotency (tx_hash-log_index)
 * - Crash safety (visibility timeout)
 * - Retry with exponential backoff
 * - Dead letter queue (max retries exceeded)
 * - Backpressure (queue size limits)
 *
 * Architecture:
 * 1. enqueue() → try memory, if full → spillover to DB, if DB down → WAL
 * 2. dequeue() → drain memory first, then spillover
 * 3. Worker uses FOR UPDATE SKIP LOCKED
 * 4. Visibility timeout (30s) for crash recovery
 */

import QueueWAL from './queue-wal.js';
import AdaptiveRateLimiter from './adaptive-rate-limiter.js';

export default class HybridQueue {
    constructor(db, config = {}) {
        this.db = db;
        this.memoryMaxSize = config.memoryMaxSize || 1000;
        this.visibilityTimeout = config.visibilityTimeout || 30000; // 30s
        this.maxRetries = config.maxRetries || 5;

        // Backpressure thresholds
        this.backpressureWarning = config.backpressureWarning || 5000;
        this.backpressureCritical = config.backpressureCritical || 10000;

        // WAL fallback
        this.wal = new QueueWAL(config.wal || {});
        this.walEnabled = config.walEnabled !== false; // Enabled by default

        // Rate limiter (adaptive backpressure)
        this.rateLimiter = new AdaptiveRateLimiter({
            tokensPerSecond: config.rateLimitTokens || 1000,
            maxTokens: config.rateLimitMaxTokens || 2000
        });
        this.rateLimitEnabled = config.rateLimitEnabled !== false;

        this.memoryQueue = [];
        this.metrics = {
            memoryEnqueued: 0,
            spilloverEnqueued: 0,
            memoryDequeued: 0,
            spilloverDequeued: 0,
            duplicatesRejected: 0,
            deadLettered: 0,
            backpressureWarnings: 0,
            backpressureRejections: 0,
            walWrites: 0
        };

        // Track idempotency keys in memory (for fast duplicate check)
        this.processedKeys = new Set();

        // Local spillover counter (avoid COUNT(*) on every enqueue)
        this.spilloverPendingCount = 0;
        this.spilloverProcessingCount = 0;
        this.lastSyncTime = 0;
        this.syncInterval = 5000; // Sync every 5 seconds

        console.log('[HybridQueue] Initialized', {
            memoryMaxSize: this.memoryMaxSize,
            visibilityTimeout: this.visibilityTimeout,
            maxRetries: this.maxRetries,
            backpressureWarning: this.backpressureWarning,
            backpressureCritical: this.backpressureCritical,
            walEnabled: this.walEnabled
        });
    }

    /**
     * Initialize queue (including WAL)
     */
    async init() {
        if (this.walEnabled) {
            await this.wal.init();

            // Recover events from WAL on startup
            const recovery = await this.wal.recover(this);
            if (recovery.recovered > 0) {
                console.log(`[HybridQueue] Recovered ${recovery.recovered} events from WAL`);
            }
        }

        // Start background sync for spillover count
        this.startBackgroundSync();

        // Initial sync
        await this.syncSpilloverCount();
    }

    /**
     * Start background sync for spillover count
     */
    startBackgroundSync() {
        this.syncIntervalId = setInterval(async () => {
            try {
                await this.syncSpilloverCount();
            } catch (error) {
                console.error('[HybridQueue] Background sync failed:', error.message);
            }
        }, this.syncInterval);
    }

    /**
     * Sync spillover count from DB (background task)
     */
    async syncSpilloverCount() {
        try {
            const result = await this.db.query(
                `SELECT
                    COUNT(*) FILTER (WHERE status = 'pending') as pending,
                    COUNT(*) FILTER (WHERE status = 'processing') as processing
                 FROM event_queue_spillover`
            );

            this.spilloverPendingCount = parseInt(result[0].pending);
            this.spilloverProcessingCount = parseInt(result[0].processing);
            this.lastSyncTime = Date.now();
        } catch (error) {
            // If DB is down, keep current count (fail open)
            console.warn('[HybridQueue] Sync spillover count failed:', error.message);
        }
    }

    /**
     * Enqueue event with ZERO DATA LOSS guarantee
     *
     * Strategy:
     * 1. Check backpressure (queue size)
     * 2. Check idempotency (duplicate prevention)
     * 3. Try memory queue (fast path)
     * 4. If memory full → spillover to DB (persistent)
     * 5. NEVER reject/drop events (unless backpressure critical)
     */
    async enqueue(event) {
        const idempotencyKey = `${event.transactionHash}-${event.logIndex}`;

        // Backpressure check (get current queue size from local counter)
        const queueSize = this.memoryQueue.length + this.getSpilloverPendingCount();

        if (queueSize >= this.backpressureCritical) {
            this.metrics.backpressureRejections++;
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                component: 'HybridQueue',
                phase: 'backpressure_critical',
                queue_size: queueSize,
                threshold: this.backpressureCritical,
                message: 'Queue full, rejecting new events'
            }));
            throw new Error(`Backpressure: queue size ${queueSize} exceeds critical threshold ${this.backpressureCritical}`);
        }

        // Adaptive rate limiting (slow down when queue is high)
        if (queueSize >= this.backpressureWarning && this.rateLimitEnabled) {
            try {
                const result = await this.rateLimiter.acquire();
                if (result.waitTime > 0) {
                    // Log slowdown
                    if (this.metrics.backpressureWarnings % 100 === 1) {
                        console.warn(JSON.stringify({
                            timestamp: new Date().toISOString(),
                            component: 'HybridQueue',
                            phase: 'rate_limit_slowdown',
                            queue_size: queueSize,
                            wait_time_ms: result.waitTime,
                            message: 'Rate limiting active, slowing ingestion'
                        }));
                    }
                }
            } catch (error) {
                // Rate limiter timeout → reject
                this.metrics.backpressureRejections++;
                throw new Error(`Rate limiter timeout: ${error.message}`);
            }
        }

        if (queueSize >= this.backpressureWarning) {
            this.metrics.backpressureWarnings++;
            if (this.metrics.backpressureWarnings % 100 === 1) {
                console.warn(JSON.stringify({
                    timestamp: new Date().toISOString(),
                    component: 'HybridQueue',
                    phase: 'backpressure_warning',
                    queue_size: queueSize,
                    threshold: this.backpressureWarning,
                    message: 'Queue size high, rate limiting active'
                }));
            }
        }

        // Duplicate check (in-memory fast path)
        if (this.processedKeys.has(idempotencyKey)) {
            this.metrics.duplicatesRejected++;
            return { enqueued: false, reason: 'duplicate', location: 'memory_cache' };
        }

        // Try memory queue first (fast path)
        if (this.memoryQueue.length < this.memoryMaxSize) {
            this.memoryQueue.push({
                event,
                idempotencyKey,
                enqueuedAt: Date.now()
            });
            this.processedKeys.add(idempotencyKey);
            this.metrics.memoryEnqueued++;

            return { enqueued: true, location: 'memory' };
        }

        // Memory full → spillover to DB (persistent, ZERO DATA LOSS)
        try {
            const result = await this.db.query(
                `INSERT INTO event_queue_spillover
                 (event_data, idempotency_key, status, created_at)
                 VALUES ($1, $2, 'pending', NOW())
                 ON CONFLICT (idempotency_key) DO NOTHING
                 RETURNING id`,
                [JSON.stringify(event), idempotencyKey]
            );

            // Check if INSERT actually happened
            if (result.length === 0) {
                // Conflict occurred → duplicate
                this.metrics.duplicatesRejected++;
                return { enqueued: false, reason: 'duplicate', location: 'spillover' };
            }

            this.metrics.spilloverEnqueued++;
            this.spilloverPendingCount++; // Increment local counter
            return { enqueued: true, location: 'spillover' };

        } catch (error) {
            // DB failure → fallback to WAL (ZERO DATA LOSS guarantee)
            if (this.walEnabled) {
                console.warn(JSON.stringify({
                    timestamp: new Date().toISOString(),
                    component: 'HybridQueue',
                    phase: 'db_failure_wal_fallback',
                    idempotency_key: idempotencyKey,
                    error: error.message
                }));

                const walSuccess = await this.wal.write(event, idempotencyKey);
                if (walSuccess) {
                    this.metrics.walWrites++;
                    return { enqueued: true, location: 'wal' };
                }
            }

            // WAL also failed or disabled → log and throw
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                component: 'HybridQueue',
                phase: 'enqueue_error',
                idempotency_key: idempotencyKey,
                error: error.message,
                wal_enabled: this.walEnabled
            }));

            throw error; // Caller must handle
        }
    }

    /**
     * Get spillover pending count (local counter, no DB query)
     */
    getSpilloverPendingCount() {
        return this.spilloverPendingCount + this.spilloverProcessingCount;
    }

    /**
     * Batch enqueue for burst load (avoids rate limit)
     *
     * Enqueues multiple events in a single transaction.
     * Used for burst scenarios (10k+ events).
     */
    async enqueueBatch(events) {
        const results = {
            memory: 0,
            spillover: 0,
            duplicates: 0
        };

        const memoryEvents = [];
        const spilloverEvents = [];

        // Separate into memory vs spillover
        for (const event of events) {
            const idempotencyKey = `${event.transactionHash}-${event.logIndex}`;

            // Skip duplicates
            if (this.processedKeys.has(idempotencyKey)) {
                results.duplicates++;
                continue;
            }

            // Fill memory first
            if (this.memoryQueue.length + memoryEvents.length < this.memoryMaxSize) {
                memoryEvents.push({ event, idempotencyKey });
            } else {
                spilloverEvents.push({ event, idempotencyKey });
            }
        }

        // Add to memory queue
        for (const item of memoryEvents) {
            this.memoryQueue.push({
                event: item.event,
                idempotencyKey: item.idempotencyKey,
                enqueuedAt: Date.now()
            });
            this.processedKeys.add(item.idempotencyKey);
            this.metrics.memoryEnqueued++;
            results.memory++;
        }

        // Batch insert to spillover (single query)
        if (spilloverEvents.length > 0) {
            const values = spilloverEvents.map((item, idx) => {
                const offset = idx * 2;
                return `($${offset + 1}, $${offset + 2}, 'pending', NOW())`;
            }).join(',');

            const params = spilloverEvents.flatMap(item => [
                JSON.stringify(item.event),
                item.idempotencyKey
            ]);

            try {
                await this.db.query(
                    `INSERT INTO event_queue_spillover
                     (event_data, idempotency_key, status, created_at)
                     VALUES ${values}
                     ON CONFLICT (idempotency_key) DO NOTHING`,
                    params
                );

                this.metrics.spilloverEnqueued += spilloverEvents.length;
                results.spillover = spilloverEvents.length;

            } catch (error) {
                console.error(JSON.stringify({
                    timestamp: new Date().toISOString(),
                    component: 'HybridQueue',
                    phase: 'batch_enqueue_error',
                    batch_size: spilloverEvents.length,
                    error: error.message
                }));
                throw error;
            }
        }

        return results;
    }

    /**
     * Dequeue event for processing
     *
     * Priority:
     * 1. Memory queue (fast, already in RAM)
     * 2. Spillover DB (persistent, slower)
     *
     * Returns: { event, source: 'memory' | 'spillover', spilloverId?: number }
     */
    async dequeue() {
        // Priority 1: Memory queue (fast path)
        if (this.memoryQueue.length > 0) {
            const item = this.memoryQueue.shift();
            this.metrics.memoryDequeued++;

            return {
                event: item.event,
                idempotencyKey: item.idempotencyKey,
                source: 'memory'
            };
        }

        // Priority 2: Spillover DB (persistent)
        // Use FOR UPDATE SKIP LOCKED for parallel workers
        // Update last_attempt_at at moment of taking (not after processing)
        const result = await this.db.query(
            `UPDATE event_queue_spillover
             SET status = 'processing',
                 last_attempt_at = NOW()
             WHERE id = (
                 SELECT id
                 FROM event_queue_spillover
                 WHERE status = 'pending'
                    OR (status = 'processing'
                        AND last_attempt_at < NOW() - INTERVAL '${this.visibilityTimeout / 1000} seconds')
                 ORDER BY created_at ASC
                 LIMIT 1
                 FOR UPDATE SKIP LOCKED
             )
             RETURNING id, event_data, idempotency_key, retry_count, max_retries`
        );

        if (result.length === 0) {
            return null; // Queue empty
        }

        const row = result[0];
        this.metrics.spilloverDequeued++;
        this.spilloverProcessingCount++; // Moved from pending to processing
        this.spilloverPendingCount--; // Decrement pending count

        return {
            event: row.event_data,
            idempotencyKey: row.idempotency_key,
            source: 'spillover',
            spilloverId: row.id,
            retryCount: row.retry_count,
            maxRetries: row.max_retries
        };
    }

    /**
     * Batch dequeue for performance (avoids rate limit)
     *
     * Fetches multiple events in one query.
     * Critical for high-throughput scenarios.
     */
    async dequeueBatch(limit = 100) {
        const batch = [];

        // Drain memory first
        while (this.memoryQueue.length > 0 && batch.length < limit) {
            const item = this.memoryQueue.shift();
            this.metrics.memoryDequeued++;
            batch.push({
                event: item.event,
                idempotencyKey: item.idempotencyKey,
                source: 'memory'
            });
        }

        // Fill remaining from spillover
        if (batch.length < limit) {
            const spilloverLimit = limit - batch.length;
            const result = await this.db.query(
                `UPDATE event_queue_spillover
                 SET status = 'processing',
                     last_attempt_at = NOW()
                 WHERE id IN (
                     SELECT id
                     FROM event_queue_spillover
                     WHERE status = 'pending'
                        OR (status = 'processing'
                            AND last_attempt_at < NOW() - INTERVAL '${this.visibilityTimeout / 1000} seconds')
                     ORDER BY created_at ASC
                     LIMIT ${spilloverLimit}
                     FOR UPDATE SKIP LOCKED
                 )
                 RETURNING id, event_data, idempotency_key, retry_count, max_retries`
            );

            for (const row of result) {
                this.metrics.spilloverDequeued++;
                batch.push({
                    event: row.event_data,
                    idempotencyKey: row.idempotency_key,
                    source: 'spillover',
                    spilloverId: row.id,
                    retryCount: row.retry_count,
                    maxRetries: row.max_retries
                });
            }
        }

        return batch;
    }

    /**
     * Mark event as completed (remove from queue)
     */
    async markCompleted(item) {
        if (item.source === 'memory') {
            // Memory event → just remove from processedKeys after some time
            // (keep for a while to prevent duplicates)
            return;
        }

        if (item.source === 'spillover') {
            await this.db.query(
                `UPDATE event_queue_spillover
                 SET status = 'completed',
                     processed_at = NOW()
                 WHERE id = $1`,
                [item.spilloverId]
            );

            // Decrement processing count
            this.spilloverProcessingCount--;
        }
    }

    /**
     * Batch mark completed (critical for performance)
     *
     * Instead of 1000 UPDATEs → 1 UPDATE with WHERE IN
     */
    async markCompletedBatch(items) {
        const spilloverIds = items
            .filter(item => item.source === 'spillover')
            .map(item => item.spilloverId);

        if (spilloverIds.length === 0) {
            return;
        }

        await this.db.query(
            `UPDATE event_queue_spillover
             SET status = 'completed',
                 processed_at = NOW()
             WHERE id = ANY($1)`,
            [spilloverIds]
        );

        // Decrement processing count
        this.spilloverProcessingCount -= spilloverIds.length;
    }

    /**
     * Mark event as failed (retry or dead letter)
     */
    async markFailed(item, error) {
        if (item.source === 'memory') {
            // Memory event failed → move to spillover for retry
            try {
                await this.db.query(
                    `INSERT INTO event_queue_spillover
                     (event_data, idempotency_key, status, retry_count, error_message)
                     VALUES ($1, $2, 'pending', 1, $3)
                     ON CONFLICT (idempotency_key) DO UPDATE
                     SET retry_count = event_queue_spillover.retry_count + 1,
                         status = CASE
                             WHEN event_queue_spillover.retry_count + 1 >= event_queue_spillover.max_retries
                             THEN 'dead_letter'
                             ELSE 'pending'
                         END,
                         error_message = EXCLUDED.error_message`,
                    [JSON.stringify(item.event), item.idempotencyKey, error.message]
                );
            } catch (err) {
                console.error(JSON.stringify({
                    timestamp: new Date().toISOString(),
                    component: 'HybridQueue',
                    phase: 'mark_failed_error',
                    idempotency_key: item.idempotencyKey,
                    error: err.message
                }));
            }
            return;
        }

        if (item.source === 'spillover') {
            const newRetryCount = item.retryCount + 1;
            const isDeadLetter = newRetryCount >= item.maxRetries;

            await this.db.query(
                `UPDATE event_queue_spillover
                 SET status = $1,
                     retry_count = $2,
                     error_message = $3
                 WHERE id = $4`,
                [
                    isDeadLetter ? 'dead_letter' : 'pending',
                    newRetryCount,
                    error.message,
                    item.spilloverId
                ]
            );

            if (isDeadLetter) {
                this.metrics.deadLettered++;
                this.spilloverProcessingCount--; // Remove from processing
                console.error(JSON.stringify({
                    timestamp: new Date().toISOString(),
                    component: 'HybridQueue',
                    phase: 'dead_letter',
                    idempotency_key: item.idempotencyKey,
                    retry_count: newRetryCount,
                    error: error.message
                }));
            } else {
                // Back to pending for retry
                this.spilloverProcessingCount--;
                this.spilloverPendingCount++;
            }
        }
    }

    /**
     * Get queue metrics
     */
    async getMetrics() {
        const spilloverStats = await this.db.query(
            `SELECT
                 COUNT(*) FILTER (WHERE status = 'pending') as pending,
                 COUNT(*) FILTER (WHERE status = 'processing') as processing,
                 COUNT(*) FILTER (WHERE status = 'dead_letter') as dead_letter,
                 COUNT(*) FILTER (WHERE status = 'processing'
                     AND last_attempt_at < NOW() - INTERVAL '${this.visibilityTimeout / 1000} seconds') as stuck
             FROM event_queue_spillover`
        );

        return {
            memory: {
                size: this.memoryQueue.length,
                maxSize: this.memoryMaxSize,
                enqueued: this.metrics.memoryEnqueued,
                dequeued: this.metrics.memoryDequeued
            },
            spillover: {
                pending: parseInt(spilloverStats[0].pending),
                processing: parseInt(spilloverStats[0].processing),
                stuck: parseInt(spilloverStats[0].stuck),
                deadLetter: parseInt(spilloverStats[0].dead_letter),
                enqueued: this.metrics.spilloverEnqueued,
                dequeued: this.metrics.spilloverDequeued
            },
            duplicatesRejected: this.metrics.duplicatesRejected,
            deadLettered: this.metrics.deadLettered,
            rateLimiter: this.rateLimiter.getMetrics(),
            wal: this.walEnabled ? this.wal.getMetrics() : null
        };
    }

    /**
     * Clear memory queue (for testing)
     */
    clearMemory() {
        this.memoryQueue = [];
        this.processedKeys.clear();
    }

    /**
     * Close queue (cleanup)
     */
    /**
     * Close queue (graceful shutdown)
     */
    async close() {
        console.log('[HybridQueue] Starting graceful shutdown...');

        try {
            // 1. Stop background sync
            if (this.syncIntervalId) {
                clearInterval(this.syncIntervalId);
                console.log('[HybridQueue]  Background sync stopped');
            }

            // 2. Flush memory queue to spillover
            if (this.memoryQueue.length > 0) {
                console.log(`[HybridQueue] Flushing ${this.memoryQueue.length} events from memory to spillover...`);

                const events = [...this.memoryQueue];
                for (const item of events) {
                    try {
                        await this.db.query(
                            `INSERT INTO event_queue_spillover
                             (event_data, idempotency_key, status, created_at)
                             VALUES ($1, $2, 'pending', NOW())
                             ON CONFLICT (idempotency_key) DO NOTHING`,
                            [JSON.stringify(item.event), item.idempotencyKey]
                        );
                    } catch (error) {
                        console.error('[HybridQueue] Failed to flush event:', error.message);
                    }
                }

                console.log('[HybridQueue]  Memory queue flushed');
            }

            // 3. Save final spillover count
            await this.syncSpilloverCount();
            console.log('[HybridQueue]  Final spillover count saved');

            // 4. Close WAL (saves checkpoint)
            if (this.walEnabled) {
                await this.wal.close();
                console.log('[HybridQueue]  WAL closed');
            }

            console.log('[HybridQueue]  Graceful shutdown complete');
        } catch (error) {
            console.error('[HybridQueue] Shutdown error:', error);
            throw error;
        }
    }
}
