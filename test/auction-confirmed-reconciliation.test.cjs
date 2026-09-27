const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const { ethers } = require('ethers');

const CHAIN = 84532;
const HASH = `0x${'12'.repeat(32)}`;
const REPLACEMENT_HASH = `0x${'34'.repeat(32)}`;
const CORE = `0x${'ab'.repeat(20)}`;
const CREATOR = `0x${'cd'.repeat(20)}`;
const STORAGE_KEY = 'artsoul_confirmed_auctions_v1';
const clientSource = fs.readFileSync('supabase-client.js', 'utf8');
const adapterSource = fs.readFileSync('contracts-integration.js', 'utf8').replace(/^import .*;\r?\n/gm, '');
const quiet = { log() {}, warn() {}, error() {} };
const plain = value => JSON.parse(JSON.stringify(value));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function clock() {
  let now = Date.parse('2026-09-21T12:00:00Z');
  return {
    Date: class extends Date { static now() { return now; } },
    advance(milliseconds) { now += milliseconds; }
  };
}

function row(overrides = {}) {
  return {
    id: 'v41:84532:28', chain_id: CHAIN, artwork_id: '28',
    auction_id: '62', active_auction_id: '62', status: 'awaiting_end',
    creator: CREATOR, current_owner_address: null, first_collector_address: null,
    canonical_floor: '0', minted: false, token_id: null,
    title: 'Indexed metadata', image_url: 'https://images.example/28.png',
    start_price: '0.1', current_bid: '0', highest_bid: '0', bids: [],
    ...overrides
  };
}

function confirmed(overrides = {}) {
  return {
    chain_id: CHAIN, artwork_id: '28', auction_id: '63',
    transaction_hash: HASH, block_number: 100, kind: 'created',
    patch: { start_price: '0.001', auction_end_time: 1790000000 },
    ...overrides
  };
}

// Separate VM globals represent separate browser tabs; only storage is shared.
// HTTP and chain calls are local doubles. No wallet or remote write is used.
function client({ store = new Map(), time = clock(), reply = () => ({ data: [] }), storageFails = false, storageWriteFails = false } = {}) {
  const requests = [];
  const events = [];
  const listeners = new Map();
  const window = {
    localStorage: {
      getItem(key) { if (storageFails) throw new Error('Storage unavailable'); return store.get(key) ?? null; },
      setItem(key, value) { if (storageFails || storageWriteFails) throw new Error('Storage unavailable'); store.set(key, value); }
    },
    addEventListener(type, callback) { listeners.set(type, [...(listeners.get(type) || []), callback]); },
    dispatchEvent(event) {
      events.push(event);
      for (const callback of listeners.get(event.type) || []) callback(event);
    }
  };
  const context = vm.createContext({
    window, document: {}, console: quiet, URL, URLSearchParams, Date: time.Date,
    CustomEvent: class { constructor(type, options = {}) { this.type = type; Object.assign(this, options); } },
    fetch: async (path, init) => {
      requests.push({ url: new URL(path, 'https://artsoul.example'), init });
      const response = await reply(requests.at(-1).url, init);
      if (response instanceof Error) throw response;
      return { ok: true, text: async () => JSON.stringify(response) };
    }
  });
  vm.runInContext(clientSource, context, { filename: 'supabase-client.js' });
  return { db: window.ArtSoulDB, requests, events, store, time, window };
}

