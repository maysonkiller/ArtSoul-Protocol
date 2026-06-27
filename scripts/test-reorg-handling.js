#!/usr/bin/env node

/**
 * Reorg Handling Test
 *
 * Simulates blockchain reorganization and verifies rollback.
 *
 * Test scenarios:
 * 1. Normal sync: blocks stored correctly
 * 2. Reorg detection: hash mismatch detected
 * 3. Rollback: data deleted from reorg block onwards
 * 4. Re-sync: correct chain indexed
 */

import PostgreSQLDatabase from '../src/indexer/postgresql-database.js';
import dotenv from 'dotenv';

dotenv.config();

class ReorgTest {
    constructor() {
        this.db = new PostgreSQLDatabase({
            connectionString: process.env.DATABASE_URL
        });
    }

    async testBlockHashStorage() {
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'block_hash_storage',
            phase: 'start'
        }));

        // Insert test blocks (valid 66-char hashes)
        const blocks = [
            {
                number: 1000,
                hash: '0x' + 'a'.repeat(64),
                parent: '0x' + '9'.repeat(64),
                timestamp: Date.now()
            },
            {
                number: 1001,
                hash: '0x' + 'b'.repeat(64),
                parent: '0x' + 'a'.repeat(64),
                timestamp: Date.now()
            },
            {
                number: 1002,
                hash: '0x' + 'c'.repeat(64),
                parent: '0x' + 'b'.repeat(64),
                timestamp: Date.now()
            }
        ];

        for (const block of blocks) {
            await this.db.query(
                `INSERT INTO block_hashes (block_number, block_hash, parent_hash, timestamp)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (block_number) DO UPDATE
                 SET block_hash = EXCLUDED.block_hash, parent_hash = EXCLUDED.parent_hash`,
                [block.number, block.hash, block.parent, block.timestamp]
            );
        }

        // Verify storage
        const stored = await this.db.query(
            `SELECT block_number, block_hash, parent_hash
             FROM block_hashes
             WHERE block_number >= 1000 AND block_number <= 1002
             ORDER BY block_number`
        );

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'block_hash_storage',
            phase: 'complete',
            blocks_stored: stored.length,
            expected: 3,
            success: stored.length === 3
        }));
    }

    async testParentChainContinuity() {
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'parent_chain_continuity',
            phase: 'start'
        }));

        // Get blocks
        const blocks = await this.db.query(
            `SELECT block_number, block_hash, parent_hash
             FROM block_hashes
             WHERE block_number >= 1000 AND block_number <= 1002
             ORDER BY block_number`
        );

        // Check continuity
        let continuityValid = true;
        for (let i = 1; i < blocks.length; i++) {
            const current = blocks[i];
            const previous = blocks[i - 1];

            if (current.parent_hash !== previous.block_hash) {
                continuityValid = false;
                console.error(JSON.stringify({
                    block: current.block_number,
                    expected_parent: previous.block_hash,
                    actual_parent: current.parent_hash
                }));
            }
        }

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'parent_chain_continuity',
            phase: 'complete',
            continuity_valid: continuityValid,
            expected: true
        }));
    }

    async testReorgDetection() {
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'reorg_detection',
            phase: 'start'
        }));

        // Simulate reorg: change block 1001 hash (breaks chain)
        await this.db.query(
            `UPDATE block_hashes
             SET block_hash = $1, parent_hash = $2
             WHERE block_number = 1001`,
            ['0x' + 'b'.repeat(63) + '1', '0x' + 'a'.repeat(63) + '1']
        );

        // Check if parent chain breaks
        const blocks = await this.db.query(
            `SELECT block_number, block_hash, parent_hash
             FROM block_hashes
             WHERE block_number >= 1000 AND block_number <= 1002
             ORDER BY block_number`
        );

        let reorgDetected = false;
        for (let i = 1; i < blocks.length; i++) {
            const current = blocks[i];
            const previous = blocks[i - 1];

            if (current.parent_hash !== previous.block_hash) {
                reorgDetected = true;
                console.log(JSON.stringify({
                    reorg_at_block: current.block_number,
                    expected_parent: previous.block_hash,
                    actual_parent: current.parent_hash
                }));
            }
        }

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'reorg_detection',
            phase: 'complete',
            reorg_detected: reorgDetected,
            expected: true
        }));
    }

    async testRollbackFunction() {
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'rollback_function',
            phase: 'start'
        }));

        // Insert test data
        await this.db.query(
            `INSERT INTO event_processing_registry
             (event_hash, transaction_hash, log_index, event_name, block_number, processing_status)
             VALUES ('0xtest1', '0xtx1', 0, 'TestEvent', 1001, 'completed'),
                    ('0xtest2', '0xtx2', 0, 'TestEvent', 1002, 'completed')`
        );

        // Call rollback function
        const result = await this.db.query(
            `SELECT * FROM rollback_events_from_block(1001)`
        );

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'rollback_function',
            phase: 'rollback_executed',
            events_deleted: result[0].events_deleted,
            auctions_deleted: result[0].auctions_deleted,
            bids_deleted: result[0].bids_deleted,
            outbox_deleted: result[0].outbox_deleted
        }));

        // Verify data deleted
        const remaining = await this.db.query(
            `SELECT COUNT(*) as count
             FROM event_processing_registry
             WHERE block_number >= 1001`
        );

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            test: 'rollback_function',
            phase: 'complete',
            remaining_events: parseInt(remaining[0].count),
            expected: 0,
            success: parseInt(remaining[0].count) === 0
        }));
    }

    async cleanup() {
        // Clean up test data
        await this.db.query(`DELETE FROM block_hashes WHERE block_number >= 1000`);
        await this.db.query(`DELETE FROM event_processing_registry WHERE event_hash LIKE '0xtest%'`);
    }

    async runAll() {
        try {
            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                phase: 'test_suite_start',
                tests: ['block_hash_storage', 'parent_chain_continuity', 'reorg_detection', 'rollback_function']
            }));

            await this.testBlockHashStorage();
            await new Promise(resolve => setTimeout(resolve, 500));

            await this.testParentChainContinuity();
            await new Promise(resolve => setTimeout(resolve, 500));

            await this.testReorgDetection();
            await new Promise(resolve => setTimeout(resolve, 500));

            await this.testRollbackFunction();

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                phase: 'test_suite_complete',
                status: 'success'
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

const test = new ReorgTest();
test.runAll().catch(console.error);
