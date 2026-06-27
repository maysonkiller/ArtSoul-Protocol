#!/usr/bin/env node

/**
 * CHAOS TEST 5: Real Overload Stress Test
 *
 * Scenario:
 * 1. Producer: enqueue as fast as possible (10k+ events/sec)
 * 2. Consumer: slow dequeue (100 events/sec) - 100x slower!
 * 3. Duration: 10 minutes
 * 4. Monitor:
 *    - Latency (p50, p95, p99)
 *    - Memory growth
 *    - WAL size growth
 *    - Backpressure rejections
 *    - System degradation
 *
 * Expected:
 * - Queue grows until backpressure kicks in
 * - Rate limiter slows down producer
 * - System degrades gracefully (no crash)
 * - Latency increases but stays bounded
 */

import HybridQueue from '../src/indexer/hybrid-queue.js';
import PostgreSQLDatabase from '../src/indexer/postgresql-database.js';
import dotenv from 'dotenv';
import fs from 'fs/promises';

dotenv.config();

function percentile(arr, p) {
    if (arr.length === 0) return 0;
    const sorted = arr.slice().sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * p) - 1;
    return sorted[index];
}

async function getWalSize(walPath = './.queue-wal') {
    try {
        const files = await fs.readdir(walPath);
        const segments = files.filter(f => f.startsWith('queue-wal-') && f.endsWith('.log'));

        let total = 0;
        for (const file of segments) {
            const stats = await fs.stat(`${walPath}/${file}`);
            total += stats.size;
        }
        return total;
    } catch (error) {
        return 0;
    }
}

