const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync('src/entries/profile.jsx', 'utf8');
const callback = source.slice(source.indexOf('async function handleOAuthCallback()'), source.indexOf('async function handleSocialConnect('));
const load = source.slice(source.indexOf('async function loadProfile('), source.indexOf('async function fetchProfileArtworks('));
const save = source.slice(source.indexOf('async function saveProfile()'), source.indexOf('function handleQuickUpload()'));
const unlinkStart = source.indexOf('async function handleSocialDisconnect(');
const unlink = source.slice(unlinkStart, source.indexOf('useEffect(() => {', unlinkStart));
const editStart = source.indexOf('function startProfileEdit()');
const editing = editStart < 0 ? '' : source.slice(editStart, source.indexOf('async function handleAvatarUpload('));
const avatar = source.slice(source.indexOf('async function handleAvatarUpload('), source.indexOf('async function saveProfile()'));
const OWNER = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const stored = (extra = {}) => ({ id: 'profile-row', wallet_address: OWNER, username: 'Artist', bio: 'Saved biography', avatar_url: '/avatar.png', ...extra });
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness({ active = '', hint = OWNER, view = '', result = { success: true, provider: 'discord' }, profile = stored() } = {}) {
  const state = { active, profile, draft: null, notices: [], alerts: [], reads: [], writes: [], timers: [], invalidated: [], authenticated: 0, headerRefreshes: [] };
  const db = {
    getProfile: async address => { state.reads.push(address); return state.cached; },
    invalidateProfileCache(address) { state.invalidated.push(address); state.cached = state.freshProfile; },
    async updateProfile(address, data) { state.writes.push({ address, data }); return stored(data); },
    async createProfile(address, data) { state.writes.push({ address, data }); return stored(data); }
  };
  state.cached = profile;
  state.freshProfile = stored({ discord_connected: true, twitter_connected: true });
  const scope = {
    console: { error() {}, warn() {} }, FIRST_GALLERY_PAGE: 24,
    window: {
      artsoulWalletStateSettled: false, ArtSoulDB: db, AvatarDropdown: { refresh: async address => state.headerRefreshes.push(address) },
      getCurrentWalletAddress: () => state.active,
      async ensureAuthenticated() { state.authenticated++; return true; }
    },
    selectedGallery: 'created', selectedGalleryRef: { current: 'created' }, profile, profileDraft: null, profileEditRef: { current: 0 },
    profileRequestRef: { current: 0 }, artworksRequestRef: { current: 0 },
    loadedProfileAddressRef: { current: profile?.wallet_address || null },
    loadingProfileAddressRef: { current: null }, galleryCacheRef: { current: new Map() },
    getViewAddress: () => view, getActiveWalletAddress: () => state.active, getStoredWalletHint: () => hint,
    waitForOAuthIntegration: async () => ({ handleCallback: async () => result, disconnect: async () => {
      state.freshProfile = stored({ discord_connected: false });
      return { profile: state.freshProfile };
    } }),
    waitForArtSoulDB: async () => db,
    isWalletStateSettled: () => scope.window.artsoulWalletStateSettled,
    resolveProfileOwnership: ({ walletSettled, viewedAddress, confirmedAddress }) => walletSettled ? viewedAddress === confirmedAddress : null,
    getGenesisState: async () => ({}), buildDiscoveryProfile: () => null,
    fetchProfileArtworks: async () => ({ items: [], corpus: [] }),
    setProfile(value) { state.profile = value; scope.profile = value; },
    setProfileDraft(value) { state.draft = typeof value === 'function' ? value(state.draft) : value; scope.profileDraft = state.draft; },
    setProfileLoadError: value => { state.loadError = value; },
    setOAuthNotice: value => state.notices.push(value), alert: value => state.alerts.push(value),
    setTimeout: fn => state.timers.push(fn),
    setEditMode: value => { state.editing = value; },
    setIsOwnProfile: value => { state.own = value; },
    setLoading: value => { state.loading = value; },
    setArtworksLoading: value => { state.artworksLoading = value; }, setSelectedGallery() {},
    setDisplayedGallery: value => { state.gallery = value; },
    setHasSettledArtworks() {}, setMyArtworks: value => { state.items = value; }, setDiscoveryProfile() {}
  };
  vm.runInNewContext(callback + '\n' + load + '\n' + save + '\n' + unlink + '\n' + editing + '\n' + avatar + '\nthis.api = { handleOAuthCallback, loadProfile, saveProfile, handleSocialDisconnect, handleAvatarUpload' + (editing ? ', startProfileEdit, cancelProfileEdit' : '') + ' };', scope);
  return { state, scope, db, ...scope.api };
}

