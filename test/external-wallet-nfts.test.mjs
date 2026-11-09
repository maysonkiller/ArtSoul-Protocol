import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import handler from '../src/api/routes/wallet-nfts.js';
import dispatch from '../api/[...route].js';
import { setWalletSession } from '../src/api/backend.js';

const A = `0x${'1'.repeat(40)}`, B = `0x${'2'.repeat(40)}`, CONTRACT = `0x${'3'.repeat(40)}`;
const KEY = 'synthetic-test-key-only';
const ENV = { SESSION_SECRET: 'synthetic-wallet-inventory-session', ARTSOUL_EXTERNAL_BASE_NFTS_ENABLED: 'true',
  ARTSOUL_EXTERNAL_BASE_NFTS_ALCHEMY_API_KEY: KEY,
  BASE_SEPOLIA_RPC_URL: 'https://base-sepolia.g.alchemy.com/v2/separate-base-test-key',
  BASE_SEPOLIA_RPC_URLS: 'https://base-sepolia.g.alchemy.com/v2/separate-base-list-test-key',
  ETH_SEPOLIA_RPC_URL: 'https://eth-sepolia.g.alchemy.com/v2/separate-ethereum-test-key',
  RPC_URL: 'https://base-sepolia.g.alchemy.com/v2/separate-generic-test-key' };
