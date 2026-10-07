const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const postcss = require('postcss');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const source = fs.readFileSync('src/entries/profile.jsx', 'utf8').replace(/\r\n/g, '\n');
const emailSource = fs.readFileSync('src/features/profile/email-connection.jsx', 'utf8');
const editorStart = source.indexOf('{editMode ? (');
const editorEnd = source.indexOf(') : (\n                                        <div>\n                                            <h1', editorStart);

test('the complete profile first render evaluates confirmation dependencies before every loading or guest return', async () => {
  const { transformWithOxc } = await import('vite');
  const componentSource = source.slice(0, source.indexOf('const profileAppRoot =')).replace(/^import .*;\n/gm, '');
  const compiled = await transformWithOxc(componentSource, 'profile-render-regression.jsx', { jsx: { runtime: 'classic' } });
  const wallet = '0x' + '1'.repeat(40);
  for (const fixture of [
    {connected: '', stored: '', settled: true, search: ''},
    {connected: '', stored: wallet, settled: false, search: ''},
    {connected: wallet, stored: wallet, settled: true, search: ''},
    {connected: '', stored: '', settled: true, search: '?address=' + wallet}
  ]) {
    const scope = {React, URLSearchParams,
      ProfilePageSkeleton: () => React.createElement('div', null, 'Profile loading'),
      window: {location: {search: fixture.search, hash: ''}, artsoulWalletStateSettled: fixture.settled,
        getCurrentWalletAddress: () => fixture.connected},
      localStorage: {getItem: key => key === 'artsoul_wallet' ? fixture.stored : null}};
    vm.runInNewContext(compiled.code + '\nthis.Component = ProfilePage;', scope);
    assert.ok(renderToStaticMarkup(React.createElement(scope.Component)).length > 0);
  }
});

test('all connection controls are in the edit branch and private email keeps owner and rollout gates', () => {
  assert.ok(editorStart >= 0 && editorEnd > editorStart);
  const editor = source.slice(editorStart, editorEnd);
  const readOnly = source.slice(editorEnd, source.indexOf('{profileLoadError', editorEnd));
  assert.match(editor, /aria-labelledby="profileConnectionsTitle"/);
  assert.match(editor, /emailVerificationEnabled && isOwnProfile && walletStateSettled && connectedWalletAddress/);
  assert.equal((source.match(/<EmailConnection\b/g) || []).length, 1);
  assert.match(editor, /<EmailConnection\b/);
  for (const handler of ['handleSocialConnect', 'handleSocialDisconnect']) {
    assert.match(editor, new RegExp(handler));
    assert.doesNotMatch(readOnly, new RegExp(handler));
  }
  assert.doesNotMatch(readOnly, /<EmailConnection\b|connection\.email|Connect email|Disconnect email/);
  assert.match(readOnly, /View verified Discord profile/);
  assert.match(readOnly, /verified X profile/);
});

test('email confirmation links open the editor only for the settled own profile with the feature enabled', () => {
  const marker = source.indexOf('const showEmailConfirmation =');
  const start = source.lastIndexOf('useEffect(() => {', marker);
  const end = source.indexOf(']);', marker) + 3;
  const effect = source.slice(start, end);
  const defaults = {emailVerificationEnabled: true, isOwnProfile: true, walletStateSettled: true, connectedWalletAddress: '0x' + '11'.repeat(20), profile: {wallet_address: 'owner'}};
  for (const override of [{}, {emailVerificationEnabled: false}, {isOwnProfile: false}, {walletStateSettled: false}, {connectedWalletAddress: ''}, {profile: null}, {hash: ''}]) {
    let opens = 0, cleanup;
    const listeners = new Map();
    const scope = {...defaults, ...override, URLSearchParams, startProfileEdit: () => {opens++;}, useEffect: callback => {cleanup = callback();},
      window: {location: {hash: override.hash ?? '#verify_email=fixture-code'}, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name)}};
    vm.runInNewContext(effect, scope);
    assert.equal(opens, Object.keys(override).length === 0 ? 1 : 0);
    cleanup(); assert.equal(listeners.size, 0);
  }
  assert.doesNotMatch(effect, /ensureAuthenticated|fetch\(|manage\(|setItem/);
});

test('all linked and unlinked provider states use one row layout without changing their handlers', () => {
  const editor = source.slice(editorStart, editorEnd);
  assert.equal((editor.match(/profile-connection-row /g) || []).length, 4);
  assert.equal((editor.match(/className="profile-connection-remove"/g) || []).length, 2);
  assert.match(emailSource, /profile-connection-row profile-email-summary/);
  assert.match(emailSource, /className="profile-connection-row"[\s\S]*manage\('open'\)/);
});

test('public social links share equal columns and provider rows share theme-based sizing', () => {
  const css = postcss.parse(fs.readFileSync('unified-styles.css', 'utf8'));
  const rules = new Map();
  css.walkRules(rule => {if (rule.parent.type === 'root') rules.set(rule.selector, rule);});
  const value = (selector, property) => rules.get(selector)?.nodes.find(node => node.prop === property)?.value;
  assert.equal(value('.profile-social-links', 'grid-template-columns'), 'repeat(2, minmax(0, 1fr))');
  assert.equal(value('.profile-social-links > *', 'font-size'), '0.875rem');
  assert.equal(value('.profile-connections .profile-connection-row', 'min-height'), '60px');
  assert.equal(value('.profile-connections .profile-connection-row', 'font-size'), '0.875rem');
  assert.equal(value('.profile-connections .profile-connection-row', 'background'), 'var(--c-surface)');
  assert.equal(value('.profile-connections .profile-connection-row', 'color'), 'var(--c-text)');
});
