#!/usr/bin/env node

/**
 * CHAOS TEST 4 (Fixed): Queue Overflow with Backpressure
 *
 * Scenario:
 * 1. Fast enqueue: as fast as possible
 * 2. Slow dequeue: 100 events/sec
 * 3. Monitor: queue size growth
 * 4. Check: does backpressure kick in?
 *
 * Expected: ✅ Backpressure prevents unbounded growth
 */

import HybridQueue from '../src/indexer/hybrid-queue.js';
import PostgreSQLDatabase from '../src/indexer/postgresql-database.js';
import dotenv from 'dotenv';

dotenv.config();

async function chaosTest4Fixed() {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        test: 'chaos_queue_overflow_with_backpressure',
        phase: 'start'
    }));

    const db = new PostgreSQLDatabase({
        connectionString: process.env.DATABASE_URL
    });

    const queue = new HybridQueue(db, {
        memoryMaxSize: 100,
        visibilityTimeout: 5000,
        maxRetries: 3,
        backpressureWarning: 500,
        backpressureCritical: 1000
    });

    await queue.init();

    // Clean slate
    await db.query(`DELETE FROM event_queue_spillover`);
    queue.clearMemory();

    let enqueueCount = 0;
    let enqueueSuccess = 0;
    let backpressureRejections = 0;
    let dequeueCount = 0;
    let running = true;

    // Fast producer
    const producer = async () => {
        while (running && enqueueCount < 2000) {
            const event = {
                transactionHash: `0x${'f'.repeat(62)}${enqueueCount.toString().padStart(4, '0')}`,
                blockNumber: 5000 + enqueueCount,
                logIndex: 0,
                eventName: 'OverflowEvent'
            };

            try {
                const result = await queue.enqueue(event);
                if (result.enqueued) {
                    enqueueSuccess++;
                }
                enqueueCount++;
            } catch (error) {
                if (error.message.includes('Backpressure')) {
                    backpressureRejections++;
                    enqueueCount++;
                    // Slow down when backpressure hits
                    await new Promise(resolve => setTimeout(resolve, 10));
                } else {
                    console.error('Producer error:', error.message);
                }
            }
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

                await new Promise(resolve => setTimeout(resolve, 10));
                await queue.markCompleted(item);
                dequeueCount++;
            } catch (error) {
                console.error('Consumer error:', error.message);
            }
        }
    };

    // Monitor
    const monitor = async () => {
        const startTime = Date.now();
        let maxQueueSize = 0;

        while (running) {
            await new Promise(resolve => setTimeout(resolve, 1000));

            const metrics = await queue.getMetrics();
            const queueSize = metrics.memory.size + metrics.spillover.pending;
            maxQueueSize = Math.max(maxQueueSize, queueSize);

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                phase: 'monitor',
                elapsed_sec: elapsed,
                enqueued: enqueueSuccess,
                rejected: backpressureRejections,
                dequeued: dequeueCount,
                queue_size: queueSize,
                max_queue_size: maxQueueSize
            }));

            // Stop after 15s
            if (Date.now() - startTime > 15000) {
                running = false;
            }
        }

        return maxQueueSize;
    };

    // Start all
    const producerPromise = producer();
    const consumerPromise = consumer();
    const maxQueueSize = await monitor();

    running = false;

    await Promise.all([producerPromise, consumerPromise]);

    const finalMetrics = await queue.getMetrics();
    const finalQueueSize = finalMetrics.memory.size + finalMetrics.spillover.pending;

    const success = maxQueueSize < 1500 && backpressureRejections > 0;

    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        phase: 'complete',
        total_attempts: enqueueCount,
        enqueued_success: enqueueSuccess,
        backpressure_rejections: backpressureRejections,
        dequeued: dequeueCount,
        max_queue_size: maxQueueSize,
        final_queue_size: finalQueueSize,
        verdict: success ? '✅ BACKPRESSURE WORKS' : '❌ BACKPRESSURE FAILED'
    }));

    await db.close();
    process.exit(success ? 0 : 1);
}

chaosTest4Fixed().catch(error => {
    console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        phase: 'error',
        error: error.message
    }));
    process.exit(1);
});
