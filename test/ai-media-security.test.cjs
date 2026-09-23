const assert = require('node:assert/strict');
const test = require('node:test');

const STORAGE = 'https://audit-project.supabase.co';
const IMAGE = `${STORAGE}/storage/v1/object/public/artworks/uploads/test/art.png`;
const CID = 'Qm' + 'a'.repeat(44);
const MAX_MEDIA = 4 * 1024 * 1024;
const MAX_METADATA = 256 * 1024;
const modules = Promise.all([
  import('../src/api/safe-artwork-fetch.js'),
  import('../src/api/backend.js'),
  import('../src/api/routes/functions/ai/analyze.js'),
  import('../src/api/routes/public/artworks.js')
]);

function environment(t) {
  for (const [key, value] of Object.entries({
    SUPABASE_URL: STORAGE,
    SUPABASE_SERVICE_ROLE_KEY: 'local-test-placeholder',
    SESSION_SECRET: 'local-test-placeholder',
    GEMINI_API_KEY: 'local-test-placeholder'
  })) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => previous === undefined ? delete process.env[key] : process.env[key] = previous);
  }
}

function res() {
  return {
    headers: {}, statusCode: 200, body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; }
  };
}

let walletCounter = 0;
async function analyze(payload, authenticated = true) {
  const [, backend, { default: handler }] = await modules;
  const session = res();
  backend.setWalletSession(session, '0x' + (++walletCounter).toString(16).padStart(40, '0'));
  const response = res();
  await handler({ method: 'POST', headers: authenticated ? { cookie: session.headers['set-cookie'].split(';')[0] } : {}, body: payload }, response);
  return response;
}

function mockAnalyzeFetch(t, mediaResponse = () => new Response(Uint8Array.of(1, 2, 3), { headers: { 'content-type': 'image/png' } }), valuation = {}) {
  const media = [];
  const prompts = [];
  t.mock.method(globalThis, 'fetch', async (input, options = {}) => {
    const url = String(input);
    if (url.startsWith('https://generativelanguage.googleapis.com/')) {
      prompts.push(JSON.parse(options.body));
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({
        estimated_value_min_eth: 0.01, estimated_value_max_eth: 0.02,
        suggested_start_price_eth: 0.01, confidence: 'low', rationale: 'Local fixture', factors: [], risk_flags: [], ...valuation
      }) }] } }] });
    }
    if (url.startsWith(`${STORAGE}/rest/v1/`)) return Response.json([{ id: 'local-valuation' }]);
    media.push({ url, options });
    return mediaResponse(options);
  });
  return { media, prompts };
}

test('remote artwork URLs cannot reach arbitrary origins or other storage/API paths', async t => {
  environment(t);
  const [{ fetchArtworkResource }] = await modules;
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('No network request is allowed'); });
  for (const url of [
    'http://127.0.0.1:9000/private', 'https://127.0.0.1/private',
    'http://169.254.169.254/latest/meta-data/', 'https://[::1]/private',
    'https://192.168.1.1/private', 'https://10.0.0.1/private', 'https://localhost/private',
    'file:///etc/passwd', 'https://attacker.example/a.png',
    `${STORAGE}.attacker.example/storage/v1/object/public/artworks/a.png`,
    'https://audit-project.supabase.co@attacker.example/storage/v1/object/public/artworks/a.png',
    'https://user:password@audit-project.supabase.co/storage/v1/object/public/artworks/a.png',
    `${STORAGE}:444/storage/v1/object/public/artworks/a.png`,
    `${STORAGE}/rest/v1/profiles`, `${STORAGE}/storage/v1/object/public/private/a.png`,
    `${STORAGE}/storage/v1/object/sign/artworks/a.png`, `${IMAGE}/../../../../../auth/v1/token`,
    `${IMAGE}/%2f..%2f..%2fprivate`, `${IMAGE}/%252e%252e/private`,
    `${IMAGE}/%5cprivate`, `${IMAGE}/%00`,
    'https://ipfs.io/api/v0/cat?arg=private', 'https://ipfs.io/ipfs/invalid-cid/file.json',
    `ipfs://${CID}/../../api/v0/cat`, 'ipns://attacker.example/file.json'
  ]) assert.equal(await fetchArtworkResource(url, { maxBytes: 100, timeoutMs: 50 }), null, url);
  assert.equal(fetch.mock.callCount(), 0);
});