let serial = 0;
const fresh = async () => (await import(`../src/api/external-wallet-nfts.js?test=${++serial}`)).readExternalWalletNfts;
function setup(t) {
  const env = Object.fromEntries(Object.keys(ENV).map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch, now = Date.now;
  Object.assign(process.env, ENV);
  globalThis.fetch = () => { throw new Error('Unexpected network call'); };
  t.after(() => {
    globalThis.fetch = originalFetch; Date.now = now;
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
}
function response() {
  return { statusCode: 200, headers: {}, body: null,
    setHeader(key, value) { this.headers[key] = value; }, status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; }, end() {} };
}
function headers(wallet = A) {
  const res = response(); setWalletSession(res, wallet);
  return { cookie: res.headers['Set-Cookie'].split(';')[0], 'x-artsoul-wallet': wallet };
}
async function call({ method = 'GET', h = headers(), query = {} } = {}) {
  const res = response(); await handler({ method, headers: h, query }, res); return res;
}
function nft(changes = {}) {
  return { contract: { address: CONTRACT, name: 'Test collection' }, tokenId: '7', tokenType: 'ERC721', balance: '1', name: 'Test artwork',
    image: { cachedUrl: 'https://nft-cdn.alchemy.com/base-mainnet/abc123', contentType: 'image/png' }, ...changes };
}
function page(changes = {}) {
  return { ownedNfts: [nft()], totalCount: 1, validAt: { blockNumber: 42, blockHash: `0x${'a'.repeat(64)}` }, ...changes };
}
const code = (expected, status = 503) => error => {
  assert.equal(error.code, expected); assert.equal(error.statusCode, status);
  assert.doesNotMatch(error.message, /synthetic-test-key|private-provider/); return true;
};

test('wallet NFT handler permits only the signed-in wallet, GET and bounded page input', async t => {
  setup(t);
  const good = headers();
  for (const h of [{}, { ...good, cookie: `${good.cookie}invalid` }, { ...good, 'x-artsoul-wallet': B }, { cookie: good.cookie }]) {
    const result = await call({ h }); assert.equal(result.statusCode, 401); assert.equal(result.headers['Cache-Control'], 'private, no-store');
  }
  const realNow = Date.now;
  Date.now = () => realNow() - 8 * 24 * 60 * 60_000;
  const expired = headers(); Date.now = realNow;
  assert.equal((await call({ h: expired })).statusCode, 401);
  assert.equal((await call({ method: 'POST' })).statusCode, 405);
  assert.equal((await call({ method: 'OPTIONS' })).statusCode, 204);
  for (const query of [{ owner: B }, { wallet: B }, { chainId: 1 }, { pageSize: 100 }, { refresh: true }, { url: 'https://other.test' },
    { quote: 'BTC' }, { quote: ['eth-usd'] }, { quote: 'eth-usd', cursor: 'anything' },
    { route: 'other' }, { route: ['wallet-nfts', 'other'] }, { route: {} }, { route: ['wallet-nfts'], owner: B }]) {
    assert.equal((await call({ query })).body.error, 'INVALID_WALLET_NFT_QUERY');
  }
  for (const cursor of ['', [], {}, 'provider-raw-page', 'x'.repeat(3201)]) {
    assert.equal((await call({ query: { cursor } })).statusCode, 400);
  }
  for (const enabled of [undefined, '', 'false', 'TRUE', '1']) {
    if (enabled === undefined) delete process.env.ARTSOUL_EXTERNAL_BASE_NFTS_ENABLED;
    else process.env.ARTSOUL_EXTERNAL_BASE_NFTS_ENABLED = enabled;
    const result = await call(); assert.equal(result.statusCode, 503); assert.equal(result.body.error, 'WALLET_NFTS_DISABLED');
  }
});

test('external inventory requires its dedicated key and never inherits any network RPC credential', async t => {
  setup(t); const read = await fresh();
  for (const key of [undefined, '', 'short', 'x'.repeat(129), ' key12345', 'key12345 ', 'key/12345', 'key?12345',
    'key#12345', 'key%2F12345', 'key\n12345', 'https://base-mainnet.g.alchemy.com/v2/key12345']) {
    if (key === undefined) delete process.env.ARTSOUL_EXTERNAL_BASE_NFTS_ALCHEMY_API_KEY;
    else process.env.ARTSOUL_EXTERNAL_BASE_NFTS_ALCHEMY_API_KEY = key;
    await assert.rejects(read(A), code('WALLET_NFTS_CONFIG_UNAVAILABLE'));
  }
  process.env.ARTSOUL_EXTERNAL_BASE_NFTS_ALCHEMY_API_KEY = KEY;
  let calls = 0;
  globalThis.fetch = async (input, options) => {
    const url = new URL(input); calls++;
    assert.equal(url.origin, 'https://base-mainnet.g.alchemy.com');
    assert.equal(url.pathname, `/nft/v3/${KEY}/getNFTsForOwner`);
    assert.deepEqual(Object.fromEntries(url.searchParams), { owner: A, pageSize: '12', withMetadata: 'true', tokenUriTimeoutInMs: '0' });
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error'); assert.ok(options.signal);
    return Response.json(page());
  };
  const result = await read(A); assert.equal(calls, 1); assert.equal(result.chainId, 8453); assert.equal(result.network, 'Base');
  assert.equal(result.source, 'alchemy'); assert.equal(result.wallet, A); assert.equal(result.nextCursor, null);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(KEY));
  process.env.BASE_SEPOLIA_RPC_URL = 'https://unrelated.test/v2/changed-rpc-key';
  process.env.RPC_URL = 'malformed unrelated RPC configuration';
  assert.deepEqual(await read(A), result); assert.equal(calls, 1, 'unrelated RPC changes do not invalidate the dedicated inventory cache');
});

test('normalization retains exact identities and quantities, bounded plain text and only cached raster images', async t => {
  setup(t); const read = await fresh();
  const rows = [nft({ tokenId: '0x07', name: '\u202e\u0000  <img src=x onerror=alert(1)>  ',
    raw: { metadata: { attributes: Array.from({ length: 10 }, (_, i) => ({ trait_type: `Trait ${i}`, value: i })) } },
    price: 1, animation_url: 'https://bad.test', tokenUri: 'javascript:alert(1)', description: 'not returned' }),
    nft({ tokenId: String(2n ** 256n - 1n), tokenType: 'ERC1155', balance: '9007199254740993', name: 'n'.repeat(200),
      contract: { address: CONTRACT.toUpperCase().replace('0X', '0x'), name: 'c'.repeat(200) }, image: { cachedUrl: 'https://bad.test/image.png', contentType: 'image/png' } }),
    nft({ tokenId: '8', image: { cachedUrl: 'https://nft-cdn.alchemy.com/base-mainnet/abc123', contentType: 'image/svg+xml' } }),
    nft({ tokenId: '9', image: { cachedUrl: 'https://nft-cdn.alchemy.com/base-mainnet/abc123?url=https://bad.test', contentType: 'image/png' } }),
    nft({ tokenId: '10', image: { cachedUrl: 'https://nft-cdn.alchemy.com.evil.test/base-mainnet/abc123', contentType: 'image/png' } }),
    nft({ tokenId: '11', image: { originalUrl: 'https://bad.test/image.png' }, raw: { metadata: { attributes: [{ trait_type: 'x', value: {} }, { trait_type: 'flag', value: true }] } } })];
  globalThis.fetch = async () => Response.json(page({ ownedNfts: rows, totalCount: rows.length }));
  const result = await read(A), first = result.items[0], last = result.items.at(-1);
  assert.equal(first.id, `8453:${CONTRACT}:7`); assert.equal(first.name, '<img src=x onerror=alert(1)>');
  assert.equal(first.imageUrl, 'https://nft-cdn.alchemy.com/base-mainnet/abc123'); assert.equal(first.traits.length, 8);
  assert.deepEqual(first.traits[0], { name: 'Trait 0', value: '0' });
  assert.equal(result.items[1].quantity, '9007199254740993'); assert.equal(result.items[1].tokenId, String(2n ** 256n - 1n));
  assert.equal(result.items[1].name.length, 160); assert.equal(result.items[1].collection.length, 160);
  assert.ok(result.items.slice(1).every(item => item.imageUrl === null)); assert.deepEqual(last.traits, []);
  for (const item of result.items) assert.deepEqual(Object.keys(item).sort(),
    ['collection', 'contractAddress', 'id', 'imageUrl', 'name', 'quantity', 'tokenId', 'tokenType', 'traits']);
  assert.equal(result.omittedCount, 0); assert.equal(result.validAt.blockNumber, 42);
});

test('unsupported, malformed, duplicate and zero-balance assets are counted as omitted rather than invented', async t => {
  setup(t); const read = await fresh();
  const rows = [nft(), nft(), nft({ tokenType: 'UNKNOWN' }), nft({ balance: '0' }), nft({ balance: '2' }),
    nft({ tokenId: String(2n ** 256n) }), nft({ tokenId: 7 }), nft({ contract: { address: `0x${'0'.repeat(40)}` } }),
    nft({ contract: { address: [CONTRACT] } }), null];
  globalThis.fetch = async () => Response.json(page({ ownedNfts: rows, totalCount: 99 }));
  const result = await read(A); assert.equal(result.items.length, 1); assert.equal(result.omittedCount, 9); assert.equal(result.totalCount, 99);
  const empty = await fresh(); globalThis.fetch = async () => Response.json(page({ ownedNfts: [], totalCount: 0, validAt: null }));
  assert.deepEqual((await empty(A)).items, []); assert.equal((await empty(A)).validAt, null);
});

test('current provider CDN accepts cached raster paths without allowing arbitrary hosts or transformations', async t => {
  setup(t); const read = await fresh();
  const valid = 'https://nft2-cdn.alchemy.com/cacheGroup/cachedImage_123';
  const urls = [valid, valid + '?url=https://bad.test', valid + '#fragment', valid + '/extra',
    valid.replace('alchemy.com', 'alchemy.com.evil.test'), valid.replace('https:', 'http:'),
    'https://nft2-cdn.alchemy.com@bad.test/group/image',
    'https://nft2-cdn.alchemy.com/group/%2e%2e',
    'https://nft2-cdn.alchemy.com/' + 'a'.repeat(129) + '/image'];
  const rows = urls.map((cachedUrl, index) => nft({ tokenId: String(index), image: { cachedUrl, contentType: 'image/png' } }));
  rows.push(nft({ tokenId: '99', image: { cachedUrl: valid, contentType: 'image/svg+xml' } }));
  globalThis.fetch = async () => Response.json(page({ ownedNfts: rows, totalCount: rows.length }));
  const result = await read(A);
  assert.equal(result.items[0].imageUrl, valid);
  assert.ok(result.items.slice(1).every(item => item.imageUrl === null));
});

test('signed cursors are wallet/config-bound, expire, reject tampering and preserve only provider-issued pagination', async t => {
  setup(t); const read = await fresh(); let now = 1_800_000_000_000; Date.now = () => now; const calls = [];
  const next = 'opaque/next?x=1&y=2';
  globalThis.fetch = async input => {
    const url = new URL(input); calls.push(url.searchParams.get('pageKey'));
    return Response.json(page(calls.length === 1 ? { pageKey: next } : { ownedNfts: [], totalCount: 1 }));
  };
  const cursor = (await read(A)).nextCursor; assert.ok(cursor); assert.notEqual(cursor, next);
  await assert.rejects(read(B, cursor), code('INVALID_WALLET_NFT_CURSOR', 400));
  await assert.rejects(read(A, cursor.slice(0, -2) + 'xx'), code('INVALID_WALLET_NFT_CURSOR', 400));
  process.env.ARTSOUL_EXTERNAL_BASE_NFTS_ALCHEMY_API_KEY = KEY + 'different';
  await assert.rejects(read(A, cursor), code('INVALID_WALLET_NFT_CURSOR', 400));
  process.env.ARTSOUL_EXTERNAL_BASE_NFTS_ALCHEMY_API_KEY = KEY;
  process.env.BASE_SEPOLIA_RPC_URL += 'different';
  assert.equal((await read(A, cursor)).nextCursor, null); assert.deepEqual(calls, [null, next]);
  now += 30 * 60_000;
  await assert.rejects(read(A, cursor), code('INVALID_WALLET_NFT_CURSOR', 400)); assert.equal(calls.length, 2);
});

test('one in-flight request serves concurrent reads; TTL and late configuration changes are enforced', async t => {
  setup(t); const read = await fresh(); let now = 1_800_000_000_000; Date.now = () => now;
  let finish, calls = 0;
  globalThis.fetch = async () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const first = read(A), second = read(A); assert.equal(calls, 1);
  finish(Response.json(page())); assert.deepEqual(await first, await second);
  const cached = await read(A); assert.equal(calls, 1);
  now += 5 * 60_000 - 1; assert.equal((await read(A)).fetchedAt, cached.fetchedAt); assert.equal(calls, 1);
  now++;
  const afterExpiry = read(A); assert.equal(calls, 2); finish(Response.json(page())); await afterExpiry;
  process.env.ARTSOUL_EXTERNAL_BASE_NFTS_ENABLED = 'false';
  await assert.rejects(read(A), code('WALLET_NFTS_DISABLED'));
  process.env.ARTSOUL_EXTERNAL_BASE_NFTS_ENABLED = 'true';
  const changed = read(B); process.env.ARTSOUL_EXTERNAL_BASE_NFTS_ALCHEMY_API_KEY += 'changed'; finish(Response.json(page()));
  await assert.rejects(changed, code('WALLET_NFTS_UNAVAILABLE'));
  process.env.ARTSOUL_EXTERNAL_BASE_NFTS_ALCHEMY_API_KEY = KEY;
  const another = await fresh(); const disabled = another(A);
  process.env.ARTSOUL_EXTERNAL_BASE_NFTS_ENABLED = 'false'; finish(Response.json(page()));
  await assert.rejects(disabled, code('WALLET_NFTS_DISABLED'));
});

test('provider failures are sanitized, briefly cached and never retried automatically', async t => {
  setup(t); let now = 1_800_000_000_000; Date.now = () => now;
  for (const responseFactory of [() => Response.json({ message: `private-provider ${KEY}` }, { status: 429 }),
    () => Response.json({ message: KEY }, { status: 500 }), () => new Response('<html>private-provider</html>'),
    () => new Response('{', { headers: { 'Content-Type': 'application/json' } }),
    () => Response.json({}), () => Response.json(page({ ownedNfts: Array(13).fill(nft()), totalCount: 13 })),
    () => Response.json(page({ pageKey: 'bad\npage' })), () => Response.json(page({ totalCount: -1 })),
    () => { throw new Error(`private-provider https://host/${KEY}`); }]) {
    const read = await fresh(); let calls = 0;
    globalThis.fetch = async () => { calls++; return responseFactory(); };
    await assert.rejects(read(A), code('WALLET_NFTS_UNAVAILABLE'));
    await assert.rejects(read(A), code('WALLET_NFTS_UNAVAILABLE')); assert.equal(calls, 1);
    now += 30_000; await assert.rejects(read(A), code('WALLET_NFTS_UNAVAILABLE')); assert.equal(calls, 2);
  }
});

test('declared and streamed response caps cancel oversized bodies; deadline covers a stalled body', async t => {
  setup(t);
  for (const declared of [true, false]) {
    const read = await fresh(); let cancelled = false;
    globalThis.fetch = async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(512 * 1024 + 1)); }, cancel() { cancelled = true; }
    }), { headers: { 'Content-Type': 'application/json', ...(declared ? { 'Content-Length': String(512 * 1024 + 1) } : {}) } });
    await assert.rejects(read(A), code('WALLET_NFTS_UNAVAILABLE'));
    assert.equal(cancelled, true);
  }
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const read = await fresh(); let signal, cancelled = false;
  globalThis.fetch = async (_, options) => {
    signal = options.signal;
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'Content-Type': 'application/json' } });
  };
  const request = read(A); const rejected = assert.rejects(request, code('WALLET_NFTS_UNAVAILABLE'));
  await Promise.resolve(); t.mock.timers.tick(5000); await rejected;
  assert.equal(signal.aborted, true); assert.equal(cancelled, true);
  const stalled = await fresh();
  globalThis.fetch = (_, options) => { signal = options.signal; return new Promise(() => {}); };
  const pending = assert.rejects(stalled(B), code('WALLET_NFTS_UNAVAILABLE'));
  t.mock.timers.tick(5000); await pending; assert.equal(signal.aborted, true);
});

