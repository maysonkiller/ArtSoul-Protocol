/**
 * Event Queue for Backpressure Control
 *
 * Replaces reject with queue to prevent data loss.
 * Features:
 * - In-memory queue with max size
 * - Overflow strategy (log + metric)
 * - Queue drain on recovery
 * - Integration with BackpressureController
 */

export default class EventQueue {
    constructor(config = {}) {
        this.maxSize = config.maxSize || 10000;
        this.queue = [];
        this.draining = false;
        this.metrics = {
            enqueued: 0,
            dequeued: 0,
            dropped: 0,
            currentSize: 0,
            maxSizeReached: 0
        };

        console.log('[EventQueue] Initialized', {
            maxSize: this.maxSize
        });
    }

    /**
     * Enqueue event (instead of reject)
     */
    enqueue(event) {
        if (this.queue.length >= this.maxSize) {
            // Overflow: log + metric (but don't drop silently)
            this.metrics.dropped++;
            this.metrics.maxSizeReached++;

            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                component: 'EventQueue',
                phase: 'overflow',
                queue_size: this.queue.length,
                max_size: this.maxSize,
                dropped_event: {
                    tx_hash: event.transactionHash,
                    block_number: event.blockNumber
                }
            }));

            return false;
        }

        this.queue.push({
            event,
            enqueuedAt: Date.now()
        });

        this.metrics.enqueued++;
        this.metrics.currentSize = this.queue.length;

        return true;
    }

    /**
     * Dequeue event for processing
     */
    dequeue() {
        if (this.queue.length === 0) {
            return null;
        }

        const item = this.queue.shift();
        this.metrics.dequeued++;
        this.metrics.currentSize = this.queue.length;

        return item.event;
    }

    /**
     * Peek at queue size
     */
    size() {
        return this.queue.length;
    }

    /**
     * Check if queue is empty
     */
    isEmpty() {
        return this.queue.length === 0;
    }

    /**
     * Drain queue with concurrency control
     */
    async drain(processor, backpressureController) {
        if (this.draining) {
            return;
        }

        this.draining = true;

        try {
            while (!this.isEmpty()) {
                const concurrency = backpressureController.getConcurrency();

                if (concurrency === 0) {
                    // Circuit breaker open, pause drain
                    console.log(JSON.stringify({
                        timestamp: new Date().toISOString(),
                        component: 'EventQueue',
                        phase: 'drain_paused',
                        reason: 'circuit_breaker_open',
                        queue_size: this.size()
                    }));
                    break;
                }

                // Process batch with concurrency limit
                const batch = [];
                for (let i = 0; i < concurrency && !this.isEmpty(); i++) {
                    const event = this.dequeue();
                    if (event) {
                        batch.push(event);
                    }
                }

                if (batch.length === 0) {
                    break;
                }

                // Process batch in parallel
                const promises = batch.map(event =>
                    processor(event)
                        .then(() => {
                            backpressureController.recordSuccess();
                        })
                        .catch(error => {
                            backpressureController.recordError();
                            console.error(JSON.stringify({
                                timestamp: new Date().toISOString(),
                                component: 'EventQueue',
                                phase: 'drain_error',
                                event_tx: event.transactionHash,
                                error: error.message
                            }));
                        })
                );

                await Promise.all(promises);

                // Log progress
                if (this.size() % 100 === 0 && this.size() > 0) {
                    console.log(JSON.stringify({
                        timestamp: new Date().toISOString(),
                        component: 'EventQueue',
                        phase: 'drain_progress',
                        queue_size: this.size(),
                        processed: this.metrics.dequeued
                    }));
                }
            }

            if (this.isEmpty()) {
                console.log(JSON.stringify({
                    timestamp: new Date().toISOString(),
                    component: 'EventQueue',
                    phase: 'drain_complete',
                    total_processed: this.metrics.dequeued
                }));
            }

        } finally {
            this.draining = false;
        }
    }

    /**
     * Get queue metrics
     */
    getMetrics() {
        return {
            ...this.metrics,
            currentSize: this.queue.length,
            oldestEventAge: this.queue.length > 0
                ? Date.now() - this.queue[0].enqueuedAt
                : 0
        };
    }

    /**
     * Clear queue (for testing)
     */
    clear() {
        this.queue = [];
        this.metrics.currentSize = 0;
    }
}