test('trusted storage object/render paths and fixed CID gateway preserve valid media', async t => {
  environment(t);
  const [{ fetchArtworkResource }] = await modules;
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(Uint8Array.of(1, 2, 3), { headers: { 'content-type': 'image/png; charset=binary' } });
  });
  for (const uri of [IMAGE, `${STORAGE}/storage/v1/render/image/public/artworks/a.png?width=256`, `ipfs://${CID}/art.png`, `https://ipfs.io/ipfs/${CID}/art.png`]) {
    const result = await fetchArtworkResource(uri, { maxBytes: 3, timeoutMs: 5000 });
    assert.deepEqual([...result.data], [1, 2, 3]);
    assert.equal(result.mimeType, 'image/png');
  }
  for (const call of calls) {
    assert.equal(call.options.redirect, 'error');
    assert.equal(call.options.headers, undefined, 'never forward credentials to artwork stores');
  }
});

test('storage fetch fails closed when the configured origin is missing or insecure', async t => {
  environment(t);
  const previous = process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  t.after(() => previous === undefined ? delete process.env.NEXT_PUBLIC_SUPABASE_URL : process.env.NEXT_PUBLIC_SUPABASE_URL = previous);
  const [{ fetchArtworkResource }] = await modules;
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('No fetch expected'); });
  for (const configured of ['', 'http://audit-project.supabase.co', `${STORAGE}/rest/v1/`]) {
    process.env.SUPABASE_URL = configured;
    assert.equal(await fetchArtworkResource(IMAGE, { maxBytes: 100, timeoutMs: 50 }), null);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('redirect errors stop at the trusted origin and never fetch the destination', async t => {
  environment(t);
  const [{ fetchArtworkResource }] = await modules;
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(String(url), IMAGE);
    assert.equal(options.redirect, 'error');
    throw new TypeError('fetch failed: unexpected redirect');
  });
  assert.equal(await fetchArtworkResource(IMAGE, { maxBytes: 100, timeoutMs: 50 }), null);
  assert.equal(fetch.mock.callCount(), 1);
});

test('stream overflow without content-length cancels before consuming the remaining body', async t => {
  environment(t);
  const [{ fetchArtworkResource }] = await modules;
  let reads = 0;
  let canceled = false;
  let signal;
  const chunks = [new Uint8Array(3), new Uint8Array(2), new Uint8Array(100000)];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    signal = options.signal;
    return new Response(new ReadableStream({
      pull(controller) { controller.enqueue(chunks[reads++]); },
      cancel() { canceled = true; }
    }, { highWaterMark: 0 }), { headers: { 'content-type': 'image/png' } });
  });
  assert.equal(await fetchArtworkResource(IMAGE, { maxBytes: 4, timeoutMs: 5000 }), null);
  assert.equal(reads, 2);
  assert.equal(canceled, true);
  assert.equal(signal.aborted, true);
});

test('declared oversized bodies are rejected without reading their stream', async t => {
  environment(t);
  const [{ fetchArtworkResource }] = await modules;
  let reads = 0;
  let signal;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    signal = options.signal;
    return new Response(new ReadableStream({ pull() { reads += 1; } }, { highWaterMark: 0 }), { headers: { 'content-length': '101' } });
  });
  assert.equal(await fetchArtworkResource(IMAGE, { maxBytes: 100, timeoutMs: 50 }), null);
  assert.equal(reads, 0);
  assert.equal(signal.aborted, true);
});

test('the deadline stays active while a response body stalls after headers', async t => {
  environment(t);
  const [{ fetchArtworkResource }] = await modules;
  let signal;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    signal = options.signal;
    return new Response(new ReadableStream({
      start(controller) { signal.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true }); }
    }));
  });
  assert.equal(await fetchArtworkResource(IMAGE, { maxBytes: 100, timeoutMs: 20 }), null);
  assert.equal(signal.aborted, true);
});