test('upstream concurrency and per-wallet page budget cannot be bypassed with new cursors', async t => {
  setup(t); let now = 1_800_000_000_000; Date.now = () => now; const read = await fresh(); const resolves = [];
  globalThis.fetch = () => new Promise(resolve => resolves.push(resolve));
  const users = Array.from({ length: 5 }, (_, i) => `0x${String(i + 1).padStart(40, '0')}`);
  const requests = users.slice(0, 4).map(wallet => read(wallet));
  await assert.rejects(read(users[4]), code('WALLET_NFTS_RATE_LIMITED', 429)); assert.equal(resolves.length, 4);
  resolves.forEach(resolve => resolve(Response.json(page()))); await Promise.all(requests);
  const pages = await fresh(); let count = 0;
  globalThis.fetch = async () => Response.json(page({ pageKey: `page-${++count}` }));
  let cursor;
  for (let i = 0; i < 6; i++) cursor = (await pages(A, cursor)).nextCursor;
  await assert.rejects(pages(A, cursor), code('WALLET_NFTS_RATE_LIMITED', 429)); assert.equal(count, 6);
  now += 10 * 60_000; await pages(A, cursor); assert.equal(count, 7);
});

test('global minute/day and authenticated request budgets are bounded, including cached reads', async t => {
  setup(t); let now = 1_800_000_000_000; Date.now = () => now; const read = await fresh(); let count = 0;
  globalThis.fetch = async () => { count++; return Response.json(page()); };
  for (let dayCall = 0; dayCall < 100; dayCall++) {
    if (dayCall && dayCall % 10 === 0) now += 60_000;
    const wallet = `0x${(dayCall + 1).toString(16).padStart(40, '0')}`;
    await read(wallet);
    if (dayCall === 9) await assert.rejects(read(B), code('WALLET_NFTS_RATE_LIMITED', 429));
  }
  now += 60_000;
  await assert.rejects(read(B), code('WALLET_NFTS_RATE_LIMITED', 429)); assert.equal(count, 100);
  now += 24 * 60 * 60_000; await read(B); assert.equal(count, 101);
  const cached = await fresh(); await cached(A);
  for (let i = 1; i < 60; i++) await cached(A);
  await assert.rejects(cached(A), code('WALLET_NFTS_RATE_LIMITED', 429)); assert.equal(count, 102);
});

