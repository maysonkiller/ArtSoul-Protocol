#!/usr/bin/env node

/**
 * Simple Multi-Worker Stress Test
 * Tests real race conditions with actual separate processes
 */

import { ethers } from 'ethers';
import PostgreSQLDatabase from '../src/indexer/postgresql-database.js';
import IndexerSyncEngine from '../src/indexer/sync-engine.js';
import EventListener from '../src/indexer/event-listener.js';
import IndexerMetrics from '../src/indexer/metrics.js';
import dotenv from 'dotenv';

dotenv.config();

const workerId = process.env.WORKER_ID || `worker-${process.pid}`;
const eventData = JSON.parse(process.argv[2] || '{}');

async function processEvent() {
    const db = new PostgreSQLDatabase({
        connectionString: process.env.DATABASE_URL
    });

    const metrics = new IndexerMetrics();
    const rpcUrl = process.env.ETHEREUM_SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com';

    const eventListener = new EventListener({
        rpcUrl: [rpcUrl],
        contractAddress: process.env.MARKETPLACE_CONTRACT_SEPOLIA || '0xd2B14b4367f01492068887111Df91B8B8e931Bf8',
        chainId: 11155111
    }, metrics);

    const syncEngine = new IndexerSyncEngine(db, eventListener, metrics);

    try {
        // Convert string amounts to BigInt
        if (eventData.eventData.startingPrice) {
            eventData.eventData.startingPrice = BigInt(eventData.eventData.startingPrice);
        }
        if (eventData.eventData.amount) {
            eventData.eventData.amount = BigInt(eventData.eventData.amount);
        }

        await syncEngine._processEvent(eventData);
    } catch (error) {
        console.error(JSON.stringify({
            worker_id: workerId,
            error: error.message,
            phase: 'worker_error'
        }));
    } finally {
        await db.close();
    }
}

processEvent().catch(console.error);