async function flushLegacyTimers(h) {
  for (const timer of h.state.timers.splice(0)) timer();
  await tick();
}

for (const provider of ['discord', 'twitter']) {
  test(`${provider} callback preserves the stored public profile while the wallet restores`, async () => {
    const h = harness({ result: { success: true, provider } });
    await h.handleOAuthCallback();
    await flushLegacyTimers(h);
    assert.equal(h.state.profile?.wallet_address, OWNER);
    assert.equal(h.state.profile.username, 'Artist');
    assert.equal(h.state.profile.bio, 'Saved biography');
    assert.notEqual(h.state.own, true, 'a public restoration hint cannot authorize editing');
  });
}

test('callback refresh invalidates cached provider state before the public read', async () => {
  const h = harness({ active: OWNER, profile: stored({ discord_connected: false }) });
  await h.handleOAuthCallback();
  await flushLegacyTimers(h);
  assert.deepEqual(h.state.invalidated, [OWNER]);
  assert.equal(h.state.profile.discord_connected, true);
});

test('a callback without any profile target never clears an already-started identity', async () => {
  const h = harness({ hint: '', profile: null });
  let resolveRead;
  h.db.getProfile = () => new Promise(resolve => { resolveRead = resolve; });
  const initial = h.loadProfile(OWNER, { walletSettled: false });
  await tick();
  await h.handleOAuthCallback();
  await flushLegacyTimers(h);
  resolveRead(stored());
  await initial;
  assert.equal(h.state.profile?.username, 'Artist');
});

test('cancelled OAuth returns the provider message without reloading or resetting the profile', async () => {
  const h = harness({ result: { success: false, provider: 'discord', message: 'Linking was cancelled.' } });
  await h.handleOAuthCallback();
  await flushLegacyTimers(h);
  assert.equal(h.state.profile.username, 'Artist');
  assert.deepEqual(h.state.reads, []);
  assert.equal(h.state.notices[0].message, 'Linking was cancelled.');
});

test('save while identity is unavailable waits without authenticating or writing blank fields', async () => {
  const h = harness({ active: OWNER, profile: null });
  await h.saveProfile();
  assert.equal(h.state.authenticated, 0);
  assert.deepEqual(h.state.writes, []);
  assert.match(h.state.alerts[0], /profile.*loading/i);
  assert.doesNotMatch(h.state.alerts[0], /null|username/i);
});

test('a draft for another profile cannot be saved using the connected wallet', async () => {
  const h = harness({ active: OTHER });
  await h.saveProfile();
  assert.equal(h.state.authenticated, 0);
  assert.deepEqual(h.state.writes, []);
});

test('changing the wallet during authentication cancels the old profile save', async () => {
  const h = harness({ active: OWNER });
  h.scope.window.ensureAuthenticated = async () => { h.state.active = OTHER; return true; };
  await h.saveProfile();
  assert.deepEqual(h.state.writes, []);
  assert.match(h.state.alerts[0], /wallet.*changed/i);
});

test('saving edits profile fields without rewriting a retained public link or provider identity', async () => {
  const h = harness({ active: OWNER, profile: stored({ twitter_handle: '@public_link', twitter_connected: true, twitter_username: 'verified_name', twitter_id: 'private-provider-id' }) });
  await h.saveProfile();
  assert.equal(h.state.writes.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.state.writes[0])), {
    address: OWNER,
    data: { username: 'Artist', bio: 'Saved biography', avatar_url: '/avatar.png' }
  });
  assert.equal(h.state.alerts[0], 'Profile saved!');
});

