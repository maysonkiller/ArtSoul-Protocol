const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/entries/profile.jsx', 'utf8');
const start = source.indexOf('function getProfileXLinks(');
const end = source.indexOf('const GALLERY_TYPES', start);
const context = vm.createContext({});
vm.runInContext(source.slice(start, end), context);
const links = profile => JSON.parse(JSON.stringify(context.getProfileXLinks(profile)));

test('one X account renders once after linking, across case and URL forms', () => {
  for (const handle of ['@artist', '@Artist', 'https://x.com/artist', 'https://twitter.com/ARTIST/']) {
    assert.deepEqual(links({ twitter_connected: true, twitter_username: 'Artist', twitter_handle: handle }),
      [{ handle: 'Artist', connected: true }]);
  }
});

test('a different public link remains available without becoming a connected identity', () => {
  assert.deepEqual(links({ twitter_connected: true, twitter_username: 'artist', twitter_handle: '@studio' }),
    [{ handle: 'artist', connected: true }, { handle: 'studio', connected: false }]);
});

test('disconnect removes the connected identity without deleting a public link', () => {
  assert.deepEqual(links({ twitter_connected: false, twitter_username: null, twitter_handle: '@artist' }),
    [{ handle: 'artist', connected: false }]);
  assert.deepEqual(links({ twitter_connected: false, twitter_username: 'stale' }), []);
});

test('invalid legacy links and empty profiles do not produce broken profile URLs', () => {
  for (const handle of ['https://evil.example/a', 'artist/status/1', 'x.com/artist', 'a?redirect=1']) {
    assert.deepEqual(links({ twitter_handle: handle }), []);
  }
  assert.deepEqual(links(null), []);
});
