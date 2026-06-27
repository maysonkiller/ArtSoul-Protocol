#!/usr/bin/env node

/**
 * CHAOS TEST 1: DB Crash During Enqueue
 *
 * Scenario:
 * 1. Start enqueuing 1000 events
 * 2. Kill PostgreSQL at event 500
 * 3. Continue enqueue (should fail)
 * 4. Count: how many events lost?
 *
 * Expected: Events 500-1000 LOST (current implementation has no retry)
 */

import HybridQueue from '../src/indexer/hybrid-queue.js';
import PostgreSQLDatabase from '../src/indexer/postgresql-database.js';
import { spawn } from 'child_process';
import dotenv from 'dotenv';

dotenv.config();

async function chaosTest1() {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        test: 'chaos_db_crash_during_enqueue',
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

    // Generate 1000 events
    const events = [];
    for (let i = 0; i < 1000; i++) {
        events.push({
            transactionHash: `0x${'a'.repeat(62)}${i.toString().padStart(2, '0')}`,
            blockNumber: 1000 + i,
            logIndex: 0,
            eventName: 'ChaosEvent'
        });
    }

    let successCount = 0;
    let failCount = 0;
    let dbKilled = false;

    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        phase: 'enqueue_start',
        total_events: events.length
    }));

    // Enqueue one by one (to simulate real-time ingestion)
    for (let i = 0; i < events.length; i++) {
        // Kill DB at event 500
        if (i === 500 && !dbKilled) {
            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                phase: 'killing_db',
                at_event: i
            }));

            // Kill PostgreSQL (Windows)
            try {
                spawn('taskkill', ['/F', '/IM', 'postgres.exe'], { shell: true });
                dbKilled = true;

                // Wait a bit for DB to die
                await new Promise(resolve => setTimeout(resolve, 2000));

                console.log(JSON.stringify({
                    timestamp: new Date().toISOString(),
                    phase: 'db_killed',
                    message: 'PostgreSQL killed, continuing enqueue...'
                }));
            } catch (e) {
                console.error('Failed to kill postgres:', e.message);
            }
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
                    error: error.message
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
        verdict: lost > 0 ? '❌ DATA LOSS DETECTED' : '✅ NO DATA LOSS'
    }));

    // Don't try to close DB (it's dead)
    process.exit(lost > 0 ? 1 : 0);
}

chaosTest1().catch(error => {
    console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        phase: 'error',
        error: error.message
    }));
    process.exit(1);
});