test('handler sends sanitized unavailable errors and Retry-After without provider details', async t => {
  setup(t); let count = 0;
  globalThis.fetch = async () => { count++; return Response.json({ error: `private-provider ${KEY}` }, { status: 500 }); };
  const result = await call(); assert.equal(result.statusCode, 503); assert.equal(result.body.error, 'WALLET_NFTS_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(result), /private-provider|synthetic-test-key/);
  for (let i = 1; i < 60; i++) await call();
  const limited = await call(); assert.equal(limited.statusCode, 429); assert.ok(Number(limited.headers['Retry-After']) > 0); assert.equal(count, 1);
});

test('successful handler returns a private provider-attributed page for exactly its authenticated wallet', async t => {
  setup(t); const owner = `0x${'4'.repeat(40)}`;
  globalThis.fetch = async input => {
    assert.equal(new URL(input).searchParams.get('owner'), owner);
    return Response.json(page());
  };
  const result = await call({ h: headers(owner) });
  assert.equal(result.statusCode, 200); assert.equal(result.headers['Cache-Control'], 'private, no-store');
  assert.equal(result.body.wallet, owner); assert.equal(result.body.source, 'alchemy'); assert.equal(result.body.items.length, 1);
  assert.equal(result.body.chainId, 8453); assert.equal(result.body.items[0].tokenType, 'ERC721');
  assert.equal(result.body.nextCursor, null); assert.doesNotMatch(JSON.stringify(result), /synthetic-test-key|SESSION_SECRET/);
});

test('catch-all dispatcher preserves wallet NFT route metadata without widening the private owner query', async t => {
  setup(t); const owner = `0x${'5'.repeat(40)}`, h = headers(owner); let calls = 0, cursor;
  const deployment = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const rewrite = deployment.rewrites.filter(rule => rule.source === '/api/wallet-nfts');
  assert.equal(rewrite.length, 1);
  const destination = new URL(rewrite[0].destination, 'https://deployment.test');
  assert.equal(destination.pathname, '/api/[...route]');
  const routedQuery = Object.fromEntries(destination.searchParams);
  assert.deepEqual(routedQuery, { route: 'wallet-nfts' });
  globalThis.fetch = async input => {
    const url = new URL(input); assert.equal(url.searchParams.get('owner'), owner); calls++;
    if (calls === 1) return Response.json(page({ pageKey: 'next-page' }));
    assert.equal(url.searchParams.get('pageKey'), 'next-page');
    return Response.json(page({ ownedNfts: [nft({ tokenId: '8' })] }));
  };
  for (const query of [{}, { route: ['wallet-nfts'] }, routedQuery]) {
    const res = response(); await dispatch({ method: 'GET', url: query === routedQuery ? destination.pathname : '/api/wallet-nfts', query, headers: h }, res);
    assert.equal(res.statusCode, 200); assert.equal(res.body.wallet, owner);
    assert.equal(res.headers['Cache-Control'], 'private, no-store'); assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
    assert.equal(res.body.items[0].tokenId, '7'); cursor = res.body.nextCursor;
  }
  assert.equal(calls, 1);
  const next = response();
  await dispatch({ method: 'GET', url: destination.pathname, query: { ...routedQuery, cursor }, headers: h }, next);
  assert.equal(next.statusCode, 200); assert.equal(next.body.items[0].tokenId, '8'); assert.equal(calls, 2);
  const rejected = response();
  await dispatch({ method: 'GET', url: destination.pathname, query: { ...routedQuery, owner: B }, headers: h }, rejected);
  assert.equal(rejected.statusCode, 400); assert.equal(rejected.body.error, 'INVALID_WALLET_NFT_QUERY'); assert.equal(calls, 2);
});

test('quote requests retain session binding and reject disabled or malformed requests before any network read', async t => {
  setup(t); let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ data: { amount: '2500', currency: 'USD' } }); };
  const good = headers(), query = { quote: 'eth-usd' };
  for (const h of [{}, { ...good, cookie: `${good.cookie}invalid` }, { ...good, 'x-artsoul-wallet': B }, { cookie: good.cookie }]) {
    const result = await call({ h, query });
    assert.equal(result.statusCode, 401); assert.equal(result.headers['Cache-Control'], 'private, no-store');
    assert.equal(result.body.quote, undefined);
  }
  const realNow = Date.now;
  Date.now = () => realNow() - 8 * 24 * 60 * 60_000;
  const expired = headers(); Date.now = realNow;
  assert.equal((await call({ h: expired, query })).statusCode, 401);
  assert.equal((await call({ method: 'POST', query })).statusCode, 405);
  for (const invalid of [{ quote: 'btc-usd' }, { quote: '' }, { quote: ['eth-usd'] }, { quote: {} }, { quote: null },
    { ...query, cursor: '' }, { ...query, cursor: 'anything' }, { ...query, owner: B }, { ...query, wallet: B },
    { ...query, url: 'https://other.test' }, { ...query, chainId: 1 }, { ...query, route: 'other' }]) {
    const result = await call({ query: invalid });
    assert.equal(result.statusCode, 400); assert.equal(result.body.error, 'INVALID_WALLET_NFT_QUERY');
  }
  for (const enabled of [undefined, '', 'false', 'TRUE', '1']) {
    if (enabled === undefined) delete process.env.ARTSOUL_EXTERNAL_BASE_NFTS_ENABLED;
    else process.env.ARTSOUL_EXTERNAL_BASE_NFTS_ENABLED = enabled;
    const result = await call({ query });
    assert.equal(result.statusCode, 503); assert.equal(result.body.error, 'WALLET_NFTS_DISABLED');
  }
  assert.equal(calls, 0, 'rejected quote requests never reach Coinbase or the NFT provider');
});

