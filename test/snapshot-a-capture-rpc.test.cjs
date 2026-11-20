// A disposable PostgreSQL proves capture isolation; never reads DATABASE_URL.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const test = require('node:test');
const { Client } = require('pg');

function docker(...args) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }).trim();
}
let available = false;
try { available = docker('version', '--format', '{{.Server.Os}}') === 'linux'; } catch {}

test('new capture checks the testnet, calendar cut-off and arguments before connecting', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'artsoul-capture-options-'));
  t.after(() => fs.rmdirSync(temp));
  const archive = path.join(temp, 'capture');
  const script = path.resolve(__dirname, '../scripts/export-snapshot-a.mjs');
  const utc = '2028-02-29T00:00:00.123456Z';
  const run = (args, chainId = '') => {
    const result = spawnSync(process.execPath, [script, '--out', archive, ...args], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: '', ARTSOUL_INDEXER_CHAIN_ID: chainId }
    });
    assert.equal(result.status, 1, result.stdout);
    assert.equal(fs.existsSync(archive), false);
    return result.stderr;
  };
  for (const chainId of ['8453', '11155111', 'text']) {
    assert.match(run(['--cut-off', utc], chainId), /Base Sepolia/);
    assert.match(run(['--cut-off', utc, '--chain-id', chainId]), /Base Sepolia/);
  }
  for (const cutOff of ['2027-02-29T10:00:00Z', '2028-04-31T08:00:00-08:00', '0000-01-01T00:00:00Z',
    '2028-01-01T24:00:00.000001Z', '2028-01-01T00:00:00+16:00']) {
    assert.match(run(['--cut-off', cutOff]), /explicit ISO-8601/);
  }
  assert.match(run(['--cut-off', utc, '--chain_id', '8453']), /Unknown option/);
  assert.match(run(['--cut-off', utc, '--cut-off', '2028-03-01T00:00:00Z']), /once/);
  assert.match(run(['--cut-off', utc, 'extra']), /positional/i);
  // A missing database URL is reached only after all options have passed.
  for (const valid of [utc, '2028-02-29T23:59:59.999999-03:30', '2028-02-29T24:00:00Z']) {
    assert.match(run(['--cut-off', valid]), /DATABASE_URL is required/);
  }
  assert.match(run(['--cut-off', utc, '--chain-id=84532'], '8453'), /DATABASE_URL is required/);
});

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
    if (created) docker('rm', '-f', '-v', container);
  });
  docker('run', '-d', '--rm', '--name', container, '-e', 'POSTGRES_PASSWORD=local-snapshot-only',
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
    const columns = spec.columns.map(column =>
      `"${column}" ${column === spec.timeColumn ? 'TIMESTAMPTZ NOT NULL DEFAULT NOW()' : 'TEXT'}`);
    await writer.query(`CREATE TABLE ${spec.table} (${columns.join(',')})`);
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

  const instants = ['2001-01-02T03:04:05.123455Z', '2001-01-02T03:04:05.123456Z', '2001-01-02T03:04:05.123457Z'];
  for (const spec of EXPORTED_TABLES) {
    await writer.query(`INSERT INTO ${spec.table}(chain_id, indexed_at)
      SELECT $1, stamp FROM unnest($2::timestamptz[]) AS fixture(stamp)`, ['84532', instants]);
  }
  await reader.query("SET TIME ZONE 'Pacific/Honolulu'");
  const cutOff = '2001-01-02T05:04:05.123456+02:00';
  const atCutOff = await readSnapshotTables(reader, 84532, cutOff);
  for (const spec of EXPORTED_TABLES) {
    assert.deepEqual(atCutOff[spec.table].map(row => row.indexed_at).sort(), instants.slice(0, 2), spec.table);
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'artsoul-snapshot-cutoff-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('artsoul-snapshot-cutoff-'));
    fs.rmSync(root, { recursive: true });
  });
  const archive = path.join(root, 'fixture');
  const scripts = path.resolve(__dirname, '../scripts');
  const output = execFileSync(process.execPath, [path.join(scripts, 'export-snapshot-a.mjs'),
    '--cut-off', cutOff, '--chain-id', '84532', '--out', archive], { encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: `postgres://postgres:local-snapshot-only@127.0.0.1:${port}/artsoul` } });
  const rootHash = output.match(/root hash\s+: ([a-f0-9]{64})/)?.[1];
  assert.ok(rootHash, 'capture prints its root');
  for (const spec of EXPORTED_TABLES) {
    const section = JSON.parse(fs.readFileSync(path.join(archive, `${spec.name}.json`), 'utf8'));
    assert.deepEqual(section.rows.map(row => row.indexed_at).sort(), instants.slice(0, 2), spec.name);
  }
  const verified = execFileSync(process.execPath, [path.join(scripts, 'verify-snapshot-a.mjs'), archive,
    '--expected-root', rootHash], { encoding: 'utf8', env: { ...process.env, DATABASE_URL: '' } });
  assert.match(verified, /VALID\./);

  const attemptsWrite = { query: async (sql, args) => {
    const result = await reader.query(sql, args);
    if (/FROM v41_artworks/.test(sql)) await reader.query("UPDATE v41_auctions SET status='unexpected'");
    return result;
  } };
  await assert.rejects(readSnapshotTables(attemptsWrite, 84532), /read-only transaction/);
  assert.equal((await reader.query("SELECT status FROM v41_auctions WHERE auction_id = '1'")).rows[0].status, 'settled', 'rollback leaves the session usable');

  await writer.query('DROP TABLE v41_bids');
  await assert.rejects(readSnapshotTables(reader, 84532), /does not exist/);
  assert.equal((await reader.query('SHOW transaction_read_only')).rows[0].transaction_read_only, 'off');
});