test('a confirmed re-auction replaces the stale previous round without changing indexed provenance', () => {
  const { db } = client();
  db.recordConfirmedAuction(confirmed({ patch: {
    start_price: '0.001', auction_end_time: 1790000000,
    creator: 'attacker', current_owner_address: 'attacker', first_collector_address: 'attacker',
    canonical_floor: '9000', token_id: '99', minted: true, title: 'Injected', image_url: 'javascript:alert(1)',
    trust_weight: 100, genesis: true
  } }));
  const original = row();
  const updated = db.applyConfirmedAuctionUpdate(original);
  assert.equal(updated.auction_id, '63');
  assert.equal(updated.active_auction_id, '63');
  assert.equal(updated.status, 'auction');
  assert.equal(updated.start_price, '0.001');
  assert.equal(updated.pending_auction_sync, true);
  for (const key of ['creator', 'current_owner_address', 'first_collector_address', 'canonical_floor', 'token_id', 'minted', 'title', 'image_url']) {
    assert.equal(updated[key], original[key], `${key} remains indexed truth`);
  }
  assert.equal(updated.trust_weight, undefined);
  assert.equal(updated.genesis, undefined);
  assert.equal(original.auction_id, '62', 'the cached response is not mutated');
});

test('an exact artwork read distinguishes network failure from a successful empty projection', async () => {
  const offline = client({ reply: () => new Error('Network failure') });
  await assert.rejects(offline.db.getArtwork('v41:84532:28'), { code: 'ARTWORK_READ_UNAVAILABLE' });
  const hidden = client({ reply: () => ({ data: [], suppressed_artwork_ids: ['v41:84532:28'] }) });
  await assert.rejects(hidden.db.getArtwork('v41:84532:28'), { code: 'V41_ARTWORK_NOT_INDEXED' });
});

test('confirmed no-bid end remains terminal while the indexer still returns the expired active round', () => {
  const { db } = client();
  db.recordConfirmedAuction(confirmed({ kind: 'ended', auction_id: '62', patch: { has_winner: false } }));
  const updated = db.applyConfirmedAuctionUpdate(row());
  assert.equal(updated.status, 'ended_no_bids');
  assert.equal(updated.active_auction_id, '');
  assert.equal(updated.auction_id, '62');
  assert.equal(updated.minted, false);
  assert.equal(updated.canonical_floor, '0');
});

test('winner finalization and default bridge only the expected lifecycle transition', () => {
  const { db } = client();
  db.recordConfirmedAuction(confirmed({ kind: 'ended', auction_id: '62', patch: { has_winner: true, settlement_deadline: 1790086400 } }));
  const pending = db.applyConfirmedAuctionUpdate(row());
  assert.equal(pending.status, 'settlement_pending');
  assert.equal(pending.active_auction_id, '62');
  assert.equal(pending.settlement_deadline, 1790086400);
  db.recordConfirmedAuction(confirmed({ kind: 'defaulted', auction_id: '62', block_number: 101, patch: {} }));
  assert.equal(db.applyConfirmedAuctionUpdate(pending).status, 'defaulted');
});

test('older receipts never regress a newer indexed auction or a settled current round', () => {
  const { db } = client();
  db.recordConfirmedAuction(confirmed());
  for (const original of [
    row({ auction_id: '64', active_auction_id: '64', status: 'auction', current_bid: '0.4' }),
    row({ auction_id: '63', active_auction_id: '', status: 'sold', minted: true, canonical_floor: '0.3' }),
    row({ auction_id: '63', active_auction_id: '63', status: 'settlement_pending', current_bid: '0.3' })
  ]) assert.deepEqual(plain(db.applyConfirmedAuctionUpdate(original)), original);
  db.recordConfirmedAuction(confirmed({ auction_id: '62', block_number: 99 }));
  assert.equal(db.confirmedAuctionUpdates()[0].auction_id, '63', 'out-of-order completion cannot replace a newer receipt');
});

test('a late completion notification from the previous round cannot replace a re-auction in the same block', () => {
  const { db } = client();
  db.recordConfirmedAuction(confirmed({ auction_id: '63', block_number: 100 }));
  db.recordConfirmedAuction(confirmed({ auction_id: '62', block_number: 100, kind: 'ended', patch: { has_winner: false } }));
  assert.equal(db.applyConfirmedAuctionUpdate(row()).auction_id, '63');
  assert.equal(db.applyConfirmedAuctionUpdate(row()).status, 'auction');
});