test('an existing profile commits the normalized server save response immediately', async () => {
  const h = harness({ active: OWNER, profile: stored({ twitter_handle: 'https://x.com/ordinary_link' }) });
  h.db.updateProfile = async () => stored({ twitter_handle: '@ordinary_link', username: 'Normalized artist' });
  await h.saveProfile();
  assert.equal(h.state.profile.twitter_handle, '@ordinary_link');
  assert.equal(h.state.profile.username, 'Normalized artist');
});

test('an old save response cannot repaint the profile or header after an account change', async () => {
  const h = harness({ active: OWNER });
  h.db.updateProfile = async () => {
    h.state.active = OTHER;
    h.scope.profileRequestRef.current++;
    h.scope.setProfile({ wallet_address: OTHER, username: 'Other artist' });
    return stored();
  };
  await h.saveProfile();
  assert.equal(h.state.profile.wallet_address, OTHER);
  assert.deepEqual(h.state.headerRefreshes, []);
  assert.ok(!h.state.alerts.includes('Profile saved!'));
});

test('an old unlink response cannot replace a newly selected profile', async () => {
  const h = harness({ active: OWNER });
  h.scope.waitForOAuthIntegration = async () => ({ disconnect: async () => {
    h.state.active = OTHER;
    h.scope.profileRequestRef.current++;
    h.scope.setProfile({ wallet_address: OTHER, username: 'Other artist' });
    return { profile: stored({ discord_connected: false }) };
  } });
  await h.handleSocialDisconnect('discord');
  assert.equal(h.state.profile.wallet_address, OTHER);
  assert.ok(!h.state.notices.some(notice => /removed/.test(notice?.message)));
});

test('cancel discards edited fields while retaining the canonical disconnect response', async () => {
  const h = harness({ active: OWNER, profile: stored({ discord_connected: true }) });
  h.startProfileEdit();
  h.scope.setProfileDraft({ ...h.state.draft, username: 'Unsaved name', bio: 'Unsaved biography' });
  await h.handleSocialDisconnect('discord');
  h.cancelProfileEdit();
  assert.equal(h.state.profile.username, 'Artist');
  assert.equal(h.state.profile.bio, 'Saved biography');
  assert.equal(h.state.profile.discord_connected, false);
  assert.equal(h.state.draft, null);
  assert.equal(h.state.editing, false);
});

test('a completed avatar upload preserves newer typed draft fields without editing canonical data', async () => {
  const h = harness({ active: OWNER });
  h.startProfileEdit();
  h.db.uploadFile = async () => {
    h.scope.setProfileDraft({ ...h.state.draft, username: 'Typed during upload' });
    return '/uploaded-avatar.png';
  };
  await h.handleAvatarUpload({ target: { files: [{ name: 'avatar.png', type: 'image/png', size: 1024 }] } });
  assert.equal(h.state.draft.username, 'Typed during upload');
  assert.equal(h.state.draft.avatar_url, '/uploaded-avatar.png');
  assert.equal(h.state.profile.avatar_url, '/avatar.png');
});

test('an avatar upload completing after cancel cannot restore the discarded draft', async () => {
  const h = harness({ active: OWNER });
  h.startProfileEdit();
  h.db.uploadFile = async () => { h.cancelProfileEdit(); return '/uploaded-avatar.png'; };
  await h.handleAvatarUpload({ target: { files: [{ name: 'avatar.png', type: 'image/png', size: 1024 }] } });
  assert.equal(h.state.draft, null);
  assert.equal(h.state.profile.avatar_url, '/avatar.png');
});

