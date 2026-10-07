const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync('src/entries/profile.jsx', 'utf8');
const loadProfile = source.slice(source.indexOf('async function loadProfile('), source.indexOf('async function fetchProfileArtworks('));
const loadTab = source.slice(source.indexOf('async function loadMyArtworks('), source.indexOf('async function handleAvatarUpload('));
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function harness() {
  const reads = [];
  const effects = [], cleanups = [], listeners = new Map();
  const state = { items: [], gallery: 'created' };
  const scope = {
    window: { artsoulWalletStateSettled: true, location: { hash: '' },
      addEventListener: (name, listener) => listeners.set(name, listener),
      removeEventListener: (name, listener) => { if (listeners.get(name) === listener) listeners.delete(name); }
    }, console, URLSearchParams,
    useEffect: effect => effects.push(effect),
    emailVerificationEnabled: true, isOwnProfile: false, walletStateSettled: true, connectedWalletAddress: '',
    selectedGallery: 'created', profile: null,
    profileRequestRef: { current: 0 }, artworksRequestRef: { current: 0 },
    loadedProfileAddressRef: { current: null }, loadingProfileAddressRef: { current: null },
    galleryCacheRef: { current: new Map() },
    getViewAddress: () => '', getActiveWalletAddress: () => '',
    isWalletStateSettled: () => true, resolveProfileOwnership: () => false,
    waitForArtSoulDB: async () => ({ getProfile: async wallet_address => ({ wallet_address }) }),
    getGenesisState: async () => ({}), buildDiscoveryProfile: () => ({}),
    fetchProfileArtworks(profile, gallery) {
      const read = { ...deferred(), address: profile.wallet_address, gallery };
      reads.push(read);
      return read.promise;
    },
    setProfile: value => { scope.profile = value; },
    setMyArtworks: value => { state.items = value; },
    setDisplayedGallery: value => { state.gallery = value; },
    setSelectedGallery: value => { scope.selectedGallery = value; },
    setHasSettledArtworks: value => { state.settled = value; },
    setArtworksLoading: value => { state.loading = value; },
    setLoading: value => { state.profileLoading = value; },
    setDiscoveryProfile() {}, setIsOwnProfile() {}, setEditMode() {}, setProfileLoadError() {}
  };
  vm.runInNewContext(loadProfile + '\n' + loadTab + '\nthis.api = { loadProfile, loadMyArtworks };', scope);
  for (const effect of effects) cleanups.push(effect());
  assert.equal(listeners.has('hashchange'), true, 'the confirmation effect mounts without changing gallery state');
  const unmount = () => {
    for (const cleanup of cleanups) cleanup?.();
    assert.equal(listeners.size, 0, 'confirmation listeners are removed on unmount');
  };
  return { scope, reads, state, unmount, ...scope.api };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const result = id => ({ items: [{ id }], corpus: [{ id }] });

test('a slow initial gallery cannot overwrite a newer tab result', async t => {
  const h = harness();
  t.after(h.unmount);
  const initial = h.loadProfile('0xalice');
  await tick();
  assert.equal(h.scope.profile.wallet_address, '0xalice', 'identity is not held behind the gallery');
  h.scope.selectedGallery = 'auction';
  const tab = h.loadMyArtworks();
  h.reads[1].resolve(result('auction-result'));
  await tab;
  h.reads[0].resolve(result('created-result'));
  await initial;
  assert.equal(h.state.gallery, 'auction');
  assert.equal(h.state.items[0].id, 'auction-result');
  assert.equal(h.state.loading, false);
});

test('a tab response from the previous profile cannot overwrite the new identity', async t => {
  const h = harness();
  t.after(h.unmount);
  const initial = h.loadProfile('0xalice');
  await tick();
  h.reads[0].resolve(result('alice-created'));
  await initial;
  h.scope.selectedGallery = 'sold';
  const oldTab = h.loadMyArtworks();
  const replacement = h.loadProfile('0xbob');
  await tick();
  h.reads[2].resolve(result('bob-created'));
  await replacement;
  h.reads[1].resolve(result('alice-sales'));
  await oldTab;
  assert.equal(h.scope.profile.wallet_address, '0xbob');
  assert.equal(h.state.items[0].id, 'bob-created');
  assert.equal(h.state.gallery, 'created');
});

test('the first gallery settles and seeds its own per-profile tab cache', async t => {
  const h = harness();
  t.after(h.unmount);
  const initial = h.loadProfile('0xalice');
  await tick();
  h.reads[0].resolve(result('alice-created'));
  await initial;
  assert.equal(h.state.settled, true);
  assert.equal(h.scope.galleryCacheRef.current.get('0xalice:created')[0].id, 'alice-created');
});
