// The profile page stopped reading `profiles` directly and now goes through
// /api/public/profile. That route answers with an explicit field list, so the
// list is not a detail of the route: it is the contract every consumer of
// ArtSoulDB.getProfile() depends on. When it first shipped it omitted
// `created_at` and `id`, and both omissions changed product behaviour without
// failing a test - the trust score dropped by the whole account-age bonus, and
// a saved profile stopped taking the update branch.
//
// These tests therefore exercise the real chain end to end: the real route
// handler answers a stubbed PostgREST, the real browser client reads that
// answer, and the real discovery service scores the profile it produced.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';

import publicProfileHandler from '../src/api/routes/public/profile.js';

const WALLET = '0x6ec8c121043357ac231e36d403edabf90ae6989b';
const DAY_MS = 86400000;

// A stored row carries more than the page may see. Provider identifiers and
// internal columns are present here precisely so the tests can prove they are
// dropped rather than merely absent upstream.
function storedProfileRow(overrides = {}) {
  return {
    id: 'a4b1f0c2-1111-4444-8888-0d9e6c5f3a21',
    wallet_address: WALLET,
    username: 'maysonkiller',
    bio: 'FOUNDER ARTSOUL',
    avatar_url: 'https://cdn.example/avatar.png',
    twitter_handle: '@maysonkiller23',
    twitter_username: 'maysonkiller23',
    discord_username: 'maysonkiller',
    vk_username: 'maysonkiller',
    created_at: new Date(Date.now() - 400 * DAY_MS).toISOString(),
    updated_at: new Date().toISOString(),
    twitter_id: '1111111111111111111',
    discord_id: '2222222222222222222',
    discord_avatar: 'a_33333333333333333333333333333333',
    ...overrides
  };
}

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

