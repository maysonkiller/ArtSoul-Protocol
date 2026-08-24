import assert from 'node:assert/strict';
import test from 'node:test';

import publicProfileHandler from '../src/api/routes/public/profile.js';

const WALLET = '0x6ec8c121043357ac231e36d403edabf90ae6989b';

function createResponse() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; }
  };
}

test('public profile exposes only the fields used by the public page', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  t.after(() => {
    globalThis.fetch = originalFetch;
    process.env.SUPABASE_URL = originalUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  });

  process.env.SUPABASE_URL = 'https://database.example';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
  let requestedUrl = '';
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify([{
      wallet_address: WALLET,
      username: 'Mayson',
      bio: 'Founder',
      avatar_url: 'https://cdn.example/avatar.png'
    }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const res = createResponse();
  await publicProfileHandler({
    method: 'GET',
    query: { address: '0x6EC8C121043357aC231E36D403EdAbf90AE6989B' }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.profile.wallet_address, WALLET);
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
  assert.match(requestedUrl, /profiles\?wallet_address=eq\./);
  assert.match(requestedUrl, /select=wallet_address,username,bio,avatar_url,twitter_handle,twitter_username,discord_username/);
  assert.doesNotMatch(requestedUrl, /select=\*/);
  assert.doesNotMatch(requestedUrl, /twitter_id|discord_id/);
});

test('public profile rejects an invalid address before querying the database', async () => {
  let fetched = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetched = true; throw new Error('must not fetch'); };
  try {
    const res = createResponse();
    await publicProfileHandler({ method: 'GET', query: { address: 'not-a-wallet' } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'INVALID_WALLET_ADDRESS');
    assert.equal(fetched, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('public profile returns null for a wallet without a profile row', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  t.after(() => {
    globalThis.fetch = originalFetch;
    process.env.SUPABASE_URL = originalUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  });
  process.env.SUPABASE_URL = 'https://database.example';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
  globalThis.fetch = async () => new Response('[]', { status: 200 });

  const res = createResponse();
  await publicProfileHandler({ method: 'GET', query: { address: WALLET } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.profile, null);
});