test('authenticated quote routing shares one Coinbase read without sending wallet data or invoking Alchemy', async t => {
  setup(t); const now = 1_900_000_000_000; Date.now = () => now;
  const owner = `0x${'6'.repeat(40)}`, other = `0x${'7'.repeat(40)}`, query = { quote: 'eth-usd' };
  let calls = 0, finish;
  globalThis.fetch = (input, options) => {
    calls++;
    assert.equal(String(input), 'https://api.coinbase.com/v2/prices/ETH-USD/spot');
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    assert.deepEqual(options.headers, { Accept: 'application/json' });
    assert.equal(options.body, undefined); assert.ok(options.signal);
    return new Promise(resolve => { finish = resolve; });
  };
  const first = call({ h: headers(owner), query }), second = call({ h: headers(other), query });
  assert.equal(calls, 1);
  finish(Response.json({ data: { base: 'ETH', amount: '2500.12345678', currency: 'USD' } }));
  const expected = { quote: { symbol: 'ETH', currency: 'USD', amount: '2500.12345678', source: 'Coinbase', fetchedAt: new Date(now).toISOString() } };
  for (const result of await Promise.all([first, second])) {
    assert.equal(result.statusCode, 200); assert.deepEqual(result.body, expected);
    assert.equal(result.headers['Cache-Control'], 'private, no-store');
  }
  const deployment = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const rewrite = deployment.rewrites.find(rule => rule.source === '/api/wallet-nfts');
  const destination = new URL(rewrite.destination, 'https://deployment.test');
  const routed = Object.fromEntries(destination.searchParams);
  for (const routeQuery of [query, { ...query, route: ['wallet-nfts'] }, { ...query, ...routed }]) {
    const res = response();
    await dispatch({ method: 'GET', url: routeQuery === query ? '/api/wallet-nfts' : destination.pathname, query: routeQuery, headers: headers(owner) }, res);
    assert.equal(res.statusCode, 200); assert.deepEqual(res.body, expected);
    assert.equal(res.headers['Cache-Control'], 'private, no-store'); assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
  }
  assert.equal(calls, 1, 'authenticated details share the process quote cache, not NFT inventory reads');
  process.env.ARTSOUL_EXTERNAL_BASE_NFTS_ENABLED = 'false';
  assert.equal((await call({ h: headers(owner), query })).body.error, 'WALLET_NFTS_DISABLED');
  process.env.ARTSOUL_EXTERNAL_BASE_NFTS_ENABLED = 'true';
  delete process.env.ARTSOUL_EXTERNAL_BASE_NFTS_ALCHEMY_API_KEY;
  assert.equal((await call({ h: headers(owner), query })).body.error, 'WALLET_NFTS_CONFIG_UNAVAILABLE');
  assert.equal(calls, 1, 'cached quotes cannot bypass disabled or unconfigured inventory gates');
});

