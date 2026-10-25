import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

const origin = 'https://projection-test.supabase.co';
const core = '0x' + '1'.repeat(40);
const creator = '0x' + '2'.repeat(40);
const originalFetch = globalThis.fetch;
const previousEnv = { ...process.env };
let sequence = 0;

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const name of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA', 'ARTSOUL_SEARCH_ENABLED']) {
    if (previousEnv[name] === undefined) delete process.env[name];
    else process.env[name] = previousEnv[name];
  }
});

function registration(id, chain = 84532) {
  return { chain_id: chain, artwork_id: String(id), creator,
    metadata_uri: `${origin}/storage/v1/object/public/artworks/${chain}-${id}.json`,
    minted: false, token_id: null, canonical_floor: '0', active_auction_id: '70',
    block_number: 100, transaction_hash: '0x' + Number(id).toString(16).padStart(64, '0') };
}
function metadata(row) {
  return { name: `Original ${row.chain_id}/${row.artwork_id}`, description: 'Unchanged public content',
    image: `${origin}/storage/v1/object/public/artworks/${row.artwork_id}.png` };
}

async function run({ rows = [registration(7)], rpcReply, hidden = [], enabled = true, configuredCore = core, query = {} } = {}) {
  process.env.SUPABASE_URL = origin;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-service-key';
  process.env.ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA = configuredCore;
  process.env.ARTSOUL_SEARCH_ENABLED = String(enabled);
  const calls = [], fileReads = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input);
    assert.ok(url.origin === origin || url.origin === 'https://ipfs.io');
    calls.push({ path: url.pathname, body: options.body && JSON.parse(options.body), signal: options.signal });
    let data = [];
    if (url.pathname === '/rest/v1/rpc/read_public_search_cards') {
      assert.equal(options.method, 'POST');
      const body = JSON.parse(options.body);
      assert.equal(body.p_core_address, core);
      assert.ok(body.p_artwork_ids.length > 0 && body.p_artwork_ids.length <= 20);
      assert.ok(options.signal instanceof AbortSignal, 'optional enrichment has a time limit');
      const selected = rows.filter(row => row.chain_id === 84532 && body.p_artwork_ids.includes(row.artwork_id));
      data = { artworks: structuredClone(selected), metadata: selected.map(metadata) };
      if (rpcReply) data = await rpcReply(data, body, options.signal);
    } else if (url.pathname === '/rest/v1/v41_artworks') data = rows;
    else if (url.pathname === '/rest/v1/v41_auctions') data = rows.map(row => ({ chain_id: row.chain_id,
      artwork_id: row.artwork_id, auction_id: '70', status: 'active', start_price: '100000000000000',
      current_bid: '0', end_time: '2099-01-01T00:00:00.000Z' }));
    else if (url.pathname === '/rest/v1/artwork_moderation_visibility') data = hidden.map(artwork_id => ({ chain_id: 84532, artwork_id, hidden: true }));
    else if (url.pathname === '/rest/v1/v41_public_metrics') data = [{ chain_id: 84532, artists_onboarded: 1,
      auctions_completed: 2, unique_collectors: 1, settled_volume_wei: '5000000000000000', last_updated_block: 99 }];
    else if (url.pathname.startsWith('/storage/') || url.origin === 'https://ipfs.io') {
      const row = rows.find(row => row.metadata_uri === String(input) ||
        String(row.metadata_uri).replace('ipfs://', 'https://ipfs.io/ipfs/') === String(input));
      assert.ok(row, 'fallback only fetches a registration original');
      fileReads.push(row.artwork_id);
      data = metadata(row);
    }
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  };
  const { default: handler } = await import(`../src/api/routes/public/artworks.js?feed-test=${sequence++}`);
  const result = { headers: {}, setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
  await handler({ method: 'GET', query, headers: {} }, result);
  assert.equal(result.statusCode, 200);
  return { ...result, calls, fileReads, rpcCalls: calls.filter(call => call.path.endsWith('/read_public_search_cards')) };
}

test('ready indexed metadata preserves the complete public response while removing per-file reads', async () => {
  const rows = Array.from({ length: 33 }, (_, i) => registration(i + 1));
  const indexed = await run({ rows });
  const fallback = await run({ rows, enabled: false });
  assert.deepEqual(indexed.body, fallback.body);
  assert.deepEqual(indexed.headers, fallback.headers);
  assert.equal(indexed.rpcCalls.length, 2);
  assert.equal(indexed.fileReads.length, 0);
  assert.equal(fallback.fileReads.length, 33);
});

test('legacy chain metadata stays on its existing path and batches contain only active-chain IDs', async () => {
  const rows = [...Array.from({ length: 21 }, (_, i) => registration(i + 1)), registration(1, 11155111)];
  const result = await run({ rows });
  assert.equal(result.rpcCalls.length, 2);
  assert.deepEqual(result.fileReads, ['1']);
  assert.equal(result.body.data.find(row => row.chain_id === 11155111).title, 'Original 11155111/1');
});

