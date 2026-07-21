// A-15 integration coverage against disposable PostgreSQL 17.
//
// The unit suite models transaction semantics; this suite runs the REAL
// failure-record UPSERT emitted by IndexerSyncEngine._recordEventFailure
// against the real event_processing_registry schema (migrations 005 + 006 +
// 013), proving the ON CONFLICT target, the completed-preservation CASE arms
// and retry_count monotonicity behave as claimed on actual PostgreSQL.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { execSync, execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CONTAINER = `artsoul-a15-pg-${process.pid}`;
const IMAGE = 'postgres:17';
const CHAIN_ID = '84532';
const OTHER_CHAIN_ID = '11155111';
const TX = '0x' + 'ab'.repeat(32);
const WORKER = 'worker-1';

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

function psql(sql, { expectError = false } = {}) {
    try {
        const output = execFileSync(
            'docker',
            ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'artsoul', '-v', 'ON_ERROR_STOP=1', '-tA', '-F', '|', '-c', sql],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
        );
        if (expectError) throw new Error(`Expected SQL failure but statement succeeded:\n${sql}`);
        return output.trim();
    } catch (error) {
        if (expectError) return String(error.stderr || error.message);
        throw new Error(`psql failed: ${sql}\n${error.stderr || error.message}`);
    }
}

function applySql(sql) {
    execFileSync(
        'docker',
        ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'artsoul', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
        { input: sql, stdio: ['pipe', 'ignore', 'pipe'], encoding: 'utf8' }
    );
}

