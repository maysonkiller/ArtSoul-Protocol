// A disposable PostgreSQL proves capture isolation; never reads DATABASE_URL.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const { Client } = require('pg');

function docker(...args) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }).trim();
}
let available = false;
try { available = docker('version', '--format', '{{.Server.Os}}') === 'linux'; } catch {}

test('capture keeps one read-only view across concurrent commits and rolls back on failure (PostgreSQL 17)', {
  skip: available ? false : 'Docker Linux PostgreSQL is unavailable', timeout: 120000
}, async t => {
  const { readSnapshotTables } = await import('../scripts/export-snapshot-a.mjs');
  const { EXPORTED_TABLES } = await import('../src/snapshot/snapshot-a.js');
  const container = `artsoul-snapshot-pg-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const clients = [];
  let created = false;
  t.after(async () => {
    await Promise.allSettled(clients.map(client => client.end()));
    if (created) docker('rm', '-f', container);
  });
  docker('run', '-d', '--name', container, '-e', 'POSTGRES_PASSWORD=local-snapshot-only',
    '-e', 'POSTGRES_DB=artsoul', '-p', '127.0.0.1::5432', 'postgres:17');
  created = true;
  const port = Number(docker('port', container, '5432/tcp').split(':').pop());
  assert.ok(Number.isInteger(port) && port > 0);
  const config = { host: '127.0.0.1', port, user: 'postgres', password: 'local-snapshot-only',
    database: 'artsoul', connectionTimeoutMillis: 1000 };
  let writer;
  for (let i = 0; i < 60; i++) {
    const candidate = new Client(config);
    try {
      await candidate.connect();
      await candidate.query('SELECT 1');
      writer = candidate; clients.push(writer); break;
    } catch { await candidate.end().catch(() => {}); }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(writer, 'disposable PostgreSQL must start');
  const reader = new Client(config);
  await reader.connect(); clients.push(reader);
  for (const spec of EXPORTED_TABLES) {
    await writer.query(`CREATE TABLE ${spec.table} (${spec.columns.map(column => `"${column}" TEXT`).join(',')})`);
  }
  await writer.query("INSERT INTO v41_artworks(chain_id, artwork_id) VALUES ('84532','1'),('11155111','2')");
  await writer.query("INSERT INTO v41_auctions(chain_id, auction_id, status) VALUES ('84532','1','active')");
  let changed = false;
  const concurrent = { query: async (sql, args) => {
    const result = await reader.query(sql, args);
    if (/FROM v41_artworks/.test(sql)) {
      assert.equal((await reader.query('SHOW transaction_isolation')).rows[0].transaction_isolation, 'repeatable read');
      assert.equal((await reader.query('SHOW transaction_read_only')).rows[0].transaction_read_only, 'on');
      await writer.query("UPDATE v41_auctions SET status = 'settled'");
      changed = true;
    }
    return result;
  } };
  const captured = await readSnapshotTables(concurrent, 84532);
  assert.equal(changed, true);
  assert.equal(captured.v41_artworks.length, 1, 'legacy chain rows must not leak into the capture');
  assert.equal(captured.v41_auctions[0].status, 'active', 'all tables must come from the same read view');
  assert.equal((await writer.query('SELECT status FROM v41_auctions')).rows[0].status, 'settled');
  const fresh = await readSnapshotTables(reader, 84532);
  assert.equal(fresh.v41_auctions[0].status, 'settled');

  const attemptsWrite = { query: async (sql, args) => {
    const result = await reader.query(sql, args);
    if (/FROM v41_artworks/.test(sql)) await reader.query("UPDATE v41_auctions SET status='unexpected'");
    return result;
  } };
  await assert.rejects(readSnapshotTables(attemptsWrite, 84532), /read-only transaction/);
  assert.equal((await reader.query('SELECT status FROM v41_auctions')).rows[0].status, 'settled', 'rollback leaves the session usable');

  await writer.query('DROP TABLE v41_bids');
  await assert.rejects(readSnapshotTables(reader, 84532), /does not exist/);
  assert.equal((await reader.query('SHOW transaction_read_only')).rows[0].transaction_read_only, 'off');
});