test('quote failures are nullable without provider leakage and an in-flight quote cannot outlive feature disablement', async t => {
  setup(t); let now = 2_000_000_000_000; Date.now = () => now;
  const owner = `0x${'8'.repeat(40)}`, query = { quote: 'eth-usd' }; let calls = 0;
  globalThis.fetch = async input => {
    calls++; assert.equal(String(input), 'https://api.coinbase.com/v2/prices/ETH-USD/spot');
    return Response.json({ error: `private-provider ${KEY}` }, { status: 500 });
  };
  for (let i = 0; i < 2; i++) {
    const result = await call({ h: headers(owner), query });
    assert.equal(result.statusCode, 200); assert.deepEqual(result.body, { quote: null });
    assert.equal(result.headers['Cache-Control'], 'private, no-store');
    assert.doesNotMatch(JSON.stringify(result), /private-provider|synthetic-test-key/);
  }
  assert.equal(calls, 1, 'failure backoff does not retry or fall back to Alchemy');
  now += 60_000; let finish;
  globalThis.fetch = input => {
    calls++; assert.equal(String(input), 'https://api.coinbase.com/v2/prices/ETH-USD/spot');
    return new Promise(resolve => { finish = resolve; });
  };
  const pending = call({ h: headers(owner), query });
  assert.equal(calls, 2);
  process.env.ARTSOUL_EXTERNAL_BASE_NFTS_ENABLED = 'false';
  finish(Response.json({ data: { base: 'ETH', amount: '2501.5', currency: 'USD' } }));
  const result = await pending;
  assert.equal(result.statusCode, 503); assert.equal(result.body.error, 'WALLET_NFTS_DISABLED');
  assert.equal(result.body.quote, undefined); assert.equal(calls, 2);
});
