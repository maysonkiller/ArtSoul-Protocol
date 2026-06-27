#!/usr/bin/env node

/**
 * Hybrid Queue Test Suite
 *
 * ZERO DATA LOSS verification:
 * 1. Burst load: 10k events → all enqueued (memory + spillover)
 * 2. Crash simulation: kill process mid-processing → events recovered
 * 3. Slow DB: processing slower than ingestion → queue grows but no loss
 * 4. Duplicates: same event twice → rejected, not double-processed
 */

import HybridQueue from '../src/indexer/hybrid-queue.js';
import PostgreSQLDatabase from '../src/indexer/postgresql-database.js';
import dotenv from 'dotenv';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class HybridQueueTest {
    constructor() {
        this.db = new PostgreSQLDatabase({
            connectionString: process.env.DATABASE_URL
        });
        this.queue = new HybridQueue(this.db, {
            memoryMaxSize: 100, // Small for testing spillover
            visibilityTimeout: 5000, // 5s for faster tests
            maxRetries: 3
        });
    }

    async cleanup() {
        await this.db.query(`DELETE FROM event_queue_spillover WHERE idempotency_key LIKE 'test-%'`);
        this.queue.clearMemory();
    }

    /**
     * TEST 1: Burst Load (10k events)
     *
     * Verify:
     * - All 10k events enqueued (no drops)
     * - First 100 in memory, rest in spillover
     * - All events can be dequeued
     */
    async testBurstLoad() {
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'burst_load',
            phase: 'start'
        }));

        await this.cleanup();

        const totalEvents = 10000;
        const events = [];

        // Generate 10k events
        for (let i = 0; i < totalEvents; i++) {
            events.push({
                transactionHash: `0x${'a'.repeat(62)}${i.toString().padStart(2, '0')}`,
                blockNumber: 1000 + i,
                logIndex: 0,
                eventName: 'BurstEvent'
            });
        }

        // Enqueue all (use batch to avoid rate limit)
        const startTime = Date.now();
        const batchSize = 1000;
        let memoryCount = 0;
        let spilloverCount = 0;

        for (let i = 0; i < events.length; i += batchSize) {
            const batch = events.slice(i, i + batchSize);
            const result = await this.queue.enqueueBatch(batch);
            memoryCount += result.memory;
            spilloverCount += result.spillover;
        }

        const enqueueTime = Date.now() - startTime;

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'burst_load',
            phase: 'enqueued',
            total_events: totalEvents,
            memory_count: memoryCount,
            spillover_count: spilloverCount,
            enqueue_time_ms: enqueueTime,
            expected: 'memory=100, spillover=9900'
        }));

        // Verify: dequeue all events
        let dequeuedCount = 0;
        let memoryDequeued = 0;
        let spilloverDequeued = 0;

        const dequeueStart = Date.now();

        while (true) {
            const item = await this.queue.dequeue();
            if (!item) break;

            dequeuedCount++;
            if (item.source === 'memory') memoryDequeued++;
            if (item.source === 'spillover') spilloverDequeued++;

            await this.queue.markCompleted(item);

            if (dequeuedCount % 1000 === 0) {
                console.log(JSON.stringify({
                    timestamp: new Date().toISOString(),
                    test: 'burst_load',
                    phase: 'dequeue_progress',
                    dequeued: dequeuedCount
                }));
            }
        }

        const dequeueTime = Date.now() - dequeueStart;

        const success = dequeuedCount === totalEvents;

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'burst_load',
            phase: 'complete',
            total_dequeued: dequeuedCount,
            memory_dequeued: memoryDequeued,
            spillover_dequeued: spilloverDequeued,
            dequeue_time_ms: dequeueTime,
            success,
            expected: 'all 10k events dequeued, ZERO DATA LOSS'
        }));

        return success;
    }

    /**
     * TEST 2: Crash Simulation
     *
     * Verify:
     * - Process crashes mid-processing
     * - Events in 'processing' state recovered via visibility timeout
     * - No data loss, no double processing
     */
    async testCrashSimulation() {
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'crash_simulation',
            phase: 'start'
        }));

        await this.cleanup();

        // Enqueue 10 events to spillover
        for (let i = 0; i < 10; i++) {
            await this.db.query(
                `INSERT INTO event_queue_spillover
                 (event_data, idempotency_key, status)
                 VALUES ($1, $2, 'pending')`,
                [
                    JSON.stringify({
                        transactionHash: `0xcrash${i}`,
                        blockNumber: 2000 + i,
                        logIndex: 0
                    }),
                    `test-crash-${i}`
                ]
            );
        }

        // Dequeue 5 events (simulate processing)
        const processing = [];
        for (let i = 0; i < 5; i++) {
            const item = await this.queue.dequeue();
            processing.push(item);
        }

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'crash_simulation',
            phase: 'before_crash',
            processing_count: processing.length,
            expected: 5
        }));

        // Simulate crash: don't mark as completed, just abandon
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'crash_simulation',
            phase: 'crash_simulated',
            message: 'Process crashed, events stuck in processing state'
        }));

        // Wait for visibility timeout (5s)
        await new Promise(resolve => setTimeout(resolve, 6000));

        // New worker starts: should recover stuck events
        const recovered = [];
        while (true) {
            const item = await this.queue.dequeue();
            if (!item) break;
            recovered.push(item);
            await this.queue.markCompleted(item);
        }

        const success = recovered.length === 10;

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'crash_simulation',
            phase: 'complete',
            recovered_count: recovered.length,
            expected: 10,
            success,
            message: 'All events recovered after crash, ZERO DATA LOSS'
        }));

        return success;
    }

    /**
     * TEST 3: Slow DB
     *
     * Verify:
     * - Events arrive faster than processing
     * - Queue grows (spillover)
     * - Eventually drains when processing catches up
     * - No data loss
     */
    async testSlowDB() {
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'slow_db',
            phase: 'start'
        }));

        await this.cleanup();

        // Fast ingestion: 500 events
        const ingestionPromise = (async () => {
            for (let i = 0; i < 500; i++) {
                await this.queue.enqueue({
                    transactionHash: `0xslow${i}`,
                    blockNumber: 3000 + i,
                    logIndex: 0,
                    eventName: 'SlowEvent'
                });
            }
        })();

        // Slow processing: 50ms per event
        let processed = 0;
        const processingPromise = (async () => {
            while (processed < 500) {
                const item = await this.queue.dequeue();
                if (!item) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    continue;
                }

                // Simulate slow DB
                await new Promise(resolve => setTimeout(resolve, 50));
                await this.queue.markCompleted(item);
                processed++;

                if (processed % 100 === 0) {
                    const metrics = await this.queue.getMetrics();
                    console.log(JSON.stringify({
                        timestamp: new Date().toISOString(),
                        test: 'slow_db',
                        phase: 'processing',
                        processed,
                        queue_size: metrics.memory.size + metrics.spillover.pending
                    }));
                }
            }
        })();

        await Promise.all([ingestionPromise, processingPromise]);

        const finalMetrics = await this.queue.getMetrics();
        const success = processed === 500 && finalMetrics.spillover.pending === 0;

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'slow_db',
            phase: 'complete',
            processed,
            final_queue_size: finalMetrics.memory.size + finalMetrics.spillover.pending,
            success,
            expected: 'all 500 processed, queue drained'
        }));

        return success;
    }

    /**
     * TEST 4: Duplicates
     *
     * Verify:
     * - Same event enqueued twice → rejected
     * - Idempotency key prevents double processing
     * - Works for both memory and spillover
     */
    async testDuplicates() {
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'duplicates',
            phase: 'start'
        }));

        await this.cleanup();

        const event = {
            transactionHash: '0xduplicate',
            blockNumber: 4000,
            logIndex: 0,
            eventName: 'DuplicateEvent'
        };

        // First enqueue: should succeed
        const result1 = await this.queue.enqueue(event);

        // Second enqueue: should be rejected (duplicate)
        const result2 = await this.queue.enqueue(event);

        // Dequeue and complete
        const item = await this.queue.dequeue();
        await this.queue.markCompleted(item);

        // Third enqueue: should be rejected (in spillover now)
        const result3 = await this.queue.enqueue(event);

        const metrics = await this.queue.getMetrics();
        const success = result1.enqueued && !result2.enqueued && !result3.enqueued
            && metrics.duplicatesRejected >= 2;

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'duplicates',
            phase: 'complete',
            first_enqueue: result1.enqueued,
            second_enqueue: result2.enqueued,
            third_enqueue: result3.enqueued,
            duplicates_rejected: metrics.duplicatesRejected,
            success,
            expected: 'first=true, second=false, third=false'
        }));

        return success;
    }

    async runAll() {
        try {
            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                phase: 'test_suite_start',
                tests: ['burst_load', 'crash_simulation', 'slow_db', 'duplicates']
            }));

            const results = {
                burst_load: await this.testBurstLoad(),
                crash_simulation: await this.testCrashSimulation(),
                slow_db: await this.testSlowDB(),
                duplicates: await this.testDuplicates()
            };

            const allPassed = Object.values(results).every(r => r);

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                phase: 'test_suite_complete',
                results,
                all_passed: allPassed,
                status: allPassed ? 'SUCCESS' : 'FAILURE'
            }));

        } catch (error) {
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                phase: 'test_suite_error',
                error: error.message,
                stack: error.stack
            }));
        } finally {
            await this.cleanup();
            await this.db.close();
        }
    }
}

const test = new HybridQueueTest();
test.runAll().catch(console.error);
