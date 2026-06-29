import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.SESSION_SECRET = 'test-session-secret';

const [{ default: publicArtworksHandler }, { default: moderationHandler }, { setWalletSession }] = await Promise.all([
  import('../src/api/routes/public/artworks.js'),
  import('../src/api/routes/moderation/artwork-visibility.js'),
  import('../src/api/backend.js')
]);

const staffWallet = '0x1111111111111111111111111111111111111111';
const creatorWallet = '0x2222222222222222222222222222222222222222';
const metadata = encodeURIComponent(JSON.stringify({
  name: 'Visibility test',
  description: 'Test artwork',
  image: 'https://example.com/art.png'
}));
let activeRole = 'admin';
let rpcCalls = [];

const artworks = [1, 2, 3, 4].map(id => ({
  chain_id: 84532,
  artwork_id: String(id),
  creator: creatorWallet,
  metadata_uri: `data:application/json,${metadata}`,
  minted: id === 3,
  active_auction_id: id === 3 ? '0' : String(id),
  token_id: id === 3 ? '3' : '0',
  indexed_at: '2026-06-29T00:00:00Z',
  last_updated_at: '2026-06-29T00:00:00Z',
  block_number: 100 + id,
  transaction_hash: `0x${String(id).padStart(64, '0')}`
}));

const auctions = [
  {
    chain_id: 84532,
    auction_id: '1',
    artwork_id: '1',
    status: 'active',
    end_time: '2099-06-29T00:00:00Z',
    start_price: '1000000000000000',
    current_bid: '0',
    current_bidder: '0x0000000000000000000000000000000000000000'
  },
  {
    chain_id: 84532,
    auction_id: '2',
    artwork_id: '2',
    status: 'defaulted_no_bids',
    end_time: '2026-01-01T00:00:00Z',
    start_price: '1000000000000000',
    current_bid: '0',
    current_bidder: '0x0000000000000000000000000000000000000000'
  },
  {
    chain_id: 84532,
    auction_id: '4',
    artwork_id: '4',
    status: 'active',
    end_time: '2099-06-29T00:00:00Z',
    start_price: '1000000000000000',
    current_bid: '0',
    current_bidder: '0x0000000000000000000000000000000000000000'
  }
];

function restRows(pathname) {
  if (pathname === 'v41_artworks') return artworks;
  if (pathname === 'v41_auctions') return auctions;
  if (pathname === 'v41_resale_listings') {
    return [{ chain_id: 84532, token_id: '3', active: true, price: '2000000000000000', seller: staffWallet }];
  }
  if (pathname === 'artwork_moderation_visibility') {
    return [{ chain_id: 84532, artwork_id: '4', hidden: true, hidden_reason: 'Test hide' }];
  }
  if (pathname === 'artsoul_staff_roles') {
    return activeRole ? [{ role: activeRole }] : [];
  }
  if (pathname === 'profiles') {
    return [{
      wallet_address: staffWallet,
      twitter_id: 'x-id',
      twitter_handle: 'staff',
      twitter_username: 'staff',
      discord_id: 'discord-id',
      discord_username: 'staff'
    }];
  }
  return [];
}

global.fetch = async (url, options = {}) => {
  const parsed = new URL(url);
  const restPath = parsed.pathname.split('/rest/v1/')[1] || '';
  const pathname = restPath.split('/')[0];
  let body;

  if (restPath === 'rpc/set_artwork_moderation_visibility') {
    const payload = JSON.parse(options.body || '{}');
    rpcCalls.push(payload);
    body = [{
      chain_id: payload.p_chain_id,
      artwork_id: payload.p_artwork_id,
      hidden: payload.p_hidden,
      hidden_reason: payload.p_reason,
      hidden_by: payload.p_actor_wallet
    }];
  } else {
    body = restRows(pathname);
  }

  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify(body);
    }
  };
};

function responseMock() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
    end() {
      return this;
    }
  };
}

function sessionCookie(wallet = staffWallet) {
  const response = responseMock();
  setWalletSession(response, wallet);
  return response.headers['Set-Cookie'].split(';')[0];
}

async function callPublic(query, cookie = '') {
  const response = responseMock();
  await publicArtworksHandler({ method: 'GET', query, headers: { cookie } }, response);
  return response;
}

test('public discovery includes only live auctions and active resale listings', async () => {
  const response = await callPublic({ limit: '100' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.data.map(row => row.artwork_id), ['1', '3']);
});

test('creator profile includes inactive lifecycle rows but excludes moderator-hidden rows', async () => {
  const response = await callPublic({ creator: creatorWallet, limit: '100' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.data.map(row => row.artwork_id), ['1', '2', '3']);
  assert.deepEqual(response.body.suppressed_artwork_ids, ['v41:84532:4']);
});

test('hidden direct artwork is unavailable publicly but visible to authorized staff', async () => {
  const publicResponse = await callPublic({ id: 'v41:84532:4' });
  assert.equal(publicResponse.body.data.length, 0);

  activeRole = 'admin';
  const staffResponse = await callPublic({ id: 'v41:84532:4' }, sessionCookie());
  assert.equal(staffResponse.body.data.length, 1);
  assert.equal(staffResponse.body.data[0].moderation_hidden, true);
});

test('regular authenticated owners cannot change moderation visibility', async () => {
  activeRole = '';
  const response = responseMock();
  await moderationHandler({
    method: 'POST',
    query: {},
    headers: { cookie: sessionCookie() },
    body: { chain_id: 84532, artwork_id: '1', hidden: true, reason: 'Not allowed' }
  }, response);

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.error, 'ADMIN_REQUIRED');
});

test('authorized staff hide action uses the atomic server-side RPC', async () => {
  activeRole = 'admin';
  rpcCalls = [];
  const response = responseMock();
  await moderationHandler({
    method: 'POST',
    query: {},
    headers: { cookie: sessionCookie() },
    body: { chain_id: 84532, artwork_id: '1', hidden: true, reason: 'Copyright review' }
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.hidden, true);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].p_actor_wallet, staffWallet);
  assert.equal(rpcCalls[0].p_reason, 'Copyright review');
});
