#!/usr/bin/env node

/**
 * Memory Leak Test - 30 Minute Long Run
 *
 * Scenario:
 * 1. Run queue operations continuously for 30 minutes
 * 2. Monitor memory usage every 10 seconds
 * 3. Check for memory leaks (unbounded growth)
 *
 * Expected:  Memory stays bounded (< 500MB)
 */

import HybridQueue from '../src/indexer/hybrid-queue.js';
import PostgreSQLDatabase from '../src/indexer/postgresql-database.js';
import dotenv from 'dotenv';

dotenv.config();

async function memoryLeakTest() {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        test: 'memory_leak_test',
        phase: 'start',
        duration_minutes: 30
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
        wal: {
            maxSegmentSize: 10 * 1024 * 1024,
            maxTotalSize: 100 * 1024 * 1024
        }
    });

    await queue.init();

    // Clean slate
    await db.query(`DELETE FROM event_queue_spillover`);
    queue.clearMemory();

    let enqueueCount = 0;
    let dequeueCount = 0;
    let running = true;

    const memorySamples = [];
    const startTime = Date.now();
    const testDuration = 30 * 60 * 1000; // 30 minutes

    // Producer: enqueue events
    const producer = async () => {
        while (running) {
            const event = {
                transactionHash: `0x${'e'.repeat(62)}${enqueueCount.toString().padStart(4, '0')}`,
                blockNumber: 4000 + enqueueCount,
                logIndex: 0,
                eventName: 'MemoryTestEvent'
            };

            try {
                await queue.enqueue(event);
                enqueueCount++;

                // Small delay to avoid overwhelming
                await new Promise(resolve => setTimeout(resolve, 10));
            } catch (error) {
                // Backpressure or other error
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
    };

    // Consumer: dequeue events
    const consumer = async () => {
        while (running) {
            try {
                const item = await queue.dequeue();
                if (!item) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    continue;
                }

                await queue.markCompleted(item);
                dequeueCount++;

                // Small delay
                await new Promise(resolve => setTimeout(resolve, 10));
            } catch (error) {
                console.error('Consumer error:', error.message);
            }
        }
    };

    // Memory monitor
    const monitor = async () => {
        let lastReport = Date.now();

        while (running) {
            await new Promise(resolve => setTimeout(resolve, 10000)); // Every 10 seconds

            const now = Date.now();
            const elapsed = (now - startTime) / 1000;
            const elapsedMinutes = (elapsed / 60).toFixed(1);

            const memoryUsage = process.memoryUsage();
            const heapUsedMB = (memoryUsage.heapUsed / 1024 / 1024).toFixed(2);
            const heapTotalMB = (memoryUsage.heapTotal / 1024 / 1024).toFixed(2);
            const rssMB = (memoryUsage.rss / 1024 / 1024).toFixed(2);

            memorySamples.push({
                timestamp: new Date().toISOString(),
                elapsed_sec: elapsed,
                heap_used_mb: parseFloat(heapUsedMB),
                heap_total_mb: parseFloat(heapTotalMB),
                rss_mb: parseFloat(rssMB)
            });

            const metrics = await queue.getMetrics();
            const queueSize = metrics.memory.size + metrics.spillover.pending;

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                phase: 'monitor',
                elapsed_minutes: elapsedMinutes,
                enqueued: enqueueCount,
                dequeued: dequeueCount,
                queue_size: queueSize,
                memory: {
                    heap_used_mb: heapUsedMB,
                    heap_total_mb: heapTotalMB,
                    rss_mb: rssMB
                }
            }));

            // Stop after 30 minutes
            if (elapsed >= testDuration / 1000) {
                running = false;
            }
        }
    };

    // Start all
    const producerPromise = producer();
    const consumerPromise = consumer();
    await monitor();

    running = false;

    await Promise.all([producerPromise, consumerPromise]);

    // Analyze memory samples
    const analysis = analyzeMemory(memorySamples);

    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        phase: 'complete',
        duration_minutes: 30,
        total_enqueued: enqueueCount,
        total_dequeued: dequeueCount,
        memory_analysis: analysis,
        verdict: analysis.leak_detected ? ' MEMORY LEAK DETECTED' : ' NO MEMORY LEAK'
    }));

    await queue.close();
    await db.close();

    process.exit(analysis.leak_detected ? 1 : 0);
}

/**
 * Analyze memory samples for leaks
 */
function analyzeMemory(samples) {
    if (samples.length < 2) {
        return {
            leak_detected: false,
            reason: 'insufficient_samples'
        };
    }

    const first = samples[0];
    const last = samples[samples.length - 1];

    const heapGrowth = last.heap_used_mb - first.heap_used_mb;
    const heapGrowthPercent = (heapGrowth / first.heap_used_mb) * 100;

    const maxHeap = Math.max(...samples.map(s => s.heap_used_mb));
    const minHeap = Math.min(...samples.map(s => s.heap_used_mb));
    const avgHeap = samples.reduce((sum, s) => sum + s.heap_used_mb, 0) / samples.length;

    // Check for unbounded growth
    const leakDetected = heapGrowth > 200 || heapGrowthPercent > 100 || maxHeap > 500;

    return {
        leak_detected: leakDetected,
        samples_count: samples.length,
        initial_heap_mb: first.heap_used_mb.toFixed(2),
        final_heap_mb: last.heap_used_mb.toFixed(2),
        heap_growth_mb: heapGrowth.toFixed(2),
        heap_growth_percent: heapGrowthPercent.toFixed(2),
        max_heap_mb: maxHeap.toFixed(2),
        min_heap_mb: minHeap.toFixed(2),
        avg_heap_mb: avgHeap.toFixed(2),
        threshold_exceeded: maxHeap > 500 ? 'max_heap > 500MB' : null
    };
}

memoryLeakTest().catch(error => {
    console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        phase: 'error',
        error: error.message,
        stack: error.stack
    }));
    process.exit(1);
});
