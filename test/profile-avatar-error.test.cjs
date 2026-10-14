const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const profile = fs.readFileSync('src/entries/profile.jsx', 'utf8');
const effect = profile.slice(profile.indexOf('const resolvedAvatarUrl ='), profile.indexOf('function getExplorerAddressUrl('));

async function loadAvatar(resize) {
  const { decodeAvatar } = await import('../src/features/artwork/decoded-image.js');
  let image, cleanup;
  const images = [];
  const state = { url: '', failed: false };
  const scope = {
    profile: {}, profileDraft: null, editMode: false, getProfileAvatarUrl: () => 'https://example.test/avatar.png',
    profileAvatarDecodeTokenRef: { current: 0 },
    setDecodedProfileAvatarUrl: value => { state.url = value; },
    setProfileAvatarFailed: value => { state.failed = value; },
    useEffect: fn => { cleanup = fn(); },
    decodeAvatar: source => decodeAvatar(source, () => { image = {}; images.push(image); return image; }, resize)
  };
  vm.runInNewContext(effect, scope);
  return { state, image, images, dispose: () => cleanup() };
}

test('a failed profile avatar load ends its pending state', async () => {
  const h = await loadAvatar();
  h.image.onerror();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.state.failed, true);
  assert.equal(h.state.url, '');
});

test('a failed profile avatar decode ends its pending state', async () => {
  const h = await loadAvatar();
  h.image.decode = async () => { throw new Error('Undecodable image'); };
  h.image.onload();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.state.failed, true);
  assert.equal(h.state.url, '');
});

test('a disposed profile cannot receive a late avatar failure', async () => {
  const h = await loadAvatar();
  const staleError = h.image.onerror;
  h.dispose();
  staleError();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.state.failed, false);
});

test('a changed identity cannot receive a late original after transformation failure', async () => {
  const h = await loadAvatar(() => 'https://example.test/contained.webp');
  h.image.onerror();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.images.length, 2);
  assert.equal(h.images[1].src, 'https://example.test/avatar.png');
  h.dispose();
  await h.images[1].onload();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.state.url, '');
  assert.equal(h.state.failed, false);
});

test('a rejected avatar upload restores the previous image and reports the original error', async () => {
  const upload = profile.slice(profile.indexOf('async function handleAvatarUpload('), profile.indexOf('async function saveProfile('));
  const state = [];
  const notices = [];
  const scope = {
    profile: {wallet_address: '0xartist', avatar_url: 'https://example.test/original.png'}, profileDraft: null,
    profileRequestRef: {current: 0}, profileEditRef: {current: 0}, getActiveWalletAddress: () => '0xartist',
    setProfileDraft: value => state.push(typeof value === 'function' ? value(state.at(-1)) : value),
    alert: message => notices.push(message), console: {error() {}},
    window: {ensureAuthenticated: async () => true, getCurrentWalletAddress: () => '0xartist',
      ArtSoulDB: {uploadFile: async () => {throw new Error('Upload unavailable');}}}
  };
  vm.runInNewContext(upload + '\nthis.upload = handleAvatarUpload;', scope);
  await scope.upload({target: {files: [{name: 'avatar.png', type: 'image/png', size: 1024}]}});
  assert.equal(state[0].avatar_url, 'uploading...');
  assert.equal(state[1].avatar_url, 'https://example.test/original.png');
  assert.equal(scope.profile.avatar_url, 'https://example.test/original.png', 'upload never changes the saved profile');
  assert.deepEqual(notices, ['Error uploading avatar: Upload unavailable']);
});
