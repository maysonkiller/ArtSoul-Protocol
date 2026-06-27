// AuctionMetrics - Metrics collection for AuctionService
// Tracks RPC calls, cache operations, events, and batch execution

class AuctionMetrics {
    constructor() {
        this.rpc = {
            totalCalls: 0,
            successfulCalls: 0,
            failedCalls: 0,
            totalLatency: 0,
            minLatency: Infinity,
            maxLatency: 0,
            batchSizes: [],
            lastReset: Date.now()
        };

        this.cache = {
            hits: 0,
            misses: 0,
            invalidations: 0,
            writes: 0,
            skippedWrites: 0,
            currentSize: 0,
            maxSize: 0,
            lastReset: Date.now()
        };

        this.events = {
            auctionCreated: 0,
            bidPlaced: 0,
            auctionEnded: 0,
            settlementCompleted: 0,
            settlementDefaulted: 0,
            totalInvalidations: 0,
            lastEventTime: null,
            lastReset: Date.now()
        };

        this.batch = {
            totalBatches: 0,
            totalArtworks: 0,
            totalTime: 0,
            minTime: Infinity,
            maxTime: 0,
            batchSizes: [],
            lastReset: Date.now()
        };

        this.circuitBreaker = {
            opens: 0,
            closes: 0,
            rejectedCalls: 0,
            currentState: 'CLOSED',
            lastStateChange: null,
            lastReset: Date.now()
        };

        this.retry = {
            totalRetries: 0,
            successfulRetries: 0,
            failedRetries: 0,
            timeouts: 0,
            lastReset: Date.now()
        };
    }

    // RPC Metrics
    recordRPCCall(success, latency) {
        this.rpc.totalCalls++;
        if (success) {
            this.rpc.successfulCalls++;
        } else {
            this.rpc.failedCalls++;
        }
        this.rpc.totalLatency += latency;
        this.rpc.minLatency = Math.min(this.rpc.minLatency, latency);
        this.rpc.maxLatency = Math.max(this.rpc.maxLatency, latency);
    }

    recordBatchSize(size) {
        this.rpc.batchSizes.push(size);
        // Keep last 100 batch sizes
        if (this.rpc.batchSizes.length > 100) {
            this.rpc.batchSizes.shift();
        }
    }

    // Cache Metrics
    recordCacheHit() {
        this.cache.hits++;
    }

    recordCacheMiss() {
        this.cache.misses++;
    }

    recordCacheWrite(skipped = false) {
        if (skipped) {
            this.cache.skippedWrites++;
        } else {
            this.cache.writes++;
        }
    }

    recordCacheEviction() {
        this.cache.evictions = (this.cache.evictions || 0) + 1;
    }

    recordStaleCacheHit() {
        this.cache.staleCacheHits = (this.cache.staleCacheHits || 0) + 1;
    }

    recordInvalidation() {
        this.cache.invalidations++;
    }

    updateCacheSize(size) {
        this.cache.currentSize = size;
        this.cache.maxSize = Math.max(this.cache.maxSize, size);
    }

    // Event Metrics
    recordEvent(eventType) {
        if (this.events[eventType] !== undefined) {
            this.events[eventType]++;
        }
        this.events.totalInvalidations++;
        this.events.lastEventTime = Date.now();
    }

    // Batch Metrics
    recordBatchExecution(artworks, time) {
        this.batch.totalBatches++;
        this.batch.totalArtworks += artworks;
        this.batch.totalTime += time;
        this.batch.minTime = Math.min(this.batch.minTime, time);
        this.batch.maxTime = Math.max(this.batch.maxTime, time);
        this.batch.batchSizes.push(artworks);
        // Keep last 100 batch sizes
        if (this.batch.batchSizes.length > 100) {
            this.batch.batchSizes.shift();
        }
    }

    // Circuit Breaker Metrics
    recordCircuitBreakerOpen() {
        this.circuitBreaker.opens++;
        this.circuitBreaker.currentState = 'OPEN';
        this.circuitBreaker.lastStateChange = Date.now();
    }

    recordCircuitBreakerClose() {
        this.circuitBreaker.closes++;
        this.circuitBreaker.currentState = 'CLOSED';
        this.circuitBreaker.lastStateChange = Date.now();
    }

    recordCircuitBreakerHalfOpen() {
        this.circuitBreaker.currentState = 'HALF_OPEN';
        this.circuitBreaker.lastStateChange = Date.now();
    }

    recordCircuitBreakerRejection() {
        this.circuitBreaker.rejectedCalls++;
    }

    // Retry Metrics
    recordRetryAttempt(success) {
        this.retry.totalRetries++;
        if (success) {
            this.retry.successfulRetries++;
        } else {
            this.retry.failedRetries++;
        }
    }

    recordTimeout() {
        this.retry.timeouts++;
    }