test('literal, encoded and base64 metadata remain readable within the upload bound', async t => {
  environment(t);
  const [{ readArtworkMetadata }] = await modules;
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Literal metadata needs no fetch'); });
  const metadata = { name: 'Art, with comma', description: 'Test', image: IMAGE };
  const json = JSON.stringify(metadata);
  for (const uri of [json, `data:application/json,${json}`, `data:application/json,${encodeURIComponent(json)}`, `data:application/json;base64,${Buffer.from(json).toString('base64')}`]) {
    assert.deepEqual(await readArtworkMetadata(uri), metadata);
  }
  assert.deepEqual(await readArtworkMetadata(JSON.stringify({ name: 'x'.repeat(MAX_METADATA) })), {});
  assert.deepEqual(await readArtworkMetadata('data:application/json,null'), {});
  assert.deepEqual(await readArtworkMetadata('data:application/json,[]'), {});
  assert.equal(fetch.mock.callCount(), 0);
});

test('remote metadata is streamed and capped at the existing 256 KiB upload limit', async t => {
  environment(t);
  const [{ readArtworkMetadata }] = await modules;
  let oversized = false;
  t.mock.method(globalThis, 'fetch', async () => Response.json({ name: oversized ? 'x'.repeat(MAX_METADATA) : 'Safe metadata' }));
  assert.deepEqual(await readArtworkMetadata(`${STORAGE}/storage/v1/object/public/artworks/metadata/a.json`), { name: 'Safe metadata' });
  oversized = true;
  assert.deepEqual(await readArtworkMetadata(`ipfs://${CID}/a.json`), {});
});

test('authenticated AI requests skip blocked media but preserve guidance and logging', async t => {
  environment(t);
  const { media, prompts } = mockAnalyzeFetch(t);
  const response = await analyze({ title: 'Fixture', media_url: 'http://169.254.169.254/latest/meta-data/' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.guidance_only, true);
  assert.equal(response.body.valuation.used_media, false);
  assert.equal(response.body.valuation_logged, true);
  assert.equal(media.length, 0);
  assert.equal(prompts[0].contents[0].parts.length, 1);
});

test('AI keeps trusted image and local upload-preview analysis working', async t => {
  environment(t);
  const { media, prompts } = mockAnalyzeFetch(t);
  const remote = await analyze({ media_url: IMAGE });
  const inline = await analyze({ media_data_url: 'data:image/png;base64,AQID', media_url: 'https://attacker.example/not-fetched.png' });
  assert.equal(remote.body.valuation.used_media, true);
  assert.equal(inline.body.valuation.used_media, true);
  assert.equal(media.length, 1);
  for (const prompt of prompts) assert.deepEqual(prompt.contents[0].parts[1].inlineData, { mimeType: 'image/png', data: 'AQID' });
});

test('AI rejects non-image content and images larger than 4 MiB', async t => {
  environment(t);
  let huge = false;
  mockAnalyzeFetch(t, () => new Response(huge ? new Uint8Array(MAX_MEDIA + 1) : 'not an image', { headers: { 'content-type': huge ? 'image/png' : 'text/html' } }));
  assert.equal((await analyze({ media_url: IMAGE })).body.valuation.used_media, false);
  huge = true;
  assert.equal((await analyze({ media_url: IMAGE })).body.valuation.used_media, false);
});

test('unauthenticated AI requests never fetch media or call the model', async t => {
  environment(t);
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('No fetch before authentication'); });
  assert.equal((await analyze({ media_url: IMAGE }, false)).statusCode, 401);
  assert.equal(fetch.mock.callCount(), 0);
});

test('inverted model values are rejected instead of fabricating and logging a corrected estimate', async t => {
  environment(t);
  mockAnalyzeFetch(t, undefined, { estimated_value_min_eth: 0.0001, estimated_value_max_eth: 0.00001 });
  const response = await analyze({ title: 'Malformed model output' });
  assert.equal(response.statusCode, 502);
  assert.equal(response.body.error, 'GEMINI_RESPONSE_INVALID');
  assert.equal(response.body.valuation, undefined);
  assert.equal(globalThis.fetch.mock.calls.some(call => String(call.arguments[0]).includes('/rest/v1/ai_valuations')), false);
});

