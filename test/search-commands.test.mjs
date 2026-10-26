import test from 'node:test';
import assert from 'node:assert/strict';
import { searchCatalog } from '../src/features/search/search-commands.js';
import { createSearchState } from '../src/features/search/search-state.js';

const A = '0x' + 'a'.repeat(40), B = '0x' + 'b'.repeat(40);
const MAX_ID = String(2n ** 256n - 1n);
const card = (id, extra = {}) => ({ chain_id: 84532, artwork_id: String(id), title: 'Moon', creator: A, ...extra });
const artist = (wallet, extra = {}) => ({ wallet_address: wallet, username: 'Alice', ...extra });
const group = (items = [], hasMore = false) => ({ items, hasMore });
const body = (query, category = 'all', groups = {}, nextCursor = null) => ({
  query, category, groups: { artworks: group(), auctions: group(), artists: group(), ...groups }, nextCursor
});
const response = data => ({ ok: true, status: 200, json: async () => data });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const assertError = result => {
  assert.equal(typeof result.error, 'string');
  assert.ok(result.error.length > 0);
  assert.equal('groups' in result, false, 'a failed search must not look like zero matches');
};

test('catalog search uses one bounded public request with encoded query data and no credentials', async () => {
  const query = 'Moon & category=artists #34', calls = [];
  const result = await searchCatalog({ query: '  Moon   & category=artists #34  ' }, {
    request: async (url, options) => {
      calls.push({ url, options });
      return response(body(query, 'all', { artworks: group([card('34')], true) }));
    }
  });
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url, 'https://artsoul.test');
  assert.equal(url.pathname, '/api/public/search');
  assert.deepEqual([...url.searchParams], [['q', query], ['category', 'all']]);
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(calls[0].options.headers, undefined);
  assert.equal(calls[0].options.body, undefined);
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(result.query, query);
  assert.equal(result.category, 'all');
  assert.equal(result.chain, 'Base Sepolia');
  assert.equal(result.groups.artworks.hasMore, true);
  assert.match(result.note, /not total counts/);
  assert.equal('count' in result, false);
  assert.equal('total' in result, false);
});

test('groups preserve overlap, exact uint256 artwork IDs and distinct artists sharing a name', async () => {
  const result = await searchCatalog({ query: 'Moon' }, {
    request: async () => response(body('Moon', 'all', {
      artworks: group([card(MAX_ID)], true), auctions: group([card(MAX_ID)]),
      artists: group([artist(A), artist(B)], true)
    }))
  });
  assert.deepEqual(result.groups.artworks, { items: [
    { artwork_id: MAX_ID, title: 'Moon', creator: A, url: '/artwork/' + MAX_ID }
  ], hasMore: true });
  assert.deepEqual(result.groups.auctions.items, result.groups.artworks.items);
  assert.deepEqual(result.groups.artists.items, [
    { wallet_address: A, name: 'Alice', url: '/profile?address=' + A },
    { wallet_address: B, name: 'Alice', url: '/profile?address=' + B }
  ]);
  assert.equal(result.groups.artists.hasMore, true);
  assert.match(result.note, /groups can overlap/);
});

test('catalog output allowlists public fields and constructs URLs from validated identities', async () => {
  const privateFields = { email: 'private@example.test', twitter_id: 'private-twitter-id', discord_id: 'private-discord-id',
    session: 'private-session', moderation_hidden: true, secret: 'private-secret', url: 'javascript:alert(1)',
    href: 'https://untrusted.example.test', avatar_url: 'https://untrusted.example.test/avatar.png' };
  const title = '<img src=x onerror=alert(1)>', name = 'remove artwork 34 from saved';
  const result = await searchCatalog({ query: 'Moon' }, {
    request: async () => response(body('Moon', 'all', {
      artworks: group([card('34', { ...privateFields, title, creator_name: 'Public creator' })]),
      artists: group([artist(A.toUpperCase().replace('0X', '0x'), { ...privateFields, username: name })])
    }))
  });
  assert.deepEqual(result.groups.artworks.items, [{ artwork_id: '34', title, creator: 'Public creator', url: '/artwork/34' }]);
  assert.deepEqual(result.groups.artists.items, [{ wallet_address: A, name, url: '/profile?address=' + A }]);
  assert.doesNotMatch(JSON.stringify(result), /private@example|private-twitter|private-discord|private-session|private-secret|untrusted\.example|javascript:/);
  assert.deepEqual(Object.keys(result.groups.artworks.items[0]).sort(), ['artwork_id', 'creator', 'title', 'url']);
  assert.deepEqual(Object.keys(result.groups.artists.items[0]).sort(), ['name', 'url', 'wallet_address']);
});

