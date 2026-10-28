// B-05: the Snapshot A exporter and verifier.
//
// Snapshot A is captured once, on an announced date, before a destructive
// reset, and it cannot be recaptured afterwards. Every test here exists because
// the failure it guards against would be discovered on the one day nothing can
// be done about it.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'src', 'snapshot', 'snapshot-a.js')).href;
const snapshotModule = import(moduleUrl);

const hashText = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const CHAIN_ID = 84532;

const CREATOR = '0xA61C114E38cEAc5BDE6325956F4e808582690329';
const COLLECTOR = '0x6EC8C121043357aC231E36D403EdAbf90AE6989B';
const BIDDER = '0x1111111111111111111111111111111111111111';
const ZERO = '0x0000000000000000000000000000000000000000';

function sampleTables() {
  return {
    v41_artworks: [
      { chain_id: '84532', artwork_id: '19', creator: CREATOR, metadata_uri: 'ipfs://a', minted: true, token_id: '3', canonical_floor: '1000', indexed_at: '2026-07-03T14:20:12Z' },
      { chain_id: '84532', artwork_id: '31', creator: COLLECTOR, metadata_uri: 'ipfs://b', minted: false, token_id: '0', canonical_floor: '0', indexed_at: '2026-08-26T10:00:00Z' }
    ],
    v41_auctions: [
      { chain_id: '84532', auction_id: '19', artwork_id: '19', creator: CREATOR, start_price: '1000', duration: 129600, end_time: '2026-07-05T02:20:10Z', status: 'settled', winner: COLLECTOR, winning_bid: '1000', indexed_at: '2026-07-03T14:20:47Z' }
    ],
    v41_bids: [
      { chain_id: '84532', auction_id: '19', bidder: COLLECTOR, bid_amount: '1000', deposit_amount: '100', block_number: 1, transaction_hash: '0xaa', indexed_at: '2026-07-04T00:00:00Z' },
      { chain_id: '84532', auction_id: '19', bidder: BIDDER, bid_amount: '900', deposit_amount: '90', block_number: 2, transaction_hash: '0xbb', indexed_at: '2026-07-04T01:00:00Z' }
    ],
    v41_auction_endings: [
      { chain_id: '84532', auction_id: '19', winner: COLLECTOR, winning_bid: '1000', settlement_deadline: '2026-07-06T07:45:34Z', transaction_hash: '0xcc', indexed_at: '2026-07-05T07:45:44Z' }
    ],
    v41_settlements: [
      { chain_id: '84532', auction_id: '19', artwork_id: '19', winner: COLLECTOR, final_price: '1000', token_id: '3', settlement_status: 'completed', transaction_hash: '0xdd', indexed_at: '2026-07-05T07:46:19Z' }
    ],
    v41_resale_history: [
      { chain_id: '84532', token_id: '3', seller: COLLECTOR, buyer: BIDDER, price: '1100', transaction_hash: '0xee', indexed_at: '2026-07-08T10:28:20Z' }
    ],
    v41_floor_history: [
      { chain_id: '84532', artwork_id: '19', token_id: '7', floor_price: '1000', indexed_at: '2026-07-05T07:46:19Z' }
    ]
  };
}

async function build(overrides = {}) {
  const { buildSnapshot } = await snapshotModule;
  return buildSnapshot({ tables: sampleTables(), chainId: CHAIN_ID, hashText, ...overrides });
}

function readerFor(files) {
  return (name) => (Object.prototype.hasOwnProperty.call(files, name) ? files[name] : undefined);
}

test('the same rows always produce the same bytes and the same root hash', async () => {
  // Reproducibility is a canon requirement, not a nicety: a second run that
  // disagrees with the first cannot be told apart from a tampered copy.
  const first = await build();
  const second = await build();

  assert.equal(first.rootHash, second.rootHash);
  assert.deepEqual(Object.keys(first.files).sort(), Object.keys(second.files).sort());
  for (const name of Object.keys(first.files)) {
    assert.equal(first.files[name], second.files[name], `${name} must be byte-identical`);
  }
});

test('row order in the database cannot change the export', async () => {
  const forward = await build();
  const tables = sampleTables();
  for (const rows of Object.values(tables)) rows.reverse();
  const reversed = await build({ tables });

  assert.equal(reversed.rootHash, forward.rootHash);
});

