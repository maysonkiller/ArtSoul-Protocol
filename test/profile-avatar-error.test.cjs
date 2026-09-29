const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const profile = fs.readFileSync('src/entries/profile.jsx', 'utf8');
const effect = profile.slice(profile.indexOf('const resolvedAvatarUrl ='), profile.indexOf('function getExplorerAddressUrl('));

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

test('a rejected avatar upload restores the previous image and reports the original error', async () => {
  const upload = profile.slice(profile.indexOf('async function handleAvatarUpload('), profile.indexOf('async function saveProfile('));
  const state = [];
  const notices = [];
  const scope = {
    profile: {avatar_url: 'https://example.test/original.png'},
    setProfile: value => state.push(value), alert: message => notices.push(message), console: {error() {}},
    window: {ensureAuthenticated: async () => true, getCurrentWalletAddress: () => '0xartist',
      ArtSoulDB: {uploadFile: async () => {throw new Error('Upload unavailable');}}}
  };
  vm.runInNewContext(upload + '\nthis.upload = handleAvatarUpload;', scope);
  await scope.upload({target: {files: [{name: 'avatar.png', type: 'image/png', size: 1024}]}});
  assert.equal(state[0].avatar_url, 'uploading...');
  assert.equal(state[1].avatar_url, 'https://example.test/original.png');
  assert.deepEqual(notices, ['Error uploading avatar: Upload unavailable']);
});
