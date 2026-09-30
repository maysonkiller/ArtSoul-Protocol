const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const source = fs.readFileSync('src/entries/profile.jsx', 'utf8');
const tabs = source.slice(source.indexOf('className="profile-section-tabs'));
const body = tabs.match(/onClick=\{\(\) => \{([\s\S]*?)\n\s*\}\}/)?.[1];
assert.ok(body, 'the profile tab click handler is present');
const click = new Function('gallery', 'selectedGallery', 'setArtworksLoading', 'setSelectedGallery', 'galleryPanelRef', 'window', body);

for (const [top, expected] of [[220, 624], [-120, 964], [1100, 0]]) {
  test(`tab replacement reserves the current viewport below gallery top ${top}`, () => {
    const changes = [];
    const panel = { style: {}, getBoundingClientRect: () => ({ top }) };
    click({ id: 'auction' }, 'created', value => changes.push(['loading', value]), value => changes.push(['tab', value]), { current: panel }, { innerHeight: 844 });
    assert.equal(panel.style.minHeight, `${expected}px`);
    assert.deepEqual(changes, [['loading', true], ['tab', 'auction']]);
  });
}

test('selecting the current tab does not reserve height or refetch', () => {
  const changes = [];
  const panel = { style: {}, getBoundingClientRect: () => { throw new Error('No replacement to measure'); } };
  click({ id: 'created' }, 'created', value => changes.push(value), value => changes.push(value), { current: panel }, { innerHeight: 844 });
  assert.deepEqual(changes, []);
  assert.deepEqual(panel.style, {});
});
