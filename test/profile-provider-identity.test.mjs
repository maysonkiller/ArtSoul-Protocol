import assert from 'node:assert/strict';
import test from 'node:test';
import handler from '../src/api/routes/profile.js';
import { setWalletSession, setOAuthState } from '../src/api/backend.js';
import { createOAuthCallbackHandler, oauthUnlinkHandler } from '../src/api/routes/oauth.js';
import { cleanProfile, publicProfile } from '../src/api/profile-fields.js';

function response() {
  return {
    headers: {}, statusCode: 200, body: null,
    setHeader(key, value) { this.headers[key] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
    end() {}
  };
}

test('profile edits cannot forge, erase or overwrite linked provider identity', async t => {
  const names = ['SESSION_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  });
  process.env.SESSION_SECRET = 'profile-identity-test-only-secret';
  process.env.SUPABASE_URL = 'https://database.example';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-placeholder';
  const wallet = '0x1111111111111111111111111111111111111111';
  const session = response();
  setWalletSession(session, wallet);
  const cookie = session.headers['Set-Cookie'].split(';')[0];

  for (const providerValue of ['forged-official-account', null, '']) {
    let written;
    globalThis.fetch = async (_url, options) => {
      written = JSON.parse(options.body)[0];
      return Response.json([written]);
    };
    const result = response();
    await handler({method: 'PUT', headers: {cookie}, body: {
      bio: '  Artist biography  ', avatar_url: 'https://media.example/avatar.png',
      discord_username: providerValue, discord_id: '123456789',
      twitter_handle: providerValue, twitter_username: providerValue, twitter_id: '987654321',
      verified: true, is_partner: true, role: 'admin', wallet_address: '0x2222222222222222222222222222222222222222'
      , twitter_connected: true, discord_connected: true
    }}, result);
    assert.equal(result.statusCode, 200);
    assert.deepEqual(Object.keys(written).sort(), ['avatar_url', 'bio', 'updated_at', 'wallet_address']);
    assert.equal(written.bio, 'Artist biography');
    assert.equal(written.wallet_address, wallet);
  }
});

test('public links remain editable without becoming OAuth evidence', () => {
  for (const input of [' @artist_1 ', 'https://x.com/artist_1', 'https://twitter.com/artist_1/']) {
    const update = cleanProfile({public_twitter_handle: input, twitter_id: 'forged', discord_id: 'forged'});
    assert.deepEqual(update, {twitter_handle: '@artist_1'});
    const view = publicProfile({...update, discord_username: 'legacy-unverified', verified: true});
    assert.equal(view.twitter_connected, false);
    assert.equal(view.discord_connected, false);
    assert.ok(!('verified' in view));
  }
  assert.deepEqual(cleanProfile({public_twitter_handle: ''}), {twitter_handle: null});
  assert.throws(() => cleanProfile({public_twitter_handle: 'https://evil.example/artist'}), /X username/);
  const view = publicProfile({twitter_id: '123', twitter_username: 'confirmed', twitter_handle: '@separate', discord_id: '456', role: 'admin'});
  assert.equal(view.twitter_connected, true);
  assert.equal(view.twitter_username, 'confirmed');
  assert.equal(view.twitter_handle, '@separate');
  assert.ok(!('twitter_id' in view) && !('discord_id' in view) && !('role' in view));
});

test('the public Discord profile URL is derived only from the server-owned numeric provider identity', () => {
  const profile = publicProfile({discord_id: '123456789012345678', discord_profile_url: 'https://evil.example/forged', email: 'private@example.test', email_verified: true});
  assert.equal(profile.discord_profile_url, 'https://discord.com/users/123456789012345678');
  assert.equal(profile.discord_connected, true);
  assert.ok(!('discord_id' in profile) && !('email' in profile) && !('email_verified' in profile));
  for (const discord_id of [null, '', 'name', '123/redirect', '9'.repeat(21)]) {
    assert.equal(publicProfile({discord_id, discord_profile_url: 'https://discord.com/users/999'}).discord_profile_url, null);
  }
  assert.deepEqual(cleanProfile({discord_profile_url: 'https://discord.com/users/999', discord_id: '999', email: 'forged@example.test', email_verified: true}), {});
});

test('OAuth callback binds provider response to the signed wallet and unlink preserves public links', async t => {
  const settings = {SESSION_SECRET: 'oauth-test-secret-only', SUPABASE_URL: 'https://database.example', SUPABASE_SERVICE_ROLE_KEY: 'test-only', DISCORD_CLIENT_ID: 'test-id', DISCORD_CLIENT_SECRET: 'test-secret', X_CLIENT_ID: 'test-id', X_CLIENT_SECRET: 'test-secret'};
  const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  Object.assign(process.env, settings);
  console.error = () => {};
  t.after(() => {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value;
  });
  const wallet = '0x1111111111111111111111111111111111111111';
  const session = response();
  setWalletSession(session, wallet);
  const sessionCookie = session.headers['Set-Cookie'].split(';')[0];
  for (const provider of ['discord', 'twitter']) {
    const state = response();
    setOAuthState(state, {provider, state: 'nonce', wallet, codeVerifier: 'pkce', redirectUri: `https://artsoulprotocol.com/api/oauth/callback/${provider}`});
    const cookie = `${sessionCookie}; ${state.headers['Set-Cookie'].split(';')[0]}`;
    const headers = {cookie, host: 'artsoulprotocol.com', 'x-forwarded-proto': 'https'};
    let row = {wallet_address: wallet, twitter_handle: '@public_link'};
    const calls = [];
    globalThis.fetch = async (url, init = {}) => {
      calls.push(String(url));
      if (String(url).includes('/oauth2/token')) return Response.json({access_token: 'mock-access'});
      if (String(url) === 'https://discord.com/api/users/@me') return Response.json({id: '123456', username: 'confirmed', global_name: 'Confirmed artist'});
      if (String(url) === 'https://api.x.com/2/users/me') return Response.json({data: {id: '987654', username: 'confirmed'}});
      assert.ok(String(url).startsWith('https://database.example/rest/v1/profiles?'));
      if (init.method === 'PATCH') {
        assert.ok(String(url).includes(`wallet_address=eq.${wallet}`));
        row = {...row, ...JSON.parse(init.body)};
      }
      return Response.json([row]);
    };
    for (const query of [{state: 'wrong', code: 'code'}, {state: 'nonce', error: 'access_denied'}, {state: 'nonce'}]) {
      const result = response();
      await createOAuthCallbackHandler(provider)({method: 'GET', headers, query}, result);
      assert.match(result.headers.Location, /oauth_status=error/);
      assert.equal(calls.length, 0);
    }
    const otherSession = response();
    setWalletSession(otherSession, '0x2222222222222222222222222222222222222222');
    const changedWallet = response();
    await createOAuthCallbackHandler(provider)({method: 'GET', headers: {...headers, cookie: `${otherSession.headers['Set-Cookie'].split(';')[0]}; ${state.headers['Set-Cookie'].split(';')[0]}`}, query: {state: 'nonce', code: 'code'}}, changedWallet);
    assert.match(changedWallet.headers.Location, /wallet_changed/);
    assert.equal(calls.length, 0);
    const result = response();
    await createOAuthCallbackHandler(provider)({method: 'GET', headers, query: {state: 'nonce', code: 'code', wallet: 'attacker', discord_id: 'attacker'}}, result);
    assert.match(result.headers.Location, /oauth_status=success/);
    assert.equal(row.wallet_address, wallet);
    assert.equal(row[`${provider}_id`], provider === 'discord' ? '123456' : '987654');
    assert.equal(row.twitter_handle, '@public_link');
    assert.match(result.headers['Set-Cookie'], /Max-Age=0/i);
    const unlinked = response();
    await oauthUnlinkHandler({method: 'POST', headers: {cookie: sessionCookie}, body: {provider, wallet_address: 'attacker'}}, unlinked);
    assert.equal(unlinked.statusCode, 200);
    assert.equal(unlinked.body.profile[`${provider}_connected`], false);
    assert.equal(unlinked.body.profile.twitter_handle, '@public_link');
    assert.equal(row[`${provider}_id`], null);
  }
});

test('profile changes require the signed wallet session before any database call', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => { assert.fail('unauthenticated request must not reach storage'); };
  const result = response();
  await handler({method: 'PUT', headers: {}, body: {discord_username: 'forged'}}, result);
  assert.equal(result.statusCode, 401);
});