test('an export validates from its own files, with no database', async () => {
  // This is Bible section 16 point 2: the export must be readable and
  // independently validated after the application database is reset.
  const { verifySnapshot } = await snapshotModule;
  const { files } = await build();

  const result = verifySnapshot({ readFile: readerFor(files), hashText });
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
});

test('one altered byte is caught, and named', async () => {
  const { verifySnapshot } = await snapshotModule;
  const { files } = await build();
  const tampered = { ...files, 'settlements.json': files['settlements.json'].replace('1000', '9999') };

  const result = verifySnapshot({ readFile: readerFor(tampered), hashText });
  assert.equal(result.ok, false);
  assert.deepEqual(result.problems, ['settlements.json does not match its recorded hash']);
});

test('a removed file is caught rather than quietly shrinking the record', async () => {
  const { verifySnapshot } = await snapshotModule;
  const { files } = await build();
  const missing = { ...files };
  delete missing['bids.json'];

  const result = verifySnapshot({ readFile: readerFor(missing), hashText });
  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /bids\.json is listed in the manifest but missing/);
});

test('editing the manifest to match a tampered file is still caught', async () => {
  // The obvious attack on a per-file hash list is to update the list. The root
  // hash covers the manifest body, so the edit has to survive that too.
  const { verifySnapshot } = await snapshotModule;
  const { files } = await build();

  const altered = files['settlements.json'].replace('1000', '9999');
  const manifest = JSON.parse(files['manifest.json']);
  manifest.files['settlements.json'] = hashText(altered);

  const tampered = {
    ...files,
    'settlements.json': altered,
    'manifest.json': `${JSON.stringify(manifest, null, 2)}\n`
  };

  const result = verifySnapshot({ readFile: readerFor(tampered), hashText });
  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /root_hash does not match/);
});

test('the export carries the entitlement notice, and losing it fails verification', async () => {
  // Canon: Snapshot A is a community record and creates no Genesis, token,
  // points or airdrop. The notice lives in the file because the file will
  // outlive every document around it.
  const { verifySnapshot, ENTITLEMENT_NOTICE } = await snapshotModule;
  const { files } = await build();
  const manifest = JSON.parse(files['manifest.json']);

  assert.equal(manifest.notice, ENTITLEMENT_NOTICE);
  assert.equal(manifest.entitlement, 'none');
  assert.match(manifest.notice, /creates no Genesis, token, points, airdrop or other entitlement/);

  const stripped = JSON.parse(files['manifest.json']);
  stripped.notice = 'Snapshot A.';
  const result = verifySnapshot({
    readFile: readerFor({ ...files, 'manifest.json': `${JSON.stringify(stripped, null, 2)}\n` }),
    hashText
  });
  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /entitlement notice is missing or altered/);
});

test('no Genesis or eligibility table can reach the export', async () => {
  // Canon says testnet activity never qualifies for Genesis. Shipping a testnet
  // eligibility list inside a snapshot invites exactly the reading canon
  // forbids, so those tables are outside the allowlist and stay there.
  const { EXPORTED_TABLES } = await snapshotModule;
  const tables = EXPORTED_TABLES.map((spec) => spec.table);

  assert.equal(tables.includes('v41_genesis_holders'), false);
  assert.equal(tables.includes('v41_project_eligibility'), false);
  assert.equal(tables.includes('profiles'), false);

  const columns = EXPORTED_TABLES.flatMap((spec) => spec.columns);
  for (const forbidden of ['email', 'username', 'avatar_url', 'session', 'token_hash', 'ip_address']) {
    assert.equal(columns.includes(forbidden), false, `${forbidden} must never be exported`);
  }
});

test('a column added to a table later cannot slip into the record', async () => {
  const tables = sampleTables();
  tables.v41_artworks[0].internal_note = 'not for publication';
  const { files } = await build({ tables });

  assert.equal(files['artworks.json'].includes('internal_note'), false);
});

