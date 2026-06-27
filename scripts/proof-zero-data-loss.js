#!/usr/bin/env node

/**
 * PHASE 2 PROOF: ZERO DATA LOSS
 *
 * Single test: 1000 events → all processed → 0 lost
 */

import HybridQueue from '../src/indexer/hybrid-queue.js';
import PostgreSQLDatabase from '../src/indexer/postgresql-database.js';
import dotenv from 'dotenv';

dotenv.config();

async function proofZeroDataLoss() {
    const db = new PostgreSQLDatabase({
        connectionString: process.env.DATABASE_URL
    });

    const queue = new HybridQueue(db, {
        memoryMaxSize: 100,
        visibilityTimeout: 5000,
        maxRetries: 3
    });

    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        phase: 'start',
        test: 'zero_data_loss_proof'
    }));

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
            eventName: 'TestEvent'
        });
    }

    // ENQUEUE
    const enqueueStart = Date.now();
    const enqueueResult = await queue.enqueueBatch(events);
    const enqueueTime = Date.now() - enqueueStart;

    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        phase: 'enqueued',
        total: events.length,
        memory: enqueueResult.memory,
        spillover: enqueueResult.spillover,
        time_ms: enqueueTime
    }));

    // DEQUEUE (batch mode)
    const dequeueStart = Date.now();
    let totalDequeued = 0;
    let batchCount = 0;

    while (true) {
        const batch = await queue.dequeueBatch(100);
        if (batch.length === 0) break;

        batchCount++;
        totalDequeued += batch.length;

        // Mark all as completed (BATCH - critical for performance)
        await queue.markCompletedBatch(batch);

        if (totalDequeued % 500 === 0) {
            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                phase: 'dequeue_progress',
                processed: totalDequeued
            }));
        }
    }

    const dequeueTime = Date.now() - dequeueStart;

    // FINAL METRICS
    const metrics = await queue.getMetrics();

    // ASSERT
    const lost = events.length - totalDequeued;
    const success = lost === 0 && totalDequeued === events.length;

    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        phase: 'complete',
        enqueued: events.length,
        dequeued: totalDequeued,
        lost,
        batch_count: batchCount,
        enqueue_time_ms: enqueueTime,
        dequeue_time_ms: dequeueTime,
        metrics: {
            memory_enqueued: metrics.memory.enqueued,
            memory_dequeued: metrics.memory.dequeued,
            spillover_enqueued: metrics.spillover.enqueued,
            spillover_dequeued: metrics.spillover.dequeued,
            spillover_pending: metrics.spillover.pending,
            spillover_stuck: metrics.spillover.stuck
        },
        success,
        verdict: success ? ' ZERO DATA LOSS PROVEN' : ' DATA LOSS DETECTED'
    }));

    await db.close();

    if (!success) {
        process.exit(1);
    }
}

proofZeroDataLoss().catch(error => {
    console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        phase: 'error',
        error: error.message,
        stack: error.stack
    }));
    process.exit(1);
});
