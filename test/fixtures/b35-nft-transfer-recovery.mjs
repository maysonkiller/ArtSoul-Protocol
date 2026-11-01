// Standalone B35 gap reproducer, deliberately outside the passing unit suite.
// Run: node --test test/fixtures/b35-nft-transfer-recovery.mjs
// Desired transfer outcomes currently fail. This never connects to RPC or DB,
// and retained snapshots are fixture inputs, not proof of SQL rollback.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { ethers } from 'ethers';
import EventListener from '../../src/indexer/event-listener.js';
import { V41_CORE_ABI } from '../../src/indexer/v4-1-event-schema.js';

const CHAIN = 84532, LEGACY_CHAIN = 11155111;
const address = byte => `0x${byte.repeat(40)}`;
const CORE = address('1'), NFT = address('2'), FOREIGN_NFT = address('3');
const CREATOR = address('4'), A = address('5'), B = address('6'), C = address('7'), D = address('8');
const ZERO = address('0'), FOREIGN_OWNER = address('9');
const TOKEN = '900', ARTWORK = '77', AUCTION = '500', FLOOR = '2000000000000000000';
const hash = value => `0x${value.toString(16).padStart(64, '0')}`;
const coreInterface = new ethers.Interface(V41_CORE_ABI);
const nftInterface = new ethers.Interface(['event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)']);

function log(iface, name, args, source, block, index, chain = CHAIN) {
  return { ...iface.encodeEventLog(iface.getEvent(name), args), address: source,
    blockNumber: block, index, transactionHash: hash(block), blockHash: hash(block + 1000),
    fixtureChainId: chain };
}
const mint = log(nftInterface, 'Transfer', [ZERO, A, TOKEN], NFT, 100, 1);
const settlement = log(coreInterface, 'SettlementCompleted', [AUCTION, ARTWORK, A, FLOOR, TOKEN], CORE, 100, 4);
const toB = log(nftInterface, 'Transfer', [A, B, TOKEN], NFT, 110, 3);
const toC = log(nftInterface, 'Transfer', [B, C, TOKEN], NFT, 110, 9);
const toD = log(nftInterface, 'Transfer', [C, D, TOKEN], NFT, 120, 1);
const foreign = [
  log(nftInterface, 'Transfer', [A, FOREIGN_OWNER, TOKEN], FOREIGN_NFT, 110, 10),
  log(nftInterface, 'Transfer', [A, FOREIGN_OWNER, TOKEN], NFT, 110, 11, LEGACY_CHAIN),
  log(nftInterface, 'Transfer', [A, FOREIGN_OWNER, '901'], NFT, 110, 12)
];
function eventRow(raw) {
  const iface = raw.address === CORE ? coreInterface : nftInterface;
  const parsed = iface.parseLog(raw);
  return { chain_id: raw.fixtureChainId, contract_address: raw.address,
    event_name: parsed.name, event_data: Object.fromEntries(parsed.fragment.inputs.map((input, index) =>
      [input.name, String(parsed.args[index])])), block_number: raw.blockNumber,
    transaction_hash: raw.transactionHash, log_index: raw.index,
    indexed_at: new Date(Date.UTC(2026, 9, 1, 0, 0, raw.blockNumber)).toISOString() };
}

function snapshot(transfers = [], boundary = 121) {
  // Model the retained facts only. Production rollback is not invoked here.
  const retained = [mint, settlement, ...transfers].map(eventRow).filter(row => row.block_number < boundary);
  const row = { chain_id: CHAIN, artwork_id: ARTWORK, creator: CREATOR,
    minted: boundary > 100, token_id: boundary > 100 ? TOKEN : '', canonical_floor: boundary > 100 ? FLOOR : '0',
    metadata_uri: 'https://fixture.invalid/metadata', active_auction_id: '',
    block_number: 90, transaction_hash: hash(90), log_index: 0,
    indexed_at: '2026-10-01T00:00:00.000Z', last_updated_at: '2026-10-01T00:00:00.000Z' };
  const completed = { ...eventRow(settlement), auction_id: AUCTION, artwork_id: ARTWORK,
    winner: A, final_price: FLOOR, token_id: TOKEN, settlement_status: 'completed' };
  return {
    v41_artworks: [row, { ...row, chain_id: LEGACY_CHAIN }],
    v41_settlements: boundary > 100 ? [completed, { ...completed, chain_id: LEGACY_CHAIN, winner: FOREIGN_OWNER }] : [],
    v41_auctions: [], v41_auction_endings: [], v41_bids: [], v41_floor_history: [],
    v41_resale_history: [], v41_resale_listings: [], v41_trust_signals: [],
    artwork_social_signals: [], artwork_moderation_visibility: [], profiles: [],
    contract_events: retained
  };
}