    // Summary
    getSummary() {
        const now = Date.now();
        const uptimeMs = now - this.rpc.lastReset;

        return {
            rpc: {
                totalCalls: this.rpc.totalCalls,
                successRate: this.rpc.totalCalls > 0
                    ? ((this.rpc.successfulCalls / this.rpc.totalCalls) * 100).toFixed(2)
                    : 0,
                avgLatency: this.rpc.totalCalls > 0
                    ? Math.round(this.rpc.totalLatency / this.rpc.totalCalls)
                    : 0,
                minLatency: this.rpc.minLatency === Infinity ? 0 : this.rpc.minLatency,
                maxLatency: this.rpc.maxLatency,
                avgBatchSize: this.rpc.batchSizes.length > 0
                    ? Math.round(this.rpc.batchSizes.reduce((a, b) => a + b, 0) / this.rpc.batchSizes.length)
                    : 0
            },
            cache: {
                hits: this.cache.hits,
                misses: this.cache.misses,
                hitRate: (this.cache.hits + this.cache.misses) > 0
                    ? ((this.cache.hits / (this.cache.hits + this.cache.misses)) * 100).toFixed(2)
                    : 0,
                invalidations: this.cache.invalidations,
                skippedWrites: this.cache.skippedWrites,
                writeSkipRate: (this.cache.writes + this.cache.skippedWrites) > 0
                    ? ((this.cache.skippedWrites / (this.cache.writes + this.cache.skippedWrites)) * 100).toFixed(2)
                    : 0,
                currentSize: this.cache.currentSize,
                maxSize: this.cache.maxSize,
                staleCacheHits: this.cache.staleCacheHits || 0,
                evictions: this.cache.evictions || 0
            },
            events: {
                auctionCreated: this.events.auctionCreated,
                bidPlaced: this.events.bidPlaced,
                auctionEnded: this.events.auctionEnded,
                settlementCompleted: this.events.settlementCompleted,
                settlementDefaulted: this.events.settlementDefaulted,
                totalInvalidations: this.events.totalInvalidations,
                eventsPerMinute: uptimeMs > 0
                    ? ((this.events.totalInvalidations / (uptimeMs / 60000)).toFixed(2))
                    : 0
            },
            batch: {
                totalBatches: this.batch.totalBatches,
                totalArtworks: this.batch.totalArtworks,
                avgBatchTime: this.batch.totalBatches > 0
                    ? Math.round(this.batch.totalTime / this.batch.totalBatches)
                    : 0,
                minBatchTime: this.batch.minTime === Infinity ? 0 : this.batch.minTime,
                maxBatchTime: this.batch.maxTime,
                throughput: this.batch.totalTime > 0
                    ? ((this.batch.totalArtworks / (this.batch.totalTime / 1000)).toFixed(2))
                    : 0
            },
            circuitBreaker: {
                opens: this.circuitBreaker.opens,
                closes: this.circuitBreaker.closes,
                rejectedCalls: this.circuitBreaker.rejectedCalls,
                currentState: this.circuitBreaker.currentState,
                lastStateChange: this.circuitBreaker.lastStateChange
            },
            retry: {
                totalRetries: this.retry.totalRetries,
                successfulRetries: this.retry.successfulRetries,
                failedRetries: this.retry.failedRetries,
                timeouts: this.retry.timeouts,
                retrySuccessRate: this.retry.totalRetries > 0
                    ? ((this.retry.successfulRetries / this.retry.totalRetries) * 100).toFixed(2)
                    : 0
            },
            uptime: uptimeMs
        };
    }

    reset() {
        const now = Date.now();

        this.rpc = {
            totalCalls: 0,
            successfulCalls: 0,
            failedCalls: 0,
            totalLatency: 0,
            minLatency: Infinity,
            maxLatency: 0,
            batchSizes: [],
            lastReset: now
        };

        this.cache = {
            hits: 0,
            misses: 0,
            invalidations: 0,
            writes: 0,
            skippedWrites: 0,
            currentSize: this.cache.currentSize, // Keep current size
            maxSize: this.cache.maxSize, // Keep max size
            lastReset: now
        };

        this.events = {
            auctionCreated: 0,
            bidPlaced: 0,
            auctionEnded: 0,
            settlementCompleted: 0,
            settlementDefaulted: 0,
            totalInvalidations: 0,
            lastEventTime: this.events.lastEventTime, // Keep last event time
            lastReset: now
        };

        this.batch = {
            totalBatches: 0,
            totalArtworks: 0,
            totalTime: 0,
            minTime: Infinity,
            maxTime: 0,
            batchSizes: [],
            lastReset: now
        };

        this.circuitBreaker = {
            opens: 0,
            closes: 0,
            rejectedCalls: 0,
            currentState: this.circuitBreaker.currentState, // Keep current state
            lastStateChange: this.circuitBreaker.lastStateChange, // Keep last change
            lastReset: now
        };

        this.retry = {
            totalRetries: 0,
            successfulRetries: 0,
            failedRetries: 0,
            timeouts: 0,
            lastReset: now
        };
    }
}

// Export for use in other modules
export default AuctionMetrics;

// Also make available globally for HTML pages
if (typeof window !== 'undefined') {
    window.AuctionMetrics = AuctionMetrics;
}
