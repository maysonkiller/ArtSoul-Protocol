// A-15/A-43 failure-record integration coverage against disposable PostgreSQL 17.
//
// Event claims are committed before projection work begins. Failure recording is
// fenced to the exact active lease, so stale attempts cannot create, downgrade,
// or overwrite another attempt's registry state.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { execFileSync, execSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const CONTAINER = `artsoul-a15-pg-${process.pid}`;
const IMAGE = 'postgres:17';
const CHAIN_ID = '84532';
const OTHER_CHAIN_ID = '11155111';

function wait(milliseconds) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function dockerAvailable() {
    try {
        execSync('docker info', { stdio: 'ignore' });
        return execSync('docker version --format {{.Server.Os}}', {
            encoding: 'utf8'
        }).trim() === 'linux';
    } catch {
        return false;
    }
}

const HAVE_DOCKER = dockerAvailable();

function event(index, overrides = {}) {
    return {
        eventHash: `0x${String(index).padStart(64, 'a')}`,
        chainId: CHAIN_ID,
        transactionHash: `0x${String(index).padStart(64, '0')}`,
        logIndex: 0,
        eventName: 'AuctionCreated',
        blockNumber: 500 + index,
        workerId: 'worker-1',
        correlationId: `corr-${index}`,
        ...overrides
    };
}

test('A-15/A-43 fenced failure records (PostgreSQL 17)', {
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

        const portOutput = execSync(`docker port ${CONTAINER} 5432/tcp`, {
            encoding: 'utf8'
        }).trim();
        const port = Number(portOutput.match(/:(\d+)$/)?.[1]);
        assert.ok(
            Number.isInteger(port) && port > 0,
            `Unexpected Docker port output: ${portOutput}`
        );

        const { Pool } = await import('pg');
        pool = new Pool({
            host: '127.0.0.1',
            port,
            user: 'postgres',
            password: 'postgres',
            database: 'artsoul',
            max: 6
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

    await t.test('records failure only after a committed claim', async () => {
        const lease = await leaseApi.claimEventProcessingLease(database, event(1));
        assert.equal(lease.acquired, true);

        const result = await leaseApi.recordEventProcessingFailure(database, lease, {
            status: 'failed',
            error: new Error('handler exploded')
        });

        assert.deepEqual(result, {
            processing_status: 'failed',
            retry_count: 0
        });
        const stored = await pool.query(
            `SELECT processing_status, retry_count, processing_error,
                    event_name, block_number, owner_worker_id
             FROM event_processing_registry
             WHERE chain_id = $1 AND transaction_hash = $2 AND log_index = $3`,
            [lease.chainId, lease.transactionHash, lease.logIndex]
        );
        assert.deepEqual(stored.rows[0], {
            processing_status: 'failed',
            retry_count: 0,
            processing_error: 'handler exploded',
            event_name: 'AuctionCreated',
            block_number: '501',
            owner_worker_id: 'worker-1'
        });
    });

    await t.test('a missing or stale lease cannot invent a failure row', async () => {
        const missingLease = {
            ...event(2),
            processingStartedAt: new Date(),
            acquired: true
        };

        assert.equal(
            await leaseApi.recordEventProcessingFailure(database, missingLease, {
                status: 'failed',
                error: new Error('uncommitted attempt')
            }),
            null
        );
        assert.equal(
            Number((await pool.query('SELECT COUNT(*) FROM event_processing_registry')).rows[0].count),
            0
        );
    });

    await t.test('retries are monotonic and each failure is fenced to its attempt', async () => {
        const first = await leaseApi.claimEventProcessingLease(database, event(3));
        await leaseApi.recordEventProcessingFailure(database, first, {
            status: 'failed',
            error: new Error('first failure')
        });

        const second = await leaseApi.claimEventProcessingLease(database, event(3));
        assert.equal(second.acquired, true);
        assert.equal(second.retryCount, 1);
        assert.notEqual(
            new Date(first.processingStartedAt).toISOString(),
            new Date(second.processingStartedAt).toISOString()
        );

        assert.equal(
            await leaseApi.recordEventProcessingFailure(database, first, {
                status: 'dead',
                error: new Error('late stale failure')
            }),
            null
        );
        const result = await leaseApi.recordEventProcessingFailure(database, second, {
            status: 'dead',
            error: new Error('terminal failure')
        });
        assert.deepEqual(result, {
            processing_status: 'dead',
            retry_count: 1
        });

        const stored = await pool.query(
            `SELECT processing_status, retry_count, processing_error
             FROM event_processing_registry
             WHERE chain_id = $1 AND transaction_hash = $2 AND log_index = $3`,
            [second.chainId, second.transactionHash, second.logIndex]
        );
        assert.deepEqual(stored.rows[0], {
            processing_status: 'dead',
            retry_count: 1,
            processing_error: 'terminal failure'
        });
    });

    await t.test('keeps chains and log indexes independent', async () => {
        const leases = await Promise.all([
            leaseApi.claimEventProcessingLease(database, event(4)),
            leaseApi.claimEventProcessingLease(database, event(5, {
                transactionHash: event(4).transactionHash,
                logIndex: 1
            })),
            leaseApi.claimEventProcessingLease(database, event(6, {
                chainId: OTHER_CHAIN_ID,
                transactionHash: event(4).transactionHash
            }))
        ]);

        for (const lease of leases) {
            await leaseApi.recordEventProcessingFailure(database, lease, {
                status: 'failed',
                error: new Error('independent failure')
            });
        }

        assert.equal(
            Number((await pool.query(
                `SELECT COUNT(*) FROM event_processing_registry
                 WHERE chain_id = $1 AND processing_status = 'failed'`,
                [CHAIN_ID]
            )).rows[0].count),
            2
        );
        assert.equal(
            Number((await pool.query(
                `SELECT COUNT(*) FROM event_processing_registry
                 WHERE chain_id = $1 AND processing_status = 'failed'`,
                [OTHER_CHAIN_ID]
            )).rows[0].count),
            1
        );
    });

    await t.test('the retired failed_events table is not required', async () => {
        const relation = await pool.query(
            `SELECT to_regclass('public.failed_events') AS relation`
        );
        assert.equal(relation.rows[0].relation, null);

        const lease = await leaseApi.claimEventProcessingLease(database, event(7));
        const result = await leaseApi.recordEventProcessingFailure(database, lease, {
            status: 'failed',
            error: new Error('registry-only failure')
        });
        assert.equal(result.processing_status, 'failed');
    });
});
