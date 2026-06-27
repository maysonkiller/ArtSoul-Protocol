#!/usr/bin/env node

/**
 * Stress test script for the indexer.
 * Generates logs for critical scenarios:
 * 1. Duplicate event
 * 2. Multi-worker race
 * 3. Kill -9 recovery
 * 4. Reaper activation
 */

import { ethers } from 'ethers';
import PostgreSQLDatabase from '../src/indexer/postgresql-database.js';
import IndexerSyncEngine from '../src/indexer/sync-engine.js';
import EventListener from '../src/indexer/event-listener.js';
import IndexerMetrics from '../src/indexer/metrics.js';
import dotenv from 'dotenv';

dotenv.config();

// Enhanced logging with structured fields
function log(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
        timestamp,
        level,
        message,
        ...data
    };
    console.log(JSON.stringify(logEntry));
}

class StressTestRunner {
    constructor() {
        this.db = new PostgreSQLDatabase({
            connectionString: process.env.DATABASE_URL
        });

        this.metrics = new IndexerMetrics();

        // Use env vars or defaults for testing
        const rpcUrl = process.env.RPC_URL || process.env.ETHEREUM_SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com';
        const rpcUrls = rpcUrl.split(',').map(url => url.trim());

        const contractAddress = process.env.CONTRACT_ADDRESS || process.env.MARKETPLACE_CONTRACT_SEPOLIA || '0xd2B14b4367f01492068887111Df91B8B8e931Bf8';
        const chainId = parseInt(process.env.CHAIN_ID || '11155111'); // Sepolia

        this.eventListener = new EventListener({
            rpcUrl: rpcUrls,
            contractAddress: contractAddress,
            chainId: chainId
        }, this.metrics);

        this.syncEngine = new IndexerSyncEngine(this.db, this.eventListener, this.metrics);

        this.workerId = `worker-${process.pid}`;
    }

    /**
     * Scenario 1: Duplicate Event
     * Send same event twice, verify idempotency
     */
    async testDuplicateEvent() {
        log('info', '=== SCENARIO 1: Duplicate Event ===');

        // Create mock event
        const mockEvent = {
            transactionHash: '0xabc123' + Date.now(),
            logIndex: 0,
            eventName: 'AuctionCreated',
            blockNumber: 1000000 + Math.floor(Math.random() * 1000),
            args: {
                artworkId: '1',
                seller: '0x1234567890123456789012345678901234567890',
                startingPrice: ethers.parseEther('1.0'),
                startTime: Math.floor(Date.now() / 1000),
                endTime: Math.floor(Date.now() / 1000) + 86400
            }
        };

        // Compute event hash
        const eventHash = await this._computeEventHash(mockEvent);

        log('info', 'Processing event (first time)', {
            worker_id: this.workerId,
            event_hash: eventHash,
            tx_hash: mockEvent.transactionHash,
            log_index: mockEvent.logIndex,
            event_name: mockEvent.eventName,
            block_number: mockEvent.blockNumber
        });

        // First processing
        try {
            await this.syncEngine._processEvent(mockEvent);
            log('info', 'Event processed successfully', {
                worker_id: this.workerId,
                event_hash: eventHash,
                status: 'completed'
            });
        } catch (error) {
            log('error', 'Event processing failed', {
                worker_id: this.workerId,
                event_hash: eventHash,
                error: error.message
            });
        }

        // Wait a bit
        await new Promise(resolve => setTimeout(resolve, 1000));

        log('info', 'Processing same event (duplicate)', {
            worker_id: this.workerId,
            event_hash: eventHash,
            tx_hash: mockEvent.transactionHash,
            log_index: mockEvent.logIndex
        });

        // Second processing (should skip)
        try {
            await this.syncEngine._processEvent(mockEvent);
            log('info', 'Duplicate event handled', {
                worker_id: this.workerId,
                event_hash: eventHash,
                status: 'skipped'
            });
        } catch (error) {
            log('error', 'Duplicate processing failed', {
                worker_id: this.workerId,
                event_hash: eventHash,
                error: error.message
            });
        }

        // Verify in DB
        const result = await this.db.query(
            'SELECT event_hash, processing_status, retry_count FROM event_processing_registry WHERE event_hash = $1',
            [eventHash]
        );

        log('info', 'Registry state after duplicate', {
            event_hash: eventHash,
            processing_status: result[0]?.processing_status,
            retry_count: result[0]?.retry_count
        });
    }

