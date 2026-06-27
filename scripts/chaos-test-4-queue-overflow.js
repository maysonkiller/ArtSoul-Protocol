#!/usr/bin/env node

/**
 * CHAOS TEST 4: Queue Overflow (No Backpressure)
 *
 * Scenario:
 * 1. Fast enqueue: 10k events/sec
 * 2. Slow dequeue: 100 events/sec (simulated slow DB)
 * 3. Monitor: queue size growth
 * 4. Check: does system crash or handle gracefully?
 *
 * Expected: ❌ Queue grows unbounded (no backpressure mechanism)
 */

import HybridQueue from '../src/indexer/hybrid-queue.js';
import PostgreSQLDatabase from '../src/indexer/postgresql-database.js';
import dotenv from 'dotenv';

dotenv.config();

async function chaosTest4() {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        test: 'chaos_queue_overflow',
        phase: 'start'
    }));

    const db = new PostgreSQLDatabase({
        connectionString: process.env.DATABASE_URL
    });

    const queue = new HybridQueue(db, {
        memoryMaxSize: 100,
        visibilityTimeout: 5000,
        maxRetries: 3
    });

    // Clean slate
    await db.query(`DELETE FROM event_queue_spillover`);
    queue.clearMemory();

    let enqueueCount = 0;
    let dequeueCount = 0;
    let running = true;

    // Fast producer (10k events/sec target)
    const producer = async () => {
        while (running && enqueueCount < 5000) {
            const event = {
                transactionHash: `0x${'f'.repeat(62)}${enqueueCount.toString().padStart(4, '0')}`,
                blockNumber: 5000 + enqueueCount,
                logIndex: 0,
                eventName: 'OverflowEvent'
            };

            try {
                await queue.enqueue(event);
                enqueueCount++;
            } catch (error) {
                console.error(JSON.stringify({
                    timestamp: new Date().toISOString(),
                    phase: 'producer_error',
                    error: error.message
                }));
            }

            // No delay → as fast as possible
        }
    };

    // Slow consumer (100 events/sec)
    const consumer = async () => {
        while (running) {
            try {
                const item = await queue.dequeue();
                if (!item) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    continue;
                }

                // Simulate slow processing (10ms per event = 100 events/sec)
                await new Promise(resolve => setTimeout(resolve, 10));
                await queue.markCompleted(item);
                dequeueCount++;
            } catch (error) {
                console.error(JSON.stringify({
                    timestamp: new Date().toISOString(),
                    phase: 'consumer_error',
                    error: error.message
                }));
            }
        }
    };

    // Monitor queue size
    const monitor = async () => {
        const startTime = Date.now();
        while (running) {
            await new Promise(resolve => setTimeout(resolve, 1000));

            const metrics = await queue.getMetrics();
            const queueSize = metrics.memory.size + metrics.spillover.pending;
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                phase: 'monitor',
                elapsed_sec: elapsed,
                enqueued: enqueueCount,
                dequeued: dequeueCount,
                queue_size: queueSize,
                memory_size: metrics.memory.size,
                spillover_pending: metrics.spillover.pending,
                rate_in: (enqueueCount / elapsed).toFixed(0),
                rate_out: (dequeueCount / elapsed).toFixed(0)
            }));

            // Stop if queue grows too large (safety)
            if (queueSize > 10000) {
                console.log(JSON.stringify({
                    timestamp: new Date().toISOString(),
                    phase: 'safety_stop',
                    reason: 'queue_size_exceeded_10k',
                    queue_size: queueSize
                }));
                running = false;
            }
        }
    };

    // Start all
    const producerPromise = producer();
    const consumerPromise = consumer();
    const monitorPromise = monitor();

    // Wait for producer to finish or timeout
    await Promise.race([
        producerPromise,
        new Promise(resolve => setTimeout(() => {
            running = false;
            resolve();
        }, 30000)) // 30s timeout
    ]);

    running = false;

    await Promise.all([consumerPromise, monitorPromise]);

    const finalMetrics = await queue.getMetrics();
    const finalQueueSize = finalMetrics.memory.size + finalMetrics.spillover.pending;

    const success = finalQueueSize < 1000; // Arbitrary threshold

    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        phase: 'complete',
        total_enqueued: enqueueCount,
        total_dequeued: dequeueCount,
        final_queue_size: finalQueueSize,
        lost: enqueueCount - dequeueCount - finalQueueSize,
        verdict: success ? '✅ QUEUE BOUNDED' : '❌ QUEUE UNBOUNDED'
    }));

    await db.close();
    process.exit(success ? 0 : 1);
}

chaosTest4().catch(error => {
    console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        phase: 'error',
        error: error.message
    }));
    process.exit(1);
});
