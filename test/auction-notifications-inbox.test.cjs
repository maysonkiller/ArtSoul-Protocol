const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const A = '0x' + 'a'.repeat(40), B = '0x' + 'b'.repeat(40), CORE = '0x' + 'c'.repeat(40);
const source = fs.readFileSync('src/features/moderation/notification-inbox.jsx', 'utf8')
  .replace(/^import .*;\r?$/gm, '').replace(/^export /gm, '');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};};
const elements = (node, predicate) => Array.isArray(node) ? node.flatMap(child => elements(child, predicate))
  : React.isValidElement(node) ? [...(predicate(node) ? [node] : []), ...elements(node.props.children, predicate)] : [];

async function harness(fetchPage, enabled = true) {
  const [{transformWithOxc}, {createAuctionNotifications}, {createNotificationInbox}, {notificationHeading}] = await Promise.all([
    import('vite'), import('../src/features/moderation/auction-notifications-state.js'),
    import('../src/features/moderation/notification-inbox-state.js'), import('../src/features/moderation/auction-notification-types.js')]);
  const values = [], refs = [], effects = [], listeners = new Map();
  let si, ri, ei, pending;
  const state = {wallet: A, calls: [], authenticate: async () => true};
  const scope = {React: {...React,
    useState(initial) {const i = si++; if (!(i in values)) values[i] = initial; return [values[i], value => {values[i] = typeof value === 'function' ? value(values[i]) : value;}];},
    useRef(initial) {return refs[ri++] ||= {current: initial};},
    useEffect(fn, deps) {const i = ei++, old = effects[i]; if (!old || deps.some((d,j) => d !== old.deps[j])) pending.push(() => {old?.cleanup?.(); effects[i] = {deps, cleanup: fn()};});}},
    notificationHeading, createAuctionNotifications: options => createAuctionNotifications({...options, fetchPage: fetcher}),
    createNotificationInbox: options => createNotificationInbox({...options, fetchPage: fetcher}),
    window: {getCurrentWalletAddress: () => state.wallet, ensureAuthenticated: () => state.authenticate(),
      ArtSoulPublicConfig: {load: async () => ({auctionNotifications: {enabled, chainId: 84532, coreAddress: CORE}})},
      addEventListener(name, fn) {if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn);},
      removeEventListener(name, fn) {listeners.get(name)?.delete(fn);}}};
  async function fetcher(url, options) {state.calls.push(url); return fetchPage(url, options);}
  const {code} = await transformWithOxc(source, 'notification-fixture.jsx', {jsx: {runtime: 'classic'}});
  vm.runInNewContext(code + '\nthis.Inbox = NotificationInbox; this.Category = AuctionNotifications;', scope);
  const h = {state, scope, render() {si = ri = ei = 0; pending = []; const view = scope.Inbox({wallet: A, compact: true}); pending.forEach(fn => fn()); return view;},
    event(name, detail = {}) {[...(listeners.get(name) || [])].forEach(fn => fn(detail));},
    unmount() {effects.forEach(effect => effect.cleanup?.());},
    toggle() {elements(h.render(), node => node.type === 'button' && node.props['aria-controls'] === 'profile-notifications')[0].props.onClick();},
    html() {return renderToStaticMarkup(h.render());}};
  h.render(); await tick(); return h;
}
function response(url) {
  if (url === '/api/notifications') return Response.json({wallet: A, items: [{id: '3', type: 'auction_created',
    created_at: '2026-10-25T10:00:00Z', chain_id: '84532', core_address: CORE, artwork_id: '34', auction_id: '66',
    transaction_hash: '0x' + 'd'.repeat(64), read: false, artworkAvailable: true, message: 'Private auction update'}],
    nextCursor: null, preferences: {auction_created: true, outbid: true}, preferencesRevision: 0, chainRevision: '0'});
  if (url.startsWith('/api/moderation/access')) return Response.json({authenticated: true, eligible: false});
  return Response.json({wallet: A, items: [{id: '1', chain_id: '84532', artwork_id: '34', created_at: '2026-10-25T10:00:00Z', message: 'Private moderation update'}], nextCursor: null});
}