// Runs the real route against a stubbed PostgREST and returns both the answer
// and the URL the route asked for, so a test can assert the projection too.
async function callPublicProfileRoute(rows, query = { address: WALLET }) {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://database.example';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';

  let requestedUrl = '';
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    // PostgREST returns only the selected columns. Mirror that, so the test
    // cannot pass because the stub leaked a column the select never asked for.
    const selected = new URL(requestedUrl).searchParams.get('select');
    const fields = String(selected || '').split(',').filter(Boolean);
    const projected = rows.map(row => Object.fromEntries(
      fields.filter(field => field in row).map(field => [field, row[field]])
    ));
    return new Response(JSON.stringify(projected), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    const res = createResponse();
    await publicProfileHandler({ method: 'GET', query }, res);
    return { res, requestedUrl };
  } finally {
    globalThis.fetch = originalFetch;
    process.env.SUPABASE_URL = originalUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
}

// The real browser client, loaded the way the page loads it: a classic script
// that publishes window.ArtSoulDB. Its fetch is recorded so a test can prove
// which request a call actually issued.
function loadArtSoulDB(routes = {}) {
  const calls = [];
  const win = {
    location: { search: '', origin: 'https://artsoul.example' },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    addEventListener() {},
    dispatchEvent() {}
  };
  const context = vm.createContext({
    window: win,
    document: { addEventListener() {} },
    console: { log() {}, warn() {}, error() {} },
    fetch: async (path, init) => {
      calls.push(String(path));
      const body = routes[String(path).split('?')[0]];
      if (body === undefined) {
        return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify(typeof body === 'function' ? body(String(path), init) : body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    },
    Response,
    Headers,
    Request,
    URL,
    URLSearchParams,
    CustomEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
    setTimeout,
    clearTimeout
  });
  vm.runInContext(fs.readFileSync('supabase-client.js', 'utf8'), context, {
    filename: 'supabase-client.js'
  });
  return { db: win.ArtSoulDB, calls };
}

function loadDiscoveryService() {
  const context = vm.createContext({
    window: {
      location: { search: '' },
      localStorage: { getItem: () => null },
      ArtSoulSecurity: { isValidStorageUrl: () => true }
    },
    URLSearchParams,
    console
  });
  vm.runInContext(
    fs.readFileSync('src/features/discovery/discovery-service.js', 'utf8'),
    context,
    { filename: 'src/features/discovery/discovery-service.js' }
  );
  return context.window.ArtSoulDiscovery;
}

test('the public profile read carries the identity the page saves and scores with', async () => {
  const { res, requestedUrl } = await callPublicProfileRoute([storedProfileRow()]);

  assert.equal(res.statusCode, 200);
  for (const field of [
    'id',
    'created_at',
    'wallet_address',
    'username',
    'bio',
    'avatar_url',
    'twitter_handle',
    'twitter_username',
    'discord_username'
  ]) {
    assert.ok(field in res.body.profile, `the public profile must carry ${field}`);
  }
  // The route asked the database for them too, rather than relying on a row
  // that happened to arrive with more columns than the select requested.
  assert.match(requestedUrl, /(^|[?&,])select=/);
  assert.match(requestedUrl, /(select=|,)id(,|$|&)/);
  assert.match(requestedUrl, /(select=|,)created_at(,|$|&)/);
  assert.doesNotMatch(requestedUrl, /select=\*/);
});

test('the public profile read still withholds private provider identifiers', async () => {
  const { res, requestedUrl } = await callPublicProfileRoute([storedProfileRow()]);

  for (const field of ['twitter_id', 'discord_id', 'discord_avatar', 'vk_username', 'updated_at']) {
    assert.ok(
      !(field in res.body.profile),
      `${field} is not needed by any public surface and must not be published`
    );
    assert.ok(
      !new RegExp(`(select=|,)${field}(,|$|&)`).test(requestedUrl),
      `${field} must not even be selected from the database`
    );
  }
});

test('an aged profile keeps its account-age contribution to trust and influence', async () => {
  const discovery = loadDiscoveryService();
  const { res } = await callPublicProfileRoute([storedProfileRow()]);

  const published = res.body.profile;
  const withoutAge = { ...published };
  delete withoutAge.created_at;

  const aged = discovery.computeTrustProfile(published, [], {});
  const ageless = discovery.computeTrustProfile(withoutAge, [], {});

  // 400 days old saturates the bonus at its cap of 10 points, which is also the
  // difference between "High trust" and "Established" for a profile near 80.
  assert.equal(aged.score - ageless.score, 10);
  assert.ok(aged.influenceWeight > ageless.influenceWeight);
  assert.equal(aged.influenceWeight, Number((0.25 + aged.score / 100).toFixed(2)));
});

test('a saved profile that already exists takes the update path, not the create fallback', async () => {
  const { res } = await callPublicProfileRoute([storedProfileRow()]);
  const { db } = loadArtSoulDB({ '/api/public/profile': res.body });

  const profile = await db.getProfile(WALLET);
  // saveProfile branches on this exact value. An existing row must reach it
  // truthy, or every save of an existing profile falls through to the
  // create/upsert fallback instead.
  assert.ok(profile.id, 'an existing profile must reach the page with its id');

  const entry = fs.readFileSync('src/entries/profile.jsx', 'utf8');
  const start = entry.indexOf('async function saveProfile()');
  const end = entry.indexOf('function handleQuickUpload()', start);
  assert.ok(start >= 0 && end > start, 'saveProfile must still be the save entry point');
  const save = entry.slice(start, end);
  assert.match(save, /if \(profile\.id\) \{\s*\n\s*await window\.ArtSoulDB\.updateProfile\(/);
  assert.match(save, /\} else \{\s*\n\s*const newProfile = await window\.ArtSoulDB\.createProfile\(/);
});

test('a first visit with no profile row still reads as a normal empty result', async () => {
  const { res } = await callPublicProfileRoute([]);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.profile, null);

  const { db } = loadArtSoulDB({ '/api/public/profile': res.body });
  assert.equal(await db.getProfile(WALLET), null);
});

test('a creator artwork query cannot degrade into an unfiltered read of every artwork', async () => {
  const { db, calls } = loadArtSoulDB({
    '/api/public/artworks': { data: [{ id: 'not-this-creators-artwork' }] }
  });

  for (const missing of [undefined, null, '']) {
    await assert.rejects(
      () => db.getArtworksByCreator(missing),
      /creator/i,
      `getArtworksByCreator(${JSON.stringify(missing)}) must refuse rather than guess`
    );
  }

  assert.deepEqual(
    calls.filter(path => path.includes('/api/public/artworks')),
    [],
    'a missing creator must issue no request at all, because a creator-less query returns everyone'
  );
});
