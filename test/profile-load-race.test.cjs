const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync('src/entries/profile.jsx', 'utf8');
const loadProfile = source.slice(source.indexOf('async function loadProfile('), source.indexOf('async function fetchProfileArtworks('));
const loadTab = source.slice(source.indexOf('async function loadMyArtworks('), source.indexOf('async function handleAvatarUpload('));
const heightEffect = source.match(/useEffect\(\(\) => \{(?:(?!useEffect\()[\s\S])*?\}, \[artworksLoading, selectedGallery\]\);/)?.[0];
assert.ok(heightEffect, 'the committed gallery releases its temporary height');
const tabClick = source.slice(source.indexOf('className="profile-section-tabs'))
  .match(/onClick=\{\(\) => \{([\s\S]*?)\n\s*\}\}/)?.[1];
assert.ok(tabClick, 'the tab selection handler is present');
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function harness() {
  const reads = [];
  const effects = [], cleanups = [], listeners = new Map();
  const state = { items: [], gallery: 'created' };
  const scope = {
    window: { artsoulWalletStateSettled: true, innerHeight: 844, location: { hash: '' },
      addEventListener: (name, listener) => listeners.set(name, listener),
      removeEventListener: (name, listener) => { if (listeners.get(name) === listener) listeners.delete(name); }
    }, console, URLSearchParams,
    useEffect: effect => effects.push(effect),
    emailVerificationEnabled: true, isOwnProfile: false, walletStateSettled: true, connectedWalletAddress: '',
    selectedGallery: 'created', displayedGallery: 'created', artworksLoading: false, profile: null,
    profileRequestRef: { current: 0 }, artworksRequestRef: { current: 0 },
    loadedProfileAddressRef: { current: null }, loadingProfileAddressRef: { current: null },
    galleryCacheRef: { current: new Map() },
    galleryPanelRef: { current: { style: { minHeight: '624px' }, getBoundingClientRect: () => ({ top: 220 }) } },
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
    setDisplayedGallery: value => { state.gallery = scope.displayedGallery = value; },
    setSelectedGallery: value => { scope.selectedGallery = value; },
    setHasSettledArtworks: value => { state.settled = value; },
    setArtworksLoading: value => { state.loading = scope.artworksLoading = value; },
    setLoading: value => { state.profileLoading = value; },
    setDiscoveryProfile() {}, setIsOwnProfile() {}, setEditMode() {}, setProfileLoadError() {}
  };
  vm.runInNewContext(loadProfile + '\n' + loadTab + '\nfunction selectGallery(gallery) {' + tabClick + '\n}\nthis.api = { loadProfile, loadMyArtworks, selectGallery };', scope);
  for (const effect of effects) cleanups.push(effect());
  assert.equal(listeners.has('hashchange'), true, 'the confirmation effect mounts without changing gallery state');
  // Run the actual post-render effect after the loader's state has committed.
  vm.runInNewContext(heightEffect, scope);
  const commit = effects.at(-1);
  const unmount = () => {
    for (const cleanup of cleanups) cleanup?.();
    assert.equal(listeners.size, 0, 'confirmation listeners are removed on unmount');
  };
  return { scope, reads, state, unmount, commit, ...scope.api };
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

for (const outcome of ['empty', 'populated', 'failed']) {
  test(`the ${outcome} tab releases reserved height after its result commits`, async t => {
    const h = harness();
    t.after(h.unmount);
    h.scope.profile = { wallet_address: '0xalice' };
    h.scope.selectedGallery = 'collected';
    const pending = h.loadMyArtworks();
    h.commit();
    assert.equal(h.scope.galleryPanelRef.current.style.minHeight, '624px');
    if (outcome === 'failed') h.reads[0].reject(new Error('Gallery unavailable'));
    else h.reads[0].resolve(outcome === 'empty' ? { items: [], corpus: [] } : result('collected'));
    await pending;
    h.commit();
    assert.equal(h.state.gallery, 'collected');
    assert.equal(h.state.loading, false);
    assert.equal(h.scope.galleryPanelRef.current.style.minHeight, '');
  });
}

test('cached results release reserved height without waiting for their refresh', async t => {
  const h = harness();
  t.after(h.unmount);
  h.scope.profile = { wallet_address: '0xalice' };
  h.scope.selectedGallery = 'sold';
  h.scope.galleryCacheRef.current.set('0xalice:sold', []);
  const refresh = h.loadMyArtworks();
  h.commit();
  assert.equal(h.state.gallery, 'sold');
  assert.equal(h.state.loading, false);
  assert.equal(h.scope.galleryPanelRef.current.style.minHeight, '');
  h.reads[0].resolve(result('sale'));
  await refresh;
});

for (const outcome of ['resolved', 'rejected']) {
  test(`a ${outcome} old tab cannot release height reserved for its replacement`, async t => {
    const h = harness();
    t.after(h.unmount);
    h.scope.profile = { wallet_address: '0xalice' };
    const old = h.loadMyArtworks();
    h.scope.selectedGallery = 'auction';
    const current = h.loadMyArtworks();
    if (outcome === 'rejected') h.reads[0].reject(new Error('Old request failed'));
    else h.reads[0].resolve(result('old'));
    await old;
    h.commit();
    assert.equal(h.state.loading, true);
    assert.equal(h.scope.galleryPanelRef.current.style.minHeight, '624px');
    h.reads[1].resolve({ items: [], corpus: [] });
    await current;
    h.commit();
    assert.equal(h.scope.galleryPanelRef.current.style.minHeight, '');
  });
}

test('a response between tab selection and the next load cannot release the new reservation', async t => {
  const h = harness();
  t.after(h.unmount);
  h.scope.profile = { wallet_address: '0xalice' };
  const old = h.loadMyArtworks();
  h.selectGallery({ id: 'auction' });
  h.reads[0].resolve(result('old'));
  await old;
  h.commit();
  assert.equal(h.state.loading, true);
  assert.equal(h.state.gallery, 'created');
  assert.equal(h.scope.galleryPanelRef.current.style.minHeight, '624px');
  const current = h.loadMyArtworks();
  h.reads[1].resolve({ items: [], corpus: [] });
  await current;
  h.commit();
  assert.equal(h.scope.galleryPanelRef.current.style.minHeight, '');
});

test('a removed gallery panel is safe when navigating to Saved', () => {
  const h = harness();
  h.scope.galleryPanelRef.current = null;
  h.scope.selectedGallery = 'saved';
  assert.doesNotThrow(h.commit);
  h.unmount();
});

test('a failed profile refresh releases the pending tab reservation it superseded', async t => {
  const h = harness();
  t.after(h.unmount);
  h.scope.profile = { wallet_address: '0xalice' };
  h.scope.loadedProfileAddressRef.current = '0xalice';
  h.selectGallery({ id: 'auction' });
  const tab = h.loadMyArtworks();
  h.scope.waitForArtSoulDB = async () => ({ getProfile: async () => { throw new Error('Profile unavailable'); } });
  await h.loadProfile('0xalice', { force: true });
  h.commit();
  assert.equal(h.state.gallery, 'created', 'the pending tab never committed');
  assert.equal(h.state.loading, false);
  assert.equal(h.scope.galleryPanelRef.current.style.minHeight, '');
  h.reads[0].resolve(result('stale-auction'));
  h.reads[1].resolve({ items: [], corpus: [] });
  await tab;
  assert.equal(h.state.items.length, 0, 'the superseded tab cannot repaint the gallery');
});
