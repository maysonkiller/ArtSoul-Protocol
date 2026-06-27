#!/usr/bin/env node

/**
 * Simple Stress Test - Real Multi-Worker
 */

import { spawn } from 'child_process';
import PostgreSQLDatabase from '../src/indexer/postgresql-database.js';
import dotenv from 'dotenv';

dotenv.config();

class SimpleStressTest {
    constructor() {
        this.db = new PostgreSQLDatabase({
            connectionString: process.env.DATABASE_URL
        });
    }

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
                startingPrice: '1000000000000000000',
                startTime: Math.floor(Date.now() / 1000),
                endTime: Math.floor(Date.now() / 1000) + 86400
            }
        };

        const eventJson = JSON.stringify(mockEvent);

        // Spawn 3 workers
        const workers = [];
        for (let i = 0; i < 3; i++) {
            const env = { ...process.env, WORKER_ID: `worker-${i}` };
            const worker = spawn('node', ['scripts/worker-process.js', eventJson], {
                env,
                stdio: 'inherit'
            });
            workers.push(new Promise(resolve => worker.on('exit', resolve)));
        }

        await Promise.all(workers);

        // Check result
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
            result: result[0] || null,
            expected: 'only one worker processed'
        }));
    }

    async testBurstLoad() {
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            scenario: 'burst_load',
            phase: 'start',
            events: 10,
            workers: 3
        }));

        const startTime = Date.now();
        const workers = [];

        for (let i = 0; i < 10; i++) {
            const mockEvent = {
                transactionHash: '0xburst' + Date.now() + '-' + i,
                logIndex: i,
                eventName: 'AuctionCreated',
                blockNumber: 2000000 + i,
                eventData: {
                    artworkId: (200 + i).toString(),
                    seller: '0x' + '3'.repeat(40),
                    startingPrice: ((i + 1) * 1000000000000000000).toString(),
                    startTime: Math.floor(Date.now() / 1000),
                    endTime: Math.floor(Date.now() / 1000) + 86400
                }
            };

            const eventJson = JSON.stringify(mockEvent);
            const workerId = `worker-burst-${i % 3}`;
            const env = { ...process.env, WORKER_ID: workerId };

            const worker = spawn('node', ['scripts/worker-process.js', eventJson], {
                env,
                stdio: 'inherit'
            });

            workers.push(new Promise(resolve => worker.on('exit', resolve)));
        }

        await Promise.all(workers);

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

    async runAll() {
        try {
            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                phase: 'test_suite_start',
                scenarios: ['3_worker_race', 'burst_load']
            }));

            await this.testThreeWorkerRace();
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
                error: error.message
            }));
        } finally {
            await this.db.close();
        }
    }
}

const test = new SimpleStressTest();
test.runAll().catch(console.error);
