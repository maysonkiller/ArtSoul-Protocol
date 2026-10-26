const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {createHash} = require('node:crypto');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');

// Rendered section hashes captured from the original JSX at 03f7134.
// They preserve all text, semantic elements and classes without copying the content.
const original = [
  ['what-is-artsoul', 'What Is ArtSoul?', '9f3cd5a56bcbe84fb377ebfba037ccc2ff40aefcab5320d1bd189614b97aec6a'],
  ['auctions', 'Discovery-First Auctions', 'a1dc8c99769482658023e529bbe45969c11f1d5b01faf7cbe41bc70472ed6b14'],
  ['deposits', 'Deposit-Based Bidding', '53c37e63db6f822569382e1e33fff05e51a11154bb64c6592f04fcd5a187e62a'],
  ['publishing', 'Publishing Artwork', 'd7f2bd3b09fe51f91091a4f3f10395c351c30ea707f27d06d2aa90a2895cf0c5'],
  ['ai-guidance', 'AI Value Guidance', 'b51e7cfecad6b9f4122452ae853549d84a01767110abd2ce4aef8633b3fa3597'],
  ['wallets-network', 'Wallets and Network', 'f3dd1ba32045e946e87366272d6bb27720825789420f2f09c05621fccf6a8172'],
  ['fees', 'Fees and Economics', 'b424d31a180dd86b01b7de0f7c5d5e6937735369dd65318ac3bd045e428fe4e0'],
  ['trust-community', 'Trust and Community Signals', '9a4355ff62f507d10a9278aeb97cf70ff42f8fda05cc4d9fb14ab21287230093'],
  ['discovery', 'Discovery Ranking', 'b285e9a58f6ae58c61d886437145e2e6ff4e739a59696e48d4de503b91185d87'],
  ['settlement', 'Settlement and Lazy Minting', 'b651cdbe02ee3e6c3d7d7aa5d9edf0e20ddce0b398f40ab0e0698fe98a5056dd'],
  ['reauctioning', 'Re-Auctioning', '5521a20e6794e6a23405778cd2581893a6e95c43b50d313ae9df95b7cd0f3dcd'],
  ['provenance-resale', 'Provenance and Resale', '935a3b4eb49a87e02975e84173051cd7f638f56582bcded493db2a80fcd4bab5'],
  ['safety', 'Reports and Copyright', 'd0a0143658691a4997c8695d511d4326372d34eb520963ce6c2034e4c3a2654c'],
  ['faq', 'Frequently Asked Questions', '7812b5bd7459a4c238a46d799aa8ddc99d1967a72c7e62bd3c769c4d6e2ee35f']
];
let compiled;
async function components(runtime = React, bindings = {}) {
  const [{transformWithOxc}, {PROTOCOL_DOC_SECTIONS: sections}] = await Promise.all([
    import('vite'), import('../src/content/protocol-docs.js')
  ]);
  const source = fs.readFileSync('src/entries/docs-protocol.jsx', 'utf8')
    .replace(/^import .*;\r?$/gm, '')
    .replace(/createRoot\(document.getElementById\('app'\)\).render\(<ProtocolDocsApp \/>\);/, '');
  compiled ||= (await transformWithOxc(source, 'docs-content-fixture.jsx', {jsx: {runtime: 'classic'}})).code;
  const scope = {React: runtime, sections, ...bindings};
  vm.runInNewContext(compiled + ';this.Block=ProtocolBlock;this.Section=ProtocolSection;this.App=ProtocolDocsApp;', scope);
  return scope;
}

test('shared documentation preserves every section ID, title and its original order', async () => {
  const {sections} = await components();
  assert.deepEqual(sections.map(section => [section.id, section.title]), original.map(([id, title]) => [id, title]));
  assert.equal(new Set(sections.map(section => section.id)).size, sections.length);
  const data = fs.readFileSync('src/content/protocol-docs.js', 'utf8');
  assert.doesNotMatch(data, /^\s*import\b/m, 'search can load the plain content without a UI runtime');
});

test('rendered documentation content is byte-identical to the original JSX', async () => {
  const {sections, Block} = await components();
  for (const [index, section] of sections.entries()) {
    const html = renderToStaticMarkup(React.createElement(React.Fragment, null,
      section.blocks.map((block, key) => React.createElement(Block, {block, key}))));
    assert.equal(createHash('sha256').update(html).digest('hex'), original[index][2], section.id);
  }
});

test('searchable text comes from the same visible paragraphs, table cells, lists and FAQ', async () => {
  const {sections, Block} = await components();
  const plain = html => html.replace(/<[^>]*>/g, ' ').replace(/&#x([a-f0-9]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
  for (const section of sections) {
    const html = section.blocks.map(block => renderToStaticMarkup(React.createElement(Block, {block}))).join(' ');
    assert.equal(section.text, plain(html), section.id);
  }
});

test('shared blocks render text safely and retain table and ordered-list semantics', async () => {
  const {Block, Section, sections} = await components();
  const html = renderToStaticMarkup(React.createElement(Block, {block: {type: 'paragraph', text: '<script>alert(1)</script>'}}));
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/);
  const fees = renderToStaticMarkup(React.createElement(Section, {section: sections.find(section => section.id === 'fees'), isOpen: true}));
  assert.match(fees, /aria-expanded="true" aria-controls="fees-content"/);
  assert.match(fees, /<thead><tr><th>/); assert.match(fees, /<tbody><tr><td>/);
  const closed = renderToStaticMarkup(React.createElement(Section, {section: sections[0], isOpen: false}));
  assert.match(closed, /id="what-is-artsoul-content"[^>]*hidden=""/);
});