test('chain and artwork identifiers isolate the bridge even when numeric ids collide', () => {
  const { db } = client();
  db.recordConfirmedAuction(confirmed());
  for (const original of [row({ chain_id: 11155111 }), row({ artwork_id: '29' })]) {
    assert.deepEqual(plain(db.applyConfirmedAuctionUpdate(original)), original);
  }
  db.recordConfirmedAuction(confirmed({ chain_id: 11155111, auction_id: '90' }));
  assert.equal(db.confirmedAuctionUpdates().length, 1, 'legacy chain records are not activated');
  assert.equal(db.applyConfirmedAuctionUpdate(row()).auction_id, '63');
});

test('same-origin second tab receives the refresh signal and reads the receipt from shared storage', () => {
  const store = new Map();
  const first = client({ store });
  const second = client({ store });
  first.db.recordConfirmedAuction(confirmed());
  second.window.dispatchEvent({ type: 'storage', key: STORAGE_KEY, newValue: store.get(STORAGE_KEY) });
  assert.equal(second.events.filter(event => event.type === 'artsoul:auction-confirmed').length, 1);
  assert.equal(second.db.applyConfirmedAuctionUpdate(row()).auction_id, '63');
  second.window.dispatchEvent({ type: 'storage', key: 'another-feature' });
  assert.equal(second.events.filter(event => event.type === 'artsoul:auction-confirmed').length, 1);
});

test('receipt records are bounded, expire, and reject malformed persisted identities', () => {
  const { db, time, store } = client();
  for (let i = 1; i <= 25; i += 1) db.recordConfirmedAuction(confirmed({ artwork_id: String(i), block_number: i }));
  assert.equal(db.confirmedAuctionUpdates().length, 20);
  time.advance(10 * 60 * 1000);
  assert.equal(db.confirmedAuctionUpdates().length, 0);
  const invalid = [
    confirmed({ artwork_id: '../28' }), confirmed({ auction_id: '-1' }),
    confirmed({ transaction_hash: 'pending' }), confirmed({ block_number: 0 }),
    confirmed({ kind: 'minted' }), confirmed({ chain_id: 1 })
  ].map(value => ({ ...value, confirmed_at: time.Date.now() }));
  store.set(STORAGE_KEY, JSON.stringify(invalid));
  assert.equal(db.confirmedAuctionUpdates().length, 0);
});

test('storage denial preserves confirmed state in the current tab without failing the action', () => {
  const { db } = client({ storageFails: true });
  assert.doesNotThrow(() => db.recordConfirmedAuction(confirmed()));
  assert.equal(db.applyConfirmedAuctionUpdate(row()).auction_id, '63');
});

test('storage quota failure preserves the in-memory receipt when existing storage is still readable', () => {
  const { db } = client({ storageWriteFails: true });
  db.recordConfirmedAuction(confirmed());
  assert.equal(db.applyConfirmedAuctionUpdate(row()).auction_id, '63');
});

test('a delayed list response is reconciled against the receipt that arrived after its request began', async () => {
  const oldResponse = deferred();
  const { db } = client({ reply: url => url.searchParams.has('fresh') ? { data: [row()] } : oldResponse.promise });
  const request = db.getPublicProjectionArtworks({ chain_id: CHAIN });
  db.recordConfirmedAuction(confirmed());
  oldResponse.resolve({ data: [row()] });
  const result = await request;
  assert.equal(result[0].auction_id, '63');
  assert.equal(result[0].status, 'auction');
});

