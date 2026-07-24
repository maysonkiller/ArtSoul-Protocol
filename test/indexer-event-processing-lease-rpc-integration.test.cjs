// A-43 integration coverage against disposable PostgreSQL 17.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { execFileSync, execSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const CONTAINER = `artsoul-a43-pg-${process.pid}`;
const IMAGE = 'postgres:17';
const CHAIN_ID = '84532';

function wait(milliseconds) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function dockerAvailable() {
    try {
        execSync('docker info', { stdio: 'ignore' });
        return execSync('docker version --format {{.Server.Os}}', { encoding: 'utf8' }).trim() === 'linux';
    } catch {
        return false;
    }
}

const HAVE_DOCKER = dockerAvailable();

function event(index = 1) {
    return {
        eventHash: `0x${String(index).padStart(64, 'a')}`,
        chainId: CHAIN_ID,
        transactionHash: `0x${String(index).padStart(64, '0')}`,
        logIndex: 0,
        eventName: 'AuctionCreated',
        blockNumber: 500 + index,
        workerId: 'shared-worker',
        correlationId: `corr-${index}`
    };
}

test('A-43 committed event-processing leases (PostgreSQL 17)', {
    skip: HAVE_DOCKER ? false : 'Docker is not available'
}, async t => {
    let pool;
    let database;
    let leaseApi;

    t.before(async () => {
        try {
            execSync(`docker rm -f ${CONTAINER}`, { stdio: 'ignore' });
        } catch {
            // The disposable container does not normally exist beforehand.
        }

        execSync(
            `docker run -d --name ${CONTAINER} -e POSTGRES_PASSWORD=postgres ` +
            `-e POSTGRES_DB=artsoul -p 127.0.0.1::5432 ${IMAGE}`,
            { stdio: 'ignore' }
        );

        let ready = false;
        for (let attempt = 0; attempt < 60; attempt++) {
            try {
                execFileSync(
                    'docker',
                    ['exec', CONTAINER, 'pg_isready', '-U', 'postgres', '-d', 'artsoul'],
                    { stdio: 'ignore' }
                );
                ready = true;
                break;
            } catch {
                wait(500);
            }
        }
        if (!ready) throw new Error('PostgreSQL did not become ready in time');

        const portOutput = execSync(`docker port ${CONTAINER} 5432/tcp`, { encoding: 'utf8' }).trim();
        const port = Number(portOutput.match(/:(\d+)$/)?.[1]);
        assert.ok(Number.isInteger(port) && port > 0, `Unexpected Docker port output: ${portOutput}`);

        const { Pool } = await import('pg');
        pool = new Pool({
            host: '127.0.0.1',
            port,
            user: 'postgres',
            password: 'postgres',
            database: 'artsoul',
            max: 8
        });

        let poolReady = false;
        for (let attempt = 0; attempt < 30; attempt++) {
            try {
                await pool.query('SELECT 1');
                await new Promise(resolve => setTimeout(resolve, 250));
                await pool.query('SELECT 1');
                poolReady = true;
                break;
            } catch {
                await new Promise(resolve => setTimeout(resolve, 250));
            }
        }
        if (!poolReady) throw new Error('PostgreSQL TCP endpoint did not stabilize in time');

        await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
        await pool.query(fs.readFileSync(
            path.join(ROOT, 'src/indexer/migrations/005_event_idempotency.sql'),
            'utf8'
        ));
        await pool.query(fs.readFileSync(
            path.join(ROOT, 'src/indexer/migrations/006_ownership_observability.sql'),
            'utf8'
        ));
        await pool.query(`
            ALTER TABLE event_processing_registry
                ADD COLUMN IF NOT EXISTS chain_id NUMERIC(78,0);
            UPDATE event_processing_registry SET chain_id = 84532 WHERE chain_id IS NULL;
            ALTER TABLE event_processing_registry ALTER COLUMN chain_id SET NOT NULL;
            ALTER TABLE event_processing_registry DROP CONSTRAINT IF EXISTS unique_tx_log;
            CREATE UNIQUE INDEX IF NOT EXISTS idx_event_registry_chain_tx_log
                ON event_processing_registry(chain_id, transaction_hash, log_index);
        `);

        database = {
            async query(sql, params = []) {
                return (await pool.query(sql, params)).rows;
            }
        };
        leaseApi = await import(pathToFileURL(
            path.join(ROOT, 'src/indexer/event-processing-lease.js')
        ).href);
    });

    t.after(async () => {
        await pool?.end();
        execSync(`docker rm -f ${CONTAINER}`, { stdio: 'ignore' });
    });

    t.beforeEach(async () => {
        await pool.query('TRUNCATE event_processing_registry');
    });

    await t.test('a committed first claim remains heartbeat-visible while projection work is open', async () => {
        const lease = await leaseApi.claimEventProcessingLease(database, event(1));
        assert.equal(lease.acquired, true);

        const projectionClient = await pool.connect();
        try {
            await projectionClient.query('BEGIN');
            await projectionClient.query('SELECT 1');

            const refreshed = await Promise.race([
                leaseApi.refreshEventProcessingLease(database, lease),
                new Promise((_, reject) => setTimeout(
                    () => reject(new Error('heartbeat blocked behind projection transaction')),
                    1000
                ))
            ]);
            assert.equal(refreshed, true);

            const reaped = await leaseApi.reapStaleEventProcessingLeases(database, {
                chainId: CHAIN_ID,
                leaseTimeoutMs: 120000
            });
            assert.equal(reaped.length, 0);
        } finally {
            await projectionClient.query('ROLLBACK');
            projectionClient.release();
        }
    });

    await t.test('a live lease rejects a duplicate call even with the same worker ID', async () => {
        const first = await leaseApi.claimEventProcessingLease(database, event(2));
        const duplicate = await leaseApi.claimEventProcessingLease(database, event(2));

        assert.equal(first.acquired, true);
        assert.equal(duplicate.acquired, false);
        assert.equal(duplicate.status, 'processing');
        assert.equal(duplicate.workerId, first.workerId);
    });

    await t.test('a reaped attempt is fenced after reacquisition by the same worker ID', async () => {
        const first = await leaseApi.claimEventProcessingLease(database, event(3));
        await pool.query(
            `UPDATE event_processing_registry
             SET last_heartbeat_at = clock_timestamp() - INTERVAL '10 minutes'
             WHERE chain_id = $1 AND transaction_hash = $2 AND log_index = $3`,
            [CHAIN_ID, first.transactionHash, first.logIndex]
        );

        const reaped = await leaseApi.reapStaleEventProcessingLeases(database, {
            chainId: CHAIN_ID,
            leaseTimeoutMs: 120000
        });
        assert.equal(reaped.length, 1);
        assert.equal(reaped[0].previous_owner, first.workerId);
        assert.equal(Number(reaped[0].retry_count), 0);

        const abandoned = await pool.query(
            `SELECT processing_status, retry_count, processing_error
             FROM event_processing_registry
             WHERE chain_id = $1 AND transaction_hash = $2 AND log_index = $3`,
            [CHAIN_ID, first.transactionHash, first.logIndex]
        );
        assert.equal(abandoned.rows[0].processing_status, 'failed');
        assert.equal(abandoned.rows[0].retry_count, 0);
        assert.match(abandoned.rows[0].processing_error, /lease expired/i);

        const second = await leaseApi.claimEventProcessingLease(database, event(3));
        assert.equal(second.acquired, true);
        assert.equal(second.workerId, first.workerId);
        assert.equal(second.retryCount, 1);
        assert.notEqual(second.processingStartedAt, first.processingStartedAt);

        const staleClient = await pool.connect();
        try {
            await assert.rejects(
                leaseApi.completeEventProcessingLease(staleClient, first),
                error => error.code === 'INDEXER_EVENT_LEASE_LOST'
            );
        } finally {
            staleClient.release();
        }

        assert.equal(
            await leaseApi.recordEventProcessingFailure(database, first, {
                status: 'dead',
                error: new Error('late stale failure')
            }),
            null
        );

        const current = await pool.query(
            `SELECT processing_status, owner_worker_id,
                    processing_started_at::TEXT AS processing_started_at
             FROM event_processing_registry
             WHERE chain_id = $1 AND transaction_hash = $2 AND log_index = $3`,
            [CHAIN_ID, second.transactionHash, second.logIndex]
        );
        assert.equal(current.rows[0].processing_status, 'processing');
        assert.equal(current.rows[0].owner_worker_id, second.workerId);
        assert.equal(current.rows[0].processing_started_at, second.processingStartedAt);
    });

    await t.test('completion is terminal and a late failure cannot downgrade it', async () => {
        const lease = await leaseApi.claimEventProcessingLease(database, event(4));
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await leaseApi.completeEventProcessingLease(client, lease);
            await client.query('COMMIT');
        } finally {
            client.release();
        }

        assert.equal(
            await leaseApi.recordEventProcessingFailure(database, lease, {
                status: 'dead',
                error: new Error('late failure')
            }),
            null
        );
        const duplicate = await leaseApi.claimEventProcessingLease(database, event(4));
        assert.equal(duplicate.acquired, false);
        assert.equal(duplicate.status, 'completed');
    });

    await t.test('the reaper skips a registry row locked by a concurrent terminal update', async () => {
        const lease = await leaseApi.claimEventProcessingLease(database, event(5));
        await pool.query(
            `UPDATE event_processing_registry
             SET last_heartbeat_at = clock_timestamp() - INTERVAL '10 minutes'
             WHERE chain_id = $1 AND transaction_hash = $2 AND log_index = $3`,
            [CHAIN_ID, lease.transactionHash, lease.logIndex]
        );

        const locker = await pool.connect();
        try {
            await locker.query('BEGIN');
            await locker.query(
                `SELECT event_hash FROM event_processing_registry
                 WHERE chain_id = $1 AND transaction_hash = $2 AND log_index = $3
                 FOR UPDATE`,
                [CHAIN_ID, lease.transactionHash, lease.logIndex]
            );

            const reaped = await Promise.race([
                leaseApi.reapStaleEventProcessingLeases(database, {
                    chainId: CHAIN_ID,
                    leaseTimeoutMs: 120000
                }),
                new Promise((_, reject) => setTimeout(
                    () => reject(new Error('reaper blocked instead of using SKIP LOCKED')),
                    1000
                ))
            ]);
            assert.equal(reaped.length, 0);
        } finally {
            await locker.query('ROLLBACK');
            locker.release();
        }
    });
});
