import assert from 'node:assert/strict';
import test from 'node:test';
import { setWalletSession } from '../src/api/backend.js';
import savedHandler from '../src/api/routes/saved.js';
import searchHandler from '../src/api/routes/public/search.js';

const address = value => `0x${value.repeat(40)}`;
const CORE = address('a'), NFT = address('b'), OLD_CORE = address('c');
const CREATOR = address('1'), FIRST = address('2'), OWNER = address('3');
const NEXT_OWNER = address('4'), LAST_OWNER = address('5'), WALLET = address('6');
const IDS = ['5', '4', '3', '2', '1'];
const hash = value => `0x${value.toString(16).padStart(64, '0')}`;
const env = {
  SESSION_SECRET: 'offline-outer-response-session', SUPABASE_URL: 'https://outer-response.example.test',
  SUPABASE_SERVICE_ROLE_KEY: 'offline-outer-response-service', ARTSOUL_SAVED_ENABLED: 'true',
  ARTSOUL_SEARCH_ENABLED: 'true', ARTSOUL_NFT_OWNERSHIP_ENABLED: 'true',
  ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA: CORE, ARTSOUL_NFT_ADDRESS_BASE_SEPOLIA: NFT,
  ARTSOUL_NFT_OWNERSHIP_CORE_CODE_HASH: hash(1), ARTSOUL_NFT_OWNERSHIP_NFT_CODE_HASH: hash(2)
};
const nextTurn = () => new Promise(resolve => setImmediate(resolve));
const transfer = (to = OWNER, block = 110) => ({ block_number: block, log_index: 9,
  transaction_hash: hash(block), recorded_at: '2026-11-01T00:00:00+00:00',
  from_address: FIRST, to_address: to });

function response() {
  return { statusCode: 200, headers: {}, sent: [],
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.sent.push({ status: this.statusCode, body }); return this; }, end() {} };
}

