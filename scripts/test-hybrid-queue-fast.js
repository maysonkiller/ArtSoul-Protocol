#!/usr/bin/env node

/**
 * Hybrid Queue Fast Test
 *
 * Focused tests for ZERO DATA LOSS verification:
 * 1. Small burst (1000 events) - memory + spillover
 * 2. Crash simulation - visibility timeout recovery
 * 3. Duplicates - idempotency check
 */

import HybridQueue from '../src/indexer/hybrid-queue.js';
import PostgreSQLDatabase from '../src/indexer/postgresql-database.js';
import dotenv from 'dotenv';

dotenv.config();

class HybridQueueFastTest {
    constructor() {
        this.db = new PostgreSQLDatabase({
            connectionString: process.env.DATABASE_URL
        });
        this.queue = new HybridQueue(this.db, {
            memoryMaxSize: 100,
            visibilityTimeout: 5000,
            maxRetries: 3
        });
    }

    async cleanup() {
        await this.db.query(`DELETE FROM event_queue_spillover WHERE idempotency_key LIKE 'test-%'`);
        this.queue.clearMemory();
    }

    /**
     * TEST 1: Burst Load (1000 events)
     */
    async testBurstLoad() {
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'burst_load',
            phase: 'start'
        }));

        await this.cleanup();

        const events = [];
        for (let i = 0; i < 1000; i++) {
            events.push({
                transactionHash: `0x${'a'.repeat(62)}${i.toString().padStart(2, '0')}`,
                blockNumber: 1000 + i,
                logIndex: 0,
                eventName: 'BurstEvent'
            });
        }

        // Batch enqueue
        const result = await this.queue.enqueueBatch(events);

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'burst_load',
            phase: 'enqueued',
            memory: result.memory,
            spillover: result.spillover,
            expected: 'memory=100, spillover=900'
        }));

        // Dequeue all
        let dequeued = 0;
        while (true) {
            const item = await this.queue.dequeue();
            if (!item) break;
            dequeued++;
            await this.queue.markCompleted(item);
        }

        const success = dequeued === 1000;

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'burst_load',
            phase: 'complete',
            dequeued,
            success,
            expected: 'all 1000 dequeued'
        }));

        return success;
    }

    /**
     * TEST 2: Crash Simulation
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

        // Dequeue 5 (simulate processing)
        for (let i = 0; i < 5; i++) {
            await this.queue.dequeue();
        }

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'crash_simulation',
            phase: 'crash_simulated',
            message: 'Process crashed, 5 events stuck in processing'
        }));

        // Wait for visibility timeout
        await new Promise(resolve => setTimeout(resolve, 6000));

        // Recover
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
            recovered: recovered.length,
            success,
            expected: 'all 10 recovered'
        }));

        return success;
    }

    /**
     * TEST 3: Duplicates
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

        // First enqueue
        const result1 = await this.queue.enqueue(event);

        // Second enqueue (duplicate)
        const result2 = await this.queue.enqueue(event);

        // Dequeue and complete
        const item = await this.queue.dequeue();
        await this.queue.markCompleted(item);

        // Third enqueue (duplicate in spillover)
        const result3 = await this.queue.enqueue(event);

        const metrics = await this.queue.getMetrics();
        const success = result1.enqueued && !result2.enqueued && !result3.enqueued;

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'duplicates',
            phase: 'complete',
            first: result1.enqueued,
            second: result2.enqueued,
            third: result3.enqueued,
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
                tests: ['burst_load', 'crash_simulation', 'duplicates']
            }));

            const results = {
                burst_load: await this.testBurstLoad(),
                crash_simulation: await this.testCrashSimulation(),
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

const test = new HybridQueueFastTest();
test.runAll().catch(console.error);