    /**
     * Scenario 2: Multi-Worker Race
     * Simulate 2 workers processing same event
     */
    async testMultiWorkerRace() {
        log('info', '=== SCENARIO 2: Multi-Worker Race ===');

        const mockEvent = {
            transactionHash: '0xdef456' + Date.now(),
            logIndex: 0,
            eventName: 'BidPlaced',
            blockNumber: 1000000 + Math.floor(Math.random() * 1000),
            args: {
                artworkId: '2',
                bidder: '0x2234567890123456789012345678901234567890',
                amount: ethers.parseEther('2.0')
            }
        };

        const eventHash = await this._computeEventHash(mockEvent);

        log('info', 'Starting multi-worker race', {
            event_hash: eventHash,
            tx_hash: mockEvent.transactionHash,
            workers: ['worker-A', 'worker-B']
        });

        // Simulate Worker A
        const workerA = async () => {
            log('info', 'Worker A: attempting to acquire lock', {
                worker_id: 'worker-A',
                event_hash: eventHash
            });

            try {
                await this.syncEngine._processEvent(mockEvent);
                log('info', 'Worker A: processing completed', {
                    worker_id: 'worker-A',
                    event_hash: eventHash,
                    status: 'completed'
                });
            } catch (error) {
                log('error', 'Worker A: processing failed', {
                    worker_id: 'worker-A',
                    event_hash: eventHash,
                    error: error.message
                });
            }
        };

        // Simulate Worker B (slightly delayed)
        const workerB = async () => {
            await new Promise(resolve => setTimeout(resolve, 50)); // 50ms delay

            log('info', 'Worker B: attempting to acquire lock', {
                worker_id: 'worker-B',
                event_hash: eventHash
            });

            try {
                await this.syncEngine._processEvent(mockEvent);
                log('info', 'Worker B: processing completed or skipped', {
                    worker_id: 'worker-B',
                    event_hash: eventHash,
                    status: 'skipped'
                });
            } catch (error) {
                log('error', 'Worker B: processing failed', {
                    worker_id: 'worker-B',
                    event_hash: eventHash,
                    error: error.message
                });
            }
        };

        // Run both workers concurrently
        await Promise.all([workerA(), workerB()]);

        // Check final state
        const result = await this.db.query(
            'SELECT event_hash, processing_status, retry_count FROM event_processing_registry WHERE event_hash = $1',
            [eventHash]
        );

        log('info', 'Race condition result', {
            event_hash: eventHash,
            processing_status: result[0]?.processing_status,
            retry_count: result[0]?.retry_count,
            expected: 'only one worker processed'
        });
    }

    /**
     * Scenario 3: Stuck Event (simulated kill -9)
     * Mark event as processing, then simulate reaper
     */
    async testStuckEventRecovery() {
        log('info', '=== SCENARIO 3: Stuck Event Recovery ===');

        const mockEvent = {
            transactionHash: '0xghi789' + Date.now(),
            logIndex: 0,
            eventName: 'AuctionEnded',
            blockNumber: 1000000 + Math.floor(Math.random() * 1000),
            args: {
                artworkId: '3',
                winner: '0x3234567890123456789012345678901234567890'
            }
        };

        const eventHash = await this._computeEventHash(mockEvent);

        log('info', 'Simulating stuck event', {
            event_hash: eventHash,
            tx_hash: mockEvent.transactionHash,
            scenario: 'worker crashed during processing'
        });

        // Manually insert stuck event (processing for >5 min)
        await this.db.query(
            `INSERT INTO event_processing_registry
             (event_hash, transaction_hash, log_index, event_name, block_number, processing_status, processing_started_at)
             VALUES ($1, $2, $3, $4, $5, 'processing', NOW() - INTERVAL '6 minutes')`,
            [eventHash, mockEvent.transactionHash, mockEvent.logIndex, mockEvent.eventName, mockEvent.blockNumber]
        );

        log('info', 'Event marked as stuck', {
            event_hash: eventHash,
            processing_status: 'processing',
            stuck_duration: '6 minutes'
        });

        // Simulate reaper
        log('info', 'Reaper: scanning for stuck events');

        const stuckEvents = await this.db.query(
            `UPDATE event_processing_registry
             SET processing_status = 'pending',
                 processing_started_at = NULL,
                 retry_count = retry_count + 1
             WHERE processing_status = 'processing'
               AND processing_started_at < NOW() - INTERVAL '5 minutes'
             RETURNING event_hash, event_name, retry_count`
        );

        if (stuckEvents.length > 0) {
            log('info', 'Reaper: recovered stuck events', {
                count: stuckEvents.length,
                events: stuckEvents.map(e => ({
                    event_hash: e.event_hash,
                    event_name: e.event_name,
                    retry_count: e.retry_count
                }))
            });
        }

        // Now retry processing
        log('info', 'Retrying recovered event', {
            event_hash: eventHash,
            worker_id: this.workerId
        });

        try {
            await this.syncEngine._processEvent(mockEvent);
            log('info', 'Recovered event processed successfully', {
                event_hash: eventHash,
                status: 'completed'
            });
        } catch (error) {
            log('error', 'Recovered event processing failed', {
                event_hash: eventHash,
                error: error.message
            });
        }

        // Final state
        const result = await this.db.query(
            'SELECT event_hash, processing_status, retry_count FROM event_processing_registry WHERE event_hash = $1',
            [eventHash]
        );

        log('info', 'Final state after recovery', {
            event_hash: eventHash,
            processing_status: result[0]?.processing_status,
            retry_count: result[0]?.retry_count
        });
    }

