#!/usr/bin/env node

/**
 * CHAOS TEST 2: Worker Crash During Batch Processing
 *
 * Scenario:
 * 1. Enqueue 1000 events to spillover
 * 2. Start dequeue batch processing
 * 3. Kill process at event 500 (process.exit(1))
 * 4. Restart worker
 * 5. Check: are all events recovered via visibility timeout?
 *
 * Expected: ✅ All events recovered (visibility timeout should work)
 */

import HybridQueue from '../src/indexer/hybrid-queue.js';
import PostgreSQLDatabase from '../src/indexer/postgresql-database.js';
import dotenv from 'dotenv';

dotenv.config();

async function chaosTest2() {
    const mode = process.argv[2] || 'crash'; // 'crash' or 'recover'

    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        test: 'chaos_worker_crash',
        mode,
        phase: 'start'
    }));

    const db = new PostgreSQLDatabase({
        connectionString: process.env.DATABASE_URL
    });

    const queue = new HybridQueue(db, {
        memoryMaxSize: 100,
        visibilityTimeout: 5000, // 5s for faster test
        maxRetries: 3
    });

    if (mode === 'crash') {
        // PHASE 1: Setup and crash
        await db.query(`DELETE FROM event_queue_spillover`);
        queue.clearMemory();

        // Enqueue 1000 events (all to spillover)
        const events = [];
        for (let i = 0; i < 1000; i++) {
            events.push({
                transactionHash: `0x${'d'.repeat(62)}${i.toString().padStart(2, '0')}`,
                blockNumber: 3000 + i,
                logIndex: 0,
                eventName: 'CrashEvent'
            });
        }

        await queue.enqueueBatch(events);

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            phase: 'enqueued',
            total: events.length
        }));

        // Start processing
        let processed = 0;

        while (true) {
            const batch = await queue.dequeueBatch(100);
            if (batch.length === 0) break;

            processed += batch.length;

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                phase: 'processing',
                processed
            }));

            // Crash at 500
            if (processed >= 500) {
                console.log(JSON.stringify({
                    timestamp: new Date().toISOString(),
                    phase: 'crash_simulated',
                    processed_before_crash: processed,
                    message: 'Worker crashed! Events stuck in processing state.'
                }));

                // DON'T mark as completed → simulate crash
                await db.close();
                process.exit(1); // Hard crash
            }

            // Mark completed (normal flow)
            await queue.markCompletedBatch(batch);
        }

    } else if (mode === 'recover') {
        // PHASE 2: Recovery after crash
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            phase: 'recovery_start',
            message: 'Worker restarted, waiting for visibility timeout...'
        }));

        // Wait for visibility timeout (5s)
        await new Promise(resolve => setTimeout(resolve, 6000));

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            phase: 'recovery_dequeue',
            message: 'Visibility timeout expired, recovering stuck events...'
        }));

        // Recover all events
        let recovered = 0;

        while (true) {
            const batch = await queue.dequeueBatch(100);
            if (batch.length === 0) break;

            recovered += batch.length;
            await queue.markCompletedBatch(batch);

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                phase: 'recovery_progress',
                recovered
            }));
        }

        // Check final state
        const metrics = await queue.getMetrics();

        const success = metrics.spillover.pending === 0 && metrics.spillover.processing === 0;

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            phase: 'complete',
            recovered,
            spillover_pending: metrics.spillover.pending,
            spillover_processing: metrics.spillover.processing,
            spillover_stuck: metrics.spillover.stuck,
            verdict: success ? '✅ ALL EVENTS RECOVERED' : '❌ EVENTS STILL STUCK'
        }));

        await db.close();
        process.exit(success ? 0 : 1);
    }
}

chaosTest2().catch(error => {
    console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        phase: 'error',
        error: error.message
    }));
    process.exit(1);
});