// Apply the handlers' actual REST filters, including JSON event fields. Unknown
// sources fail rather than silently making new production reads appear covered.
function rowsFor(path, fixtures) {
  const [table, queryString] = path.split('?');
  assert.ok(Object.hasOwn(fixtures, table), `Unexpected fixture source: ${table}`);
  const query = new URLSearchParams(queryString);
  let rows = [...fixtures[table]];
  for (const [key, filter] of query) {
    if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
    const value = row => key.startsWith('event_data->>') ? row.event_data?.[key.slice(13)] : row[key];
    if (filter.startsWith('eq.')) rows = rows.filter(row => String(value(row)) === filter.slice(3));
    else if (filter.startsWith('in.(')) rows = rows.filter(row => filter.slice(4, -1).split(',').includes(String(value(row))));
    else assert.fail(`Unsupported fixture filter: ${key}=${filter}`);
  }
  for (const term of (query.get('order') || '').split(',').reverse()) {
    if (!term) continue;
    const [key, direction] = term.split('.');
    rows.sort((left, right) => (Number(left[key] || 0) - Number(right[key] || 0)) * (direction === 'desc' ? -1 : 1));
  }
  assert.ok(Number(query.get('limit')) > 0, `Unbounded fixture read: ${path}`);
  return rows.slice(0, Number(query.get('limit')));
}

