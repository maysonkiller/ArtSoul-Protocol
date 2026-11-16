import test from 'node:test';
import assert from 'node:assert/strict';
import profileHandler from '../src/api/routes/profile.js';
import publicProfileHandler from '../src/api/routes/public/profile.js';
import { oauthUnlinkHandler } from '../src/api/routes/oauth.js';
import { setWalletSession } from '../src/api/backend.js';
import { readReportingConfig } from '../src/api/reporting-config.js';

const OWNER = `0x${'1'.repeat(40)}`;
const OTHER = `0x${'2'.repeat(40)}`;
const response = () => ({
  headers: {}, statusCode: 200,
  setHeader(key, value) { this.headers[key] = value; },
  status(code) { this.statusCode = code; return this; },
  json(value) { this.body = value; return this; }, end() {}
});
function fixture(t) {
  const settings = { SESSION_SECRET: 'profile-moderation-test-only', SUPABASE_URL: 'https://profile.test',
    SUPABASE_SERVICE_ROLE_KEY: 'fixture', ARTSOUL_REPORTING_ENABLED: 'false', ARTSOUL_PROFILE_REPORTS_ENABLED: 'false', ARTSOUL_REPORT_DAILY_LIMIT: '5' };
  const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  const oldFetch = globalThis.fetch;
  Object.assign(process.env, settings);
  t.after(() => {
    globalThis.fetch = oldFetch;
    for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value;
  });
  const session = response(); setWalletSession(session, OWNER);
  return { cookie: session.headers['Set-Cookie'].split(';')[0], 'x-artsoul-wallet': OWNER };
}

test('private profile originals require both a wallet session and its intended wallet', async t => {
  const headers = fixture(t);
  let calls = 0;
  const original = { wallet_address: OWNER, username: 'Original name', bio: 'Original text', avatar_url: 'https://media.test/a.png',
    twitter_id: 'provider-id', discord_id: '123456', discord_username: 'Original social name', email: 'private@test.invalid', role: 'team' };
  globalThis.fetch = async url => {
    calls++;
    const parsed = new URL(url);
    assert.equal(parsed.pathname, '/rest/v1/profiles');
    assert.equal(parsed.searchParams.get('wallet_address'), `eq.${OWNER}`);
    assert.ok(!parsed.searchParams.get('select').includes('email'));
    return Response.json([original]);
  };
  for (const invalid of [{}, { 'x-artsoul-wallet': OWNER }, { cookie: headers.cookie }, { ...headers, 'x-artsoul-wallet': OTHER }]) {
    const res = response(); await profileHandler({ method: 'GET', headers: invalid, query: { address: OTHER } }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.headers['Cache-Control'], 'private, no-store');
  }
  assert.equal(calls, 0);
  const res = response(); await profileHandler({ method: 'GET', headers, query: { address: OTHER } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls, 1);
  assert.equal(res.body.profile.bio, original.bio);
  assert.equal(res.body.profile.wallet_address, OWNER, 'query input cannot select another owner');
  assert.equal(res.body.profile.discord_connected, true);
  for (const key of ['twitter_id', 'discord_id', 'email', 'role']) assert.ok(!(key in res.body.profile));
});

test('public reads retain profile masking when new report intake is disabled', async t => {
  fixture(t);
  assert.equal(readReportingConfig().profileEnabled, false);
  globalThis.fetch = async url => {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, '/rest/v1/public_profile_content');
    assert.ok(parsed.searchParams.get('select').includes('profile_content_hidden'));
    return Response.json([{ wallet_address: OWNER, username: null, bio: null, avatar_url: null,
      twitter_id: null, discord_id: null, profile_content_hidden: true }]);
  };
  const res = response(); await publicProfileHandler({ method: 'GET', query: { address: OWNER } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.profile.profile_content_hidden, true);
  assert.equal(res.body.profile.bio, null);
  assert.equal(res.body.profile.discord_profile_url, null);
});

test('public profile projection failure does not fall back to the unmasked table', async t => {
  fixture(t); let calls = 0;
  globalThis.fetch = async url => {
    calls++; assert.equal(new URL(url).pathname, '/rest/v1/public_profile_content');
    return Response.json({ message: 'projection unavailable' }, { status: 503 });
  };
  const res = response(); await publicProfileHandler({ method: 'GET', query: { address: OWNER } }, res);
  assert.ok(res.statusCode >= 500); assert.equal(calls, 1);
  assert.ok(!res.body.profile);
});

test('save and unlink return masked public data instead of caching owner-only originals', async t => {
  const headers = fixture(t);
  for (const operation of ['save', 'unlink']) {
    const calls = [];
    globalThis.fetch = async (url, init) => {
      const path = new URL(url).pathname; calls.push([path, init.method]);
      if (init.method !== 'GET') {
        assert.equal(path, '/rest/v1/profiles');
        assert.match(init.headers.Prefer, /return=minimal/);
        return new Response(null, { status: 204 });
      }
      assert.equal(path, '/rest/v1/public_profile_content');
      return Response.json([{ wallet_address: OWNER, bio: null, profile_content_hidden: true }]);
    };
    const res = response();
    if (operation === 'save') await profileHandler({ method: 'PUT', headers, body: { bio: 'Already reviewed content' } }, res);
    else await oauthUnlinkHandler({ method: 'POST', headers, body: { provider: 'discord' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.profile.bio, null);
    assert.equal(res.body.profile.profile_content_hidden, true);
    assert.equal(calls.length, 2);
    assert.equal(res.headers['Cache-Control'], 'private, no-store');
  }
});

test('unlink rejects a missing or mismatched intended wallet before any profile mutation', async t => {
  const headers = fixture(t);
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json([]); };
  for (const provider of ['discord', 'twitter']) {
    for (const invalid of [
      {cookie: headers.cookie},
      {...headers, 'x-artsoul-wallet': OTHER},
      {...headers, 'x-artsoul-wallet': [OWNER]},
      {'x-artsoul-wallet': OWNER}
    ]) {
      const res = response();
      await oauthUnlinkHandler({method: 'POST', headers: invalid,
        body: {provider, wallet_address: OWNER}}, res);
      assert.equal(res.statusCode, 401);
      assert.equal(res.body.error, invalid.cookie ? 'SESSION_WALLET_MISMATCH' : 'UNAUTHENTICATED');
      assert.equal(res.headers['Cache-Control'], 'private, no-store');
    }
  }
  assert.equal(calls, 0, 'no profile read or write is allowed for a stale or unverified wallet context');
});

test('profile intake requires its own flag as well as working global report limits', t => {
  fixture(t);
  process.env.ARTSOUL_PROFILE_REPORTS_ENABLED = 'true';
  assert.equal(readReportingConfig().profileEnabled, false);
  process.env.ARTSOUL_REPORTING_ENABLED = 'true';
  assert.equal(readReportingConfig().profileEnabled, true);
  process.env.ARTSOUL_REPORT_DAILY_LIMIT = '0';
  assert.equal(readReportingConfig().profileEnabled, false);
});