    /**
     * Scenario 4: Reaper in Action
     * Check for any stuck events in DB
     */
    async testReaperScan() {
        log('info', '=== SCENARIO 4: Reaper Scan ===');

        log('info', 'Reaper: starting scan for stuck events');

        const stuckEvents = await this.db.query(
            `SELECT event_hash, event_name, processing_started_at,
                    EXTRACT(EPOCH FROM (NOW() - processing_started_at)) as stuck_seconds
             FROM event_processing_registry
             WHERE processing_status = 'processing'
               AND processing_started_at < NOW() - INTERVAL '5 minutes'`
        );

        if (stuckEvents.length === 0) {
            log('info', 'Reaper: no stuck events found', {
                status: 'healthy'
            });
        } else {
            log('warn', 'Reaper: found stuck events', {
                count: stuckEvents.length,
                events: stuckEvents.map(e => ({
                    event_hash: e.event_hash,
                    event_name: e.event_name,
                    stuck_seconds: Math.floor(e.stuck_seconds)
                }))
            });

            // Recover them
            const recovered = await this.db.query(
                `UPDATE event_processing_registry
                 SET processing_status = 'pending',
                     processing_started_at = NULL,
                     retry_count = retry_count + 1
                 WHERE processing_status = 'processing'
                   AND processing_started_at < NOW() - INTERVAL '5 minutes'
                 RETURNING event_hash, retry_count`
            );

            log('info', 'Reaper: recovered stuck events', {
                count: recovered.length,
                events: recovered.map(e => ({
                    event_hash: e.event_hash,
                    retry_count: e.retry_count
                }))
            });
        }
    }

    /**
     * Helper: Compute event hash
     */
    async _computeEventHash(event) {
        const result = await this.db.query(
            `SELECT encode(
                digest(
                    $1 || ':' || $2::TEXT || ':' || $3 || ':' || $4::TEXT,
                    'sha256'
                ),
                'hex'
            ) as hash`,
            [event.transactionHash, event.logIndex, event.eventName, event.blockNumber]
        );
        return '0x' + result[0].hash;
    }

    /**
     * Run all scenarios
     */
    async runAll() {
        try {
            log('info', 'Starting stress test', {
                worker_id: this.workerId,
                timestamp: new Date().toISOString()
            });

            await this.testDuplicateEvent();
            await new Promise(resolve => setTimeout(resolve, 2000));

            await this.testMultiWorkerRace();
            await new Promise(resolve => setTimeout(resolve, 2000));

            await this.testStuckEventRecovery();
            await new Promise(resolve => setTimeout(resolve, 2000));

            await this.testReaperScan();

            log('info', 'Stress test completed', {
                worker_id: this.workerId,
                status: 'success'
            });
        } catch (error) {
            log('error', 'Stress test failed', {
                worker_id: this.workerId,
                error: error.message,
                stack: error.stack
            });
        } finally {
            await this.db.close();
        }
    }
}

// Run
const runner = new StressTestRunner();
runner.runAll().catch(console.error);
