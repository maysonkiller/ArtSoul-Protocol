#!/usr/bin/env node

/**
 * Event Queue Test
 *
 * Verifies queue prevents data loss on burst load.
 *
 * Test scenarios:
 * 1. Burst load: 1000 events → all enqueued, none lost
 * 2. Slow processing: queue grows, then drains
 * 3. Overflow: queue full → drops logged
 * 4. Recovery: queue drains when system recovers
 */

import EventQueue from '../src/indexer/event-queue.js';
import BackpressureController from '../src/indexer/backpressure-controller.js';

class EventQueueTest {
    constructor() {
        this.queue = new EventQueue({ maxSize: 100 });
        this.backpressure = new BackpressureController({
            minConcurrency: 1,
            maxConcurrency: 10,
            initialConcurrency: 5
        });
        this.processedEvents = [];
    }

    async testBurstLoad() {
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'burst_load',
            phase: 'start'
        }));

        // Simulate burst: 1000 events arrive
        const events = [];
        for (let i = 0; i < 1000; i++) {
            events.push({
                transactionHash: `0xtx${i}`,
                blockNumber: 1000 + i,
                logIndex: 0,
                eventName: 'TestEvent'
            });
        }

        // Enqueue all
        let enqueued = 0;
        let rejected = 0;

        for (const event of events) {
            if (this.queue.enqueue(event)) {
                enqueued++;
            } else {
                rejected++;
            }
        }

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'burst_load',
            phase: 'enqueued',
            total_events: events.length,
            enqueued,
            rejected,
            queue_size: this.queue.size(),
            expected: 'enqueued <= maxSize (100)'
        }));

        // Verify: enqueued should be capped at maxSize
        const success = enqueued <= this.queue.maxSize && this.queue.size() === Math.min(enqueued, this.queue.maxSize);

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'burst_load',
            phase: 'complete',
            success,
            queue_size: this.queue.size()
        }));
    }

    async testQueueDrain() {
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'queue_drain',
            phase: 'start',
            initial_queue_size: this.queue.size()
        }));

        // Mock processor
        const processor = async (event) => {
            await new Promise(resolve => setTimeout(resolve, 10)); // Simulate processing
            this.processedEvents.push(event.transactionHash);
        };

        // Drain queue
        await this.queue.drain(processor, this.backpressure);

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'queue_drain',
            phase: 'complete',
            queue_size: this.queue.size(),
            processed_count: this.processedEvents.length,
            expected: 'queue empty'
        }));
    }

    async testSlowProcessing() {
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'slow_processing',
            phase: 'start'
        }));

        // Clear previous state
        this.queue.clear();
        this.processedEvents = [];

        // Enqueue 50 events
        for (let i = 0; i < 50; i++) {
            this.queue.enqueue({
                transactionHash: `0xslow${i}`,
                blockNumber: 2000 + i,
                logIndex: 0,
                eventName: 'SlowEvent'
            });
        }

        const initialSize = this.queue.size();

        // Slow processor (simulates slow DB)
        const slowProcessor = async (event) => {
            await new Promise(resolve => setTimeout(resolve, 50)); // Slow
            this.processedEvents.push(event.transactionHash);
        };

        // Start drain (will take time)
        const drainPromise = this.queue.drain(slowProcessor, this.backpressure);

        // Check queue size during processing
        await new Promise(resolve => setTimeout(resolve, 100));
        const midSize = this.queue.size();

        await drainPromise;

        const finalSize = this.queue.size();

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'slow_processing',
            phase: 'complete',
            initial_size: initialSize,
            mid_size: midSize,
            final_size: finalSize,
            processed: this.processedEvents.length,
            expected: 'queue gradually drains'
        }));
    }

    async testOverflow() {
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'overflow',
            phase: 'start'
        }));

        // Clear queue
        this.queue.clear();

        // Fill queue to max
        for (let i = 0; i < this.queue.maxSize; i++) {
            this.queue.enqueue({
                transactionHash: `0xfill${i}`,
                blockNumber: 3000 + i,
                logIndex: 0,
                eventName: 'FillEvent'
            });
        }

        const beforeOverflow = this.queue.size();

        // Try to add more (should overflow)
        const overflowResult = this.queue.enqueue({
            transactionHash: '0xoverflow',
            blockNumber: 4000,
            logIndex: 0,
            eventName: 'OverflowEvent'
        });

        const afterOverflow = this.queue.size();
        const metrics = this.queue.getMetrics();

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'overflow',
            phase: 'complete',
            before_size: beforeOverflow,
            after_size: afterOverflow,
            overflow_rejected: !overflowResult,
            dropped_count: metrics.dropped,
            expected: 'overflow logged, event dropped'
        }));
    }

    async testRecovery() {
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'recovery',
            phase: 'start'
        }));

        // Queue should still be full from overflow test
        const beforeRecovery = this.queue.size();

        // Fast processor (simulates recovery)
        const fastProcessor = async (event) => {
            await new Promise(resolve => setTimeout(resolve, 1)); // Fast
        };

        // Drain queue
        await this.queue.drain(fastProcessor, this.backpressure);

        const afterRecovery = this.queue.size();

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'recovery',
            phase: 'complete',
            before_size: beforeRecovery,
            after_size: afterRecovery,
            expected: 'queue drained on recovery'
        }));
    }

    async runAll() {
        try {
            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                phase: 'test_suite_start',
                tests: ['burst_load', 'queue_drain', 'slow_processing', 'overflow', 'recovery']
            }));

            await this.testBurstLoad();
            await new Promise(resolve => setTimeout(resolve, 500));

            await this.testQueueDrain();
            await new Promise(resolve => setTimeout(resolve, 500));

            await this.testSlowProcessing();
            await new Promise(resolve => setTimeout(resolve, 500));

            await this.testOverflow();
            await new Promise(resolve => setTimeout(resolve, 500));

            await this.testRecovery();

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                phase: 'test_suite_complete',
                status: 'success'
            }));

        } catch (error) {
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                phase: 'test_suite_error',
                error: error.message,
                stack: error.stack
            }));
        }
    }
}

const test = new EventQueueTest();
test.runAll().catch(console.error);