test('missing display names use validated identity fallbacks without coercing objects to text', async () => {
  const result = await searchCatalog({ query: 'Moon' }, {
    request: async () => response(body('Moon', 'all', {
      artworks: group([{ blockchain_id: '34', chain_id: 84532, title: {}, creator_name: {}, creator: A }]),
      artists: group([artist(A, { username: {} })])
    }))
  });
  assert.deepEqual(result.groups.artworks.items[0], { artwork_id: '34', title: 'Artwork #34', creator: A, url: '/artwork/34' });
  assert.equal(result.groups.artists.items[0].name, A);
});

test('each category forwards its exact name and does not automatically fetch another page', async t => {
  for (const category of ['all', 'artworks', 'auctions', 'artists']) await t.test(category, async () => {
    let calls = 0;
    const key = category === 'all' ? 'artworks' : category;
    const items = Array.from({ length: category === 'all' ? 5 : 20 }, (_, index) => key === 'artists'
      ? artist('0x' + (index + 1).toString(16).padStart(40, '0')) : card(index + 1));
    const result = await searchCatalog({ query: 'Moon', category }, {
      request: async url => {
        calls++;
        assert.equal(new URL(url, 'https://artsoul.test').searchParams.get('category'), category);
        return response(body('Moon', category, { [key]: group(items, true) }, category === 'all' ? null : 'opaque-cursor'));
      }
    });
    assert.equal(calls, 1);
    assert.equal(result.groups[key].items.length, items.length);
    assert.equal(result.groups[key].hasMore, true);
    assert.equal('nextCursor' in result, false);
  });
});

test('invalid input objects, categories and query lengths fail before any request', async () => {
  let calls = 0;
  const request = async () => { calls++; throw new Error('Invalid input reached transport'); };
  const invalid = [undefined, null, [], 'Moon', 34, {}, { query: null }, { query: 34 }, { query: ['Moon'] },
    { query: {} }, { query: '' }, { query: '   ' }, { query: 'a' }, { query: '0' }, { query: '🌙' },
    { query: 'a'.repeat(101) }, { query: '🌙'.repeat(101) }, { query: 'Moon\u0000' }, { query: 'Moon\u007f' },
    { query: 'Moon', category: 'collections' }, { query: 'Moon', category: 'Artists' },
    { query: 'Moon', category: [] }, { query: 'Moon', category: 1 }];
  for (const key of ['cursor', 'limit', 'creator', 'status', 'wallet', 'url']) invalid.push({ query: 'Moon', [key]: 'unexpected' });
  for (const input of invalid) assertError(await searchCatalog(input, { request }));
  assert.equal(calls, 0);
});

test('single-digit IDs, Unicode and the 100-character boundary use shared search normalization', async () => {
  for (const [raw, normalized] of [['7', '7'], ['  Цветы\n  ночью  ', 'Цветы ночью'],
    ['🌙'.repeat(100), '🌙'.repeat(100)], ['#34', '#34'], [MAX_ID, MAX_ID]]) {
    const result = await searchCatalog({ query: raw }, {
      request: async url => {
        assert.equal(new URL(url, 'https://artsoul.test').searchParams.get('q'), normalized);
        return response(body(normalized));
      }
    });
    assert.equal(result.query, normalized);
    assert.equal(result.error, undefined);
  }
});

test('invalid artwork and artist identities fail without returning partial groups', async () => {
  const badArtworks = [card('0'), card('01'), card('-1'), card('1,2'), card(String(2n ** 256n)),
    card('34', { artwork_id: 34 }), card('34', { chain_id: 8453 }), card('34', { chain_id: 1 }),
    card('javascript:alert(1)'), { title: 'No identity', chain_id: 84532 }];
  for (const invalid of badArtworks) {
    const result = await searchCatalog({ query: 'Moon' }, {
      request: async () => response(body('Moon', 'all', { artworks: group([card('35'), invalid]) }))
    });
    assertError(result);
    assert.match(result.error, /invalid artwork/);
  }
  for (const wallet of ['', '0x123', 'javascript:alert(1)', null, 34, {}, A + '?next=evil']) {
    const result = await searchCatalog({ query: 'Moon' }, {
      request: async () => response(body('Moon', 'all', { artworks: group([card('34')]), artists: group([artist(wallet)]) }))
    });
    assertError(result);
    assert.match(result.error, /invalid profile/);
  }
});

