// B-05: the Snapshot A exporter and verifier.
//
// Snapshot A is captured once, on an announced date, before a destructive
// reset, and it cannot be recaptured afterwards. Every test here exists because
// the failure it guards against would be discovered on the one day nothing can
// be done about it.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
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
      { chain_id: '84532', auction_id: '19', artwork_id: '19', creator: CREATOR, start_price: '1000', duration_seconds: 129600, end_time: '2026-07-05T02:20:10Z', status: 'settled', winner: COLLECTOR, winning_bid: '1000', indexed_at: '2026-07-03T14:20:47Z' }
    ],
    v41_bids: [
      { chain_id: '84532', auction_id: '19', bidder: COLLECTOR, bid_amount: '1000', deposit: '100', block_number: 1, transaction_hash: '0xaa', indexed_at: '2026-07-04T00:00:00Z' },
      { chain_id: '84532', auction_id: '19', bidder: BIDDER, bid_amount: '900', deposit: '90', block_number: 2, transaction_hash: '0xbb', indexed_at: '2026-07-04T01:00:00Z' }
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
      { chain_id: '84532', artwork_id: '19', floor_price: '1000', source: 'settlement', indexed_at: '2026-07-05T07:46:19Z' }
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