test('an avatar upload remains owned by the edit session when the same wallet unlinks a provider', async () => {
  const h = harness({ active: OWNER });
  h.startProfileEdit();
  let resolveUpload;
  h.db.uploadFile = () => new Promise(resolve => { resolveUpload = resolve; });
  const upload = h.handleAvatarUpload({ target: { files: [{ name: 'avatar.png', type: 'image/png', size: 1024 }] } });
  await tick();
  assert.equal(h.state.draft.avatar_url, 'uploading...');
  await h.handleSocialDisconnect('discord');
  resolveUpload('/uploaded-avatar.png');
  await upload;
  assert.equal(h.state.profile.discord_connected, false);
  assert.equal(h.state.profile.avatar_url, '/avatar.png');
  assert.equal(h.state.draft.avatar_url, '/uploaded-avatar.png');
  await h.saveProfile();
  assert.equal(h.state.writes[0].data.avatar_url, '/uploaded-avatar.png');
});

test('an avatar upload cannot complete into a different active wallet', async () => {
  const h = harness({ active: OWNER });
  h.startProfileEdit();
  let resolveUpload;
  h.db.uploadFile = () => new Promise(resolve => { resolveUpload = resolve; });
  const upload = h.handleAvatarUpload({ target: { files: [{ name: 'avatar.png', type: 'image/png', size: 1024 }] } });
  await tick();
  h.state.active = OTHER;
  h.scope.setProfile(stored({ wallet_address: OTHER, avatar_url: '/other-avatar.png' }));
  h.scope.setProfileDraft(stored({ wallet_address: OTHER, avatar_url: '/other-avatar.png' }));
  resolveUpload('/uploaded-avatar.png');
  await upload;
  assert.equal(h.state.draft.wallet_address, OTHER);
  assert.equal(h.state.draft.avatar_url, '/other-avatar.png');
});

test('a failed initial profile read cannot become a new blank editable profile', async () => {
  const h = harness({ active: OWNER, profile: null });
  h.scope.window.artsoulWalletStateSettled = true;
  h.db.getProfile = async () => { throw new Error('Network unavailable'); };
  await h.loadProfile(OWNER, { force: true });
  assert.equal(h.state.profile, null);
  assert.ok(h.state.loadError);
  await h.saveProfile();
  assert.deepEqual(h.state.writes, []);
});

test('a failed profile refresh preserves the previously confirmed identity and draft', async () => {
  const h = harness({ active: OWNER });
  h.startProfileEdit();
  h.scope.setProfileDraft({ ...h.state.draft, username: 'Unsaved name' });
  h.db.getProfile = async () => { throw new Error('Network unavailable'); };
  await h.loadProfile(OWNER, { force: true });
  assert.equal(h.state.profile.username, 'Artist');
  assert.equal(h.state.profile.bio, 'Saved biography');
  assert.equal(h.state.draft.username, 'Unsaved name');
  assert.ok(h.state.loadError);
});

test('unlink during the initial gallery read preserves the draft and settles the latest tab', async () => {
  const h = harness({ active: OWNER, profile: null });
  h.scope.window.artsoulWalletStateSettled = true;
  const feeds = [];
  h.scope.fetchProfileArtworks = (_profile, gallery) => new Promise(resolve => feeds.push({ gallery, resolve }));
  const initial = h.loadProfile(OWNER);
  await tick();
  h.startProfileEdit();
  h.scope.setProfileDraft({ ...h.state.draft, username: 'Unsaved draft' });
  h.scope.selectedGalleryRef.current = 'sold';
  const unlink = h.handleSocialDisconnect('discord');
  await tick();
  if (feeds[1]) feeds[1].resolve({ items: [{ id: 'fresh-sales' }], corpus: [] });
  await unlink;
  feeds[0].resolve({ items: [{ id: 'old-created' }], corpus: [] });
  await initial;
  assert.equal(h.state.artworksLoading, false);
  assert.equal(h.scope.loadingProfileAddressRef.current, null);
  assert.equal(h.state.profile.username, 'Artist');
  assert.equal(h.state.profile.discord_connected, false);
  assert.equal(h.state.draft.username, 'Unsaved draft');
  assert.equal(h.state.gallery, 'sold');
  assert.equal(h.state.items[0].id, 'fresh-sales');
});