test('the cut-off excludes later rows and is recorded in the manifest', async () => {
  const { files } = await build({ cutOff: '2026-07-06T00:00:00Z' });
  const manifest = JSON.parse(files['manifest.json']);
  const artworks = JSON.parse(files['artworks.json']);

  assert.equal(manifest.source_cut_off, '2026-07-06T00:00:00Z');
  assert.equal(artworks.count, 1, 'the 26 August artwork is after the cut-off');
  assert.equal(artworks.rows[0].artwork_id, '19');
  // The resale on 8 July is also after it.
  assert.equal(JSON.parse(files['resales.json']).count, 0);
});

test('participants are every address that took part, once, and never the zero address', async () => {
  const tables = sampleTables();
  tables.v41_auctions[0].winner = ZERO;
  const { files } = await build({ tables });
  const participants = JSON.parse(files['participants.json']);

  assert.equal(participants.addresses.includes(ZERO), false);
  assert.deepEqual(participants.addresses, [
    BIDDER.toLowerCase(),
    COLLECTOR.toLowerCase(),
    CREATOR.toLowerCase()
  ]);
  assert.equal(participants.count, 3);
});

test('the same wallet in different letter cases is one participant', async () => {
  const tables = sampleTables();
  tables.v41_bids[0].bidder = COLLECTOR.toUpperCase().replace('0X', '0x');
  const { files } = await build({ tables });

  assert.equal(JSON.parse(files['participants.json']).count, 3);
});

test('aggregate counts are reported, and settled volume survives being large', async () => {
  const tables = sampleTables();
  // A wei total well past Number.MAX_SAFE_INTEGER: JSON has no integer type
  // that survives it, so the field is a decimal string.
  tables.v41_settlements[0].final_price = '12345678901234567890123';
  const { files } = await build({ tables });
  const counts = JSON.parse(files['manifest.json']).counts;

  assert.equal(counts.artworks, 2);
  assert.equal(counts.auctions, 1);
  assert.equal(counts.bids, 2);
  assert.equal(counts.settlements_completed, 1);
  assert.equal(counts.resales, 1);
  assert.equal(counts.participating_addresses, 3);
  assert.equal(counts.settled_volume_wei, '12345678901234567890123');
});

test('a missing table produces an empty section rather than a broken export', async () => {
  const { files } = await build({ tables: {} });
  const manifest = JSON.parse(files['manifest.json']);

  assert.equal(manifest.counts.artworks, 0);
  assert.equal(manifest.counts.participating_addresses, 0);
  assert.equal(manifest.counts.settled_volume_wei, '0');
  assert.equal(JSON.parse(files['participants.json']).count, 0);
});

test('an unreadable cut-off is refused instead of exporting everything', async () => {
  const { buildSnapshot } = await snapshotModule;
  assert.throws(
    () => buildSnapshot({ tables: sampleTables(), chainId: CHAIN_ID, hashText, cutOff: 'last friday' }),
    /ISO-8601/
  );
});

test('an incomplete manifest is rejected even when its root hash is recomputed', async () => {
  const { verifySnapshot, canonicalJson } = await snapshotModule;
  const { files } = await build();
  const { root_hash, ...body } = JSON.parse(files['manifest.json']);
  delete body.files['bids.json'];
  body.sections = body.sections.filter(name => name !== 'bids.json');
  const altered = { ...files, 'manifest.json': canonicalJson({ ...body, root_hash: hashText(canonicalJson(body)) }) };
  delete altered['bids.json'];
  const result = verifySnapshot({ readFile: readerFor(altered), hashText });
  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /required snapshot files/);
});

test('malformed JSON manifest shapes return failures instead of throwing', async () => {
  const { verifySnapshot } = await snapshotModule;
  for (const value of [null, [], 'manifest', 42]) {
    const result = verifySnapshot({ readFile: () => JSON.stringify(value), hashText });
    assert.equal(result.ok, false);
    assert.match(result.problems.join(' '), /JSON object/);
  }
});

test('a trusted root rejects a fully rewritten but internally consistent export', async () => {
  const { verifySnapshot } = await snapshotModule;
  const original = await build();
  const tables = sampleTables();
  tables.v41_settlements[0].final_price = '9000';
  const rewritten = await build({ tables });
  assert.equal(verifySnapshot({ readFile: readerFor(rewritten.files), hashText }).ok, true);
  const result = verifySnapshot({ readFile: readerFor(rewritten.files), hashText, expectedRootHash: original.rootHash });
  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /trusted root hash/);
  assert.equal(verifySnapshot({ readFile: readerFor(original.files), hashText, expectedRootHash: original.rootHash }).ok, true);
});