test('compact presentation loads both categories only when explicitly opened and preserves its bell', async () => {
  const h = await harness(async url => response(url));
  assert.equal(h.state.calls.length, 0); assert.match(h.html(), /profile-notification-inbox/); assert.match(h.html(), /<svg/);
  h.toggle(); await tick(); const html = h.html();
  assert.match(html, /Private auction update/); assert.match(html, /Private moderation update/);
  assert.match(html, /aria-expanded="true"/); assert.match(html, /id="profile-notifications"/);
  h.toggle(); assert.doesNotMatch(h.html(), /Private auction update|Private moderation update/); h.unmount();
});

for (const event of ['artsoul:wallet-state-changed', 'artsoul:auth-state-changed', 'storage', 'pagehide']) {
  test(`${event} immediately clears both categories`, async () => {
    const h = await harness(async url => response(url)); h.toggle(); await tick();
    assert.match(h.html(), /Private auction update/);
    if (event === 'artsoul:wallet-state-changed') h.state.wallet = B;
    h.event(event, {key: 'artsoul_authenticated_wallet'});
    assert.doesNotMatch(h.html(), /Private auction update|Private moderation update/); h.unmount();
  });
}

test('401 from either private category clears both and offers one sign-in action', async () => {
  for (const failed of ['/api/notifications', '/api/moderation/notifications']) {
    const h = await harness(async url => url === failed ? Response.json({}, {status: 401}) : response(url));
    h.toggle(); await tick(); const html = h.html();
    assert.doesNotMatch(html, /Private auction update|Private moderation update/);
    assert.equal((html.match(/Sign in to view/g) || []).length, 1); h.unmount();
  }
});

test('closing during wallet sign-in prevents its completion from reopening private loads', async () => {
  const auth = deferred(); const h = await harness(async () => Response.json({}, {status: 401}));
  h.state.authenticate = () => auth.promise; h.toggle(); await tick();
  const button = elements(h.render(), n => n.type === 'button' && n.props.children === 'Sign in to view')[0];
  const pending = button.props.onClick(); h.toggle(); const count = h.state.calls.length;
  auth.resolve(true); await pending; assert.equal(h.state.calls.length, count);
  assert.doesNotMatch(h.html(), /id="profile-notifications"/); h.unmount();
});

test('disabled auction notifications stay absent while the existing moderation inbox works', async () => {
  const h = await harness(async url => response(url), false); h.toggle(); await tick();
  assert.equal(h.state.calls.includes('/api/notifications'), false);
  const html = h.html(); assert.match(html, /Private moderation update/); assert.doesNotMatch(html, /auction-notifications-heading|not been activated/); h.unmount();
});

test('unavailable artworks have no action link and read controls express the next action', async () => {
  const h = await harness(async url => response(url)); const actions = [];
  const state = {status: 'ready', pendingIds: [], preferencesPending: false, preferences: {auction_created: true, outbid: true},
    items: [{id: '3', type: 'outbid', artworkAvailable: false, artwork_id: '34', auction_id: '66', read: true, created_at: '2026-10-25T10:00:00Z', message: 'Private update'}]};
  const view = h.scope.Category({state, model: {markRead: (...args) => actions.push(args)}});
  const html = renderToStaticMarkup(view); assert.match(html, /Currently unavailable/); assert.doesNotMatch(html, /href=/); assert.match(html, /Mark unread/);
  elements(view, n => n.type === 'button')[0].props.onClick(); assert.deepEqual(JSON.parse(JSON.stringify(actions)), [[['3'], false]]); h.unmount();
});

test('resale activity shows the NFT and network without inventing an auction identifier', async () => {
  const h = await harness(async url => response(url));
  const state = {status: 'ready', pendingIds: [], preferencesPending: false,
    preferences: {auction_created: true, outbid: true, lifecycle: true}, items: [{id: '3', type: 'resale_sold',
      chain_id: '84532', artworkAvailable: true, artwork_id: '34', auction_id: null, token_id: '6',
      read: false, created_at: '2026-10-25T10:00:00Z', message: 'Your NFT was sold.'}]};
  const html = renderToStaticMarkup(h.scope.Category({state, model: {}}));
  assert.match(html, /Your activity/); assert.match(html, /Your NFT sold/);
  assert.match(html, /Base Sepolia.*NFT #6/); assert.match(html, /href="\/artwork\/v41:84532:34"/);
  assert.doesNotMatch(html, /Auction #|auction #null/); h.unmount();
});
