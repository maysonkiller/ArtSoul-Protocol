const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');

const profile = fs.readFileSync('src/entries/profile.jsx', 'utf8');
const email = fs.readFileSync('src/features/profile/email-connection.jsx', 'utf8');
const types = profile.slice(profile.indexOf('const GALLERY_TYPES ='), profile.indexOf('function TransactionProcessingLabel'));
const tabs = profile.slice(profile.indexOf('{/* Gallery Tabs */}'), profile.indexOf('{/* Gallery Content */}'));
const headingStart = profile.indexOf('<div className="profile-gallery-heading">');
const heading = profile.slice(headingStart, profile.indexOf('{artworksLoading ? (', headingStart));
const connectionsStart = profile.indexOf('<section className="profile-connections"');
const connections = profile.slice(connectionsStart, profile.indexOf('</section>', connectionsStart) + '</section>'.length);
const emailView = email.slice(email.indexOf('\n  return (') + '\n  return ('.length, email.lastIndexOf(');'));

async function fixture(markup, values = {}, declarations = '') {
  const {transformWithOxc} = await import('vite');
  const {code} = await transformWithOxc(`${declarations}\nfunction Fixture() { return (<>${markup}</>); }`, 'profile-organization-fixture.jsx', {jsx: {runtime: 'classic'}});
  const scope = {React, ...values};
  vm.runInNewContext(code + '\nthis.render = Fixture;', scope);
  return scope.render();
}

const render = element => renderToStaticMarkup(element);
function elements(node, predicate) {
  if (Array.isArray(node)) return node.flatMap(child => elements(child, predicate));
  if (!React.isValidElement(node)) return [];
  return [...(predicate(node) ? [node] : []), ...elements(node.props.children, predicate)];
}

test('profile navigation orders public sections, then owner-only Wallet NFTs and Favorites behind their flags', async () => {
  for (const isOwnProfile of [false, true]) {
    for (const savedEnabled of [false, true]) {
      for (const walletNftsEnabled of [false, true]) {
        const view = await fixture(tabs, {isOwnProfile, savedEnabled, walletNftsEnabled, selectedGallery: 'sold', isClassic: true}, types);
        const buttons = elements(view, item => item.type === 'button');
        assert.deepEqual(buttons.map(button => React.Children.toArray(button.props.children).join('').trim()),
          ['Artworks', 'Auctions', 'Collected', 'Activity', ...(isOwnProfile && walletNftsEnabled ? ['Wallet NFTs'] : []), ...(isOwnProfile && savedEnabled ? ['Favorites'] : [])]);
        assert.deepEqual(buttons.map(button => button.key), ['created', 'auction', 'collected', 'sold', ...(isOwnProfile && walletNftsEnabled ? ['wallet-nfts'] : []), ...(isOwnProfile && savedEnabled ? ['saved'] : [])]);
        assert.deepEqual(buttons.filter(button => button.props['aria-pressed']).map(button => button.key), ['sold']);
        assert.doesNotMatch(render(view), /Profile Sections/);
        const navigation = elements(view, item => item.type === 'nav')[0];
        assert.equal(navigation.props['aria-label'], 'Profile content');
        const tabRow = elements(view, item => Object.hasOwn(item.props, 'data-wallet-nfts'))[0];
        assert.equal(tabRow.props['data-wallet-nfts'], isOwnProfile && walletNftsEnabled);
      }
    }
  }
});

test('profile display and editing defer notifications to the single shared header', () => {
  assert.doesNotMatch(profile, /NotificationInbox|notification-inbox\.jsx/);
  const html = fs.readFileSync('profile.html', 'utf8');
  assert.equal((html.match(/id="header-notifications"/g) || []).length, 1);
  assert.match(html, /<div id="header-notifications">/);
  assert.match(html, /id="notification-preview-panel"[^>]*popover="auto"/);
  assert.doesNotMatch(html, /id="profile-notifications"|notification-badge/);
});

