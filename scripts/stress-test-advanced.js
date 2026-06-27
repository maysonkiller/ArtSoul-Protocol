#!/usr/bin/env node

/**
 * Advanced Stress Test - 3+ Workers + Kill -9 + Real Race Conditions
 */

import { ethers } from 'ethers';
import PostgreSQLDatabase from '../src/indexer/postgresql-database.js';
import IndexerSyncEngine from '../src/indexer/sync-engine.js';
import EventListener from '../src/indexer/event-listener.js';
import IndexerMetrics from '../src/indexer/metrics.js';
import { spawn } from 'child_process';
import dotenv from 'dotenv';

dotenv.config();

class AdvancedStressTest {
    constructor() {
        this.db = new PostgreSQLDatabase({
            connectionString: process.env.DATABASE_URL
        });
        this.workers = [];
    }

    /**
     * Scenario 1: 3 Workers Racing for Same Event
     */
    async testThreeWorkerRace() {
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            scenario: '3_worker_race',
            phase: 'start'
        }));

        const mockEvent = {
            transactionHash: '0xrace' + Date.now(),
            logIndex: 0,
            eventName: 'AuctionCreated',
            blockNumber: 2000000 + Math.floor(Math.random() * 1000),
            eventData: {
                artworkId: '100',
                seller: '0x' + '1'.repeat(40),
                startingPrice: '1000000000000000000', // Wei as string
                startTime: Math.floor(Date.now() / 1000),
                endTime: Math.floor(Date.now() / 1000) + 86400
            }
        };

        // Spawn 3 worker processes
        const workers = [];
        for (let i = 0; i < 3; i++) {
            const worker = spawn('node', [
                '-e',
                `
                import { ethers } from 'ethers';
                import PostgreSQLDatabase from './src/indexer/postgresql-database.js';
                import IndexerSyncEngine from './src/indexer/sync-engine.js';
                import EventListener from './src/indexer/event-listener.js';
                import IndexerMetrics from './src/indexer/metrics.js';
                import dotenv from 'dotenv';
                dotenv.config();

                process.env.WORKER_ID = 'worker-${i}';

                const db = new PostgreSQLDatabase({ connectionString: process.env.DATABASE_URL });
                const metrics = new IndexerMetrics();
                const rpcUrl = process.env.ETHEREUM_SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com';
                const eventListener = new EventListener({
                    rpcUrl: [rpcUrl],
                    contractAddress: process.env.MARKETPLACE_CONTRACT_SEPOLIA || '0xd2B14b4367f01492068887111Df91B8B8e931Bf8',
                    chainId: 11155111
                }, metrics);
                const syncEngine = new IndexerSyncEngine(db, eventListener, metrics);

                const event = ${JSON.stringify(mockEvent)};
                event.eventData.startingPrice = BigInt(event.eventData.startingPrice);

                (async () => {
                    try {
                        await syncEngine._processEvent(event);
                    } catch (error) {
                        console.error(JSON.stringify({ worker_id: 'worker-${i}', error: error.message }));
                    } finally {
                        await db.close();
                        process.exit(0);
                    }
                })();
                `
            ], {
                shell: true,
                stdio: 'inherit'
            });

            workers.push(worker);
        }

        // Wait for all workers
        await Promise.all(workers.map(w => new Promise(resolve => w.on('exit', resolve))));

        // Check final state
        const eventHash = await this._computeEventHash(mockEvent);
        const result = await this.db.query(
            `SELECT event_hash, processing_status, owner_worker_id, retry_count
             FROM event_processing_registry WHERE event_hash = $1`,
            [eventHash]
        );

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            scenario: '3_worker_race',
            phase: 'complete',
            result: result[0],
            expected: 'only one worker processed'
        }));
    }

    /**
     * Scenario 2: Kill -9 During Processing
     */
    async testKillDuringProcessing() {
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            scenario: 'kill_9',
            phase: 'start'
        }));

        const mockEvent = {
            transactionHash: '0xkill' + Date.now(),
            logIndex: 0,
            eventName: 'BidPlaced',
            blockNumber: 2000000 + Math.floor(Math.random() * 1000),
            eventData: {
                artworkId: '101',
                bidder: '0x' + '2'.repeat(40),
                amount: '2000000000000000000' // Wei as string
            }
        };

        // Spawn worker that will be killed
        const worker = spawn('node', [
            '-e',
            `
            import { ethers } from 'ethers';
            import PostgreSQLDatabase from './src/indexer/postgresql-database.js';
            import IndexerSyncEngine from './src/indexer/sync-engine.js';
            import EventListener from './src/indexer/event-listener.js';
            import IndexerMetrics from './src/indexer/metrics.js';
            import dotenv from 'dotenv';
            dotenv.config();

            process.env.WORKER_ID = 'worker-victim';

            const db = new PostgreSQLDatabase({ connectionString: process.env.DATABASE_URL });
            const metrics = new IndexerMetrics();
            const rpcUrl = process.env.ETHEREUM_SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com';
            const eventListener = new EventListener({
                rpcUrl: [rpcUrl],
                contractAddress: process.env.MARKETPLACE_CONTRACT_SEPOLIA || '0xd2B14b4367f01492068887111Df91B8B8e931Bf8',
                chainId: 11155111
            }, metrics);
            const syncEngine = new IndexerSyncEngine(db, eventListener, metrics);

            const event = ${JSON.stringify(mockEvent)};
            event.eventData.amount = BigInt(event.eventData.amount);

            (async () => {
                try {
                    // Add artificial delay to ensure we can kill it
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    await syncEngine._processEvent(event);
                } catch (error) {
                    console.error(JSON.stringify({ worker_id: 'worker-victim', error: error.message }));
                } finally {
                    await db.close();
                }
            })();
            `
        ], {
            shell: true,
            stdio: 'inherit'
        });

        // Wait 500ms then kill -9
        await new Promise(resolve => setTimeout(resolve, 500));
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            scenario: 'kill_9',
            phase: 'killing_worker',
            pid: worker.pid
        }));

        worker.kill('SIGKILL');

        await new Promise(resolve => worker.on('exit', resolve));

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            scenario: 'kill_9',
            phase: 'worker_killed'
        }));

        // Wait for reaper (2 minutes)
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            scenario: 'kill_9',
            phase: 'waiting_for_reaper',
            wait_seconds: 130
        }));

        await new Promise(resolve => setTimeout(resolve, 130000)); // 2:10

        // Check if reaper recovered it
        const eventHash = await this._computeEventHash(mockEvent);
        const result = await this.db.query(
            `SELECT event_hash, processing_status, owner_worker_id, retry_count
             FROM event_processing_registry WHERE event_hash = $1`,
            [eventHash]
        );

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            scenario: 'kill_9',
            phase: 'after_reaper',
            result: result[0],
            expected: 'status=pending, retry_count=1'
        }));
    }

    /**
     * Scenario 3: Burst Load (10 events, 3 workers)
     */
    async testBurstLoad() {
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            scenario: 'burst_load',
            phase: 'start',
            events: 10,
            workers: 3
        }));

        const events = [];
        for (let i = 0; i < 10; i++) {
            events.push({
                transactionHash: '0xburst' + Date.now() + '-' + i,
                logIndex: i,
                eventName: 'AuctionCreated',
                blockNumber: 2000000 + i,
                eventData: {
                    artworkId: (200 + i).toString(),
                    seller: '0x' + '3'.repeat(40),
                    startingPrice: ((i + 1) * 1000000000000000000).toString(), // Wei as string
                    startTime: Math.floor(Date.now() / 1000),
                    endTime: Math.floor(Date.now() / 1000) + 86400
                }
            });
        }

        const startTime = Date.now();

        // Process with 3 workers
        const workerPromises = [];
        for (let w = 0; w < 3; w++) {
            const workerEvents = events.filter((_, i) => i % 3 === w);

            const promise = new Promise((resolve) => {
                const worker = spawn('node', [
                    '-e',
                    `
                    import { ethers } from 'ethers';
                    import PostgreSQLDatabase from './src/indexer/postgresql-database.js';
                    import IndexerSyncEngine from './src/indexer/sync-engine.js';
                    import EventListener from './src/indexer/event-listener.js';
                    import IndexerMetrics from './src/indexer/metrics.js';
                    import dotenv from 'dotenv';
                    dotenv.config();

                    process.env.WORKER_ID = 'worker-burst-${w}';

                    const db = new PostgreSQLDatabase({ connectionString: process.env.DATABASE_URL });
                    const metrics = new IndexerMetrics();
                    const rpcUrl = process.env.ETHEREUM_SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com';
                    const eventListener = new EventListener({
                        rpcUrl: [rpcUrl],
                        contractAddress: process.env.MARKETPLACE_CONTRACT_SEPOLIA || '0xd2B14b4367f01492068887111Df91B8B8e931Bf8',
                        chainId: 11155111
                    }, metrics);
                    const syncEngine = new IndexerSyncEngine(db, eventListener, metrics);

                    const events = ${JSON.stringify(workerEvents)};

                    (async () => {
                        for (const event of events) {
                            event.eventData.startingPrice = BigInt(event.eventData.startingPrice);
                            try {
                                await syncEngine._processEvent(event);
                            } catch (error) {
                                console.error(JSON.stringify({ worker_id: 'worker-burst-${w}', error: error.message }));
                            }
                        }
                        await db.close();
                    })();
                    `
                ], {
                    shell: true,
                    stdio: 'inherit'
                });

                worker.on('exit', resolve);
            });

            workerPromises.push(promise);
        }

        await Promise.all(workerPromises);

        const duration = Date.now() - startTime;

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            scenario: 'burst_load',
            phase: 'complete',
            total_events: 10,
            duration_ms: duration,
            events_per_second: (10 / (duration / 1000)).toFixed(2)
        }));
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
            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                phase: 'test_suite_start',
                scenarios: ['3_worker_race', 'kill_9', 'burst_load']
            }));

            await this.testThreeWorkerRace();
            await new Promise(resolve => setTimeout(resolve, 2000));

            await this.testKillDuringProcessing();
            await new Promise(resolve => setTimeout(resolve, 2000));

            await this.testBurstLoad();

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
            await this.db.close();
        }
    }
}

// Run
const test = new AdvancedStressTest();
test.runAll().catch(console.error);