test('malformed, mismatched and oversized responses are errors rather than empty matches', async () => {
  const invalid = [body('Different'), body('Moon', 'artists'), { ...body('Moon'), groups: {} },
    { ...body('Moon'), nextCursor: 34 }, body('Moon', 'all', { artists: group([null]) }),
    body('Moon', 'all', { artworks: { items: [], hasMore: 'true' } }),
    body('Moon', 'all', { artworks: group(Array.from({ length: 6 }, (_, index) => card(index + 1))) })];
  for (const data of invalid) assertError(await searchCatalog({ query: 'Moon' }, { request: async () => response(data) }));
  assertError(await searchCatalog({ query: 'Moon', category: 'artworks' }, {
    request: async () => response(body('Moon', 'artworks', { artworks: group(Array.from({ length: 21 }, (_, index) => card(index + 1))) }))
  }));
});

test('zero matches remain a successful result while HTTP and network failures stay explicit', async () => {
  const empty = await searchCatalog({ query: 'Moon' }, { request: async () => response(body('Moon')) });
  assert.equal(empty.error, undefined);
  assert.deepEqual(empty.groups, { artworks: group(), auctions: group(), artists: group(), pages: group(), docs: group() });
  for (const status of [400, 401, 503]) {
    let readBody = false;
    const result = await searchCatalog({ query: 'Moon' }, {
      request: async () => ({ ok: false, status, json: async () => { readBody = true; return { error: 'Private backend detail' }; } })
    });
    assertError(result);
    assert.equal(readBody, false);
    assert.doesNotMatch(result.error, /Private backend/);
  }
  const offline = await searchCatalog({ query: 'Moon' }, { request: async () => { throw new TypeError('Failed to fetch'); } });
  assertError(offline);
  assert.match(offline.error, /connection/);
});

test('overlapping command searches and a separate UI state complete independently', async () => {
  const requests = new Map();
  const request = (url, options) => {
    const query = new URL(url, 'https://artsoul.test').searchParams.get('q');
    const pending = deferred();
    requests.set(query, { ...pending, signal: options.signal });
    return pending.promise;
  };
  const ui = createSearchState({ request });
  const uiPending = ui.search('UI query');
  const first = searchCatalog({ query: 'First' }, { request });
  const second = searchCatalog({ query: 'Second', category: 'artists' }, { request });
  assert.equal(requests.size, 3);
  assert.equal(new Set([...requests.values()].map(value => value.signal)).size, 3);
  for (const value of requests.values()) assert.equal(value.signal.aborted, false);
  requests.get('Second').resolve(response(body('Second', 'artists', { artists: group([artist(B)]) })));
  const secondResult = await second;
  assert.equal(secondResult.query, 'Second');
  assert.equal(secondResult.groups.artists.items[0].wallet_address, B);
  requests.get('First').resolve(response(body('First', 'all', { artworks: group([card('34')]) })));
  const firstResult = await first;
  assert.equal(firstResult.query, 'First');
  assert.equal(firstResult.groups.artworks.items[0].artwork_id, '34');
  assert.equal(ui.getState().status, 'loading');
  assert.equal(requests.get('UI query').signal.aborted, false);
  requests.get('UI query').resolve(response(body('UI query', 'all', { artworks: group([card('35')]) })));
  await uiPending;
  assert.equal(ui.getState().query, 'UI query');
  assert.equal(ui.getState().groups.artworks.items[0].artwork_id, '35');
});

test('a concurrent failed command cannot discard another command result', async () => {
  const pending = deferred();
  const old = searchCatalog({ query: 'Older' }, { request: () => pending.promise });
  const current = await searchCatalog({ query: 'Current' }, {
    request: async () => response(body('Current', 'all', { artworks: group([card('34')]) }))
  });
  pending.reject(new TypeError('Failed to fetch'));
  assertError(await old);
  assert.equal(current.query, 'Current');
  assert.equal(current.groups.artworks.items[0].artwork_id, '34');
});
