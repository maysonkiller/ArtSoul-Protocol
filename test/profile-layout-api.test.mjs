import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { allowMethods, normalizeWallet, requireWallet, sendError, supabaseRest, getPublicStorageUrl, setWalletSession } from '../src/api/backend.js';
import { publicOrigin, readBoundedJson, serviceError } from '../src/api/launch-services.js';
import { fetchArtworkResource } from '../src/api/safe-artwork-fetch.js';
import { readProfileLayoutConfig } from '../src/api/profile-layout-config.js';
import { PROFILE_COVER_MIME_EXTENSIONS, MAX_PROFILE_COVER_BYTES } from '../src/config/upload-policy.js';
import { defaultProfileLayout, validateProfileLayout, layoutArtworks, canFeatureArtwork } from '../src/features/profile/profile-layout.js';
import { profileCoverPath, verifyProfileCover } from '../src/api/routes/profile-layout.js';

const A = `0x${'1'.repeat(40)}`, B = `0x${'2'.repeat(40)}`, CORE = `0x${'3'.repeat(40)}`, OLD = `0x${'4'.repeat(40)}`;
const item = id => ({ chain_id: 84532, core_address: CORE, artwork_id: String(id) });
const base = defaultProfileLayout();
const env = { SESSION_SECRET: 'local-layout-test-only', SUPABASE_URL: 'https://layout.example.test',
  SUPABASE_SERVICE_ROLE_KEY: 'local-service-fixture', ARTSOUL_PROFILE_LAYOUT_ENABLED: 'true',
  ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA: CORE, ARTSOUL_PUBLIC_ORIGIN: 'https://artsoulprotocol.com', API_ALLOWED_ORIGINS: '' };
const source = fs.readFileSync('src/api/routes/profile-layout.js', 'utf8').replace(/^import .*;\r?$/gm, '')
  .replaceAll('export function ', 'function ').replaceAll('export async function ', 'async function ')
  .replace('export default async function handler', 'return async function handler');
function response() { return { statusCode: 200, headers: {}, body: null, setHeader(key, value) { this.headers[key] = value; },
  status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; }, end() {} }; }
function handler(hydrate) {
  const names = ['allowMethods','normalizeWallet','requireWallet','sendError','supabaseRest','getPublicStorageUrl','publicOrigin',
    'readBoundedJson','serviceError','fetchArtworkResource','readProfileLayoutConfig','readVisibleArtworkCards',
    'PROFILE_COVER_MIME_EXTENSIONS','MAX_PROFILE_COVER_BYTES','defaultProfileLayout','validateProfileLayout','layoutArtworks','canFeatureArtwork'];
  return new Function(...names, source)(allowMethods,normalizeWallet,requireWallet,sendError,supabaseRest,getPublicStorageUrl,
    publicOrigin,readBoundedJson,serviceError,fetchArtworkResource,readProfileLayoutConfig,hydrate,
    PROFILE_COVER_MIME_EXTENSIONS,MAX_PROFILE_COVER_BYTES,defaultProfileLayout,validateProfileLayout,layoutArtworks,canFeatureArtwork);
}

