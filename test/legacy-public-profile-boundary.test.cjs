const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync('supabase-client.js', 'utf8');
const CREATOR = `0x${'1'.repeat(40)}`, COLLECTOR = `0x${'2'.repeat(40)}`;
const UUID = '11111111-2222-4333-8444-555555555555';
const plain = value => JSON.parse(JSON.stringify(value));

function client({ rows = {}, projection = [], projectionFails = false, profileFails = false, legacyError = null } = {}) {
  const queries = [], requests = [];
  const database = { from(table) {
    const query = { table, filters: [] };
    const chain = {
      select(value) { query.select = value; return chain; },
      order(field, options) { query.order = [field, options]; return chain; },
      eq(field, value) { query.filters.push(['eq', field, value]); return chain; },
      neq(field, value) { query.filters.push(['neq', field, value]); return chain; },
      single() { query.single = true; return chain; },
      then(resolve, reject) {
        queries.push(query);
        // Model the migration's revoked raw-profile access, including embeds.
        const error = table === 'profiles' || /profiles[!(]/.test(query.select || '')
          ? { code: '42501', message: 'permission denied for table profiles' } : legacyError;
        const selected = (rows[table] || []).filter(row => query.filters.every(([kind, field, value]) =>
          kind === 'eq' ? row[field] === value : row[field] !== value));
        return Promise.resolve({ data: query.single ? selected[0] || null : selected, error }).then(resolve, reject);
      }
    };
    return chain;
  } };
  const window = {
    ArtSoulSupabaseSingleton: { client: database },
    location: { origin: 'https://artsoul.test' },
    localStorage: { getItem: () => null }, addEventListener() {}, dispatchEvent() {}
  };
  vm.runInNewContext(source, {
    window, document: {}, URL, URLSearchParams, console: { log() {}, warn() {}, error() {} },
    CustomEvent: class { constructor(type) { this.type = type; } },
    fetch: async path => {
      requests.push(path);
      const url = new URL(path, window.location.origin);
      if (url.pathname === '/api/public/artworks') return Response.json({ data: projection }, { status: projectionFails ? 503 : 200 });
      assert.equal(url.pathname, '/api/public/profile', 'legacy identity hydration uses only the masked public API');
      const wallet = url.searchParams.get('address');
      assert.match(wallet, /^0x[0-9a-f]{40}$/, 'a UUID or embedded profile is never treated as a wallet');
      return Response.json({ profile: { wallet_address: wallet, username: null, avatar_url: null, profile_content_hidden: true } },
        { status: profileFails ? 503 : 200 });
    }
  });
  return { db: window.ArtSoulDB, queries, requests };
}

test('valid empty modern feeds and wallet-specific creator reads never fall back to legacy storage', async () => {
  const { db, queries, requests } = client();
  assert.equal((await db.getArtworks()).length, 0);
  assert.equal((await db.getArtworksByCreator(CREATOR)).length, 0);
  assert.equal(queries.length, 0);
  assert.equal(requests.length, 2);
  assert.equal(new URL(requests[1], 'https://artsoul.test').searchParams.get('creator'), CREATOR);
});

test('modern read failures stay failures and cannot reveal old legacy rows', async () => {
  const { db, queries } = client({ projectionFails: true, rows: { artworks: [{ id: 'legacy', creator_id: CREATOR }] } });
  await assert.rejects(db.getArtworks(), error => error.code === 'ARTWORK_READ_UNAVAILABLE');
  await assert.rejects(db.getArtworksByCreator(CREATOR), error => error.code === 'ARTWORK_READ_UNAVAILABLE');
  assert.equal(queries.length, 0);
});

test('explicit legacy artwork reads preserve records and scope without raw-profile joins or UUID guesses', async () => {
  const row = { id: 'legacy', creator_id: UUID, owner_address: COLLECTOR, file_type: 'image/png',
    creator: { wallet_address: CREATOR, username: 'Unmasked snapshot' }, auctions: [] };
  const { db, queries, requests } = client({ rows: { artworks: [row] } });
  const list = await db.getArtworks({ publicTestnet: false, creator_id: UUID, file_type: 'image/png' });
  const byCreator = await db.getArtworksByCreator(UUID);
  const owned = await db.getArtworksByOwner(COLLECTOR);
  const detail = await db.getArtwork('legacy');
  for (const result of [list[0], byCreator[0], owned[0], detail]) {
    assert.equal(result.id, 'legacy'); assert.equal(result.creator_id, UUID);
    assert.equal(result.owner_address, COLLECTOR); assert.equal(result.creator, null);
    assert.deepEqual(plain(result.auctions), []);
  }
  assert.equal(requests.length, 0, 'a UUID-only identity is neutral, not guessed');
  assert.deepEqual(queries[0].filters, [['eq', 'creator_id', UUID], ['eq', 'file_type', 'image/png']]);
  assert.deepEqual(queries[1].filters, [['eq', 'creator_id', UUID]]);
  assert.deepEqual(queries[2].filters, [['eq', 'owner_address', COLLECTOR], ['neq', 'creator_id', COLLECTOR]]);
  assert.deepEqual(queries[3].filters, [['eq', 'id', 'legacy']]);
  assert.equal(row.creator.username, 'Unmasked snapshot', 'hydration does not mutate retained input');
});

test('wallet-backed legacy artwork, auction and bidder identities use the masked public profile', async () => {
  const artwork = { id: 'legacy', creator_id: UUID, creator_address: CREATOR };
  const bid = { id: 'bid', auction_id: 'auction', bidder_id: COLLECTOR, amount: '1' };
  const auction = { id: 'auction', status: 'active', winner_id: COLLECTOR, artwork, bids: [bid] };
  const { db, queries, requests } = client({ rows: { artworks: [artwork], auctions: [auction], bids: [bid] } });
  const detail = await db.getArtwork('legacy');
  const active = await db.getActiveAuctions();
  const selected = await db.getAuction('auction');
  const bids = await db.getAuctionBids('auction');
  for (const profile of [detail.creator, active[0].artwork.creator, active[0].winner,
    selected.artwork.creator, selected.winner, selected.bids[0].bidder, bids[0].bidder]) {
    assert.equal(profile.profile_content_hidden, true);
    assert.equal(profile.username, null); assert.equal(profile.avatar_url, null);
  }
  assert.equal(selected.winner.wallet_address, COLLECTOR);
  assert.equal(selected.artwork.creator.wallet_address, CREATOR);
  assert.equal(selected.bids[0].amount, '1');
  assert.equal(requests.length, 2, 'existing profile request coalescing/cache handles repeated roles');
  assert.ok(queries.every(query => !query.select.includes('profiles')));
  assert.deepEqual(queries[3].filters, [['eq', 'auction_id', 'auction']]);
});

test('legacy count-only bid embeds remain counts and missing records remain null', async () => {
  const { db, requests } = client({ rows: { auctions: [{ id: 'auction', status: 'active', artwork: null, bids: [{ count: 3 }] }] } });
  assert.deepEqual(plain((await db.getActiveAuctions())[0].bids), [{ count: 3 }]);
  assert.equal(await db.getArtwork('missing'), null);
  assert.equal(requests.length, 0);
});

test('masked-profile outages and legacy storage errors never fall back to raw profile content', async () => {
  const unavailable = client({ profileFails: true, rows: { artworks: [{ id: 'legacy', creator_id: CREATOR }] } });
  await assert.rejects(unavailable.db.getArtwork('legacy'));
  assert.equal(unavailable.queries.length, 1); assert.equal(unavailable.requests.length, 1);
  assert.ok(unavailable.queries.every(query => !query.select.includes('profiles')));
  const storage = client({ legacyError: { code: '42501', message: 'permission denied' } });
  await assert.rejects(storage.db.getArtwork('legacy'), error => error.code === '42501');
  assert.equal(storage.requests.length, 0);
});