test('fresh receipt recovery reads at most four exact artworks and preserves list metadata', async () => {
  const { db, requests } = client({ reply: url => ({
    data: url.searchParams.has('fresh') ? [] : [row()],
    public_metrics: { auctions_completed: 8 }, suppressed_artwork_ids: ['v41:84532:99']
  }) });
  for (let i = 21; i <= 28; i += 1) db.recordConfirmedAuction(confirmed({ artwork_id: String(i), block_number: i }));
  const result = await db.getPublicProjectionArtworks({ chain_id: CHAIN });
  const fresh = requests.filter(request => request.url.searchParams.get('fresh') === '1');
  assert.equal(fresh.length, 4);
  for (const { url } of fresh) {
    assert.equal(url.searchParams.get('chain_id'), String(CHAIN));
    assert.match(url.searchParams.get('artwork_id'), /^\d+$/);
    assert.equal(url.searchParams.get('limit'), '1');
  }
  assert.equal(result[0].auction_id, '63');
  assert.deepEqual(plain(result.public_metrics), { auctions_completed: 8 });
  assert.deepEqual(plain(result.suppressed_artwork_ids), ['v41:84532:99']);
});

test('fresh recovery is isolated to requested chain and exact artwork', async () => {
  const { db, requests } = client();
  db.recordConfirmedAuction(confirmed());
  await db.getPublicProjectionArtworks({ chain_id: 11155111, artwork_id: '28' });
  await db.getPublicProjectionArtworks({ chain_id: CHAIN, artwork_id: '29' });
  assert.equal(requests.filter(request => request.url.searchParams.has('fresh')).length, 0);
});

test('an exact fresh projection can restore a new auction omitted from a stale filtered list', async () => {
  const { db } = client({ reply: url => ({ data: url.searchParams.has('fresh') ? [row()] : [] }) });
  db.recordConfirmedAuction(confirmed());
  const result = await db.getPublicProjectionArtworks({ chain_id: CHAIN, view: 'auctions' });
  assert.equal(result.length, 1);
  assert.equal(result[0].auction_id, '63');
  assert.equal(result[0].status, 'auction');
});

test('an exact refresh with an older cached round cannot regress a newer list projection', async () => {
  const newer = row({ auction_id: '64', active_auction_id: '64', status: 'auction', current_bid: '0.5' });
  const older = row({ auction_id: '63', active_auction_id: '63', status: 'auction', current_bid: '0' });
  const { db } = client({ reply: url => ({ data: [url.searchParams.has('fresh') ? older : newer] }) });
  db.recordConfirmedAuction(confirmed());
  const result = await db.getPublicProjectionArtworks({ chain_id: CHAIN });
  assert.equal(result[0].auction_id, '64');
  assert.equal(result[0].current_bid, '0.5');
});

test('an exact refresh cannot revive a current round already finalized in the list projection', async () => {
  const terminal = row({ auction_id: '63', active_auction_id: '', status: 'ended_no_bids' });
  const active = row({ auction_id: '63', active_auction_id: '63', status: 'auction' });
  const { db } = client({ reply: url => ({ data: [url.searchParams.has('fresh') ? active : terminal] }) });
  db.recordConfirmedAuction(confirmed());
  const result = await db.getPublicProjectionArtworks({ chain_id: CHAIN });
  assert.equal(result[0].status, 'ended_no_bids');
  assert.equal(result[0].active_auction_id, '');
});

test('a receipt cannot invent an absent or suppressed artwork or add another creator to a profile', async () => {
  const absent = client();
  absent.db.recordConfirmedAuction(confirmed());
  assert.equal((await absent.db.getPublicProjectionArtworks({ chain_id: CHAIN })).length, 0);
  const otherCreator = client({ reply: url => ({ data: url.searchParams.has('fresh') ? [row()] : [] }) });
  otherCreator.db.recordConfirmedAuction(confirmed());
  assert.equal((await otherCreator.db.getPublicProjectionArtworks({ creator: '0xAnotherCreator' })).length, 0);
});