// Model an archive whose data AND hashes were edited together. Structural
// validation must still reject it; authenticity additionally needs a trusted root.
async function rehash(files) {
  const { canonicalJson } = await snapshotModule;
  const { root_hash, ...body } = JSON.parse(files['manifest.json']);
  for (const name of Object.keys(body.files)) body.files[name] = hashText(files[name]);
  files['manifest.json'] = canonicalJson({ ...body, root_hash: hashText(canonicalJson(body)) });
  return files;
}

test('section contents, participants and totals are checked after hashes agree', async () => {
  const { verifySnapshot } = await snapshotModule;
  const cases = [
    ['bids.json', data => { data.rows = null; }, /invalid section or row count/],
    ['bids.json', data => { data.count++; }, /invalid section or row count/],
    ['bids.json', data => { data.section = 'artworks'; }, /invalid section or row count/],
    ['bids.json', data => { data.private_note = 'unexpected'; }, /invalid section or row count/],
    ['bids.json', data => { data.rows[0].chain_id = '11155111'; }, /different chain/],
    ['bids.json', data => { data.rows[0].bidder = { toString: null }; }, /invalid columns/],
    ['bids.json', data => { data.rows[0].email = 'not-exportable@example.test'; }, /invalid columns/],
    ['bids.json', data => { delete data.rows[0].transaction_hash; }, /invalid columns/],
    ['participants.json', data => { data.addresses.pop(); data.count--; }, /exported participants/],
    ['manifest.json', data => { data.counts.bids++; }, /aggregate counts/],
    ['manifest.json', data => { data.entitlement = 'granted'; }, /entitlement must be none/],
    ['settlements.json', data => { data.rows[0].final_price = 'not a number'; }, /cannot be aggregated/]
  ];
  for (const [name, mutate, expected] of cases) {
    const { files } = await build();
    const data = JSON.parse(files[name]);
    mutate(data);
    files[name] = JSON.stringify(data);
    const result = verifySnapshot({ readFile: readerFor(await rehash(files)), hashText });
    assert.equal(result.ok, false, `${name}: ${expected}`);
    assert.match(result.problems.join(' '), expected);
  }
});

test('manifest names cannot coerce objects and canonical hashing preserves prototype-named keys', async () => {
  const { verifySnapshot, canonicalJson } = await snapshotModule;
  const prototypeNamed = JSON.parse('{"__proto__":{"value":1}}');
  assert.deepEqual(JSON.parse(canonicalJson(prototypeNamed)), prototypeNamed);
  const { files } = await build();
  const originalManifest = files['manifest.json'];
  const addedKey = originalManifest.replace('{', '{"__proto__":{"value":1},');
  assert.equal(verifySnapshot({ readFile: readerFor({ ...files, 'manifest.json': addedKey }), hashText }).ok, false);
  const body = JSON.parse(originalManifest);
  body.sections[0] = { toString: null };
  const malformed = verifySnapshot({ readFile: readerFor({ ...files, 'manifest.json': JSON.stringify(body) }), hashText });
  assert.equal(malformed.ok, false);
  assert.match(malformed.problems.join(' '), /required snapshot files/);
});

test('arbitrary manifest paths are rejected before any data file is read', async () => {
  const { verifySnapshot, canonicalJson } = await snapshotModule;
  for (const replacement of [null, [], '../outside.json', { '../outside.json': 'a'.repeat(64) }]) {
    const { files } = await build();
    const { root_hash, ...body } = JSON.parse(files['manifest.json']);
    body.files = replacement;
    const reads = [];
    const result = verifySnapshot({ hashText, readFile: name => {
      reads.push(name);
      return canonicalJson({ ...body, root_hash: hashText(canonicalJson(body)) });
    } });
    assert.equal(result.ok, false);
    assert.deepEqual(reads, ['manifest.json']);
  }
});

