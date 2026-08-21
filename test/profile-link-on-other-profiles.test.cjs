const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

// The component ships with CRLF and the extractor below matches whole lines,
// so carriage returns are dropped first.
const source = fs.readFileSync('avatar-dropdown.js', 'utf8').split(String.fromCharCode(13)).join('');

// The two methods under test read only `this` and window.location, so they can
// be exercised directly without booting the whole component.
function methods(search) {
  // Both methods read only `this` and window.location, so they run standalone.
  // The class syntax `name(args) {` becomes `function name(args) {`.
  const grab = (name) => {
    const start = source.indexOf(`        ${name}(`);
    assert.ok(start > -1, `${name} not found`);
    const lines = source.slice(start).split('\n');
    const out = [];
    for (const line of lines) {
      out.push(line);
      if (line === '        }') break;
    }
    return 'function ' + out.join('\n').trimStart();
  };
  const win = { location: { pathname: '/profile', search } };
  return new Function('window', `
    ${grab('isOwnProfileAddress')}
    ${grab('isCurrentNavigationItem')}
    function normalizePagePath(p) { return p; }
    const self = { isOwnProfileAddress, isCurrentNavigationItem, normalizePagePath };
    return {
      isOwnProfileAddress: (w) => isOwnProfileAddress.call(self, w),
      isCurrentNavigationItem: (...a) => isCurrentNavigationItem.call(self, ...a)
    };
  `)(win);
}

const PROFILE_ITEM = { href: '/profile', label: 'Profile', path: '/profile', profile: true };
const MINE = '0x6ec8c121043357ac231e36d403edabf90ae6989b';
const SOMEONE_ELSE = '0xa61c114e38ceac5bde6325956f4e808582690329';

test('reading someone else\u2019s profile keeps the way back to your own', () => {
  // Reported from production: opening another person's profile removed the
  // Profile entry from the account menu, because the menu matched on the path
  // and `/profile` is the path for everybody's profile. That is exactly when
  // the link is needed.
  const m = methods(`?address=${SOMEONE_ELSE}`);
  const own = m.isOwnProfileAddress(MINE);
  assert.equal(own, false);
  assert.equal(m.isCurrentNavigationItem(PROFILE_ITEM, '/profile', '', own), false,
    'the Profile entry must not be treated as the current page');
});

test('your own profile still hides the entry that points at it', () => {
  for (const search of ['', `?address=${MINE}`, `?address=${MINE.toUpperCase()}`]) {
    const m = methods(search);
    assert.equal(m.isOwnProfileAddress(MINE), true, `search=${search || '(none)'}`);
    assert.equal(m.isCurrentNavigationItem(PROFILE_ITEM, '/profile', '', true), true);
  }
});

test('an address is compared without regard to case', () => {
  const m = methods(`?address=${MINE.toUpperCase()}`);
  assert.equal(m.isOwnProfileAddress(MINE.toLowerCase()), true);
});

test('no wallet at all is never somebody\u2019s own profile', () => {
  const m = methods('?address=' + SOMEONE_ELSE);
  for (const value of ['', null, undefined]) {
    assert.equal(m.isOwnProfileAddress(value), false);
  }
});

test('every own-profile decision goes through the one helper', () => {
  // The same comparison used to be written out at four call sites, and the menu
  // renderer ignored the answer entirely.
  assert.equal((source.match(/isOwnProfileAddress\(/g) || []).length >= 5, true);
  assert.doesNotMatch(source, /viewingAddress\.toLowerCase\(\) === currentWallet/);
  assert.match(source, /this\.isCurrentNavigationItem\(item, currentPath, currentHash, isOwnProfile\)/);
});