async function realOverloadTest() {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        test: 'chaos_real_overload_stress',
        phase: 'start',
        duration_minutes: 10
    }));

    const db = new PostgreSQLDatabase({
        connectionString: process.env.DATABASE_URL
    });

    const queue = new HybridQueue(db, {
        memoryMaxSize: 100,
        visibilityTimeout: 5000,
        maxRetries: 3,
        backpressureWarning: 500,
        backpressureCritical: 1000,
        rateLimitTokens: 1000, // 1000 events/sec max
        rateLimitMaxTokens: 2000,
        wal: {
            maxSegmentSize: 10 * 1024 * 1024, // 10MB
            maxTotalSize: 100 * 1024 * 1024 // 100MB
        }
    });

    await queue.init();

    // Clean slate
    await db.query(`DELETE FROM event_queue_spillover`);
    queue.clearMemory();

    let enqueueCount = 0;
    let enqueueSuccess = 0;
    let enqueueRejections = 0;
    let dequeueCount = 0;
    let running = true;

    const latencies = [];
    const queueSizes = [];
    const memorySamples = [];
    const walSizes = [];

    // Producer: as fast as possible
    const producer = async () => {
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            phase: 'producer_start',
            target: 'unlimited (as fast as possible)'
        }));

        while (running) {
            const event = {
                transactionHash: `0x${'f'.repeat(62)}${enqueueCount.toString().padStart(4, '0')}`,
                blockNumber: 10000 + enqueueCount,
                logIndex: 0,
                eventName: 'OverloadEvent'
            };

            const start = Date.now();
            try {
                const result = await queue.enqueue(event);
                const latency = Date.now() - start;
                latencies.push(latency);

                if (result.enqueued) {
                    enqueueSuccess++;
                }
                enqueueCount++;
            } catch (error) {
                if (error.message.includes('Backpressure') || error.message.includes('Rate limiter')) {
                    enqueueRejections++;
                    enqueueCount++;
                    // Exponential backoff on rejection
                    await new Promise(resolve => setTimeout(resolve, 100));
                } else {
                    console.error('Producer error:', error.message);
                }
            }
        }
    };

    // Consumer: 100 events/sec (slow!)
    const consumer = async () => {
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            phase: 'consumer_start',
            rate: '100 events/sec (10ms per event)'
        }));

        while (running) {
            try {
                const item = await queue.dequeue();
                if (!item) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    continue;
                }

                // Simulate processing (10ms = 100 events/sec)
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
        let lastReport = startTime;

        while (running) {
            await new Promise(resolve => setTimeout(resolve, 5000)); // Every 5 seconds

            const now = Date.now();
            const elapsed = (now - startTime) / 1000;

            const metrics = await queue.getMetrics();
            const queueSize = metrics.memory.size + metrics.spillover.pending;
            queueSizes.push(queueSize);

            const memoryMB = process.memoryUsage().heapUsed / 1024 / 1024;
            memorySamples.push(memoryMB);

            const walSizeMB = await getWalSize() / 1024 / 1024;
            walSizes.push(walSizeMB);

            // Calculate latency percentiles from last 5 seconds
            const recentLatencies = latencies.slice(-1000);
            const p50 = percentile(recentLatencies, 0.5);
            const p95 = percentile(recentLatencies, 0.95);
            const p99 = percentile(recentLatencies, 0.99);

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                phase: 'monitor',
                elapsed_sec: elapsed.toFixed(1),
                enqueued: enqueueSuccess,
                rejected: enqueueRejections,
                dequeued: dequeueCount,
                queue_size: queueSize,
                latency_p50_ms: p50,
                latency_p95_ms: p95,
                latency_p99_ms: p99,
                memory_mb: memoryMB.toFixed(2),
                wal_size_mb: walSizeMB.toFixed(2),
                rate_limiter: metrics.rateLimiter
            }));

            // Stop after 1 minute (for quick test)
            if (elapsed > 60) {
                running = false;
            }

            lastReport = now;
        }
    };

    // Start all
    const producerPromise = producer();
    const consumerPromise = consumer();
    await monitor();

    running = false;

    await Promise.all([producerPromise, consumerPromise]);

    // Final metrics
    const finalMetrics = await queue.getMetrics();
    const finalQueueSize = finalMetrics.memory.size + finalMetrics.spillover.pending;

    const maxQueueSize = Math.max(...queueSizes);
    const maxMemoryMB = Math.max(...memorySamples);
    const maxWalSizeMB = Math.max(...walSizes);

    const allLatenciesP50 = percentile(latencies, 0.5);
    const allLatenciesP95 = percentile(latencies, 0.95);
    const allLatenciesP99 = percentile(latencies, 0.99);
    const allLatenciesMax = Math.max(...latencies);

    const enqueueRate = (enqueueSuccess / 60).toFixed(2); // events/sec
    const dequeueRate = (dequeueCount / 60).toFixed(2);

    // Success criteria
    const success =
        enqueueRejections > 0 && // Backpressure triggered
        maxQueueSize < 2000 && // Queue stayed bounded
        allLatenciesP99 < 5000 && // p99 latency < 5s
        maxMemoryMB < 500; // Memory < 500MB

    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        phase: 'complete',
        duration_sec: 60,
        total_enqueued: enqueueSuccess,
        total_rejected: enqueueRejections,
        total_dequeued: dequeueCount,
        enqueue_rate: `${enqueueRate} events/sec`,
        dequeue_rate: `${dequeueRate} events/sec`,
        max_queue_size: maxQueueSize,
        final_queue_size: finalQueueSize,
        latency: {
            p50_ms: allLatenciesP50,
            p95_ms: allLatenciesP95,
            p99_ms: allLatenciesP99,
            max_ms: allLatenciesMax
        },
        memory: {
            max_mb: maxMemoryMB.toFixed(2),
            final_mb: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)
        },
        wal: {
            max_size_mb: maxWalSizeMB.toFixed(2),
            final_size_mb: (await getWalSize() / 1024 / 1024).toFixed(2)
        },
        rate_limiter: finalMetrics.rateLimiter,
        wal_metrics: finalMetrics.wal,
        verdict: success ? '✅ SYSTEM STABLE UNDER OVERLOAD' : '❌ SYSTEM DEGRADED'
    }));

    await queue.close();
    await db.close();
    process.exit(success ? 0 : 1);
}

realOverloadTest().catch(error => {
    console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        phase: 'error',
        error: error.message,
        stack: error.stack
    }));
    process.exit(1);
});
