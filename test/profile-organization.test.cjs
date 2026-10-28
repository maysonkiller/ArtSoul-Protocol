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

test('profile navigation orders the public sections and keeps Saved private', async () => {
  for (const isOwnProfile of [false, true]) {
    for (const savedEnabled of [false, true]) {
      const view = await fixture(tabs, {isOwnProfile, savedEnabled, selectedGallery: 'sold', isClassic: true}, types);
      const buttons = elements(view, item => item.type === 'button');
      assert.deepEqual(buttons.map(button => React.Children.toArray(button.props.children).join('').trim()),
        ['Artworks', 'Auctions', 'Collected', 'Activity', ...(isOwnProfile && savedEnabled ? ['Saved'] : [])]);
      assert.deepEqual(buttons.map(button => button.key), ['created', 'auction', 'collected', 'sold', ...(isOwnProfile && savedEnabled ? ['saved'] : [])]);
      assert.deepEqual(buttons.filter(button => button.props['aria-pressed']).map(button => button.key), ['sold']);
      assert.doesNotMatch(render(view), /Profile Sections/);
      const navigation = elements(view, item => item.type === 'nav')[0];
      assert.equal(navigation.props['aria-label'], 'Profile content');
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
