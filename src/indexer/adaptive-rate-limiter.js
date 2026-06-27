/**
 * Adaptive Rate Limiter (Token Bucket Algorithm)
 *
 * Features:
 * - Token bucket: refills at constant rate
 * - Adaptive backoff: slows down when tokens depleted
 * - Burst support: allows short bursts up to maxTokens
 * - Non-blocking: returns immediately if no tokens
 *
 * Use cases:
 * - Prevent retry storms
 * - Smooth ingestion rate
 * - Protect downstream systems
 */

export default class AdaptiveRateLimiter {
    constructor(config = {}) {
        this.tokensPerSecond = config.tokensPerSecond || 100;
        this.maxTokens = config.maxTokens || this.tokensPerSecond * 2; // Allow 2x burst
        this.tokens = this.maxTokens;
        this.lastRefill = Date.now();

        this.metrics = {
            acquired: 0,
            rejected: 0,
            waited: 0,
            totalWaitTime: 0
        };
    }

    /**
     * Acquire token (blocking with adaptive backoff)
     */
    async acquire() {
        this.refill();

        let waitTime = 0;
        const startTime = Date.now();

        while (this.tokens < 1) {
            // Adaptive backoff: wait longer as queue grows
            const backoffMs = Math.min(100, 10 + waitTime / 10);
            await this.sleep(backoffMs);
            waitTime += backoffMs;

            this.refill();

            // Safety: max wait 5 seconds
            if (Date.now() - startTime > 5000) {
                this.metrics.rejected++;
                throw new Error('Rate limiter timeout: waited 5s for token');
            }
        }

        this.tokens--;
        this.metrics.acquired++;

        if (waitTime > 0) {
            this.metrics.waited++;
            this.metrics.totalWaitTime += waitTime;
        }

        return { acquired: true, waitTime };
    }

    /**
     * Try acquire token (non-blocking)
     */
    tryAcquire() {
        this.refill();

        if (this.tokens < 1) {
            this.metrics.rejected++;
            return { acquired: false, reason: 'no_tokens' };
        }

        this.tokens--;
        this.metrics.acquired++;
        return { acquired: true };
    }

    /**
     * Refill tokens based on elapsed time
     */
    refill() {
        const now = Date.now();
        const elapsed = (now - this.lastRefill) / 1000; // seconds

        if (elapsed > 0) {
            const tokensToAdd = elapsed * this.tokensPerSecond;
            this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
            this.lastRefill = now;
        }
    }

    /**
     * Get current token count
     */
    getTokens() {
        this.refill();
        return Math.floor(this.tokens);
    }

    /**
     * Get metrics
     */
    getMetrics() {
        return {
            ...this.metrics,
            currentTokens: this.getTokens(),
            maxTokens: this.maxTokens,
            tokensPerSecond: this.tokensPerSecond,
            avgWaitTime: this.metrics.waited > 0
                ? (this.metrics.totalWaitTime / this.metrics.waited).toFixed(2)
                : 0
        };
    }

    /**
     * Reset metrics
     */
    resetMetrics() {
        this.metrics = {
            acquired: 0,
            rejected: 0,
            waited: 0,
            totalWaitTime: 0
        };
    }

    /**
     * Sleep helper
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