test('fresh suppression removes a stale listed card and a receipt never restores the suppressed artwork', async () => {
  const { db } = client({ reply: url => url.searchParams.has('fresh')
    ? { data: [], suppressed_artwork_ids: ['v41:84532:28'] }
    : { data: [row()], suppressed_artwork_ids: [] } });
  db.recordConfirmedAuction(confirmed());
  const rows = await db.getPublicProjectionArtworks({ chain_id: CHAIN });
  assert.equal(rows.length, 0);
  assert.deepEqual(plain(rows.suppressed_artwork_ids), ['v41:84532:28'], 'Downstream merges retain the latest moderation suppression');
  assert.equal((await db.getPublicProjectionArtworks({ chain_id: CHAIN, view: 'auctions' })).length, 0);
  db.recordConfirmedAuction(confirmed({ auction_id: '64', block_number: 101 }));
  assert.equal((await db.getPublicProjectionArtworks({ chain_id: CHAIN })).length, 0);
});

test('a list suppression wins over an older visible exact projection', async () => {
  const { db } = client({ reply: url => url.searchParams.has('fresh')
    ? { data: [row()], suppressed_artwork_ids: [] }
    : { data: [], suppressed_artwork_ids: ['v41:84532:28'] } });
  db.recordConfirmedAuction(confirmed());
  const rows = await db.getPublicProjectionArtworks({ chain_id: CHAIN });
  assert.equal(rows.length, 0);
  assert.deepEqual(plain(rows.suppressed_artwork_ids), ['v41:84532:28']);
});

test('receipt bridge survives a failed exact read and excludes ended auctions from the live list', async () => {
  const { db } = client({ reply: url => url.searchParams.has('fresh') ? new Error('Read outage') : { data: [row()] } });
  db.recordConfirmedAuction(confirmed());
  assert.equal((await db.getPublicProjectionArtworks({ view: 'auctions' }))[0].auction_id, '63');
  db.recordConfirmedAuction(confirmed({ kind: 'ended', block_number: 101, patch: { has_winner: false } }));
  assert.equal((await db.getPublicProjectionArtworks({ view: 'auctions' })).length, 0);
});

function adapter({ tx, recordError, eventName = 'AuctionCreated' } = {}) {
  const records = [];
  const window = { ArtSoulDB: { recordConfirmedAuction(value) { if (recordError) throw recordError; records.push(value); } } };
  vm.runInNewContext(`${adapterSource}\nwindow.testCoreABI = CORE_ABI;`, { window, ethers, console: quiet });
  const api = window.ArtSoulContracts;
  const iface = new ethers.Interface(window.testCoreABI);
  api.ensureBaseSepoliaWrite = async () => {};
  api.coreContract = {
    interface: iface, getAddress: async () => CORE,
    createAuction: async () => tx,
    auctions: async () => ({ status: 1, artworkId: 28n }),
    endAuction: async () => tx,
    claimSettlementDefault: async () => tx
  };
  const args = eventName === 'AuctionCreated' ? [63n, 28n, CREATOR, ethers.parseEther('0.001'), 86400n, 1790000000n, BigInt(CHAIN)]
    : eventName === 'AuctionEnded' ? [63n, ethers.ZeroAddress, 0n, 0n] : [63n, CREATOR, 8n, 2n];
  const encoded = iface.encodeEventLog(iface.getEvent(eventName), args);
  const receipt = { status: 1, hash: HASH, blockNumber: 100, logs: [{ ...encoded, address: CORE }] };
  return { api, records, receipt };
}

test('submitting an auction does not publish receipt state before a successful confirmation', async () => {
  const pending = deferred();
  const submitted = deferred();
  const tx = { hash: HASH, wait: () => pending.promise };
  const { api, records, receipt } = adapter({ tx });
  const action = api.createAuction(28, '0.001', 24, { onSubmitted: () => submitted.resolve() });
  await submitted.promise;
  assert.equal(records.length, 0);
  pending.resolve(receipt);
  assert.equal(await action, HASH);
  assert.equal(records.length, 1);
  assert.equal(records[0].artwork_id, '28');
  assert.equal(records[0].auction_id, '63');
  assert.equal(records[0].chain_id, CHAIN);
  assert.equal(records[0].patch.start_price, '0.001');
});

