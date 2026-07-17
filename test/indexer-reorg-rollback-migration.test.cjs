const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const migrationPath = path.join(
  repoRoot,
  'src',
  'indexer',
  'migrations',
  '014_schema_aware_reorg_rollback.sql'
);

function readMigration() {
  return fs.readFileSync(migrationPath, 'utf8');
}

test('migration 014 guards both optional legacy projection tables', () => {
  const sql = readMigration();

  for (const table of ['indexed_auctions', 'indexed_bids']) {
    assert.match(sql, new RegExp(`to_regclass\\('public\\.${table}'\\) IS NOT NULL`, 'i'));
    assert.match(sql, new RegExp(`EXECUTE 'DELETE FROM public\\.${table} WHERE block_number >= \\$1'`, 'i'));
  }
});

test('migration 014 keeps authoritative V4.1 rollback chain-scoped', () => {
  const sql = readMigration();
  const v41Tables = [
    'v41_artworks',
    'v41_auctions',
    'v41_bids',
    'v41_settlements',
    'v41_resale_listings',
    'v41_resale_history'
  ];

  for (const table of v41Tables) {
    assert.match(
      sql,
      new RegExp(`DELETE FROM public\\.${table}[\\s\\S]*?chain_id = target_chain_id[\\s\\S]*?block_number >= reorg_block`, 'i'),
      `${table} rollback must remain chain-scoped`
    );
  }
});

test('migration 014 deletes outbox references before their contract events', () => {
  const sql = readMigration();
  const outboxIndex = sql.indexOf('DELETE FROM public.outbox_events');
  const contractEventsIndex = sql.indexOf('DELETE FROM public.contract_events');

  assert.ok(outboxIndex >= 0, 'outbox rollback is present');
  assert.ok(contractEventsIndex > outboxIndex, 'contract events are deleted after outbox correlation lookups');
});

test('the tracked migration sequence and setup entry include migration 014', async () => {
  const { listIndexerMigrations } = await import('../scripts/apply-migrations.js');
  const migrations = listIndexerMigrations();
  const setupSql = fs.readFileSync(
    path.join(repoRoot, 'src', 'indexer', 'setup-database.sql'),
    'utf8'
  );

  assert.deepEqual(
    migrations.map(migration => migration.number),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
  );
  assert.match(setupSql, /014_schema_aware_reorg_rollback\.sql/);
});
