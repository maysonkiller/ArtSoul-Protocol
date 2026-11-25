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

// The field list is asserted literally here so that widening it is a deliberate
// edit rather than a side effect. Which fields the page actually needs, and what
// breaks when one goes missing, is proved in
// public-profile-read-keeps-page-behavior.test.mjs.
test('public profile exposes exactly the fields used by the public page', async (t) => {
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
      id: 'a4b1f0c2-1111-4444-8888-0d9e6c5f3a21',
      created_at: '2025-05-01T10:00:00.000Z',
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
  const requested = new URL(requestedUrl);
  assert.equal(requested.pathname, '/rest/v1/public_profile_content');
  assert.equal(requested.searchParams.get('wallet_address'), `eq.${WALLET}`);
  assert.equal(requested.searchParams.get('select'), 'id,created_at,wallet_address,username,bio,avatar_url,twitter_handle,twitter_username,discord_username,twitter_id,discord_id,profile_content_hidden');
  assert.doesNotMatch(requestedUrl, /select=\*/);
  assert.doesNotMatch(requestedUrl, /discord_avatar/);
  assert.equal(res.body.profile.twitter_connected, false);
  assert.equal(res.body.profile.discord_connected, false);
  assert.ok(!('twitter_id' in res.body.profile));
  assert.ok(!('discord_id' in res.body.profile));
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

test('optional Genesis lookup accepts only the configured issuer and returns a public serial without a profile row', async t => {
  const fetch = globalThis.fetch;
  const names = ['ARTSOUL_PROFILE_GENESIS_ENABLED', 'ARTSOUL_PROFILE_GENESIS_DEPLOYMENT', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
  const before = names.map(name => process.env[name]);
  t.after(() => {
    globalThis.fetch = fetch;
    names.forEach((name, i) => { if (before[i] === undefined) delete process.env[name]; else process.env[name] = before[i]; });
  });
  const deployment = { chainId: 8453, genesis: '0x' + '1'.repeat(40), genesisCodeHash: '0x' + '2'.repeat(64),
    safe: '0x' + '3'.repeat(40), founder: '0x' + '4'.repeat(40) };
  process.env.SUPABASE_URL = 'https://database.example';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
  let count = 0, returned = 0;
  globalThis.fetch = async (url, options) => {
    count++;
    assert.equal(new URL(url).pathname, '/rest/v1/rpc/read_profile_genesis_serial');
    assert.deepEqual(JSON.parse(options.body), { p_genesis: deployment.genesis, p_code_hash: deployment.genesisCodeHash,
      p_authority: deployment.safe, p_founder: deployment.founder, p_wallet: WALLET });
    return Response.json(returned);
  };
  const call = async () => {
    const res = createResponse();
    await publicProfileHandler({ method: 'GET', query: { view: 'genesis', address: WALLET,
      chainId: 84532, serial: '500', genesis: WALLET } }, res);
    assert.equal(res.statusCode, 200); assert.equal(res.headers['Cache-Control'], 'private, no-store');
    return res.body;
  };
  process.env.ARTSOUL_PROFILE_GENESIS_ENABLED = 'false';
  process.env.ARTSOUL_PROFILE_GENESIS_DEPLOYMENT = JSON.stringify(deployment);
  assert.deepEqual(await call(), { wallet: WALLET, serial: null });
  process.env.ARTSOUL_PROFILE_GENESIS_ENABLED = 'true';
  for (const invalid of ['{}', 'not-json', JSON.stringify({...deployment, chainId:84532}), JSON.stringify({...deployment, safe: deployment.genesis})]) {
    process.env.ARTSOUL_PROFILE_GENESIS_DEPLOYMENT = invalid;
    assert.deepEqual(await call(), { wallet: WALLET, serial: null });
  }
  assert.equal(count, 0);
  process.env.ARTSOUL_PROFILE_GENESIS_DEPLOYMENT = JSON.stringify(deployment);
  assert.deepEqual(await call(), { wallet: WALLET, serial: 0 });
  for (returned of [null, { serial: 0, private: 'fixture' }, '0', -1, 10000]) {
    assert.deepEqual(await call(), { wallet: WALLET, serial: null });
  }
  assert.equal(count, 6);
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
