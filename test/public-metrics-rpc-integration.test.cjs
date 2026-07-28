// A11 public-metrics projection coverage against disposable PostgreSQL 17.
// The test proves idempotent increments, distinct participant counts, settled
// volume semantics, and automatic aggregate reversal when reorg cleanup
// deletes the referenced contract events.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { execFileSync, execSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CONTAINER = `artsoul-a11-pg-${process.pid}`;
const IMAGE = 'postgres:17';
const MIGRATION = fs.readFileSync(
  path.join(ROOT, 'src/indexer/migrations/015_public_metrics_projection.sql'),
  'utf8'
);

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

function psql(sql) {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'artsoul', '-v', 'ON_ERROR_STOP=1', '-tA', '-F', '|', '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  ).trim();
}

function tx(index) {
  return `0x${String(index).padStart(64, '0')}`;
}

function record({ index, name, type = null, address = null, auctions = 0, volume = 0, block }) {
  const nullable = value => value === null ? 'NULL' : `'${value}'`;
  psql(`
    INSERT INTO public.contract_events
      (chain_id, transaction_hash, log_index, event_name, block_number)
    VALUES (84532, '${tx(index)}', 0, '${name}', ${block});
    SELECT public.record_v41_public_metric_event(
      84532, '${tx(index)}', 0, '${name}',
      ${nullable(type)}, ${nullable(address)}, ${auctions}, ${volume},
      ${block}, to_timestamp(${block})
    );
  `);
}

test('A11 public metrics are idempotent and reverse with contract-event rollback', {
  skip: HAVE_DOCKER ? false : 'Docker is not available'
}, t => {
  t.before(() => {
    try {
      execSync(`docker rm -f ${CONTAINER}`, { stdio: 'ignore' });
    } catch {
      // The disposable container does not normally exist before the test.
    }
    execSync(
      `docker run -d --name ${CONTAINER} -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=artsoul ${IMAGE}`,
      { stdio: 'ignore' }
    );

    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        execFileSync(
          'docker',
          ['exec', CONTAINER, 'psql', '-U', 'postgres', '-d', 'artsoul', '-v', 'ON_ERROR_STOP=1', '-c', 'SELECT 1;'],
          { stdio: 'ignore' }
        );
        ready = true;
        break;
      } catch {
        wait(500);
      }
    }
    if (!ready) throw new Error('PostgreSQL did not become ready in time');

    psql(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN;
      CREATE TABLE public.contract_events (
        chain_id NUMERIC(78,0) NOT NULL,
        transaction_hash VARCHAR(66) NOT NULL,
        log_index INTEGER NOT NULL,
        event_name VARCHAR(100) NOT NULL,
        block_number BIGINT NOT NULL,
        PRIMARY KEY (chain_id, transaction_hash, log_index)
      );
      CREATE TABLE public.v41_artworks (
        chain_id NUMERIC(78,0), transaction_hash VARCHAR(66), log_index INTEGER,
        creator VARCHAR(42), block_number BIGINT, indexed_at TIMESTAMPTZ
      );
      CREATE TABLE public.v41_settlements (
        chain_id NUMERIC(78,0), transaction_hash VARCHAR(66), log_index INTEGER,
        winner VARCHAR(42), final_price NUMERIC(78,0), settlement_status VARCHAR(24),
        block_number BIGINT, indexed_at TIMESTAMPTZ
      );
      CREATE TABLE public.v41_auction_endings (
        chain_id NUMERIC(78,0), transaction_hash VARCHAR(66), log_index INTEGER,
        winner VARCHAR(42), block_number BIGINT, indexed_at TIMESTAMPTZ
      );
      CREATE TABLE public.v41_resale_history (
        chain_id NUMERIC(78,0), transaction_hash VARCHAR(66), log_index INTEGER,
        buyer VARCHAR(42), price NUMERIC(78,0), block_number BIGINT, indexed_at TIMESTAMPTZ
      );
    `);

    execFileSync(
      'docker',
      ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'artsoul', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
      { input: MIGRATION, stdio: ['pipe', 'ignore', 'pipe'], encoding: 'utf8' }
    );
  });

  t.after(() => {
    execSync(`docker rm -f ${CONTAINER}`, { stdio: 'ignore' });
  });

  const artist = '0x1111111111111111111111111111111111111111';
  const collectorA = '0x2222222222222222222222222222222222222222';
  const collectorB = '0x3333333333333333333333333333333333333333';

  record({ index: 1, name: 'ArtworkRegistered', type: 'artist', address: artist, block: 100 });
  record({ index: 2, name: 'ArtworkRegistered', type: 'artist', address: artist, block: 101 });
  record({ index: 3, name: 'SettlementCompleted', type: 'collector', address: collectorA, auctions: 1, volume: 100, block: 102 });
  record({ index: 4, name: 'ResaleCompleted', type: 'collector', address: collectorA, volume: 50, block: 103 });
  record({ index: 5, name: 'SettlementCompleted', type: 'collector', address: collectorB, auctions: 1, volume: 200, block: 104 });
  record({ index: 6, name: 'SettlementDefaulted', auctions: 1, block: 105 });
  record({ index: 7, name: 'AuctionEnded', auctions: 1, block: 106 });

  assert.equal(
    psql(`SELECT artists_onboarded, auctions_completed, unique_collectors, settled_volume_wei
          FROM public.v41_public_metrics WHERE chain_id = 84532;`),
    '1|4|2|350'
  );

  assert.equal(
    psql(`SELECT public.record_v41_public_metric_event(
      84532, '${tx(3)}', 0, 'SettlementCompleted', 'collector', '${collectorA}',
      1, 100, 102, to_timestamp(102)
    );`),
    'f',
    'replaying an event is a no-op'
  );
  assert.equal(
    psql(`SELECT artists_onboarded, auctions_completed, unique_collectors, settled_volume_wei
          FROM public.v41_public_metrics WHERE chain_id = 84532;`),
    '1|4|2|350'
  );

  psql('DELETE FROM public.contract_events WHERE chain_id = 84532 AND block_number >= 104;');
  assert.equal(
    psql(`SELECT artists_onboarded, auctions_completed, unique_collectors, settled_volume_wei, last_updated_block
          FROM public.v41_public_metrics WHERE chain_id = 84532;`),
    '1|1|1|150|103',
    'cascade rollback reverses counts, volume and the second collector'
  );
});
