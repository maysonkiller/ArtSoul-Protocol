#!/usr/bin/env node

/**
 * CHAOS TEST 3: Race Conditions (Concurrent enqueueBatch)
 *
 * Scenario:
 * 1. 10 parallel workers
 * 2. Each enqueues the SAME 100 events (duplicates)
 * 3. Check: how many duplicates got through?
 *
 * Expected: ✅ 0 duplicates (UNIQUE constraint should work)
 */

import HybridQueue from '../src/indexer/hybrid-queue.js';
import PostgreSQLDatabase from '../src/indexer/postgresql-database.js';
import dotenv from 'dotenv';

dotenv.config();

async function chaosTest3() {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        test: 'chaos_race_conditions',
        phase: 'start'
    }));

    const db = new PostgreSQLDatabase({
        connectionString: process.env.DATABASE_URL
    });

    const queue = new HybridQueue(db, {
        memoryMaxSize: 10, // Small memory to force spillover
        visibilityTimeout: 5000,
        maxRetries: 3
    });

    // Clean slate
    await db.query(`DELETE FROM event_queue_spillover`);
    queue.clearMemory();

    // Generate 100 events (will be duplicated 10x)
    const events = [];
    for (let i = 0; i < 100; i++) {
        events.push({
            transactionHash: `0x${'e'.repeat(62)}${i.toString().padStart(2, '0')}`,
            blockNumber: 4000 + i,
            logIndex: 0,
            eventName: 'RaceEvent'
        });
    }

    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        phase: 'setup',
        unique_events: events.length,
        workers: 10,
        total_attempts: events.length * 10
    }));

    // Launch 10 parallel workers, each trying to enqueue the same events
    const workers = [];
    for (let w = 0; w < 10; w++) {
        workers.push(
            (async (workerId) => {
                const workerQueue = new HybridQueue(db, {
                    memoryMaxSize: 10,
                    visibilityTimeout: 5000,
                    maxRetries: 3
                });

                let success = 0;
                let duplicates = 0;

                for (const event of events) {
                    try {
                        const result = await workerQueue.enqueue(event);
                        if (result.enqueued) {
                            success++;
                        } else if (result.reason === 'duplicate') {
                            duplicates++;
                        }
                    } catch (error) {
                        // Ignore errors (likely duplicates)
                    }
                }

                return { workerId, success, duplicates };
            })(w)
        );
    }

    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        phase: 'workers_started',
        message: '10 workers racing to enqueue same events...'
    }));

    const results = await Promise.all(workers);

    // Aggregate results
    const totalSuccess = results.reduce((sum, r) => sum + r.success, 0);
    const totalDuplicates = results.reduce((sum, r) => sum + r.duplicates, 0);

    // Check DB state
    const dbCount = await db.query(
        `SELECT COUNT(*) as count FROM event_queue_spillover`
    );

    const actualCount = parseInt(dbCount[0].count);
    const memoryCount = queue.memoryQueue.length;
    const totalStored = actualCount + memoryCount;

    const duplicatesInDB = totalSuccess - totalStored;
    const success = totalStored === events.length && duplicatesInDB === 0;

    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        phase: 'complete',
        unique_events: events.length,
        total_attempts: events.length * 10,
        total_success_reported: totalSuccess,
        total_duplicates_reported: totalDuplicates,
        stored_in_memory: memoryCount,
        stored_in_db: actualCount,
        total_stored: totalStored,
        duplicates_in_db: duplicatesInDB,
        verdict: success ? '✅ NO DUPLICATES' : '❌ DUPLICATES DETECTED'
    }));

    await db.close();
    process.exit(success ? 0 : 1);
}

chaosTest3().catch(error => {
    console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        phase: 'error',
        error: error.message,
        stack: error.stack
    }));
    process.exit(1);
});
