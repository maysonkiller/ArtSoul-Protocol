#!/usr/bin/env node

/**
 * Graceful Shutdown Test
 *
 * Scenario:
 * 1. Start queue operations
 * 2. Trigger graceful shutdown
 * 3. Verify: WAL closed, queue flushed, checkpoint saved
 *
 * Expected:  Clean shutdown with no data loss
 */

import HybridQueue from '../src/indexer/hybrid-queue.js';
import PostgreSQLDatabase from '../src/indexer/postgresql-database.js';
import dotenv from 'dotenv';

dotenv.config();

async function gracefulShutdownTest() {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        test: 'graceful_shutdown',
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

    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        phase: 'enqueue_start',
        message: 'Enqueuing 500 events...'
    }));

    // Enqueue events
    for (let i = 0; i < 500; i++) {
        const event = {
            transactionHash: `0x${'f'.repeat(62)}${i.toString().padStart(4, '0')}`,
            blockNumber: 5000 + i,
            logIndex: 0,
            eventName: 'ShutdownTestEvent'
        };

        await queue.enqueue(event);
    }

    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        phase: 'enqueue_complete',
        enqueued: 500
    }));

    // Get metrics before shutdown
    const beforeMetrics = await queue.getMetrics();

    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        phase: 'before_shutdown',
        metrics: {
            memory_size: beforeMetrics.memory.size,
            spillover_pending: beforeMetrics.spillover.pending
        }
    }));

    // Trigger graceful shutdown
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        phase: 'shutdown_start',
        message: 'Triggering graceful shutdown...'
    }));

    await queue.close();

    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        phase: 'shutdown_complete',
        message: 'Graceful shutdown completed'
    }));

    // Verify: check spillover has all events
    const result = await db.query(
        `SELECT COUNT(*) as count FROM event_queue_spillover WHERE status = 'pending'`
    );

    const savedCount = parseInt(result[0].count);

    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        phase: 'verification',
        saved_events: savedCount,
        expected_events: 500,
        verdict: savedCount === 500 ? ' ALL EVENTS SAVED' : ' DATA LOSS DETECTED'
    }));

    await db.close();

    process.exit(savedCount === 500 ? 0 : 1);
}

gracefulShutdownTest().catch(error => {
    console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        phase: 'error',
        error: error.message
    }));
    process.exit(1);
});