test('invalid model price fields fail closed while decimal comma remains supported', async t => {
  environment(t);
  for (const value of [null, '', -0.01, 'NaN', '1,2.3']) {
    mockAnalyzeFetch(t, undefined, { estimated_value_min_eth: value });
    assert.equal((await analyze({ title: 'Invalid price fixture' })).statusCode, 502);
    t.mock.restoreAll();
  }
  const { prompts } = mockAnalyzeFetch(t, undefined, { estimated_value_min_eth: '0,01', estimated_value_max_eth: '0,02' });
  const valid = await analyze({ creator_value: '0,001' });
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.valuation.estimated_value_min_eth, 0.01);
  assert.match(prompts[0].contents[0].parts[0].text, /"creator_starting_price_eth":0.001/);
  assert.match(prompts[0].contents[0].parts[0].text, /never the value or worth of the creator/);
});

test('historical malformed guidance is unavailable without altering metadata or generating a substitute', async t => {
  environment(t);
  const [, , , { default: publicHandler }] = await modules;
  let guidance;
  let artworkId = 98800;
  const valid = { estimated_value_min_eth: '0,00001', estimated_value_max_eth: '0,0001', suggested_start_price_eth: '0,00002' };
  const fetch = t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input);
    assert.equal(url.origin, STORAGE);
    assert.ok(url.pathname.startsWith('/rest/v1/'), 'stored guidance never calls the model or writes metadata');
    return Response.json(url.pathname.endsWith('/v41_artworks') ? [{
      chain_id: 84532, artwork_id: String(artworkId), creator: '0x1111111111111111111111111111111111111111',
      metadata_uri: JSON.stringify({ name: 'Historical guidance', ai_value_guidance: guidance }),
      minted: false, token_id: '', canonical_floor: '0', active_auction_id: '', block_number: 10,
      transaction_hash: '0x' + 'a'.repeat(64), indexed_at: '2026-09-20T00:00:00.000Z'
    }] : []);
  });
  for (const value of [
    { ...valid, estimated_value_min_eth: 0.0001, estimated_value_max_eth: 0.00001 },
    { ...valid, estimated_value_min_eth: null }, { ...valid, suggested_start_price_eth: -1 }, valid
  ]) {
    guidance = value;
    artworkId += 1;
    const response = res();
    await publicHandler({ method: 'GET', headers: {}, query: { chain_id: '84532', artwork_id: String(artworkId) } }, response);
    assert.equal(response.statusCode, 200);
    const projected = response.body.data[0].ai_guidance;
    if (value === valid) assert.equal(projected.estimated_value_min_eth, 0.00001);
    else assert.equal(projected, null);
  }
  assert.ok(fetch.mock.callCount() > 0);
});

test('anonymous public artwork reads preserve provenance while blocking malicious metadata', async t => {
  environment(t);
  const [, , , { default: publicHandler }] = await modules;
  const CREATOR = '0x1111111111111111111111111111111111111111';
  const externalCalls = [];
  let safe = false;
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input);
    if (url.origin === STORAGE && url.pathname.startsWith('/rest/v1/')) {
      const table = url.pathname.slice('/rest/v1/'.length);
      return Response.json(table === 'v41_artworks' ? [{
        chain_id: 84532, artwork_id: safe ? '98702' : '98701', creator: CREATOR,
        metadata_uri: safe ? `${STORAGE}/storage/v1/object/public/artworks/metadata/safe.json` : 'http://127.0.0.1:9000/internal.json',
        minted: false, token_id: '', canonical_floor: '0', active_auction_id: '', block_number: 10,
        transaction_hash: '0x' + 'a'.repeat(64), indexed_at: '2026-09-20T00:00:00.000Z'
      }] : []);
    }
    externalCalls.push(String(url));
    assert.equal(url.origin, STORAGE, 'only configured public artwork storage may be fetched');
    return Response.json({ name: 'Safe metadata fixture', image: IMAGE });
  });
  const blocked = res();
  await publicHandler({ method: 'GET', headers: {}, query: { chain_id: '84532', artwork_id: '98701' } }, blocked);
  assert.equal(blocked.statusCode, 200);
  assert.equal(blocked.body.data[0].title, 'Artwork #98701');
  assert.equal(blocked.body.data[0].creator, CREATOR);
  assert.equal(blocked.body.data[0].minted, false);
  assert.equal(externalCalls.length, 0);
  safe = true;
  const valid = res();
  await publicHandler({ method: 'GET', headers: {}, query: { chain_id: '84532', artwork_id: '98702' } }, valid);
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.data[0].title, 'Safe metadata fixture');
  assert.equal(externalCalls.length, 1);
});