function fixture() {
  const f = { calls: [], unexpected: [], savedReads: 0, artistReads: 0, publications: 0,
    marker: { indexed_through: 120, confirmed_through: 115, covered_hash: hash(120), state_revision: '1234' },
    onLastSavedCard: null, onArtistProfiles: null, afterProof: null, lastCardAttempts: new Set(),
    searchKeys: { artworks: [...IDS], auctions: [], artists: [CREATOR] } };
  f.rows = {
    saved_artworks: IDS.map(id => ({ id, wallet_address: WALLET, chain_id: '84532', core_address: CORE,
      artwork_id: id, created_at: '2026-10-24T12:00:00.000Z' })),
    v41_artworks: IDS.map(id => ({ chain_id: 84532, artwork_id: id, token_id: id, creator: CREATOR,
      minted: true, canonical_floor: '2000000000000000000', active_auction_id: '',
      metadata_uri: `data:application/json,${encodeURIComponent(JSON.stringify({ name: `Artwork ${id}` }))}`,
      block_number: 10, last_updated_block: 20, transaction_hash: hash(10), indexed_at: '2026-10-01T00:00:00Z' })),
    v41_settlements: IDS.map(id => ({ chain_id: 84532, artwork_id: id, auction_id: id, token_id: id,
      settlement_status: 'completed', winner: FIRST, final_price: '2000000000000000000',
      block_number: 20, log_index: 4, transaction_hash: hash(20) })),
    v41_auctions: [], v41_bids: [], v41_floor_history: [], v41_resale_listings: [], v41_resale_history: [],
    v41_trust_signals: [], artwork_social_signals: [], artwork_moderation_visibility: [],
    profiles: [CREATOR, FIRST, OWNER, NEXT_OWNER, LAST_OWNER].map(wallet_address => ({ wallet_address,
      username: 'Publication 0', twitter_id: 'private-provider-id', email: 'private@example.test' }))
  };
  f.owners = IDS.map(artwork_id => ({ artwork_id, token_id: artwork_id, verified: true,
    first_collector_address: FIRST, current_owner_address: OWNER, latest_transfer: transfer(), active_listing: null }));
  f.publish = () => {
    const height = f.marker.indexed_through + 1;
    f.publications++;
    f.marker = { indexed_through: height, confirmed_through: height, covered_hash: hash(height),
      state_revision: String(Number(f.marker.state_revision) + 1) };
    for (const owner of f.owners) {
      owner.current_owner_address = f.publications === 1 ? NEXT_OWNER : LAST_OWNER;
      owner.latest_transfer = transfer(owner.current_owner_address, height);
    }
    for (const profile of f.rows.profiles) profile.username = `Publication ${f.publications}`;
  };
  f.mutateOwner = id => {
    const owner = f.owners.find(row => row.artwork_id === id);
    owner.current_owner_address = NEXT_OWNER;
    owner.latest_transfer = transfer(NEXT_OWNER);
  };
  f.fetch = async (input, options = {}) => {
    try {
      const url = new URL(input), name = url.pathname.split('/rest/v1/')[1];
      assert.equal(url.origin, env.SUPABASE_URL, 'all requests must stay inside the synthetic fixture');
      const body = options.body && JSON.parse(options.body);
      const method = options.method || 'GET';
      assert.ok(method === 'GET' || (method === 'POST' && [
        'rpc/read_verified_nft_boundary', 'rpc/read_verified_nft_cards',
        'rpc/search_public_artworks', 'rpc/read_public_search_cards'
      ].includes(name)), 'the fixture never permits a write');
      f.calls.push({ name, query: url.searchParams, body });
      if (name === 'saved_artworks') f.savedReads++;
      if (name === 'v41_artworks' && url.searchParams.get('artwork_id') === 'eq.1' &&
          !f.lastCardAttempts.has(f.savedReads)) {
        f.lastCardAttempts.add(f.savedReads);
        await f.onLastSavedCard?.();
      }
      let result;
      if (name === 'rpc/read_verified_nft_boundary') result = [{ ...f.marker }];
      else if (name === 'rpc/read_verified_nft_cards') result = body.p_artwork_ids.map(id => ({
        ...f.owners.find(row => row.artwork_id === id), ...f.marker
      }));
      else if (name === 'rpc/search_public_artworks') {
        assert.equal(body.p_core_address, CORE);
        result = f.searchKeys[body.p_category].map(result_key => ({ result_key }));
      } else if (name === 'rpc/read_public_search_cards') {
        const artworks = body.p_artwork_ids.flatMap(id => f.rows.v41_artworks.filter(row => row.artwork_id === id));
        result = { artworks, metadata: artworks.map(row => ({ name: `Artwork ${row.artwork_id}` })),
          auctions: [], settlements: f.rows.v41_settlements.filter(row => body.p_artwork_ids.includes(row.artwork_id)),
          listings: [], resales: [], signals: artworks.map(() => ({ like: 0, would_buy: 0, watching: 0 })) };
      } else {
        assert.ok(Object.hasOwn(f.rows, name), `Unexpected fixture request: ${name}`);
        result = f.rows[name].filter(row => [...url.searchParams].every(([key, value]) => {
          if (value.startsWith('eq.')) return String(row[key]) === value.slice(3);
          if (value.startsWith('in.(')) return value.slice(4, -1).split(',').includes(String(row[key]));
          return true;
        }));
      }
      const encoded = JSON.stringify(result);
      if (name === 'rpc/read_verified_nft_cards') await f.afterProof?.(body.p_artwork_ids);
      if (name === 'profiles' && url.searchParams.get('select')?.includes('twitter_id')) {
        f.artistReads++;
        // All other fixture reads resolve immediately. Hold this outer response
        // dependency for a turn so card hydration finishes before publication.
        await nextTurn();
        await f.onArtistProfiles?.();
      }
      return new Response(encoded, { headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
      f.unexpected.push(error.message);
      throw error;
    }
  };
  return f;
}

function assertSuccess(res) {
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.sent.length, 1, 'only one complete response is sent');
  assert.equal(res.headers['cache-control'], 'private, no-store');
  assert.doesNotMatch(JSON.stringify(res.body), /private-provider-id|private@example\.test/);
}
function assertUnavailable(res, surface) {
  assert.equal(res.statusCode, 503, 'a mixed or unverified response must not be successful');
  const body = surface === 'Saved'
    ? { error: 'SAVED_UNAVAILABLE', message: 'Saved is temporarily unavailable. Please try again.' }
    : { error: 'SEARCH_UNAVAILABLE', message: 'Search is temporarily unavailable. Please try again.' };
  assert.deepEqual(res.sent, [{ status: 503, body }], 'no partial success or private proof is serialized');
  assert.equal(res.headers['cache-control'], 'private, no-store');
}
function assertOwners(cards, owner) {
  assert.deepEqual(cards.map(card => card.artwork_id), IDS);
  for (const card of cards) {
    assert.equal(card.current_owner_address, owner, `owner of artwork ${card.artwork_id}`);
    assert.equal(card.auction_winner_address, FIRST);
    assert.equal(card.ownership_status, 'verified');
    assert.equal(card.canonical_floor, '2');
  }
}

test('Saved and search verify ownership at the complete HTTP response boundary', async t => {
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  let f, headers;
  t.beforeEach(() => {
    Object.assign(process.env, env);
    f = fixture(); globalThis.fetch = f.fetch;
    const session = response(); setWalletSession(session, WALLET);
    headers = { cookie: session.headers['set-cookie'].split(';')[0], 'x-artsoul-wallet': WALLET };
  });
  t.afterEach(async () => {
    await nextTurn();
    assert.deepEqual(f.unexpected, [], 'fixture failures must not masquerade as ownership denials');
  });
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const callSaved = async () => {
    const res = response(); await savedHandler({ method: 'GET', query: {}, headers }, res); return res;
  };
  const callSearch = async () => {
    const res = response(); await searchHandler({ method: 'GET', query: { q: 'Artwork', category: 'all' }, headers: {} }, res); return res;
  };
  const searchPasses = () => f.calls.filter(call => call.name === 'rpc/search_public_artworks').length / 3;
  const proofCalls = () => f.calls.filter(call => call.name === 'rpc/read_verified_nft_cards');
  const assertProofBudget = expected => {
    assert.equal(f.calls.filter(call => call.name === 'rpc/read_verified_nft_boundary').length, 1);
    assert.equal(proofCalls().length, expected);
    assert.ok(proofCalls().every(call => call.body.p_artwork_ids.length <= 20), 'proof RPCs stay bounded');
  };

  await t.test('stable Saved returns five verified cards across two hydration groups', async () => {
    const res = await callSaved(); assertSuccess(res);
    assertOwners(res.body.items.map(item => item.artwork), OWNER);
    assert.equal(res.body.wallet, WALLET); assert.equal(res.body.nextCursor, null);
    assert.equal(f.savedReads, 1);
    assert.equal(f.lastCardAttempts.size, 1);
    assertProofBudget(6);
    assert.deepEqual(proofCalls().map(call => call.body.p_artwork_ids.length), [1, 1, 1, 1, 1, 5]);
  });
  await t.test('Saved discards the first group and rereads the whole page after one publication', async () => {
    f.onLastSavedCard = () => { if (!f.publications) f.publish(); };
    const res = await callSaved(); assertSuccess(res);
    assertOwners(res.body.items.map(item => item.artwork), NEXT_OWNER);
    assert.equal(f.savedReads, 2, 'the saved list and visibility must be read again, not just the last card');
  });
  await t.test('Saved returns one sanitized denial after publication on both page attempts', async () => {
    f.onLastSavedCard = () => f.publish();
    assertUnavailable(await callSaved(), 'Saved');
    assert.equal(f.savedReads, 2, 'one outer retry only');
    assert.equal(f.publications, 2);
  });
  await t.test('Saved rejects an earlier card owner changing under an unchanged marker', async () => {
    f.onLastSavedCard = () => f.mutateOwner('5');
    assertUnavailable(await callSaved(), 'Saved');
    assert.equal(f.savedReads, 1, 'an owner mutation is not a retryable publication');
  });
  await t.test('stable search all returns verified artworks and public artist profiles', async () => {
    const res = await callSearch(); assertSuccess(res);
    assertOwners(res.body.groups.artworks.items, OWNER);
    assert.equal(res.body.groups.artists.items[0].username, 'Publication 0');
    assert.deepEqual(res.body.groups.auctions.items, []);
    assert.equal(searchPasses(), 1); assert.equal(f.artistReads, 1);
    assertProofBudget(2);
  });
  await t.test('search rereads categories, cards and artists after publication during pending profiles', async () => {
    f.onArtistProfiles = () => { if (!f.publications) f.publish(); };
    const res = await callSearch(); assertSuccess(res);
    assertOwners(res.body.groups.artworks.items, NEXT_OWNER);
    assert.equal(res.body.groups.artists.items[0].username, 'Publication 1');
    assert.equal(searchPasses(), 2); assert.equal(f.artistReads, 2);
  });
  await t.test('search sends only a sanitized denial after a second late publication', async () => {
    f.onArtistProfiles = () => f.publish();
    assertUnavailable(await callSearch(), 'search');
    assert.equal(searchPasses(), 2); assert.equal(f.artistReads, 2);
  });
  await t.test('search rejects an owner mutation after card hydration with an unchanged marker', async () => {
    f.onArtistProfiles = () => f.mutateOwner('5');
    assertUnavailable(await callSearch(), 'search');
    assert.equal(searchPasses(), 1);
  });
  for (const [key, value] of [['ARTSOUL_NFT_OWNERSHIP_ENABLED', 'false'], ['ARTSOUL_NFT_ADDRESS_BASE_SEPOLIA', OLD_CORE]]) {
    await t.test(`Saved fails closed when ${key} changes between groups`, async () => {
      f.onLastSavedCard = () => { process.env[key] = value; };
      assertUnavailable(await callSaved(), 'Saved');
      assert.equal(f.savedReads, 1);
    });
    await t.test(`search fails closed when ${key} changes after card hydration`, async () => {
      f.onArtistProfiles = () => { process.env[key] = value; };
      assertUnavailable(await callSearch(), 'search');
      assert.equal(searchPasses(), 1);
    });
  }
  await t.test('Saved revalidates its route flag after the final aggregate proof', async () => {
    let changed = false;
    f.afterProof = ids => {
      if (ids.length === IDS.length) { changed = true; process.env.ARTSOUL_SAVED_ENABLED = 'false'; }
    };
    assertUnavailable(await callSaved(), 'Saved');
    assert.equal(changed, true); assert.equal(f.savedReads, 1);
  });
  await t.test('search revalidates its route flag after the final aggregate proof', async () => {
    let changed = false;
    f.afterProof = () => {
      if (proofCalls().length === 2) { changed = true; process.env.ARTSOUL_SEARCH_ENABLED = 'false'; }
    };
    assertUnavailable(await callSearch(), 'search');
    assert.equal(changed, true); assert.equal(searchPasses(), 1);
  });
  await t.test('ownership-disabled Saved and search retain the existing stable projection without proof RPCs', async () => {
    process.env.ARTSOUL_NFT_OWNERSHIP_ENABLED = 'false';
    const saved = await callSaved(), search = await callSearch();
    assertSuccess(saved); assertSuccess(search);
    for (const cards of [saved.body.items.map(item => item.artwork), search.body.groups.artworks.items]) {
      assert.deepEqual(cards.map(card => card.artwork_id), IDS);
      for (const card of cards) {
        assert.equal(card.current_owner_address, FIRST);
        assert.equal(card.auction_winner_address, FIRST);
        assert.equal(card.canonical_floor, '2');
      }
    }
    assert.equal(f.calls.some(call => call.name.startsWith('rpc/read_verified_nft_')), false);
  });
  await t.test('Saved keeps hidden, missing and historical deployment entries as unavailable', async () => {
    f.rows.artwork_moderation_visibility = [{ chain_id: 84532, artwork_id: '4', hidden: true }];
    f.rows.v41_artworks = f.rows.v41_artworks.filter(row => row.artwork_id !== '3');
    f.rows.saved_artworks.find(row => row.artwork_id === '2').core_address = OLD_CORE;
    const res = await callSaved(); assertSuccess(res);
    assert.deepEqual(res.body.items.map(item => item.artwork?.artwork_id ?? null), ['5', null, null, null, '1']);
    assert.equal(res.body.items[3].core_address, OLD_CORE);
    const proved = f.calls.filter(call => call.name === 'rpc/read_verified_nft_cards').flatMap(call => call.body.p_artwork_ids);
    assert.ok(proved.every(id => id === '5' || id === '1'));
  });
  await t.test('search omits hidden and missing cards while preserving artist results', async () => {
    f.rows.artwork_moderation_visibility = [{ chain_id: 84532, artwork_id: '4', hidden: true }];
    f.rows.v41_artworks = f.rows.v41_artworks.filter(row => row.artwork_id !== '3');
    const res = await callSearch(); assertSuccess(res);
    assert.deepEqual(res.body.groups.artworks.items.map(card => card.artwork_id), ['5', '2', '1']);
    assert.equal(res.body.groups.artists.items.length, 1);
  });
  await t.test('empty Saved and search responses stay empty without artwork proof requests', async () => {
    f.rows.saved_artworks = []; f.searchKeys = { artworks: [], auctions: [], artists: [] };
    const saved = await callSaved(), search = await callSearch();
    assertSuccess(saved); assertSuccess(search);
    assert.deepEqual(saved.body.items, []);
    for (const group of Object.values(search.body.groups)) assert.deepEqual(group.items, []);
    assert.equal(f.calls.some(call => call.name === 'rpc/read_verified_nft_cards'), false);
  });
});
