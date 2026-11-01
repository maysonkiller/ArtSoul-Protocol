const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const source = fs.readFileSync('src/entries/profile.jsx', 'utf8');
const tabs = source.slice(source.indexOf('className="profile-section-tabs'));
const body = tabs.match(/onClick=\{\(\) => \{([\s\S]*?)\n\s*\}\}/)?.[1];
assert.ok(body, 'the profile tab click handler is present');
const click = new Function('gallery', 'selectedGallery', 'setArtworksLoading', 'setSelectedGallery', 'galleryPanelRef', 'window', 'artworksRequestRef', 'setArtworksError = () => {}', body);

for (const [top, expected] of [[220, 624], [-120, 964], [1100, 0]]) {
  test(`tab replacement reserves the current viewport below gallery top ${top}`, () => {
    const changes = [];
    const request = { current: 3 };
    const panel = { style: {}, getBoundingClientRect: () => ({ top }) };
    click({ id: 'auction' }, 'created', value => changes.push(['loading', value]), value => changes.push(['tab', value]), { current: panel }, { innerHeight: 844, location: { hash: '' } }, request);
    assert.equal(request.current, 4, 'the outgoing request retires before the replacement effect');
    assert.equal(panel.style.minHeight, `${expected}px`);
    assert.deepEqual(changes, [['loading', true], ['tab', 'auction']]);
  });
}

test('selecting the current tab does not reserve height or refetch', () => {
  const changes = [];
  const request = { current: 3 };
  const panel = { style: {}, getBoundingClientRect: () => { throw new Error('No replacement to measure'); } };
  click({ id: 'created' }, 'created', value => changes.push(value), value => changes.push(value), { current: panel }, { innerHeight: 844 }, request);
  assert.equal(request.current, 3);
  assert.deepEqual(changes, []);
  assert.deepEqual(panel.style, {});
});

test('Saved navigation preserves the history entry and clears its hash when another tab is selected', () => {
  const historyState = { restoredScroll: 224 };
  const writes = [];
  const request = { current: 3 };
  const window = { innerHeight: 844, location: { pathname: '/profile', search: '?address=owner', hash: '' },
    history: { state: historyState, replaceState: (...args) => writes.push(args) } };
  click({ id: 'saved' }, 'created', () => {}, () => {}, { current: null }, window, request);
  assert.deepEqual(writes[0], [historyState, '', '/profile?address=owner#saved']);
  window.location.hash = '#saved';
  click({ id: 'created' }, 'saved', () => {}, () => {}, { current: null }, window, request);
  assert.deepEqual(writes[1], [historyState, '', '/profile?address=owner']);
});