test('invalid JSON in a correctly hashed section fails verification', async () => {
  const { verifySnapshot } = await snapshotModule;
  const { files } = await build();
  files['bids.json'] = '{broken';
  const result = verifySnapshot({ readFile: readerFor(await rehash(files)), hashText });
  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /bids.json is not valid JSON/);
});

test('CLI distinguishes consistency from a trusted copy and rejects incomplete options', async () => {
  const { files, rootHash } = await build();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'artsoul-verifier-'));
  const script = path.join(__dirname, '..', 'scripts', 'verify-snapshot-a.mjs');
  try {
    for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(directory, name), content);
    const run = (...args) => spawnSync(process.execPath, [script, directory, ...args], { encoding: 'utf8' });
    const unanchored = run();
    assert.equal(unanchored.status, 0, unanchored.stderr);
    assert.match(unanchored.stdout, /Authenticity is NOT checked/);
    const trusted = run('--expected-root', rootHash);
    assert.equal(trusted.status, 0, trusted.stderr);
    assert.match(trusted.stdout, /independently supplied trusted capture record/);
    const mismatch = run('--expected-root', '0'.repeat(64));
    assert.equal(mismatch.status, 1);
    assert.match(mismatch.stdout, /trusted root hash/);
    for (const args of [['--expected-root'], ['--expected-root', 'bad'], ['--unknown'], ['--expected-root', rootHash, 'extra']]) {
      const invalid = run(...args);
      assert.equal(invalid.status, 1);
      assert.match(invalid.stderr, /Usage:/);
    }
    fs.writeFileSync(path.join(directory, 'manifest.json'), 'null');
    const invalidManifest = run();
    assert.equal(invalidManifest.status, 1);
    assert.match(invalidManifest.stdout, /JSON object/);

    // Archive the verifier with its one local module; no repository or npm
    // installation is needed when a durable copy is checked after migration.
    fs.writeFileSync(path.join(directory, 'manifest.json'), files['manifest.json']);
    const toolsDir = path.join(directory, 'verification-tools');
    fs.mkdirSync(path.join(toolsDir, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(toolsDir, 'src', 'snapshot'), { recursive: true });
    fs.writeFileSync(path.join(toolsDir, 'package.json'), '{"type":"module"}\n');
    fs.copyFileSync(script, path.join(toolsDir, 'scripts', 'verify-snapshot-a.mjs'));
    fs.copyFileSync(path.join(__dirname, '..', 'src', 'snapshot', 'snapshot-a.js'), path.join(toolsDir, 'src', 'snapshot', 'snapshot-a.js'));
    const isolated = spawnSync(process.execPath, [path.join(toolsDir, 'scripts', 'verify-snapshot-a.mjs'), directory,
      '--expected-root', rootHash], { cwd: directory, encoding: 'utf8', env: { ...process.env, DATABASE_URL: '', SUPABASE_URL: '' } });
    assert.equal(isolated.status, 0, isolated.stderr);
    assert.match(isolated.stdout, /trusted capture record/);
  } finally {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('artsoul-verifier-'));
    fs.rmSync(directory, { recursive: true });
  }
});

test('export refuses existing output and missing cut-off before any database connection', async () => {
  const { writeSnapshotFiles } = await import('../scripts/export-snapshot-a.mjs');
  const { files } = await build();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'artsoul-export-'));
  const directory = path.join(root, 'capture');
  const script = path.join(__dirname, '..', 'scripts', 'export-snapshot-a.mjs');
  try {
    writeSnapshotFiles(directory, files);
    assert.throws(() => writeSnapshotFiles(directory, { 'manifest.json': 'replacement' }), /EEXIST/);
    assert.equal(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'), files['manifest.json']);
    const run = (...args) => spawnSync(process.execPath, [script, ...args], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: '' }
    });
    const existing = run('--out', directory, '--cut-off', '2026-10-28T00:00:00Z');
    assert.equal(existing.status, 1);
    assert.match(existing.stderr, /Output directory already exists/);
    const missingCutOff = run('--out', path.join(root, 'new'));
    assert.equal(missingCutOff.status, 1);
    assert.match(missingCutOff.stderr, /explicit ISO-8601/);
    assert.equal(fs.existsSync(path.join(root, 'new')), false);
  } finally {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('artsoul-export-'));
    fs.rmSync(root, { recursive: true });
  }
});