async function readProjection(route, fixtures, chain = CHAIN) {
  // Reuse the existing public-projection suite's VM injection technique. The
  // real handler runs; backend imports are replaced without reading .env.
  const source = readFileSync(new URL(`../../src/api/routes/public/${route}.js`, import.meta.url), 'utf8')
    .replace(/^import[^\n]*\n/gm, '')
    .replace('export default async function handler', 'this.handler = async function handler')
    .replace(/^export (?!default)/gm, '');
  const context = vm.createContext({
    allowMethods: () => true, supabaseRest: async path => rowsFor(path, fixtures),
    validateArtworkId: value => String(value ?? '').trim() || null, getModerationAccess: async () => ({ canModerate: false }),
    sendError: (_res, error) => { throw error; },
    readArtworkMetadata: async () => ({ name: 'Offline transfer fixture', image: 'https://fixture.invalid/art.png' }),
    fetch: () => { throw new Error('Network access is forbidden in this fixture'); },
    process: { env: {} }, Buffer, console: { warn() {}, error() {}, log() {} }
  });
  const valuation = readFileSync(new URL('../../src/features/artwork/ai-valuation-values.js', import.meta.url), 'utf8')
    .replace(/^export /gm, '');
  vm.runInContext(`${valuation}\n${source}`, context);
  const response = { statusCode: 200, setHeader() {},
    status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await context.handler({ method: 'GET', query: { chain_id: String(chain), artwork_id: ARTWORK } }, response);
  assert.equal(response.statusCode, 200);
  return JSON.parse(JSON.stringify(response.body));
}

async function assertRoles(fixtures, expectedOwner, chain = CHAIN) {
  const provenance = await readProjection('artwork-provenance', fixtures, chain);
  const cards = await readProjection('artworks', fixtures, chain);
  const card = cards.data[0];
  assert.ok(card, 'fixture artwork must be present in the public projection');
  const expectedFirst = fixtures.v41_artworks[0].minted ? (chain === CHAIN ? A : FOREIGN_OWNER) : null;
  assert.equal(provenance.roles.first_collector_address, expectedFirst);
  assert.equal(card.auction_winner_address, expectedFirst);
  assert.equal(card.canonical_floor, expectedFirst ? '2' : '0');
  assert.equal(provenance.events.filter(event => event.type === 'resale_completed').length, 0);
  assert.equal(card.current_owner_address, expectedOwner, 'public card owner must follow the latest retained NFT transfer');
  assert.equal(provenance.roles.current_owner_address, expectedOwner, 'provenance owner must follow the latest retained NFT transfer');
  return provenance;
}

test('fixture uses standard NFT logs and contains no marketplace sale', () => {
  assert.equal(nftInterface.parseLog(toB).args.from, A);
  assert.equal(nftInterface.parseLog(toB).args.to, B);
  assert.equal(nftInterface.parseLog(toB).args.tokenId, BigInt(TOKEN));
  assert.equal(coreInterface.parseLog(settlement).name, 'SettlementCompleted');
  const retained = snapshot([toD, toC, toB, ...foreign], 111).contract_events;
  assert.ok(retained.some(row => row.log_index === 9 && row.block_number === 110));
  assert.ok(!retained.some(row => row.block_number === 120));
  assert.ok(!retained.some(row => row.event_name === 'ResaleCompleted'));
});

test('completed settlement without a subsequent transfer preserves the existing owner and floor', async () => {
  await assertRoles(snapshot(), A);
});

test('listener ingests only the configured NFT deployment with block and log ordering', async () => {
  const calls = [];
  const listener = Object.create(EventListener.prototype);
  Object.assign(listener, { contractAddress: CORE, contract: { interface: coreInterface }, chainId: CHAIN,
    nftAddress: NFT, nftInterface, donationAddress: '', maxBlockRange: 1000, maxBlockRangeLimit: 1000,
    provider: { async getLogs(filter) {
      calls.push(filter);
      // A provider returns logs for its own chain; deployment filtering remains
      // the production listener's responsibility even if a provider overreturns.
      return [toD, foreign[0], toC, settlement, toB, mint];
    } }, _retryRpcCall: operation => operation() });
  const events = await listener._queryLogsChunk(100, 120);
  assert.deepEqual(events.map(event => [event.eventName, event.blockNumber, event.logIndex]), [
    ['Transfer', 100, 1], ['SettlementCompleted', 100, 4],
    ['Transfer', 110, 3], ['Transfer', 110, 9], ['Transfer', 120, 1]
  ]);
  assert.equal(calls.length, 1);
  assert.ok([calls[0].address].flat().includes(NFT), 'bounded deployment filter must include the NFT');
});

test('a retained wallet transfer changes current owner without changing First Collector or floor', async () => {
  await assertRoles(snapshot([toB]), B);
});

test('provenance owner follows a retained transfer even without a resale event', async () => {
  const provenance = await readProjection('artwork-provenance', snapshot([toB]));
  assert.equal(provenance.roles.current_owner_address, B);
});

test('provenance exposes the retained non-sale transfer in its timeline', async () => {
  const provenance = await readProjection('artwork-provenance', snapshot([toB]));
  const movement = provenance.events.find(event => event.transaction_hash === toB.transactionHash && event.log_index === toB.index);
  assert.ok(movement, 'retained NFT movement must appear in the indexer-backed timeline');
  assert.notEqual(movement.type, 'resale_completed');
  assert.equal(movement.price, undefined, 'wallet movement must not invent a sale price');
});

test('later retained transfer wins by log order despite shuffled rows and foreign records', async () => {
  await assertRoles(snapshot([toC, ...foreign, toB]), C);
});

test('rewound snapshot restores the last retained owner instead of an orphaned recipient', async () => {
  await assertRoles(snapshot([toD, toC, ...foreign, toB], 111), C);
});

test('rewound snapshot before all wallet transfers restores the First Collector as owner', async () => {
  await assertRoles(snapshot([toD, toC, toB], 101), A);
});

test('rewound snapshot before settlement never invents an NFT owner or floor', async () => {
  await assertRoles(snapshot([toD, toC, toB], 100), null);
});

test('historical chain without transfer coverage retains its own settlement identity', async () => {
  await assertRoles(snapshot([toB, toC]), FOREIGN_OWNER, LEGACY_CHAIN);
});
