#!/usr/bin/env node

/**
 * CHAOS TEST 1 (Revised): DB Connection Failure During Enqueue
 *
 * Scenario:
 * 1. Start enqueuing 1000 events
 * 2. Close DB connection pool at event 500
 * 3. Continue enqueue (should fail)
 * 4. Count: how many events lost?
 *
 * Expected: Events 500-1000 LOST (no retry mechanism)
 */

import HybridQueue from '../src/indexer/hybrid-queue.js';
import PostgreSQLDatabase from '../src/indexer/postgresql-database.js';
import dotenv from 'dotenv';

dotenv.config();

async function chaosTest1Revised() {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        test: 'chaos_db_connection_failure',
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

    // Initialize queue (including WAL)
    await queue.init();

    // Clean slate
    await db.query(`DELETE FROM event_queue_spillover`);
    queue.clearMemory();

    // Generate 1000 events
    const events = [];
    for (let i = 0; i < 1000; i++) {
        events.push({
            transactionHash: `0x${'c'.repeat(62)}${i.toString().padStart(2, '0')}`,
            blockNumber: 2000 + i,
            logIndex: 0,
            eventName: 'ChaosEvent'
        });
    }

    let successCount = 0;
    let failCount = 0;
    let dbClosed = false;

    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        phase: 'enqueue_start',
        total_events: events.length
    }));

    // Enqueue one by one
    for (let i = 0; i < events.length; i++) {
        // Close DB connection at event 500
        if (i === 500 && !dbClosed) {
            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                phase: 'closing_db',
                at_event: i
            }));

            await db.close();
            dbClosed = true;

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                phase: 'db_closed',
                message: 'DB connection closed, continuing enqueue...'
            }));
        }

        try {
            const result = await queue.enqueue(events[i]);
            if (result.enqueued) {
                successCount++;
            }
        } catch (error) {
            failCount++;

            if (failCount === 1) {
                console.log(JSON.stringify({
                    timestamp: new Date().toISOString(),
                    phase: 'first_failure',
                    at_event: i,
                    error: error.message,
                    error_code: error.code
                }));
            }
        }

        if ((i + 1) % 100 === 0) {
            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                phase: 'enqueue_progress',
                processed: i + 1,
                success: successCount,
                failed: failCount
            }));
        }
    }

    const lost = events.length - successCount;

    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        phase: 'complete',
        total_events: events.length,
        enqueued_success: successCount,
        enqueue_failed: failCount,
        lost_events: lost,
        loss_percentage: ((lost / events.length) * 100).toFixed(2) + '%',
        verdict: lost > 0 ? '❌ DATA LOSS DETECTED' : '✅ NO DATA LOSS'
    }));

    process.exit(lost > 0 ? 1 : 0);
}

chaosTest1Revised().catch(error => {
    console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        phase: 'error',
        error: error.message,
        stack: error.stack
    }));
    process.exit(1);
});
