const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');

const source = fs.readFileSync('src/features/profile/profile-layout.jsx', 'utf8');
const wallet = '0x' + '1'.repeat(40), core = '0x' + '2'.repeat(40), oldCore = '0x' + '3'.repeat(40);
const config = {chainId: 84532, coreAddress: core, selectionPolicy: 'owned-or-created'};
const pointer = id => ({chain_id: 84532, core_address: core, artwork_id: String(id)});
const card = (id, extra = {}) => ({source: 'v41_projection', chain_id: 84532, artwork_id: String(id), title: `Work ${id}`, creator: wallet, ...extra});

async function components() {
  const helpers = await import('../src/features/profile/profile-layout-state.js');
  const layoutHelpers = await import('../src/features/profile/profile-layout.js');
  const search = await import('../src/features/search/search-state.js');
  const upload = await import('../src/config/upload-policy.js');
  const {transformWithOxc} = await import('vite');
  const compiled = await transformWithOxc(source.replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/\bexport /g, ''), 'profile-layout-fixture.jsx', {jsx: {runtime: 'classic'}});
  const scope = {...layoutHelpers, ...helpers, ...search, ...upload, React, decodeImage: async url => url,
    window: {ArtSoulArtworkCard: {ReactCard: ({artwork, href, surface}) => React.createElement('article', {'data-id': artwork.artwork_id, 'data-surface': surface}, React.createElement('a', {href}, artwork.title)), detailHref: art => '/artwork/' + art.artwork_id}}};
  vm.runInNewContext(compiled.code + '\nthis.Preview = ProfileLayoutPreview; this.Editor = LayoutEditor;', scope);
  return scope;
}

test('public profile selections keep shared cards and omit hidden, absent and old-deployment pointers', async () => {
  const h = await components();
  const layout = {version: 1, template: 'featured', cover_url: null, pinned: pointer(1), sections: [
    {id: 'first', label: '<script>not HTML</script>', artworks: [pointer(2), pointer(3), {...pointer(4), core_address: oldCore}]},
    {id: 'empty', label: 'Hidden-only section', artworks: [pointer(3)]}
  ]};
  const html = renderToStaticMarkup(React.createElement(h.Preview, {layout, config, cards: [card(1), card(2), card(3, {is_hidden: true}), card(4)]}));
  assert.match(html, /profile-curation-featured/);
  assert.match(html, /data-id="1"/); assert.match(html, /data-id="2"/);
  assert.doesNotMatch(html, /data-id="3"|data-id="4"|Hidden-only section|<script>/);
  assert.match(html, /&lt;script&gt;not HTML&lt;\/script&gt;/);
  assert.equal((html.match(/data-surface="profile"/g) || []).length, 2);
  assert.doesNotMatch(html, /Saved|Email|Notifications|Customize profile/);
});

test('editor exposes explicit draft controls, keyboard ordering and constrained cover input', async () => {
  const h = await components();
  const draft = {version: 1, template: 'default', cover_url: null, pinned: pointer(1), sections: [
    {id: 'first', label: 'First', artworks: [pointer(1), pointer(2)]}, {id: 'second', label: 'Second', artworks: []}
  ]};
  const html = renderToStaticMarkup(React.createElement(h.Editor, {state: {draft, preview: false, busy: '', error: '', conflict: false},
    controller: {}, cards: [card(1), card(2)], config, wallet, candidates: []}));
  for (const label of ['Preview', 'Save layout', 'Cancel', 'Restore default', 'Move section up', 'Move section down', 'Move up', 'Move down']) assert.ok(html.includes(label), label);
  assert.match(html, /type="file" accept="image\/jpeg,image\/png,image\/gif,image\/webp"/);
  assert.doesNotMatch(html, /type="url"|type="color"|contenteditable|draggable|Saved|Discord|Email/);
  assert.match(html, /Creator credits stay visible/);
  assert.match(html, /permission to display/);
});

test('preview contains only selected public content and keeps save/cancel available', async () => {
  const h = await components();
  const draft = {version: 1, template: 'default', cover_url: null, pinned: pointer(1), sections: []};
  const html = renderToStaticMarkup(React.createElement(h.Editor, {state: {draft, preview: true, busy: '', error: '', conflict: false},
    controller: {}, cards: [card(1), card(2)], config, wallet, candidates: []}));
  assert.match(html, /data-id="1"/); assert.doesNotMatch(html, /data-id="2"|type="file"|role="search"/);
  assert.match(html, /Continue editing/); assert.match(html, /Save layout/); assert.match(html, /Cancel/);
});

test('selection preserves the twenty-work bound, supports replacing the pin and avoids section duplicates', async () => {
  const h = await components();
  const start = source.indexOf('  function choose('), end = source.indexOf('  const previewCards', start);
  let draft = {version: 1, template: 'default', cover_url: null, pinned: pointer(20), sections: [{id: 'works', label: 'Works', artworks: Array.from({length: 19}, (_, index) => pointer(index + 1))}]};
  const notices = [];
  const scope = {...h, config, wallet, draft, targetId: 'works', selectedCards: {current: new Map()},
    setNotice: message => notices.push(message), controller: {change: value => {draft = value; scope.draft = value;}}};
  vm.runInNewContext(source.slice(start, end) + '\nthis.choose = choose;', scope);
  scope.choose(card(21), true); assert.equal(draft.pinned.artwork_id, '21');
  scope.choose(card(22), false); assert.equal(draft.sections[0].artworks.length, 19); assert.match(notices.at(-1), /up to 20/);
  scope.choose(card(1), false); assert.equal(draft.sections[0].artworks.length, 19);
  scope.choose(card(22, {creator: '0x' + '4'.repeat(40)}), true); assert.equal(draft.pinned.artwork_id, '21');
});