test('revert and wallet rejection never publish a confirmed auction', async () => {
  for (const wait of [async () => null, async () => ({ status: 0 }), async () => { throw Object.assign(new Error('Rejected'), { code: 'ACTION_REJECTED' }); }]) {
    const { api, records } = adapter({ tx: { hash: HASH, wait } });
    await assert.rejects(() => api.createAuction(28, '0.001', 24));
    assert.equal(records.length, 0);
  }
});

test('a verified gas-only replacement publishes the actual confirmed replacement hash', async () => {
  const tx = { hash: HASH, to: CORE, data: '0x123456', value: 0n };
  const { api, records, receipt } = adapter({ tx });
  const replacementReceipt = { ...receipt, hash: REPLACEMENT_HASH };
  tx.wait = async () => { throw {
    code: 'TRANSACTION_REPLACED', cancelled: false, reason: 'repriced',
    replacement: { to: CORE.toUpperCase(), data: tx.data, value: 0n }, receipt: replacementReceipt
  }; };
  assert.equal(await api.createAuction(28, '0.001', 24), REPLACEMENT_HASH);
  assert.equal(records[0].transaction_hash, REPLACEMENT_HASH);
});

test('cancelled, reverted, or different-intent replacements cannot be recorded as successful', async () => {
  const variations = [
    { cancelled: true }, { reason: 'cancelled' }, { reason: 'replaced' },
    { replacement: { to: CREATOR, data: '0x123456', value: 0n } },
    { replacement: { to: CORE, data: '0x999999', value: 0n } },
    { replacement: { to: CORE, data: '0x123456', value: 1n } },
    { receipt: { status: 0 } }
  ];
  for (const variation of variations) {
    const tx = { hash: HASH, to: CORE, data: '0x123456', value: 0n };
    const { api, records, receipt } = adapter({ tx });
    tx.wait = async () => { throw {
      code: 'TRANSACTION_REPLACED', cancelled: false, reason: 'repriced',
      replacement: { to: CORE, data: tx.data, value: tx.value }, receipt, ...variation
    }; };
    await assert.rejects(() => api.createAuction(28, '0.001', 24));
    assert.equal(records.length, 0);
  }
});

test('terminal receipt events identify the artwork through the auction rather than the auction number', async () => {
  for (const eventName of ['AuctionEnded', 'SettlementDefaulted']) {
    const tx = { hash: HASH };
    const { api, records, receipt } = adapter({ tx, eventName });
    tx.wait = async () => receipt;
    await (eventName === 'AuctionEnded' ? api.endAuction(63) : api.claimSettlementDefault(63));
    assert.equal(records[0].artwork_id, '28');
    assert.equal(records[0].auction_id, '63');
    assert.equal(records[0].kind, eventName === 'AuctionEnded' ? 'ended' : 'defaulted');
    assert.equal(records[0].patch.has_winner, false);
  }
});

test('missing events do not fabricate a receipt record and local persistence failure does not undo confirmation', async () => {
  const tx = { hash: HASH };
  const noEvent = adapter({ tx });
  tx.wait = async () => ({ ...noEvent.receipt, logs: [] });
  assert.equal(await noEvent.api.createAuction(28, '0.001', 24), HASH);
  assert.equal(noEvent.records.length, 0);
  const unavailable = adapter({ tx, recordError: new Error('Storage unavailable') });
  tx.wait = async () => unavailable.receipt;
  assert.equal(await unavailable.api.createAuction(28, '0.001', 24), HASH);
});