async function harness(hash = '') {
  const values = [], effects = [], frames = new Map(), scrolls = [], windowEvents = new Map(), documentEvents = new Map();
  let index = 0, frameId = 0, mounted = false;
  const window = {location: new URL('https://artsoul.example/docs-protocol' + hash),
    addEventListener: (name, fn) => windowEvents.set(name, fn), removeEventListener: name => windowEvents.delete(name)};
  const document = {getElementById: id => ({scrollIntoView: options => scrolls.push({id, ...options})}),
    addEventListener: (name, fn) => documentEvents.set(name, fn), removeEventListener: name => documentEvents.delete(name)};
  const scope = await components({...React,
    useState(initial) {const slot = index++; if (!(slot in values)) values[slot] = typeof initial === 'function' ? initial() : initial;
      return [values[slot], next => {values[slot] = typeof next === 'function' ? next(values[slot]) : next;}];},
    useEffect: fn => {if (!mounted) effects.push(fn);}
  }, {window, document, URL, requestAnimationFrame: fn => {frames.set(++frameId, fn); return frameId;}, cancelAnimationFrame: id => frames.delete(id)});
  const result = {window, values, frames, scrolls, windowEvents, documentEvents,
    render() {index = 0; return scope.App();},
    flush() {for (const [id, fn] of frames) {frames.delete(id); fn();}},
    hash(value) {window.location.hash = value; windowEvents.get('hashchange')();},
    click(href, extra = {}, linkExtra = {}) {documentEvents.get('click')({button: 0,
      target: {closest: () => ({href, target: '', hasAttribute: () => false, ...linkExtra})}, ...extra});}
  };
  result.render(); mounted = true; result.cleanup = effects.map(fn => fn());
  return result;
}

test('initial section links open and reveal the requested accordion without closing others', async () => {
  const h = await harness('#fees');
  assert.equal(h.values[0].fees, true); assert.equal(h.values[0]['what-is-artsoul'], true);
  h.render(); h.flush();
  assert.deepEqual(h.scrolls, [{id: 'fees', block: 'start'}]);
});

test('hash changes reveal a known section in the existing page and reject unrelated anchors', async () => {
  const h = await harness();
  assert.equal(h.frames.size, 0);
  h.hash('#faq'); h.render(); h.flush();
  assert.equal(h.values[0].faq, true); assert.deepEqual(h.scrolls, [{id: 'faq', block: 'start'}]);
  h.hash('#unknown'); h.hash('#__proto__');
  assert.equal(h.frames.size, 0); assert.equal(Object.hasOwn(h.values[0], '__proto__'), false);
});

test('a repeated link to the current hash reopens an accordion the reader collapsed', async () => {
  const h = await harness('#fees'); h.flush(); h.values[0] = {...h.values[0], fees: false};
  h.click('https://artsoul.example/docs-protocol#fees');
  assert.equal(h.values[0].fees, true); h.flush(); assert.equal(h.scrolls.length, 2);
  h.values[0] = {...h.values[0], fees: false};
  h.click('https://artsoul.example/docs-protocol.html#fees');
  assert.equal(h.values[0].fees, true);
});

test('modified, external and unrelated links do not reopen documentation sections', async () => {
  const h = await harness('#fees'); h.flush(); h.values[0] = {...h.values[0], fees: false};
  for (const flags of [{ctrlKey: true}, {metaKey: true}, {shiftKey: true}, {altKey: true}, {button: 1}, {defaultPrevented: true}]) {
    h.click('https://artsoul.example/docs-protocol#fees', flags);
  }
  h.click('https://outside.example/docs-protocol#fees');
  h.click('https://artsoul.example/artwork/34#fees');
  h.click('https://artsoul.example/docs-protocol#fees', {}, {target: '_blank'});
  h.click('https://artsoul.example/docs-protocol#fees', {}, {hasAttribute: () => true});
  assert.equal(h.values[0].fees, false); assert.equal(h.frames.size, 0);
});

test('rapid navigation and unmount cancel obsolete scrolling and remove listeners', async () => {
  const h = await harness('#fees'); h.hash('#faq');
  assert.equal(h.frames.size, 1); h.flush(); assert.deepEqual(h.scrolls, [{id: 'faq', block: 'start'}]);
  h.hash('#deposits'); h.hash('#unknown'); assert.equal(h.frames.size, 0);
  h.hash('#fees'); h.cleanup.forEach(fn => fn?.());
  assert.equal(h.frames.size, 0); assert.equal(h.windowEvents.size, 0); assert.equal(h.documentEvents.size, 0);
});
