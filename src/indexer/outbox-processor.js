/**
 * Outbox Processor - Side Effects Isolation
 *
 * Ensures external API calls happen only after successful transaction commit.
 * Prevents data inconsistency when transactions rollback but external calls already happened.
 *
 * Pattern:
 * 1. Business logic writes to outbox table INSIDE transaction
 * 2. Transaction commits (or rolls back)
 * 3. Separate processor polls outbox and executes side effects
 * 4. If side effect fails, retry with exponential backoff
 */

export default class OutboxProcessor {
    constructor(db, handlers = {}) {
        this.db = db;
        this.handlers = handlers; // { event_type: async (payload) => {} }
        this.isRunning = false;
        this.pollInterval = null;
        this.pollIntervalMs = 1000; // 1 second
        this.maxRetries = 5;
    }

    /**
     * Start polling for pending outbox events
     */
    start() {
        if (this.isRunning) {
            console.warn('[OutboxProcessor] Already running');
            return;
        }

        this.isRunning = true;
        console.log('[OutboxProcessor] Started');

        // Immediate first poll
        this.processPendingEvents();

        // Then poll on interval
        this.pollInterval = setInterval(() => {
            this.processPendingEvents();
        }, this.pollIntervalMs);
    }

    /**
     * Stop polling
     */
    stop() {
        if (!this.isRunning) {
            return;
        }

        this.isRunning = false;
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }

        console.log('[OutboxProcessor] Stopped');
    }

    /**
     * Process all pending outbox events
     */
    async processPendingEvents() {
        if (!this.isRunning) {
            return;
        }

        try {
            // Fetch pending events + stuck events (visibility timeout)
            // Stuck = processing for >30s (worker probably died)
            const events = await this.db.query(
                `SELECT id, aggregate_type, aggregate_id, event_type, payload,
                        correlation_id, processing_attempts, idempotency_key
                 FROM outbox_events
                 WHERE processing_status = 'pending'
                    OR (processing_status = 'processing'
                        AND last_attempt_at < NOW() - INTERVAL '30 seconds')
                 ORDER BY created_at ASC
                 LIMIT 100
                 FOR UPDATE SKIP LOCKED`
            );

            if (events.length === 0) {
                return;
            }

            console.log(`[OutboxProcessor] Processing ${events.length} pending events`);

            // Process events sequentially to maintain order
            for (const event of events) {
                await this.processEvent(event);
            }
        } catch (error) {
            console.error('[OutboxProcessor] Failed to fetch pending events:', error.message);
        }
    }

    /**
     * Process a single outbox event
     */
    async processEvent(event) {
        const startTime = Date.now();

        try {
            // Mark as processing (with ownership check)
            const lock = await this.db.query(
                `UPDATE outbox_events
                 SET processing_status = 'processing',
                     last_attempt_at = NOW(),
                     processing_attempts = processing_attempts + 1
                 WHERE id = $1 AND processing_status = 'pending'
                 RETURNING id`,
                [event.id]
            );

            // Another processor grabbed it
            if (lock.length === 0) {
                return;
            }

            // Get handler for this event type
            const handler = this.handlers[event.event_type];
            if (!handler) {
                throw new Error(`No handler registered for event type: ${event.event_type}`);
            }

            // Execute side effect
            await handler(event.payload);

            // Mark as completed
            await this.db.query(
                `UPDATE outbox_events
                 SET processing_status = 'completed',
                     processed_at = NOW()
                 WHERE id = $1`,
                [event.id]
            );

            const duration = Date.now() - startTime;
            console.log(JSON.stringify({
                outbox_event_id: event.id,
                event_type: event.event_type,
                aggregate_type: event.aggregate_type,
                aggregate_id: event.aggregate_id,
                correlation_id: event.correlation_id,
                processing_status: 'completed',
                duration_ms: duration,
                phase: 'outbox_processed'
            }));

        } catch (error) {
            const duration = Date.now() - startTime;

            // Determine if should go to DLQ
            const shouldDLQ = event.processing_attempts >= this.maxRetries;

            // Mark as failed or dead
            await this.db.query(
                `UPDATE outbox_events
                 SET processing_status = $1,
                     last_error = $2
                 WHERE id = $3`,
                [shouldDLQ ? 'dead' : 'failed', error.message, event.id]
            );

            console.error(JSON.stringify({
                outbox_event_id: event.id,
                event_type: event.event_type,
                aggregate_type: event.aggregate_type,
                aggregate_id: event.aggregate_id,
                correlation_id: event.correlation_id,
                processing_status: shouldDLQ ? 'dead' : 'failed',
                error_message: error.message,
                processing_attempts: event.processing_attempts + 1,
                duration_ms: duration,
                will_retry: !shouldDLQ,
                phase: 'outbox_failed'
            }));

            // Reset to pending for retry (if not DLQ)
            if (!shouldDLQ) {
                await this.db.query(
                    `UPDATE outbox_events
                     SET processing_status = 'pending'
                     WHERE id = $1`,
                    [event.id]
                );
            }
        }
    }

    /**
     * Retry failed events (manual trigger or scheduled)
     */
    async retryFailedEvents() {
        const events = await this.db.query(
            `UPDATE outbox_events
             SET processing_status = 'pending',
                 last_error = NULL
             WHERE processing_status = 'failed'
             RETURNING id, event_type, aggregate_type, aggregate_id`
        );

        console.log(`[OutboxProcessor] Reset ${events.length} failed events to pending`);
        return events.length;
    }

    /**
     * Get statistics
     */
    async getStats() {
        const stats = await this.db.query(
            `SELECT
                processing_status,
                COUNT(*) as count,
                MIN(created_at) as oldest,
                MAX(created_at) as newest
             FROM outbox_events
             GROUP BY processing_status`
        );

        return stats;
    }
}