test('profile layout API protects writes and separates metadata from current public cards', async t => {
  const priorFetch = globalThis.fetch, priorEnv = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => { globalThis.fetch = priorFetch; for (const [key, value] of Object.entries(priorEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }});
  const session = response(); setWalletSession(session, A);
  const headers = { cookie: session.headers['Set-Cookie'].split(';')[0], 'x-artsoul-wallet': A,
    'content-type': 'application/json', origin: 'https://artsoulprotocol.com' };
  const noAccess = () => { throw new Error('Unexpected storage or hydration access'); };
  async function call({ method = 'GET', query = { address: A }, body, h = headers, hydrate = noAccess } = {}) {
    const res = response(); await handler(hydrate)({ method, query, body, headers: h }, res); return res;
  }
  await t.test('guests read the default metadata without hydration; private columns are never returned', async () => {
    globalThis.fetch = async input => { const url = new URL(input);
      assert.equal(url.searchParams.get('select'), 'revision,layout');
      assert.equal(url.searchParams.get('wallet_address'), `eq.${A}`); return Response.json([]); };
    assert.deepEqual((await call({ h: {} })).body, { wallet: A, revision: 0, layout: base });
    globalThis.fetch = async () => Response.json([{ revision: 3, layout: base, private_email: 'private@example.test' }]);
    assert.deepEqual((await call({ h: {} })).body, { wallet: A, revision: 3, layout: base });
  });
  await t.test('unauthenticated, mismatched-wallet and malformed write requests fail before any storage', async () => {
    globalThis.fetch = noAccess;
    for (const h of [{}, { ...headers, cookie: `${headers.cookie}invalid` }, { ...headers, 'x-artsoul-wallet': B },
      { ...headers, 'x-artsoul-wallet': undefined }]) assert.equal((await call({ method: 'PUT', body: { expected_revision: 0, layout: base }, h })).statusCode, 401);
    assert.equal((await call({ method: 'POST' })).statusCode, 405);
    assert.equal((await call({ method: 'PUT', h: { ...headers, origin: 'https://evil.test' } })).statusCode, 401);
    assert.equal((await call({ method: 'PUT', h: { ...headers, 'content-type': 'text/plain' } })).statusCode, 415);
    assert.equal((await call({ method: 'PUT', body: 'x'.repeat(16385) })).statusCode, 413);
    for (const body of [{ expected_revision: 0, layout: { ...base, twitter_id: 'forged' } },
      { expected_revision: '0', layout: base }, { expected_revision: 0, layout: base, wallet: B },
      { expected_revision: -1, layout: base }]) assert.equal((await call({ method: 'PUT', body })).statusCode, 400);
    assert.equal((await call({ query: { address: 'bad' } })).statusCode, 400);
    assert.equal((await call({ query: { address: A, view: 'private' } })).statusCode, 400);
    process.env.ARTSOUL_PROFILE_LAYOUT_ENABLED = 'false';
    assert.equal((await call()).body.error, 'PROFILE_LAYOUT_DISABLED');
    process.env.ARTSOUL_PROFILE_LAYOUT_ENABLED = 'true';
  });
  await t.test('CAS write submits the authenticated wallet and never silently overwrites a conflicting revision', async () => {
    globalThis.fetch = async (input, options) => {
      assert.equal(new URL(input).pathname.split('/').at(-1), 'save_profile_layout');
      const body = JSON.parse(options.body);
      assert.deepEqual(body, { p_wallet_address: A, p_expected_revision: 2, p_layout: base });
      return Response.json({ saved: true, wallet: A, revision: 3, layout: base });
    };
    assert.deepEqual((await call({ method: 'PUT', body: { expected_revision: 2, layout: base } })).body,
      { wallet: A, revision: 3, layout: base });
    globalThis.fetch = async () => Response.json({ saved: false });
    const conflict = await call({ method: 'PUT', body: { expected_revision: 2, layout: base } });
    assert.equal(conflict.statusCode, 409); assert.equal(conflict.body.error, 'LAYOUT_CONFLICT');
    globalThis.fetch = async () => Response.json({ saved: true, wallet: B, revision: 3, layout: base });
    assert.equal((await call({ method: 'PUT', body: { expected_revision: 2, layout: base } })).statusCode, 503);
  });
  await t.test('selection hydration is one bounded public batch and uses server ownership rather than submitted labels', async () => {
    const layout = { ...base, pinned: item(1), sections: [{ id: 'section', label: 'Selected', artworks: [item(1), item(2)] }] };
    const hydrated = [];
    const hydrate = async (...args) => { hydrated.push(args); return [
      { artwork_id: '1', chain_id: 84532, creator: A, current_owner_address: B },
      { artwork_id: '2', chain_id: 84532, creator: B, minted: true, current_owner_address: A }
    ]; };
    globalThis.fetch = async (_, options) => Response.json({ saved: true, wallet: A, revision: 1, layout: JSON.parse(options.body).p_layout });
    assert.equal((await call({ method: 'PUT', body: { expected_revision: 0, layout }, hydrate })).statusCode, 200);
    assert.deepEqual(hydrated, [[84532, ['1', '2'], CORE]]);
    globalThis.fetch = noAccess;
    for (const cards of [[], [{ artwork_id: '1', chain_id: 84532, creator: B }],
      [{ artwork_id: '1', chain_id: 84532, creator: B, minted: false, current_owner_address: A }],
      [{ artwork_id: '1', chain_id: 84532, creator: A, moderation_hidden: true }]]) {
      const result = await call({ method: 'PUT', body: { expected_revision: 0, layout: { ...base, pinned: item(1) } }, hydrate: async () => cards });
      assert.equal(result.body.error, 'PROFILE_ARTWORK_UNAVAILABLE');
    }
    for (const cards of [[{ artwork_id: 1, chain_id: 84532, creator: A }],
      [{ artwork_id: '1', chain_id: 1, creator: A }],
      [null], [{ artwork_id: '1', chain_id: 84532, creator: A }, { artwork_id: '1', chain_id: 84532, creator: A }]]) {
      const result = await call({ method: 'PUT', body: { expected_revision: 0, layout: { ...base, pinned: item(1) } }, hydrate: async () => cards });
      assert.equal(result.body.error, 'PROFILE_LAYOUT_UNAVAILABLE');
    }
    assert.equal((await call({ method: 'PUT', body: { expected_revision: 0,
      layout: { ...base, pinned: { ...item(1), core_address: OLD } } } })).body.error, 'PROFILE_LAYOUT_DEPLOYMENT_MISMATCH');
  });
  await t.test('metadata retains references for editing; public card reads omit hidden, transferred and old-deployment selections', async () => {
    const layout = { ...base, pinned: { ...item(9), core_address: OLD },
      sections: [{ id: 'one', label: 'My choices', artworks: [item(1), item(2), item(3)] }] };
    globalThis.fetch = async () => Response.json([{ revision: 4, layout }]);
    assert.deepEqual((await call({ h: {} })).body.layout, layout);
    let batches = 0;
    const result = await call({ h: {}, query: { address: A, view: 'artworks' }, hydrate: async (chain, ids, core) => {
      batches++; assert.deepEqual([chain, ids, core], [84532, ['1', '2', '3'], CORE]);
      return [{ artwork_id: '1', chain_id: 84532, creator: A },
        { artwork_id: '2', chain_id: 84532, creator: B, current_owner_address: B }];
    }});
    assert.equal(batches, 1); assert.equal(result.body.revision, 4);
    assert.deepEqual(result.body.cards.map(card => card.artwork_id), ['1']);
    assert.equal(Object.hasOwn(result.body, 'layout'), false);
    assert.equal((await call({ query: { address: A, view: 'artworks' }, hydrate: async () => { throw new Error('secret internal failure'); } })).statusCode, 503);
  });
  await t.test('cover verification rejects foreign URLs, redirects, non-raster bytes and oversized streams before saving', async () => {
    const path = `profile-covers/${A}/12345678-1234-1234-1234-123456789abc.png`;
    const url = getPublicStorageUrl('artworks', path);
    assert.equal(profileCoverPath(A, url), path);
    for (const bad of [url.replace(A, B), `${url}?x=1`, `${url}#x`, url.replace('.png', '.svg'), url.replace('layout.example.test', 'evil.test'),
      url.replace('profile-covers/', 'uploads/'), url.replace('/12345678-', '/%2e%2e/12345678-')]) assert.throws(() => profileCoverPath(A, bad));
    const signature = Buffer.from([137,80,78,71,13,10,26,10]);
    let reads = 0;
    globalThis.fetch = async (input, options) => { reads++; assert.equal(String(input), url); assert.equal(options.redirect, 'error');
      return new Response(signature, { headers: { 'Content-Type': 'image/png' } }); };
    await verifyProfileCover(A, url); assert.equal(reads, 1);
    for (const [mime, extension, bytes] of [
      ['image/jpeg', 'jpg', Buffer.from([0xff, 0xd8, 0xff])],
      ['image/gif', 'gif', Buffer.from('GIF89a')],
      ['image/webp', 'webp', Buffer.from('RIFFxxxxWEBP')]
    ]) {
      const rasterUrl = url.replace(/\.png$/, `.${extension}`);
      globalThis.fetch = async input => { assert.equal(String(input), rasterUrl); return new Response(bytes, { headers: { 'Content-Type': mime } }); };
      await verifyProfileCover(A, rasterUrl);
      globalThis.fetch = async () => new Response(bytes, { headers: { 'Content-Type': mime } });
      await assert.rejects(verifyProfileCover(A, url), { code: 'PROFILE_COVER_UNAVAILABLE' });
    }
    for (const mode of ['svg', 'wrong-bytes', 'header-size', 'stream-size', 'redirect']) {
      globalThis.fetch = async () => {
        if (mode === 'redirect') throw new Error('redirect rejected');
        const bytes = mode === 'stream-size' ? Buffer.alloc(MAX_PROFILE_COVER_BYTES + 1) : Buffer.from('<svg/>');
        return new Response(bytes, { headers: { 'Content-Type': mode === 'svg' ? 'image/svg+xml' : 'image/png',
          ...(mode === 'header-size' ? { 'Content-Length': String(MAX_PROFILE_COVER_BYTES + 1) } : {}) } });
      };
      await assert.rejects(verifyProfileCover(A, url), { code: 'PROFILE_COVER_UNAVAILABLE' });
    }
    globalThis.fetch = noAccess;
    assert.equal((await call({ method: 'PUT', body: { expected_revision: 0, layout: { ...base, cover_url: url.replace(A, B) } } })).body.error, 'INVALID_PROFILE_COVER');
  });
});
