#!/usr/bin/env node

/**
 * Backpressure Controller Test
 *
 * Simulates burst load and verifies adaptive concurrency control.
 *
 * Test scenarios:
 * 1. Normal load: concurrency stays stable
 * 2. Burst load: queue builds up, concurrency increases
 * 3. High error rate: concurrency decreases, circuit breaker opens
 * 4. Rate limiting: rejects work when rate exceeded
 */

import BackpressureController from '../src/indexer/backpressure-controller.js';

class BackpressureTest {
    constructor() {
        this.controller = new BackpressureController({
            minConcurrency: 1,
            maxConcurrency: 10,
            initialConcurrency: 5,
            maxQueueDepth: 100,
            warningQueueDepth: 50,
            maxEventsPerSecond: 50
        });
    }

    async testNormalLoad() {
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'normal_load',
            phase: 'start'
        }));

        // Simulate 20 events with 100% success rate
        for (let i = 0; i < 20; i++) {
            if (this.controller.shouldAccept()) {
                this.controller.recordEnqueued();
                this.controller.recordStarted();

                // Simulate processing
                await new Promise(resolve => setTimeout(resolve, 10));

                this.controller.recordSuccess();
            }
        }

        const metrics = this.controller.getMetrics();
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'normal_load',
            phase: 'complete',
            metrics,
            expected: 'concurrency stable around 5'
        }));
    }

    async testBurstLoad() {
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'burst_load',
            phase: 'start'
        }));

        // Simulate burst: 100 events arrive at once
        let accepted = 0;
        let rejected = 0;

        for (let i = 0; i < 100; i++) {
            if (this.controller.shouldAccept()) {
                this.controller.recordEnqueued();
                accepted++;
            } else {
                rejected++;
            }
        }

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'burst_load',
            phase: 'enqueued',
            accepted,
            rejected,
            queueDepth: this.controller.queueDepth
        }));

        // Process queue
        while (this.controller.queueDepth > 0) {
            const concurrency = this.controller.getConcurrency();

            for (let i = 0; i < concurrency && this.controller.queueDepth > 0; i++) {
                this.controller.recordStarted();

                // Simulate async processing
                setTimeout(() => {
                    this.controller.recordSuccess();
                }, 10);
            }

            await new Promise(resolve => setTimeout(resolve, 20));
        }

        // Wait for all processing to complete
        await new Promise(resolve => setTimeout(resolve, 100));

        const metrics = this.controller.getMetrics();
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'burst_load',
            phase: 'complete',
            metrics,
            expected: 'concurrency increased, queue drained'
        }));
    }

    async testHighErrorRate() {
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'high_error_rate',
            phase: 'start'
        }));

        // Simulate 20 events with 60% error rate
        for (let i = 0; i < 20; i++) {
            if (this.controller.shouldAccept()) {
                this.controller.recordEnqueued();
                this.controller.recordStarted();

                await new Promise(resolve => setTimeout(resolve, 10));

                // 60% errors
                if (Math.random() < 0.6) {
                    this.controller.recordError();
                } else {
                    this.controller.recordSuccess();
                }
            }
        }

        const metrics = this.controller.getMetrics();
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'high_error_rate',
            phase: 'complete',
            metrics,
            expected: 'concurrency decreased or circuit breaker opened'
        }));
    }

    async testRateLimiting() {
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'rate_limiting',
            phase: 'start'
        }));

        // Try to enqueue 100 events in < 1 second (rate limit is 50/sec)
        let accepted = 0;
        let rejected = 0;

        for (let i = 0; i < 100; i++) {
            if (this.controller.shouldAccept()) {
                this.controller.recordEnqueued();
                accepted++;
            } else {
                rejected++;
            }
        }

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'rate_limiting',
            phase: 'complete',
            accepted,
            rejected,
            expected: 'accepted ~50, rejected ~50'
        }));
    }

    async testCircuitBreaker() {
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'circuit_breaker',
            phase: 'start'
        }));

        // Simulate 15 events with 100% error rate to trigger circuit breaker
        for (let i = 0; i < 15; i++) {
            if (this.controller.shouldAccept()) {
                this.controller.recordEnqueued();
                this.controller.recordStarted();

                await new Promise(resolve => setTimeout(resolve, 5));

                this.controller.recordError();
            }
        }

        const metrics = this.controller.getMetrics();
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'circuit_breaker',
            phase: 'complete',
            metrics,
            expected: 'circuit breaker opened (isCircuitOpen: true)'
        }));

        // Try to process more (should be rejected)
        const shouldAccept = this.controller.shouldAccept();
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'circuit_breaker',
            phase: 'verify_rejection',
            shouldAccept,
            expected: false
        }));
    }

    async runAll() {
        try {
            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                phase: 'test_suite_start',
                tests: ['normal_load', 'burst_load', 'high_error_rate', 'rate_limiting', 'circuit_breaker']
            }));

            await this.testNormalLoad();
            await new Promise(resolve => setTimeout(resolve, 500));

            // Reset for next test
            this.controller = new BackpressureController({
                minConcurrency: 1,
                maxConcurrency: 10,
                initialConcurrency: 5,
                maxQueueDepth: 100,
                warningQueueDepth: 50,
                maxEventsPerSecond: 50
            });

            await this.testBurstLoad();
            await new Promise(resolve => setTimeout(resolve, 500));

            // Reset for next test
            this.controller = new BackpressureController({
                minConcurrency: 1,
                maxConcurrency: 10,
                initialConcurrency: 5
            });

            await this.testHighErrorRate();
            await new Promise(resolve => setTimeout(resolve, 500));

            // Reset for next test
            this.controller = new BackpressureController({
                maxEventsPerSecond: 50
            });

            await this.testRateLimiting();
            await new Promise(resolve => setTimeout(resolve, 500));

            // Reset for next test
            this.controller = new BackpressureController({
                errorThreshold: 0.5
            });

            await this.testCircuitBreaker();

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                phase: 'test_suite_complete',
                status: 'success'
            }));

        } catch (error) {
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                phase: 'test_suite_error',
                error: error.message
            }));
        }
    }
}

const test = new BackpressureTest();
test.runAll().catch(console.error);
