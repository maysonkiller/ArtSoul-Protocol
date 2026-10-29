const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const unavailable = () => Object.assign(new Error('Source unavailable'), { code: 'ARTWORK_READ_UNAVAILABLE' });
const row = id => ({ id, title: 'Test artwork', source: 'v41_projection', file_url: '/test.png' });
const tick = () => new Promise(resolve => setImmediate(resolve));

class Element {
  constructor() { this.children = []; this.dataset = {}; this.hidden = true; this.attributes = {}; }
  appendChild(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = children; }
  set innerHTML(value) { this.children = []; }
  setAttribute(key, value) { this.attributes[key] = value; }
}

function homeHarness(read) {
  const source = fs.readFileSync('src/entries/index.js', 'utf8');
  const ids = Object.fromEntries(['artworkGallery', 'homepageFeedError', 'homepageFeedRetry',
    'homepageFeedErrorMessage', 'homepageMetrics', 'homepageMetricsStatus', 'homepageFeaturedSection',
    'homepageFeaturedRow', 'homepageFeaturedSummary'].map(id => [id, new Element()]));
  const metrics = Object.fromEntries(['artists_onboarded', 'auctions_completed', 'unique_collectors',
    'settled_volume_eth'].map(key => [key, new Element()]));
  ids.homepageMetrics.querySelector = selector => metrics[selector.match(/"([^"]+)"/)[1]];
  ids.homepageMetrics.querySelectorAll = () => Object.values(metrics);
  const window = { ArtSoulDB: { getPublicProjectionArtworks: async (options, strict) => {
    assert.equal(strict, true); return read(options);
  } }, ArtSoulArtworkCard: { hasSafeMedia: () => true, createCardElement: art => Object.assign(new Element(), { artwork: art }) } };
  const context = vm.createContext({ window, document: { getElementById: id => ids[id], createElement: () => new Element() },
    localStorage: { getItem: () => '[]' }, console: { error() {} } });
  vm.runInContext(source.slice(source.indexOf('        function normalizeProtocolArtworkId'),
    source.indexOf('        // The entry is mounted')), context);
  return { ids, metrics, load: () => vm.runInContext('loadHomeArtworks()', context) };
}

test('homepage cold failure is unavailable, not empty; retry recovers cards and metrics', async () => {
  let fail = true;
  const data = [row('v41:84532:38')];
  data.public_metrics = { artists_onboarded: 5, auctions_completed: 45, unique_collectors: 5, settled_volume_eth: '0.0265' };
  const h = homeHarness(() => { if (fail) throw unavailable(); return data; });
  await h.load();
  assert.equal(h.ids.homepageFeedError.hidden, false);
  assert.match(h.ids.homepageFeedErrorMessage.textContent, /temporarily unavailable/);
  assert.equal(h.ids.artworkGallery.children.length, 0);
  assert.equal(h.ids.artworkGallery.attributes['aria-busy'], 'false');
  assert.equal(h.ids.homepageFeedRetry.disabled, false);
  assert.equal(h.ids.homepageMetricsStatus.hidden, false);
  fail = false;
  await h.load();
  assert.equal(h.ids.homepageFeedError.hidden, true);
  assert.equal(h.ids.artworkGallery.children[0].artwork.id, data[0].id);
  assert.equal(h.ids.homepageMetricsStatus.hidden, true);
  assert.equal(h.metrics.auctions_completed.textContent, '45');
  fail = true;
  await h.load();
  assert.equal(h.ids.artworkGallery.children[0].artwork.id, data[0].id);
  assert.match(h.ids.homepageFeedErrorMessage.textContent, /last loaded/);
  assert.equal(h.metrics.auctions_completed.textContent, '—');
});

test('homepage successful empty response remains distinct and can later populate', async () => {
  let data = [];
  const h = homeHarness(() => data);
  await h.load();
  assert.equal(h.ids.homepageFeedError.hidden, true);
  assert.equal(h.ids.artworkGallery.children[0].textContent, 'Awaiting live testnet artworks');
  data = [row('v41:84532:38')];
  await h.load();
  assert.equal(h.ids.artworkGallery.className, 'gallery');
  assert.equal(h.ids.artworkGallery.children[0].artwork.id, data[0].id);
});

