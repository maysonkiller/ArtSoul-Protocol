// B-06: the Snapshot A allowlist named columns that do not exist.
//
// Snapshot A is captured once, on an announced date, immediately before a
// destructive reset. A defect found on that day is unrecoverable, which is why
// the exporter was built months ahead. The first rehearsal against the real
// database - 2026-09-14 - failed on the second table:
//
//     read v41_artworks: 33 rows
//     column "duration_seconds" does not exist
//
// Three names were wrong: `duration_seconds` for `duration`, `deposit` for
// `deposit_amount`, and a `source` column on the floor history that has never
// existed in any migration. Fifteen tests passed throughout, because the
// fixtures had been written from the allowlist rather than from the schema.
//
// This test reads the migration instead. It is the one check that could have
// caught it without a database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { EXPORTED_TABLES } = require('../src/snapshot/snapshot-a.js');

const root = path.join(__dirname, '..');
const MIGRATION = path.join(root, 'src', 'indexer', 'migrations', '010_v4_1_event_lifecycle.sql');
const CHAIN_SCOPE = path.join(root, 'src', 'indexer', 'migrations', '013_chain_scoped_v41_projections.sql');

// Columns of one CREATE TABLE, read from the migration that creates it.
function declaredColumns(sql, table) {
  const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`);
  assert.notEqual(start, -1, `${table} is not created in this migration`);
  const open = sql.indexOf('(', start);
  let depth = 0;
  let index = open;
  for (; index < sql.length; index++) {
    if (sql[index] === '(') depth++;
    else if (sql[index] === ')') {
      depth--;
      if (depth === 0) break;
    }
  }
  return sql
    .slice(open + 1, index)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^(CONSTRAINT|PRIMARY KEY|UNIQUE|FOREIGN KEY|CHECK)\b/i.test(line))
    .map((line) => line.split(/\s+/)[0].replace(/[",]/g, ''))
    .filter(Boolean);
}

test('every allowlisted column exists in the table it is read from', () => {
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  // 013 adds chain_id to these projections, so it is legitimately absent from
  // the original CREATE TABLE for some of them.
  const chainScoped = fs.readFileSync(CHAIN_SCOPE, 'utf8');

  const missing = [];
  for (const spec of EXPORTED_TABLES) {
    const columns = new Set(declaredColumns(sql, spec.table));
    if (chainScoped.includes(`ALTER TABLE ${spec.table} ADD COLUMN IF NOT EXISTS chain_id`)) {
      columns.add('chain_id');
    }

    for (const column of spec.columns) {
      if (!columns.has(column)) missing.push(`${spec.table}.${column}`);
    }
    if (!columns.has(spec.timeColumn)) missing.push(`${spec.table}.${spec.timeColumn} (timeColumn)`);
  }

  assert.deepEqual(
    missing,
    [],
    `the export would fail on the cut-off date for: ${missing.join(', ')}`
  );
});

test('the three names the rehearsal found are the corrected ones', () => {
  // Named individually so a revert reads as a deliberate act rather than a
  // formatting change inside a long frozen array.
  const auctions = EXPORTED_TABLES.find((spec) => spec.table === 'v41_auctions');
  const bids = EXPORTED_TABLES.find((spec) => spec.table === 'v41_bids');
  const floors = EXPORTED_TABLES.find((spec) => spec.table === 'v41_floor_history');

  assert.ok(auctions.columns.includes('duration'));
  assert.ok(!auctions.columns.includes('duration_seconds'));

  assert.ok(bids.columns.includes('deposit_amount'));
  assert.ok(!bids.columns.includes('deposit'));

  assert.ok(!floors.columns.includes('source'), 'the floor history has never had a source column');
  assert.ok(floors.columns.includes('token_id'), 'a floor belongs to a token under canon 4');
});

test('the export still reads only the projection tables it is allowed to', () => {
  // Genesis, eligibility and profiles stay out. Canon says testnet never
  // qualifies for Genesis, and shipping an eligibility list inside a permanent
  // public record invites the reading canon forbids.
  const forbidden = ['v41_project_eligibility', 'v41_genesis_holders', 'v41_trust_signals', 'profiles'];
  for (const table of EXPORTED_TABLES.map((spec) => spec.table)) {
    assert.ok(!forbidden.includes(table), `${table} must not be exported`);
  }
  assert.equal(EXPORTED_TABLES.length, 7);
});