// The exact statement shipped in src/indexer/sync-engine.js, extracted from
// source so the test can never drift from the implementation.
function extractFailureUpsert() {
    const source = fs.readFileSync(path.join(ROOT, 'src/indexer/sync-engine.js'), 'utf8');
    const match = source.match(
        /await this\.db\.query\(\s*`(INSERT INTO event_processing_registry[\s\S]*?RETURNING processing_status, retry_count)`/
    );
    assert.ok(match, '_recordEventFailure UPSERT must be present in sync-engine.js');
    return match[1];
}

function recordFailure({
    eventHash, chainId = CHAIN_ID, transactionHash = TX, logIndex = 0,
    eventName = 'AuctionCreated', blockNumber = 500, status = 'failed',
    errorMessage = 'handler exploded', retryCount = 0, workerId = WORKER,
    correlationId = 'corr-1'
}) {
    const literals = [
        `'${eventHash}'`, `${chainId}`, `'${transactionHash}'`, `${logIndex}`,
        `'${eventName}'`, `${blockNumber}`, `'${status}'`, `'${errorMessage}'`,
        `${retryCount}`, `'${workerId}'`, `'${correlationId}'`
    ];
    // Single pass over $N so $1 can never swallow the prefix of $10/$11.
    const sql = extractFailureUpsert().replace(
        /\$(\d+)/g,
        (_match, index) => literals[Number(index) - 1]
    );
    // psql appends the "INSERT 0 1" command tag after the RETURNING row.
    return psql(sql).split('\n')[0].trim();
}

test('A-15 failure-record UPSERT integration (PostgreSQL 17)', { skip: HAVE_DOCKER ? false : 'Docker is not available' }, async t => {
    t.before(() => {
        try {
            execSync(`docker rm -f ${CONTAINER}`, { stdio: 'ignore' });
        } catch {
            // The disposable container does not normally exist beforehand.
        }
        execSync(
            `docker run -d --name ${CONTAINER} -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=artsoul ${IMAGE}`,
            { stdio: 'ignore' }
        );

        let ready = false;
        for (let attempt = 0; attempt < 60; attempt++) {
            try {
                const args = ['exec', CONTAINER, 'psql', '-U', 'postgres', '-d', 'artsoul', '-v', 'ON_ERROR_STOP=1', '-c', 'SELECT 1;'];
                execFileSync('docker', args, { stdio: 'ignore' });
                wait(500);
                execFileSync('docker', args, { stdio: 'ignore' });
                ready = true;
                break;
            } catch {
                wait(500);
            }
        }
        if (!ready) throw new Error('PostgreSQL did not become ready in time');

        psql('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
        // Real registry schema: base table, ownership columns, chain scoping.
        applySql(fs.readFileSync(path.join(ROOT, 'src/indexer/migrations/005_event_idempotency.sql'), 'utf8'));
        applySql(fs.readFileSync(path.join(ROOT, 'src/indexer/migrations/006_ownership_observability.sql'), 'utf8'));
        psql(`ALTER TABLE event_processing_registry ADD COLUMN IF NOT EXISTS chain_id NUMERIC(78,0);
              UPDATE event_processing_registry SET chain_id = 84532 WHERE chain_id IS NULL;
              ALTER TABLE event_processing_registry ALTER COLUMN chain_id SET NOT NULL;
              ALTER TABLE event_processing_registry DROP CONSTRAINT IF EXISTS unique_tx_log;
              CREATE UNIQUE INDEX IF NOT EXISTS idx_event_registry_chain_tx_log
                  ON event_processing_registry(chain_id, transaction_hash, log_index);`);
    });

    t.after(() => {
        execSync(`docker rm -f ${CONTAINER}`, { stdio: 'ignore' });
    });

    t.beforeEach(() => {
        psql('TRUNCATE public.event_processing_registry RESTART IDENTITY CASCADE;');
    });

    await t.test('creates the row when the claim was rolled back', () => {
        assert.equal(psql('SELECT COUNT(*) FROM event_processing_registry;'), '0');

        const result = recordFailure({ eventHash: '0xhash-1', retryCount: 0 });

        assert.equal(result, 'failed|0');
        assert.equal(
            psql(`SELECT processing_status, retry_count, processing_error, event_name, block_number, owner_worker_id
                  FROM event_processing_registry WHERE chain_id = ${CHAIN_ID} AND transaction_hash = '${TX}';`),
            `failed|0|handler exploded|AuctionCreated|500|${WORKER}`
        );
    });

    await t.test('is idempotent and monotonic in retry_count', () => {
        recordFailure({ eventHash: '0xhash-1', retryCount: 3 });
        recordFailure({ eventHash: '0xhash-1', retryCount: 3 });

        assert.equal(psql('SELECT COUNT(*) FROM event_processing_registry;'), '1');
        assert.equal(psql(`SELECT retry_count FROM event_processing_registry WHERE transaction_hash = '${TX}';`), '3');

        // A late writer carrying a stale lower count can never lower it.
        recordFailure({ eventHash: '0xhash-1', retryCount: 1 });
        assert.equal(psql(`SELECT retry_count FROM event_processing_registry WHERE transaction_hash = '${TX}';`), '3');

        // Escalation to dead is recorded.
        assert.equal(recordFailure({ eventHash: '0xhash-1', status: 'dead', retryCount: 5 }), 'dead|5');
    });

    await t.test('never downgrades a completed record', () => {
        psql(`INSERT INTO event_processing_registry (
                  event_hash, chain_id, transaction_hash, log_index, event_name, block_number,
                  processing_status, processing_completed_at, retry_count, owner_worker_id, correlation_id
              ) VALUES ('0xcompleted', ${CHAIN_ID}, '${TX}', 0, 'AuctionCreated', 500,
                        'completed', NOW(), 2, 'worker-winner', 'corr-winner');`);

        const result = recordFailure({
            eventHash: '0xlate', status: 'dead', retryCount: 9,
            errorMessage: 'late failure', workerId: 'worker-late', correlationId: 'corr-late'
        });

        assert.equal(result, 'completed|2');
        assert.equal(
            psql(`SELECT processing_status, retry_count, COALESCE(processing_error, 'NULL'),
                         event_hash, owner_worker_id, correlation_id
                  FROM event_processing_registry WHERE transaction_hash = '${TX}';`),
            'completed|2|NULL|0xcompleted|worker-winner|corr-winner'
        );
    });

    await t.test('keeps failures for different chains and log indexes independent', () => {
        recordFailure({ eventHash: '0xa', chainId: CHAIN_ID, logIndex: 0 });
        recordFailure({ eventHash: '0xb', chainId: CHAIN_ID, logIndex: 1 });
        recordFailure({ eventHash: '0xc', chainId: OTHER_CHAIN_ID, logIndex: 0 });

        assert.equal(psql('SELECT COUNT(*) FROM event_processing_registry;'), '3');
        // The health query is chain scoped.
        assert.equal(
            psql(`SELECT COUNT(*) FROM event_processing_registry
                  WHERE chain_id = ${CHAIN_ID} AND processing_status IN ('failed', 'dead');`),
            '2'
        );
        assert.equal(
            psql(`SELECT COUNT(*) FROM event_processing_registry
                  WHERE chain_id = ${OTHER_CHAIN_ID} AND processing_status IN ('failed', 'dead');`),
            '1'
        );
    });

    await t.test('the retired failed_events table is not required by this path', () => {
        assert.equal(psql("SELECT to_regclass('public.failed_events') IS NULL;"), 't');
        // Recording a failure works with no failed_events relation present.
        assert.equal(recordFailure({ eventHash: '0xhash-1' }), 'failed|0');
    });
});
