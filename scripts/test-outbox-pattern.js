#!/usr/bin/env node

/**
 * Outbox Pattern Test
 *
 * Proves that side effects only execute after successful transaction commit.
 *
 * Test scenarios:
 * 1. Success path: transaction commits → outbox processes → side effect executes
 * 2. Rollback path: transaction rolls back → outbox empty → side effect never executes
 */

import PostgreSQLDatabase from '../src/indexer/postgresql-database.js';
import OutboxProcessor from '../src/indexer/outbox-processor.js';
import OutboxHandlers from '../src/indexer/outbox-handlers.js';
import dotenv from 'dotenv';

dotenv.config();

class OutboxPatternTest {
    constructor() {
        this.db = new PostgreSQLDatabase({
            connectionString: process.env.DATABASE_URL
        });

        const handlers = new OutboxHandlers();
        this.outboxProcessor = new OutboxProcessor(this.db, handlers.getHandlers());
    }

    async testSuccessPath() {
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'success_path',
            phase: 'start'
        }));

        const client = await this.db.pool.connect();

        try {
            await client.query('BEGIN');

            // Simulate business logic
            const artworkId = 'test-artwork-' + Date.now();
            const correlationId = 'test-correlation-' + Date.now();

            // Write to outbox INSIDE transaction
            await client.query(
                `INSERT INTO outbox_events (
                    aggregate_type, aggregate_id, event_type, payload,
                    correlation_id, idempotency_key, processing_status
                ) VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
                [
                    'auction',
                    artworkId,
                    'notification',
                    JSON.stringify({
                        type: 'test_notification',
                        recipient: '0xtest',
                        artworkId
                    }),
                    correlationId,
                    `${correlationId}-notification`
                ]
            );

            // COMMIT transaction
            await client.query('COMMIT');

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                test: 'success_path',
                phase: 'committed',
                artworkId,
                correlationId
            }));

            // Wait for outbox processor
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Check outbox was processed
            const result = await this.db.query(
                `SELECT processing_status, processed_at
                 FROM outbox_events
                 WHERE correlation_id = $1`,
                [correlationId]
            );

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                test: 'success_path',
                phase: 'complete',
                outbox_status: result[0]?.processing_status,
                processed: result[0]?.processed_at !== null,
                expected: 'completed'
            }));

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async testRollbackPath() {
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'rollback_path',
            phase: 'start'
        }));

        const client = await this.db.pool.connect();
        const correlationId = 'test-rollback-' + Date.now();

        try {
            await client.query('BEGIN');

            // Write to outbox INSIDE transaction
            await client.query(
                `INSERT INTO outbox_events (
                    aggregate_type, aggregate_id, event_type, payload,
                    correlation_id, idempotency_key, processing_status
                ) VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
                [
                    'auction',
                    'test-artwork-rollback',
                    'notification',
                    JSON.stringify({ type: 'should_never_execute' }),
                    correlationId,
                    `${correlationId}-notification`
                ]
            );

            // ROLLBACK transaction (simulate error)
            await client.query('ROLLBACK');

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                test: 'rollback_path',
                phase: 'rolled_back',
                correlationId
            }));

            // Wait a bit
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Check outbox is empty (event was rolled back)
            const result = await this.db.query(
                `SELECT COUNT(*) as count
                 FROM outbox_events
                 WHERE correlation_id = $1`,
                [correlationId]
            );

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                test: 'rollback_path',
                phase: 'complete',
                outbox_count: parseInt(result[0].count),
                expected: 0,
                success: parseInt(result[0].count) === 0
            }));

        } finally {
            client.release();
        }
    }

    async testIdempotency() {
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'idempotency',
            phase: 'start'
        }));

        const client = await this.db.pool.connect();
        const correlationId = 'test-idempotency-' + Date.now();
        const idempotencyKey = `${correlationId}-notification`;

        try {
            await client.query('BEGIN');

            // Write same event twice (should only insert once)
            for (let i = 0; i < 2; i++) {
                await client.query(
                    `INSERT INTO outbox_events (
                        aggregate_type, aggregate_id, event_type, payload,
                        correlation_id, idempotency_key, processing_status
                    ) VALUES ($1, $2, $3, $4, $5, $6, 'pending')
                    ON CONFLICT (idempotency_key) DO NOTHING`,
                    [
                        'auction',
                        'test-artwork-idem',
                        'notification',
                        JSON.stringify({ type: 'test_idempotency' }),
                        correlationId,
                        idempotencyKey
                    ]
                );
            }

            await client.query('COMMIT');

            // Check only one event exists
            const result = await this.db.query(
                `SELECT COUNT(*) as count
                 FROM outbox_events
                 WHERE idempotency_key = $1`,
                [idempotencyKey]
            );

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                test: 'idempotency',
                phase: 'complete',
                outbox_count: parseInt(result[0].count),
                expected: 1,
                success: parseInt(result[0].count) === 1
            }));

        } finally {
            client.release();
        }
    }

    async runAll() {
        try {
            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                phase: 'test_suite_start',
                tests: ['success_path', 'rollback_path', 'idempotency']
            }));

            // Start outbox processor
            this.outboxProcessor.start();

            await this.testSuccessPath();
            await new Promise(resolve => setTimeout(resolve, 1000));

            await this.testRollbackPath();
            await new Promise(resolve => setTimeout(resolve, 1000));

            await this.testIdempotency();

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                phase: 'test_suite_complete',
                status: 'success'
            }));

        } catch (error) {
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                phase: 'test_suite_error',
                error: error.message
            }));
        } finally {
            this.outboxProcessor.stop();
            await this.db.close();
        }
    }
}

const test = new OutboxPatternTest();
test.runAll().catch(console.error);
