#!/usr/bin/env node

/**
 * Crash Simulation Test - Verify Recovery After Unexpected Shutdown
 *
 * Scenario:
 * 1. Start enqueuing events
 * 2. Kill process mid-write (simulate crash)
 * 3. Restart and verify recovery
 * 4. Check: WAL recovery, no data loss
 *
 * Expected:  All events recovered from WAL
 */

import HybridQueue from '../src/indexer/hybrid-queue.js';
import PostgreSQLDatabase from '../src/indexer/postgresql-database.js';
import { spawn } from 'child_process';
import dotenv from 'dotenv';

dotenv.config();

async function crashSimulationTest() {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        test: 'crash_simulation',
        phase: 'start'
    }));

    const db = new PostgreSQLDatabase({
        connectionString: process.env.DATABASE_URL
    });

    const queue = new HybridQueue(db, {
        memoryMaxSize: 100,
        visibilityTimeout: 5000,
        maxRetries: 3,
        wal: {
            maxSegmentSize: 10 * 1024 * 1024,
            maxTotalSize: 100 * 1024 * 1024
        }
    });

    await queue.init();

    // Clean slate
    await db.query(`DELETE FROM event_queue_spillover`);
    queue.clearMemory();
    await queue.wal.clear();

    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        phase: 'setup_complete',
        message: 'Starting crash simulation...'
    }));

    // Phase 1: Enqueue events and crash mid-write
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        phase: 'phase_1',
        message: 'Enqueuing 1000 events, will crash at 500...'
    }));

    let enqueued = 0;

    for (let i = 0; i < 1000; i++) {
        const event = {
            transactionHash: `0x${'d'.repeat(62)}${i.toString().padStart(4, '0')}`,
            blockNumber: 3000 + i,
            logIndex: 0,
            eventName: 'CrashTestEvent'
        };

        try {
            await queue.enqueue(event);
            enqueued++;

            // Simulate crash at event 500
            if (i === 500) {
                console.log(JSON.stringify({
                    timestamp: new Date().toISOString(),
                    phase: 'crash_simulation',
                    at_event: i,
                    message: 'Simulating crash (no graceful shutdown)...'
                }));

                // Force exit without cleanup (simulate crash)
                process.exit(137); // 137 = SIGKILL
            }
        } catch (error) {
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                phase: 'enqueue_error',
                at_event: i,
                error: error.message
            }));
        }
    }

    // This should never be reached (process exits at 500)
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        phase: 'complete',
        enqueued,
        message: 'All events enqueued (no crash occurred)'
    }));

    await queue.close();
    await db.close();
}

async function verifyRecovery() {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        test: 'crash_recovery_verification',
        phase: 'start'
    }));

    const db = new PostgreSQLDatabase({
        connectionString: process.env.DATABASE_URL
    });

    const queue = new HybridQueue(db, {
        memoryMaxSize: 100,
        visibilityTimeout: 5000,
        maxRetries: 3,
        wal: {
            maxSegmentSize: 10 * 1024 * 1024,
            maxTotalSize: 100 * 1024 * 1024
        }
    });

    // Initialize will trigger WAL recovery
    await queue.init();

    // Check how many events were recovered
    const result = await db.query(
        `SELECT COUNT(*) as count FROM event_queue_spillover`
    );

    const recoveredCount = parseInt(result[0].count);

    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        phase: 'recovery_complete',
        recovered_events: recoveredCount,
        expected_events: 500,
        verdict: recoveredCount >= 500 ? ' RECOVERY SUCCESS' : ' DATA LOSS DETECTED'
    }));

    await queue.close();
    await db.close();

    process.exit(recoveredCount >= 500 ? 0 : 1);
}

// Main execution
const mode = process.argv[2];

if (mode === 'verify') {
    verifyRecovery().catch(error => {
        console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            phase: 'error',
            error: error.message
        }));
        process.exit(1);
    });
} else {
    crashSimulationTest().catch(error => {
        console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            phase: 'error',
            error: error.message
        }));
        process.exit(1);
    });
}
