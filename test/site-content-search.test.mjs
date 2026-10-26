import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { searchSiteContent, getSiteSearchEntry } from '../src/features/search/site-content-search.js';
import { createSearchState, readSearchHistory } from '../src/features/search/search-state.js';
import { searchCatalog } from '../src/features/search/search-commands.js';

const remoteBody = query => ({ query, category: 'all', nextCursor: null,
  groups: Object.fromEntries(['artworks', 'auctions', 'artists'].map(key => [key, { items: [], hasMore: false }])) });

test('documentation search finds body text and opens the exact public section', () => {
  const result = searchSiteContent('outbid deposits', 'docs');
  assert.ok(result.docs.items.some(item => item.id === 'deposits'));
  for (const item of result.docs.items) {
    assert.equal(item.url, '/docs-protocol#' + item.id);
    assert.ok(item.excerpt.length <= 182);
  }
  assert.deepEqual(result.pages.items, []);
  assert.deepEqual(searchSiteContent('OUTBID   DEPOSITS', 'docs'), result);
  assert.deepEqual(searchSiteContent('settlement nonexistentword', 'docs').docs.items, []);
});

test('public pages and grouped results are bounded and exclude staff and private data', () => {
  assert.ok(searchSiteContent('publish', 'pages').pages.items.some(item => item.url === '/upload'));
  const bounded = searchSiteContent('art');
  assert.ok(bounded.docs.items.length <= 5);
  assert.equal(bounded.docs.hasMore, true);
  assert.ok(searchSiteContent('art', 'docs').docs.items.length > 5);
  for (const query of ['staff roster', 'inbox', 'admin panel', 'private@example.test']) {
    const groups = searchSiteContent(query);
    assert.ok(Object.values(groups).every(group => group.items.length === 0));
  }
  assert.deepEqual(searchSiteContent('').docs.items, []);
  assert.deepEqual(searchSiteContent('auction', 'artists').docs.items, []);
});

test('recent public entries use an allowlist even with hostile storage keys or URLs', () => {
  for (const kind of ['__proto__', 'constructor', 'toString', 'admin', null]) assert.equal(getSiteSearchEntry(kind, 'fees'), undefined);
  const history = readSearchHistory({ getItem: () => JSON.stringify({ queries: [], views: [
    { kind: '__proto__', id: 'fees' }, { kind: 'docs', id: 'fees', url: 'javascript:alert(1)' },
    { kind: 'pages', id: 'home' }, { kind: 'docs', id: '../admin' }, { kind: 'pages', id: 'admin' }
  ] }) });
  assert.equal(history.views.length, 2);
  assert.equal(getSiteSearchEntry(history.views[0].kind, history.views[0].id).url, '/docs-protocol#fees');
});

test('pages and docs search do not depend on the artwork API or wallet credentials', async () => {
  const request = () => { throw Error('Public bundled search must not fetch'); };
  for (const [category, query] of [['docs', 'settlement'], ['pages', 'gallery']]) {
    const state = createSearchState({ request });
    await state.search(query, category);
    assert.equal(state.getState().status, 'ready');
    assert.ok(state.getState().groups[category].items.length);
    const result = await searchCatalog({ category, query }, { request });
    assert.ok(result.groups[category].items.length);
    assert.equal(result.error, undefined);
  }
});

test('switching from slow artwork search to docs cannot restore obsolete results', async () => {
  let finish;
  const state = createSearchState({ request: () => new Promise(resolve => { finish = resolve; }) });
  const old = state.search('old');
  await state.search('deposits', 'docs');
  finish({ ok: true, json: async () => remoteBody('old') });
  await old;
  assert.equal(state.getState().category, 'docs');
  assert.equal(state.getState().query, 'deposits');
  assert.ok(state.getState().groups.docs.items.length);
});

test('bundled matches survive remote failure with an explicit partial-result warning', async () => {
  const request = async () => ({ ok: false, status: 503 });
  const state = createSearchState({ request });
  await state.search('deposits');
  assert.equal(state.getState().status, 'error');
  assert.ok(state.getState().groups.docs.items.length);
  const result = await searchCatalog({ query: 'deposits' }, { request });
  assert.match(result.warning, /unavailable/);
  assert.ok(result.groups.docs.items.length);
  assert.deepEqual(result.groups.artworks.items, []);
});

test('remote response cannot inject static results or links', async () => {
  const state = createSearchState({ request: async () => ({ ok: true, json: async () => ({
    ...remoteBody('fees'), groups: { ...remoteBody('fees').groups,
      docs: { items: [{ id: 'fees', title: 'Injected', url: '/admin' }], hasMore: false } }
  }) }) });
  await state.search('fees');
  assert.ok(state.getState().groups.docs.items.some(item => item.id === 'fees'));
  assert.doesNotMatch(JSON.stringify(state.getState().groups.docs), /Injected|\/admin/);
});

test('all application headers expose one public search trigger and one module entry', () => {
  for (const page of ['index', 'gallery', 'artwork', 'profile', 'docs-protocol', 'upload', 'collection-builder', 'admin']) {
    const html = readFileSync(new URL('../' + page + '.html', import.meta.url), 'utf8');
    assert.equal((html.match(/data-artsoul-search/g) || []).length, 1, page);
    assert.equal((html.match(/src="\/src\/entries\/search.js"/g) || []).length, 1, page);
  }
});