function publicProjection() {
  const time = clock();
  const calls = [];
  let auctionId = '62';
  const future = '2099-01-01T00:00:00.000Z';
  const source = fs.readFileSync('src/api/routes/public/artworks.js', 'utf8')
    .replace(/^import[^\n]*\n/gm, '')
    .replace('export default async function handler', 'this.handler = async function handler');
  const context = vm.createContext({
    Date: time.Date, console: quiet, process: { env: {} },
    allowMethods: () => true,
    sendError: (res, error) => res.status(500).json({ error: error.message }),
    validateArtworkId: value => String(value || '').trim() || null,
    getModerationAccess: async () => ({ canModerate: false }),
    readArtworkMetadata: async () => ({ name: 'Art', image: 'https://images.example/28.png' }),
    supabaseRest: async path => {
      calls.push(path);
      const table = path.split('?')[0];
      if (table === 'v41_artworks') return [{ chain_id: CHAIN, artwork_id: '28', creator: CREATOR,
        metadata_uri: 'https://metadata.example/28.json', minted: false, token_id: '',
        canonical_floor: '0', active_auction_id: auctionId, block_number: 100,
        transaction_hash: HASH, indexed_at: future, last_updated_at: future }];
      if (table === 'v41_auctions') return [{ chain_id: CHAIN, auction_id: auctionId, artwork_id: '28', status: 'active',
        start_price: '1000000000000000', end_time: future, current_bid: '0', current_bidder: null,
        winner: null, winning_bid: '0', final_price: '0', token_id: '' }];
      return [];
    }
  });
  vm.runInContext(fs.readFileSync('src/features/artwork/ai-valuation-values.js', 'utf8').replace(/^export /gm, '') + '\n' + source, context);
  return {
    time, calls,
    setAuction(id) { auctionId = id; },
    async read(query) {
      const response = { headers: {}, statusCode: 200,
        setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; } };
      await context.handler({ method: 'GET', query }, response);
      assert.equal(response.statusCode, 200, response.body?.error);
      return response;
    }
  };
}

test('fresh exact lookup bypasses the projection TTL, coalesces one second, and never rebuilds the full list', async () => {
  const api = publicProjection();
  await api.read({});
  const direct = { chain_id: String(CHAIN), artwork_id: '28' };
  assert.equal((await api.read(direct)).body.data[0].auction_id, '62');
  api.setAuction('63');
  api.time.advance(1001);
  assert.equal((await api.read(direct)).body.data[0].auction_id, '62', 'ordinary reads still use the short-lived snapshot');
  const before = api.calls.length;
  const [first, second] = await Promise.all([api.read({ ...direct, fresh: '1' }), api.read({ ...direct, fresh: '1' })]);
  assert.equal(first.body.data[0].auction_id, '63');
  assert.equal(second.body.data[0].auction_id, '63');
  assert.equal(first.headers['cache-control'], 'private, no-store');
  const refreshed = api.calls.slice(before);
  assert.equal(refreshed.filter(path => path.startsWith('v41_artworks?')).length, 1);
  assert.equal(refreshed.some(path => path.includes('chain_id=in.')), false, 'no corpus query is issued by fresh detail');
  assert.equal(refreshed.some(path => path.startsWith('v41_public_metrics?')), false);
  assert.equal(refreshed.some(path => path.includes('select=*')), false);
  for (const path of refreshed.filter(path => !path.startsWith('profiles?'))) {
    assert.match(path, /chain_id=eq\.84532/);
    assert.match(path, /artwork_id=eq\.28/);
  }
  const callsAfterRefresh = api.calls.length;
  assert.equal((await api.read({ fresh: '1' })).body.data[0].auction_id, '62', 'a query flag cannot invalidate the entire list');
  assert.equal(api.calls.length, callsAfterRefresh);
  api.time.advance(999);
  await api.read({ ...direct, fresh: '1' });
  assert.equal(api.calls.length, callsAfterRefresh);
  api.time.advance(1);
  await api.read({ ...direct, fresh: '1' });
  assert.equal(api.calls.filter(path => path.startsWith('v41_artworks?') && path.includes('artwork_id=eq.28')).length, 3);
});