test('homepage ignores an older failed request after a newer successful response', async () => {
  let reject;
  const pending = new Promise((_, fail) => { reject = fail; });
  let reads = 0;
  const h = homeHarness(() => ++reads === 1 ? pending : [row('v41:84532:38')]);
  const older = h.load();
  await h.load();
  reject(unavailable());
  await older;
  assert.equal(h.ids.homepageFeedError.hidden, true);
  assert.equal(h.ids.artworkGallery.children.length, 1);
});

const descendants = node => !node || typeof node !== 'object' ? [] :
  [node, ...[node.props?.children].flat(Infinity).flatMap(descendants)];
const text = node => typeof node === 'string' ? node : typeof node === 'number' ? String(node) :
  node && typeof node === 'object' ? [node.props?.children].flat(Infinity).map(text).join('') : '';

async function galleryHarness(read) {
  const source = fs.readFileSync('src/entries/gallery.jsx', 'utf8');
  const { transformWithOxc } = await import('vite');
  const { code } = await transformWithOxc(source.slice(0, source.lastIndexOf('        createRoot('))
    .replace(/^import .*;\r?\n/gm, ''), 'gallery-outage.jsx', { jsx: { runtime: 'classic' } });
  const states = [], refs = [], listeners = {}, effects = [];
  let stateIndex, refIndex, mounted = false;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const i = stateIndex++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial;
      return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
    useRef(initial) { return refs[refIndex++] ||= { current: initial }; },
    useMemo: fn => fn(),
    useEffect(fn) { if (!mounted) effects.push(fn); }
  };
  const window = { location: { hash: '#discover' }, addEventListener: (key, fn) => { listeners[key] = fn; },
    ArtSoulDB: { getPublicProjectionArtworks: async (options, strict) => { assert.equal(strict, true); return read(options); } },
    ArtSoulArtworkCard: { hasSafeMedia: () => true, ReactCard: () => null, detailHref: art => '/artwork/' + art.id },
    ArtSoulDiscovery: { filterForGalleryTab: rows => rows } };
  const render = vm.runInNewContext(code + '\nGalleryPage;', { React, window, document: { addEventListener() {} },
    CardGridSkeleton: function CardGridSkeleton() {}, setTimeout: () => 1, clearTimeout() {}, console: { error() {} } });
  let tree;
  const update = () => { stateIndex = refIndex = 0; tree = render(); if (!mounted) { mounted = true; effects.forEach(fn => fn()); } };
  update();
  return { update, listeners, nodes: () => descendants(tree), text: () => text(tree),
    retry: () => descendants(tree).find(node => node.type === 'button' && text(node) === 'Retry')?.props.onClick() };
}

test('gallery failure never claims zero artworks; retry recovers, failed refresh keeps cards', async () => {
  let fail = true;
  const h = await galleryHarness(() => { if (fail) throw unavailable(); return [row('v41:84532:38')]; });
  await tick(); h.update();
  assert.match(h.text(), /Artworks are temporarily unavailable/);
  assert.doesNotMatch(h.text(), /Showing 0|Awaiting live|Publish Artwork/);
  fail = false;
  await h.retry(); h.update();
  assert.match(h.text(), /Showing 1 artworks/);
  assert.doesNotMatch(h.text(), /temporarily unavailable/);
  fail = true;
  h.listeners['artsoul:resale-confirmed']();
  await tick(); h.update();
  assert.match(h.text(), /last loaded results/);
  assert.equal(h.nodes().filter(node => node.props?.artwork?.id === 'v41:84532:38').length, 1);
});

test('gallery genuine empty success retains its usual empty-state messaging', async () => {
  const h = await galleryHarness(() => []);
  await tick(); h.update();
  assert.match(h.text(), /Showing 0 artworks/);
  assert.doesNotMatch(h.text(), /temporarily unavailable/);
});

test('gallery ignores an older failed request after a newer successful response', async () => {
  let reject;
  const pending = new Promise((_, fail) => { reject = fail; });
  let reads = 0;
  const h = await galleryHarness(() => ++reads === 1 ? pending : [row('v41:84532:38')]);
  h.listeners['artsoul:resale-confirmed']();
  await tick(); h.update();
  reject(unavailable());
  await tick(); h.update();
  assert.match(h.text(), /Showing 1 artworks/);
  assert.doesNotMatch(h.text(), /temporarily unavailable/);
});