test('Favorites acknowledges a pending wallet request and allows retry after cancellation', async () => {
  const {transformWithOxc} = await import('vite');
  const file = fs.readFileSync('src/features/saved/saved-list.jsx', 'utf8');
  const {code} = await transformWithOxc(file.slice(file.indexOf('export function SavedList')).replace('export ', ''), 'favorites.jsx', {jsx: {runtime: 'classic'}});
  const owner = '0x' + '1'.repeat(40);
  const state = {owner, status: 'auth', items: []};
  let hook, resolve, loads = 0;
  const hooks = [];
  const scope = {window: {}, currentSavedWallet: () => owner, savedStore: {getState: () => state, load: () => loads++},
    signInForSaved: () => new Promise(done => {resolve = done;}),
    React: {...React, useEffect() {}, useState(initial) {
      const index = hook++;
      if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial;
      return [hooks[index], value => {hooks[index] = value;}];
    }}};
  vm.runInNewContext(code + '\nthis.list = SavedList;', scope);
  const list = () => {hook = 0; return scope.list({wallet: owner});};
  const signIn = () => elements(list(), node => node.type === 'button' && node.props.children === 'Sign in')[0];
  const first = signIn().props.onClick();
  assert.match(render(list()), /Waiting for wallet sign-in/);
  assert.equal(signIn(), undefined);
  resolve(false);
  await first;
  assert.match(render(list()), /Sign-in was not completed/);
  assert.equal(loads, 0);
  const retry = signIn().props.onClick();
  resolve(true);
  await retry;
  assert.equal(loads, 1);
});

test('Activity names the existing Sales subset without pretending to be a complete ledger', async () => {
  const sales = render(await fixture(heading, {selectedGallery: 'sold', isClassic: true}, types));
  assert.match(sales, />Activity<\/h3>/);
  assert.match(sales, />Sales<\/h4>/);
  assert.match(sales, /Completed sales of works created by this artist/);
  assert.doesNotMatch(sales, /complete transaction history|All transactions/);
  const collected = render(await fixture(heading, {selectedGallery: 'collected', isClassic: false}, types));
  assert.match(collected, /NFTs currently owned by this profile/);
  assert.doesNotMatch(collected, />Sales<\/h4>/);
  const auctions = render(await fixture(heading, {selectedGallery: 'auction', isClassic: true}, types));
  assert.match(auctions, /Auctions for works created by this artist/);
  assert.doesNotMatch(auctions, /awaiting completion|settlement/);
});

test('a gallery outage renders one retry, keeps existing cards and never claims an empty collection', async () => {
  const start = profile.indexOf('<div className="profile-gallery-panel');
  const markup = profile.slice(start, profile.indexOf('\n                        )}', start));
  for (const isClassic of [false, true]) {
    for (const items of [[], [{id: 'retained'}]]) {
      let retries = 0;
      const view = await fixture(markup, {isClassic, selectedGallery: 'created', displayedGallery: 'created',
        galleryPanelRef: {current: null}, artworksLoading: false, hasSettledArtworks: items.length > 0,
        artworksError: 'Artworks could not be loaded. Please retry.', visibleArtworks: items, isOwnProfile: false,
        loadMyArtworks: () => {retries++;}, ProfileArtworkCard: ({artwork}) => React.createElement('article', null, artwork.id)}, types);
      const html = render(view);
      assert.match(html, /role="alert"/); assert.match(html, /Retry artworks/);
      assert.doesNotMatch(html, /No created artworks yet|0 items/);
      assert.equal(elements(view, node => node.type === 'button').length, 1);
      elements(view, node => node.type === 'button')[0].props.onClick();
      assert.equal(retries, 1);
      assert.equal(html.includes('retained'), items.length > 0);
    }
  }
  const empty = render(await fixture(markup, {isClassic: true, selectedGallery: 'created', displayedGallery: 'created',
    galleryPanelRef: {current: null}, artworksLoading: false, hasSettledArtworks: true,
    artworksError: null, visibleArtworks: [], isOwnProfile: false}, types));
  assert.match(empty, /No created artworks yet/); assert.doesNotMatch(empty, /Retry artworks/);
});