test('permitted external IPFS originals retain their existing fetch path', async () => {
  const row = { ...registration(7), metadata_uri: 'ipfs://Qm' + 'a'.repeat(44) };
  const result = await run({ rows: [row] });
  assert.equal(result.rpcCalls.length, 0);
  assert.deepEqual(result.fileReads, ['7']);
  assert.equal(result.body.data[0].title, 'Original 84532/7');
});

test('a project URL rejected by the existing URL allowlist never receives indexed metadata', async () => {
  const row = { ...registration(7), metadata_uri: `${origin}/storage/v1/object/public/artworks/%2fmetadata.json` };
  const result = await run({ rows: [row] });
  assert.equal(result.rpcCalls.length, 0);
  assert.equal(result.fileReads.length, 0);
  assert.equal(result.body.data[0].title, 'Artwork #7');
});

for (const [label, mutate] of [
  ['changed source transaction', row => { row.transaction_hash = '0x' + 'f'.repeat(64); }],
  ['changed URI', row => { row.metadata_uri += '?changed'; }],
  ['reorg moved registration block', row => { row.block_number++; }],
  ['different chain', row => { row.chain_id = 11155111; }],
  ['different artwork', row => { row.artwork_id = '99'; }]
]) test(`${label} cannot supply indexed metadata for an earlier registration`, async () => {
  const result = await run({ rpcReply: data => { mutate(data.artworks[0]); data.metadata[0] = { name: 'Stale metadata' }; return data; } });
  assert.deepEqual(result.fileReads, ['7']);
  assert.equal(result.body.data[0].title, 'Original 84532/7');
});

test('a reorg-deleted RPC row falls back without recreating it from the derived metadata table', async () => {
  const result = await run({ rpcReply: () => ({ artworks: [], metadata: [] }) });
  assert.deepEqual(result.fileReads, ['7']);
  assert.equal(result.body.data[0].title, 'Original 84532/7');
});

for (const missing of [{}, null, [], 'not an object']) test(`missing or pending metadata falls back (${JSON.stringify(missing)})`, async () => {
  const result = await run({ rpcReply: data => ({ ...data, metadata: [missing] }) });
  assert.deepEqual(result.fileReads, ['7']);
  assert.equal(result.body.data[0].title, 'Original 84532/7');
});

test('unavailable metadata RPC keeps the existing public feed available', async () => {
  const result = await run({ rpcReply: () => { throw new Error('PGRST202 function unavailable'); } });
  assert.deepEqual(result.fileReads, ['7']);
  assert.deepEqual(result.body.warnings, []);
});

test('an unavailable batch does not discard a different successful batch', async () => {
  const result = await run({ rows: Array.from({ length: 21 }, (_, i) => registration(i + 1)), rpcReply: (data, body) => {
    if (body.p_artwork_ids.includes('21')) throw new Error('Temporary read failure');
    return data;
  } });
  assert.deepEqual(result.fileReads, ['21']);
  assert.equal(result.body.count, 21);
});

test('malformed or duplicate RPC rows cannot redirect metadata between works', async () => {
  for (const rpcReply of [() => null, data => ({ ...data, metadata: [] }), data => ({
    artworks: [data.artworks[0], data.artworks[0]], metadata: [{ name: 'Wrong' }, { name: 'Wrong' }]
  })]) {
    const result = await run({ rpcReply });
    assert.deepEqual(result.fileReads, ['7']);
    assert.equal(result.body.data[0].title, 'Original 84532/7');
  }
});

test('indexed metadata never bypasses the existing moderation filter', async () => {
  const result = await run({ hidden: ['7'] });
  assert.equal(result.fileReads.length, 0);
  assert.equal(result.body.count, 0);
  assert.deepEqual(result.body.suppressed_artwork_ids, ['v41:84532:7']);
});

test('disabled search or invalid configured core does not invoke the optional RPC', async () => {
  for (const options of [{ enabled: false }, { configuredCore: '' }, { configuredCore: '0x' + '0'.repeat(40) }]) {
    const result = await run(options);
    assert.equal(result.rpcCalls.length, 0);
    assert.deepEqual(result.fileReads, ['7']);
  }
});

test('direct artwork reads retain their existing fresh metadata and private response behavior', async () => {
  const result = await run({ query: { id: '7' } });
  assert.equal(result.rpcCalls.length, 0);
  assert.deepEqual(result.fileReads, ['7']);
  assert.equal(result.headers['Cache-Control'], 'private, no-store');
});

test('a stalled optional metadata RPC is aborted before the existing file fallback', async () => {
  const result = await run({ rpcReply: (_data, _body, signal) => new Promise((_, reject) => {
    const hold = setTimeout(() => reject(new Error('Missing abort')), 5000);
    signal.addEventListener('abort', () => { clearTimeout(hold); reject(signal.reason); }, { once: true });
  }) });
  assert.equal(result.rpcCalls[0].signal.aborted, true);
  assert.deepEqual(result.fileReads, ['7']);
});
