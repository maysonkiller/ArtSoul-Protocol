const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const profile = fs.readFileSync('src/entries/profile.jsx', 'utf8');
const effect = profile.slice(profile.indexOf('const resolvedAvatarUrl ='), profile.indexOf('// Base mainnet explorer:'));

function loadAvatar() {
  let image, cleanup;
  const state = { url: '', failed: false };
  const scope = {
    profile: {}, getProfileAvatarUrl: () => 'https://example.test/avatar.png',
    profileAvatarDecodeTokenRef: { current: 0 },
    setDecodedProfileAvatarUrl: value => { state.url = value; },
    setProfileAvatarFailed: value => { state.failed = value; },
    useEffect: fn => { cleanup = fn(); },
    Image: function () { image = this; }
  };
  vm.runInNewContext(effect, scope);
  return { state, image, dispose: () => cleanup() };
}

test('a failed profile avatar load ends its pending state', () => {
  const h = loadAvatar();
  h.image.onerror();
  assert.equal(h.state.failed, true);
  assert.equal(h.state.url, '');
});

test('a failed profile avatar decode ends its pending state', async () => {
  const h = loadAvatar();
  h.image.decode = async () => { throw new Error('Undecodable image'); };
  h.image.onload();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.state.failed, true);
  assert.equal(h.state.url, '');
});

test('a disposed profile cannot receive a late avatar failure', () => {
  const h = loadAvatar();
  const staleError = h.image.onerror;
  h.dispose();
  staleError();
  assert.equal(h.state.failed, false);
});