test('email shares the provider grid but never mounts for another wallet or an unsettled owner', async () => {
  const values = {emailVerificationEnabled: true, isOwnProfile: true, walletStateSettled: true,
    connectedWalletAddress: '0x' + '1'.repeat(40), profile: {}, isClassic: true,
    handleSocialConnect() {}, handleSocialDisconnect() {},
    EmailConnection: () => React.createElement('div', {'data-private-email': true}, 'Private account')};
  for (const override of [{}, {isOwnProfile: false}, {walletStateSettled: false}, {connectedWalletAddress: ''}, {emailVerificationEnabled: false}]) {
    const view = await fixture(connections, {...values, ...override});
    const grids = elements(view, item => item.props.className === 'profile-connection-grid');
    assert.equal(grids.length, 1);
    const providers = elements(grids[0], item => item.props.className === 'profile-connection-provider');
    assert.equal(providers.length, Object.keys(override).length ? 2 : 3);
    const html = render(view);
    assert.equal(html.includes('data-private-email'), Object.keys(override).length === 0);
    assert.match(html, /Connecting or disconnecting an account takes effect immediately/);
    assert.match(html, /Save Profile and Cancel apply only to your profile details/);
  }
});

test('every favorite has a card or removable placeholder, including media failures and hidden works', async () => {
  const {transformWithOxc} = await import('vite');
  const file = fs.readFileSync('src/features/saved/saved-list.jsx', 'utf8');
  const {code} = await transformWithOxc(file.slice(file.indexOf('function SavedArtwork(')), 'favorite.jsx', {jsx: {runtime: 'classic'}});
  const mutations = [];
  let failed = null;
  const cards = {ReactCard: function Card() {}, detailHref: () => '/artwork/23', isHidden: row => row.hidden,
    mediaUrl: row => row.url, hasSafeMedia: row => row.url.startsWith('https:')};
  const scope = {React: {...React, useState: () => [failed, src => { failed = src; }]}, window: {ArtSoulArtworkCard: cards},
    savedStore: {set: (...args) => mutations.push(args)}};
  vm.runInNewContext(code + '\nthis.itemView = SavedArtwork;', scope);
  const identity = {chain_id:84532, core_address:'0x'+'a'.repeat(40), artwork_id:'23'};
  const view = artwork => scope.itemView({item:{...identity,artwork},pending:false});
  const valid = {url:'https://example.test/work.png',title:'Saved work'};
  const card = view(valid);
  assert.equal(card.type, cards.ReactCard);
  card.props.onMediaUnavailable();
  for (const artwork of [valid, {...valid,url:'file:///bad'}]) {
    const fallback = view(artwork);
    assert.match(render(fallback), /Preview unavailable/);
    assert.match(render(fallback), /href="\/artwork\/23"/);
  }
  assert.equal(view({...valid,url:valid.url+'?updated'}).type, cards.ReactCard);
  for (const artwork of [null,{...valid,hidden:true}]) {
    const fallback = view(artwork);
    assert.doesNotMatch(render(fallback), /Saved work|href=/);
    elements(fallback, node => node.type === 'button')[0].props.onClick();
  }
  assert.deepEqual(JSON.parse(JSON.stringify(mutations)), [[identity,false],[identity,false]]);
});

test('verified email retains a labelled disconnect action and explicit verified/private status', async () => {
  const actions = [];
  const base = {connection: {verified: true, email: 'artist@example.test'}, editing: false, busy: false, hasToken: false, notice: '', manage: action => actions.push(action)};
  const view = await fixture(emailView, base);
  const disconnect = elements(view, item => item.type === 'button' && item.props['aria-label'] === 'Disconnect email')[0];
  assert.ok(disconnect);
  assert.equal(disconnect.props.className, 'profile-connection-remove');
  disconnect.props.onClick();
  assert.deepEqual(actions, ['disconnect']);
  assert.match(render(view), /artist@example\.test/);
  assert.match(render(view), /Verified email/);
  assert.match(render(view), /Email stays private/);
  const busyView = await fixture(emailView, {...base, busy: true});
  assert.equal(elements(busyView, item => item.props['aria-label'] === 'Disconnect email')[0].props.disabled, true);
  const unlinked = await fixture(emailView, {...base, connection: {verified: false, available: true}});
  assert.doesNotMatch(render(unlinked), /artist@example\.test|Verified email/);
  elements(unlinked, item => item.type === 'button')[0].props.onClick();
  assert.deepEqual(actions, ['disconnect', 'open']);
  const unavailable = await fixture(emailView, {...base, connection: {available: false}});
  assert.equal(elements(unavailable, item => item.type === 'button').length, 0);
  const unavailableStatus = elements(unavailable, item => item.props.role === 'status')[0];
  assert.equal(unavailableStatus.props.className, 'profile-connection-row');
  assert.doesNotMatch(render(unavailable), /artist@example\.test/);
});
