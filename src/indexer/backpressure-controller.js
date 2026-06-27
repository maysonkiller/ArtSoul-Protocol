/**
 * Backpressure Controller
 *
 * Adaptive concurrency control based on system load.
 * Prevents DB/RPC/CPU exhaustion during burst loads.
 *
 * Features:
 * - Dynamic concurrency adjustment (1-10)
 * - Queue depth monitoring
 * - Rate limiting
 * - Circuit breaker pattern
 */

export default class BackpressureController {
    constructor(config = {}) {
        this.minConcurrency = config.minConcurrency || 1;
        this.maxConcurrency = config.maxConcurrency || 10;
        this.currentConcurrency = config.initialConcurrency || 5;

        // Queue depth thresholds
        this.maxQueueDepth = config.maxQueueDepth || 1000;
        this.warningQueueDepth = config.warningQueueDepth || 500;

        // Rate limiting
        this.maxEventsPerSecond = config.maxEventsPerSecond || 100;
        this.eventCount = 0;
        this.lastResetTime = Date.now();

        // Circuit breaker
        this.errorThreshold = config.errorThreshold || 0.5; // 50% error rate
        this.errorWindow = config.errorWindow || 60000; // 1 minute
        this.recentErrors = [];
        this.recentSuccesses = [];
        this.isCircuitOpen = false;

        // Metrics
        this.queueDepth = 0;
        this.processingCount = 0;
        this.totalProcessed = 0;
        this.totalErrors = 0;

        console.log('[BackpressureController] Initialized', {
            minConcurrency: this.minConcurrency,
            maxConcurrency: this.maxConcurrency,
            initialConcurrency: this.currentConcurrency,
            maxQueueDepth: this.maxQueueDepth,
            maxEventsPerSecond: this.maxEventsPerSecond
        });
    }

    /**
     * Get current concurrency limit
     */
    getConcurrency() {
        if (this.isCircuitOpen) {
            return 0; // Stop processing
        }

        return this.currentConcurrency;
    }

    /**
     * Check if should accept new work
     */
    shouldAccept() {
        // Circuit breaker check
        if (this.isCircuitOpen) {
            return false;
        }

        // Queue depth check
        if (this.queueDepth >= this.maxQueueDepth) {
            console.warn('[BackpressureController] Queue depth exceeded, rejecting work', {
                queueDepth: this.queueDepth,
                maxQueueDepth: this.maxQueueDepth
            });
            return false;
        }

        // Rate limit check
        const now = Date.now();
        if (now - this.lastResetTime >= 1000) {
            this.eventCount = 0;
            this.lastResetTime = now;
        }

        if (this.eventCount >= this.maxEventsPerSecond) {
            return false;
        }

        return true;
    }

    /**
     * Record event accepted into queue
     */
    recordEnqueued() {
        this.queueDepth++;
        this.eventCount++;
    }

    /**
     * Record event started processing
     */
    recordStarted() {
        this.queueDepth--;
        this.processingCount++;
    }

    /**
     * Record event completed successfully
     */
    recordSuccess() {
        this.processingCount--;
        this.totalProcessed++;

        const now = Date.now();
        this.recentSuccesses.push(now);

        // Clean old successes
        this.recentSuccesses = this.recentSuccesses.filter(
            time => now - time < this.errorWindow
        );

        // Adjust concurrency up if doing well
        this.adjustConcurrency();
    }

    /**
     * Record event failed
     */
    recordError() {
        this.processingCount--;
        this.totalErrors++;

        const now = Date.now();
        this.recentErrors.push(now);

        // Clean old errors
        this.recentErrors = this.recentErrors.filter(
            time => now - time < this.errorWindow
        );

        // Check circuit breaker
        this.checkCircuitBreaker();

        // Adjust concurrency down on errors
        this.adjustConcurrency();
    }

    /**
     * Adjust concurrency based on system state
     */
    adjustConcurrency() {
        const totalRecent = this.recentErrors.length + this.recentSuccesses.length;
        if (totalRecent === 0) {
            return;
        }

        const errorRate = this.recentErrors.length / totalRecent;

        // Decrease concurrency if error rate high
        if (errorRate > 0.2 && this.currentConcurrency > this.minConcurrency) {
            this.currentConcurrency = Math.max(
                this.minConcurrency,
                Math.floor(this.currentConcurrency * 0.8)
            );
            console.log('[BackpressureController] Decreased concurrency', {
                newConcurrency: this.currentConcurrency,
                errorRate: errorRate.toFixed(2)
            });
        }
        // Increase concurrency if error rate low and queue building up
        else if (errorRate < 0.05 && this.queueDepth > this.warningQueueDepth) {
            if (this.currentConcurrency < this.maxConcurrency) {
                this.currentConcurrency = Math.min(
                    this.maxConcurrency,
                    this.currentConcurrency + 1
                );
                console.log('[BackpressureController] Increased concurrency', {
                    newConcurrency: this.currentConcurrency,
                    queueDepth: this.queueDepth
                });
            }
        }
    }

    /**
     * Check if circuit breaker should open
     */
    checkCircuitBreaker() {
        const totalRecent = this.recentErrors.length + this.recentSuccesses.length;
        if (totalRecent < 10) {
            return; // Not enough data
        }

        const errorRate = this.recentErrors.length / totalRecent;

        if (errorRate >= this.errorThreshold && !this.isCircuitOpen) {
            this.isCircuitOpen = true;
            console.error('[BackpressureController] Circuit breaker OPENED', {
                errorRate: errorRate.toFixed(2),
                recentErrors: this.recentErrors.length,
                recentSuccesses: this.recentSuccesses.length
            });

            // Auto-reset after 30 seconds
            setTimeout(() => {
                this.isCircuitOpen = false;
                this.currentConcurrency = this.minConcurrency;
                console.log('[BackpressureController] Circuit breaker CLOSED (auto-reset)');
            }, 30000);
        }
    }

    /**
     * Get current metrics
     */
    getMetrics() {
        const totalRecent = this.recentErrors.length + this.recentSuccesses.length;
        const errorRate = totalRecent > 0 ? this.recentErrors.length / totalRecent : 0;

        return {
            concurrency: this.currentConcurrency,
            queueDepth: this.queueDepth,
            processingCount: this.processingCount,
            totalProcessed: this.totalProcessed,
            totalErrors: this.totalErrors,
            errorRate: errorRate.toFixed(3),
            isCircuitOpen: this.isCircuitOpen,
            eventsPerSecond: this.eventCount
        };
    }

    /**
     * Reset circuit breaker manually
     */
    resetCircuitBreaker() {
        this.isCircuitOpen = false;
        this.recentErrors = [];
        this.recentSuccesses = [];
        this.currentConcurrency = this.minConcurrency;
        console.log('[BackpressureController] Circuit breaker manually reset');
    }
}
