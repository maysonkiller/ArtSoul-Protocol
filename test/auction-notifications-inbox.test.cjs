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

async function harness(fetchPage, enabled = true, summaryEnabled = false, configPromise = null) {
  const [{transformWithOxc}, {createAuctionNotifications}, {createNotificationInbox}, {notificationHeading}, {createNotificationSummary}, {createNotificationReadQueue}] = await Promise.all([
    import('vite'), import('../src/features/moderation/auction-notifications-state.js'),
    import('../src/features/moderation/notification-inbox-state.js'), import('../src/features/moderation/auction-notification-types.js'), import('../src/features/moderation/notification-summary-state.js'), import('../src/features/moderation/notification-read-queue.js')]);
  const values = [], refs = [], effects = [], listeners = new Map();
  let si, ri, ei, pending;
  const state = {wallet: A, authenticatedWallet:A, calls: [], authenticate: async () => true};
  const scope = {React: {...React,
    useState(initial) {const i = si++; if (!(i in values)) values[i] = initial; return [values[i], value => {values[i] = typeof value === 'function' ? value(values[i]) : value;}];},
    useRef(initial) {return refs[ri++] ||= {current: initial};},
    useEffect(fn, deps) {const i = ei++, old = effects[i]; if (!old || deps.some((d,j) => d !== old.deps[j])) pending.push(() => {old?.cleanup?.(); effects[i] = {deps, cleanup: fn()};});}},
    notificationHeading, createNotificationReadQueue, createNotificationSummary:options=>createNotificationSummary({...options,fetchPage:fetcher}), createAuctionNotifications: options => createAuctionNotifications({...options, fetchPage: fetcher}),
    createNotificationInbox: options => createNotificationInbox({...options, fetchPage: fetcher}),
    document: {visibilityState: 'visible', addEventListener() {}, removeEventListener() {}},
    window: {getCurrentWalletAddress: () => state.wallet, ensureAuthenticated: () => state.authenticate(),
      SupabaseAuth:{getAuthenticatedWallet:()=>state.authenticatedWallet},
      setInterval() {return 1;}, clearInterval() {},
      ArtSoulPublicConfig: {load: async () => configPromise || ({auctionNotifications: {enabled, summaryEnabled, chainId: 84532, coreAddress: CORE}})},
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

function staffResponse(url, verified = true) {
  if (url.startsWith('/api/moderation/access')) return Response.json({authenticated: true, eligible: true, enabled: true, access: {stepUpActive: verified}});
  if (url.includes('review-queue')) return Response.json({data: {reports: [{id: '11111111-1111-4111-8111-111111111111', created_at: '2026-10-25T10:00:00Z'}]}});
  return response(url);
}

const groupButton = (h, name) => elements(h.render(), n => n.type === 'button' && elements(n.props.children, child => child.type === 'span' && child.props.children === name).length)[0];

test('staff inbox separates personal messages from the review queue without marking either read', async () => {
  const methods = [];
  const h = await harness(async (url, options) => {methods.push(options.method || 'GET'); return staffResponse(url);});
  h.toggle(); await tick();
  assert.match(h.html(), /Private auction update|Private moderation update/);
  assert.doesNotMatch(h.html(), /id="staff-notifications"|Report 11111111/);
  assert.equal(groupButton(h, 'Personal').props['aria-pressed'], true);
  groupButton(h, 'Moderation').props.onClick();
  assert.equal(groupButton(h, 'Moderation').props['aria-pressed'], true);
  assert.match(h.html(), /Reports awaiting review|Report 11111111/);
  assert.equal(elements(h.render(), n => n.props.id === 'personal-notifications')[0].props.hidden, true);
  groupButton(h, 'Personal').props.onClick();
  assert.equal(elements(h.render(), n => n.props.id === 'personal-notifications')[0].props.hidden, false);
  assert.match(h.html(), /Private moderation update/);
  assert.doesNotMatch(h.html(), /Report 11111111/);
  assert.ok(methods.every(method => method === 'GET')); h.unmount();
});

test('ordinary users keep their own report results without a staff category', async () => {
  const h = await harness(async url => response(url)); h.toggle(); await tick();
  assert.match(h.html(), /Your reports and artwork updates|Private moderation update/);
  assert.doesNotMatch(h.html(), /Notification categories|staff-notifications|Reports awaiting review/);
  assert.equal(h.state.calls.some(url => url.includes('review-queue')), false); h.unmount();
});

test('unverified staff see the sign-in link only in Moderation and no queue details', async () => {
  const h = await harness(async url => staffResponse(url, false)); h.toggle(); await tick();
  assert.doesNotMatch(h.html(), /Verify admin access/);
  groupButton(h, 'Moderation').props.onClick(); assert.match(h.html(), /Verify admin access/);
  assert.doesNotMatch(h.html(), /Report 11111111/);
  assert.equal(elements(h.render(), n => n.props.id === 'personal-notifications')[0].props.hidden, true);
  assert.equal(h.state.calls.some(url => url.includes('review-queue')), false); h.unmount();
});

test('closing or invalidating access resets the category and cannot retain a staff panel', async () => {
  let eligible = true;
  const h = await harness(async url => eligible ? staffResponse(url) : response(url)); h.toggle(); await tick();
  groupButton(h, 'Moderation').props.onClick(); h.toggle(); h.toggle(); await tick();
  assert.equal(groupButton(h, 'Personal').props['aria-pressed'], true);
  groupButton(h, 'Moderation').props.onClick(); eligible = false; h.event('artsoul:auth-state-changed');
  assert.doesNotMatch(h.html(), /staff-notifications|Report 11111111|Notification categories/);
  h.toggle(); h.toggle(); await tick();
  assert.doesNotMatch(h.html(), /Notification categories|Report 11111111/);
  assert.match(h.html(), /Private moderation update/); h.unmount();
});

test('personal unread badge and staff pending count retain separate meanings', async () => {
  const h = await harness(async url => url.includes('summary=1') ? summaryReply({auctionCount: 3, moderationCount: 2}) :
    url.includes('moderation/notifications') ? Response.json({wallet: A, items: [], nextCursor: null}) : staffResponse(url), true, true);
  h.toggle(); await tick();
  assert.match(h.html(), /5 unread notifications/);
  assert.match(h.html(), /1 report awaiting review/);
  assert.doesNotMatch(h.html(), /6 unread notifications/);
  groupButton(h, 'Moderation').props.onClick(); assert.match(h.html(), /5 unread notifications/);
  h.unmount();
});

test('rapid message opens serialize personal read writes without losing the next message', async () => {
  const first=deferred(),writes=[];
  const h=await harness(async(url,options)=>{
    if(url.includes('summary=1'))return summaryReply();
    if(options.method==='PUT'){
      const body=JSON.parse(options.body);writes.push(body.ids[0]);
      if(writes.length===1)await first.promise;
      return Response.json({wallet:A,updated:body.ids,read:true});
    }
    if(url.includes('moderation/notifications'))return Response.json({wallet:A,items:['1','2'].map(id=>({id,chain_id:'84532',artwork_id:'34',created_at:'2026-10-25T10:00:00Z',read:false,message:'Outcome '+id})),nextCursor:null});
    return response(url);
  },true,true);
  h.toggle();await tick();
  const messages=elements(h.render(),n=>n.type==='details' && n.props.className==='notification-message');
  messages[0].props.onToggle({currentTarget:{open:true}});
  messages[1].props.onToggle({currentTarget:{open:true}});
  await tick();assert.deepEqual(writes,['1']);assert.match(h.html(),/1 unread notification/);
  first.resolve();await tick();await tick();assert.deepEqual(writes,['1','2']);
  assert.equal((h.html().match(/notification-read-label">Read/g)||[]).length,2);h.unmount();
});

test('same-wallet network updates keep the open notification panel',async()=>{
  const h=await harness(async url=>response(url));h.toggle();await tick();
  h.event('artsoul:wallet-state-changed');assert.match(h.html(),/id="profile-notifications"/);
  assert.match(h.html(),/Private auction update/);h.unmount();
});

for (const clearAccess of [false, true]) {
  test(clearAccess ? 'logout discards queued reads and ignores a late save' : 'closing the panel lets already opened messages finish saving', async () => {
    const first=deferred(), writes=[], saved=new Set();
    const h=await harness(async(url,options)=>{
      if(url.includes('summary=1'))return summaryReply();
      if(options.method==='PUT'){
        const body=JSON.parse(options.body);writes.push(body.ids[0]);
        if(writes.length===1)await first.promise;
        body.ids.forEach(id=>saved.add(id));
        return Response.json({wallet:A,updated:body.ids,read:true});
      }
      if(url.includes('moderation/notifications'))return Response.json({wallet:A,items:['1','2'].map(id=>({id,chain_id:'84532',artwork_id:'34',created_at:'2026-10-25T10:00:00Z',read:saved.has(id),message:'Outcome '+id})),nextCursor:null});
      return response(url);
    },true,true);
    h.toggle();await tick();
    const messages=elements(h.render(),n=>n.type==='details' && n.props.className==='notification-message');
    messages.forEach(message=>message.props.onToggle({currentTarget:{open:true}}));
    await tick();assert.deepEqual(writes,['1']);
    h.toggle();assert.doesNotMatch(h.html(),/Outcome 1|Outcome 2/);
    if(clearAccess){h.state.authenticatedWallet='';h.event('artsoul:auth-state-changed');}
    first.resolve();await tick();await tick();
    assert.deepEqual(writes,clearAccess?['1']:['1','2']);
    assert.doesNotMatch(h.html(),/Outcome 1|Outcome 2/);
    if(!clearAccess){h.toggle();await tick();assert.equal((h.html().match(/notification-read-label">Read/g)||[]).length,2);}
    h.unmount();
  });
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

test('opening an unread activity marks it read without linking unavailable artwork', async () => {
  const h = await harness(async url => response(url)); const actions = [];
  const state = {status: 'ready', pendingIds: [], preferencesPending: false, preferences: {auction_created: true, outbid: true},
    items: [{id: '3', type: 'outbid', artworkAvailable: false, artwork_id: '34', auction_id: '66', read: false, created_at: '2026-10-25T10:00:00Z', message: 'Private update'}]};
  const view = h.scope.Category({state, model: {openMessage: id => actions.push(id)}});
  const html = renderToStaticMarkup(view); assert.match(html, /Currently unavailable/); assert.doesNotMatch(html, /href=|Mark unread|Mark read/);
  const message=elements(view,n=>n.type==='details' && n.props.className==='notification-message')[0];
  message.props.onToggle({currentTarget:{open:false}});assert.equal(actions.length,0);
  message.props.onToggle({currentTarget:{open:true}}); assert.deepEqual(actions, ['3']); h.unmount();
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

const summaryReply = (patch={}) => Response.json({wallet:A,auctionCount:1,moderationCount:0,reminderCount:0,
  remindersAvailable:true,serverTime:'2026-10-25T12:00:00Z',nextReminderDeadline:null,chainRevision:'0',preferencesRevision:0,...patch});
test('badge appears before opening, keeps its count when closed, and excludes staff review contents', async () => {
  const h=await harness(async url=>url.includes('summary=1')?summaryReply():url.includes('moderation/notifications')?
    Response.json({wallet:A,items:[],nextCursor:null}):response(url),true,true);
  assert.deepEqual(h.state.calls,['/api/notifications?summary=1']);assert.match(h.html(),/notification-badge/);
  assert.match(h.html(),/1 unread notification/);assert.doesNotMatch(h.html(),/Private auction update|Reports awaiting review/);
  h.toggle();await tick();h.toggle();assert.match(h.html(),/1 unread notification/);h.unmount();
});
test('badge shows 99+ only for a saturated verified total and a dot for partial availability', async () => {
  for(const [patch,label,dot] of [[{auctionCount:100},'99+ unread notifications',false],[{remindersAvailable:false},'Unread notifications.',true]]) {
    const h=await harness(async()=>summaryReply(patch),true,true);const html=h.html();
    assert.ok(html.includes(label));assert.equal(html.includes('notification-badge-dot'),dot);h.unmount();
  }
  const h=await harness(async()=>summaryReply({auctionCount:0}),true,true);assert.doesNotMatch(h.html(),/notification-badge/);h.unmount();
});
test('Back navigation revalidates a same-wallet badge but local logout never repaints it', async () => {
  const h=await harness(async()=>summaryReply(),true,true);assert.match(h.html(),/notification-badge/);
  h.event('pagehide');assert.doesNotMatch(h.html(),/notification-badge/);
  h.event('pageshow');await tick();assert.match(h.html(),/notification-badge/);
  h.state.authenticatedWallet='';h.event('artsoul:auth-state-changed');const requests=h.state.calls.length;
  h.event('pageshow');h.event('focus');await tick();assert.equal(h.state.calls.length,requests);assert.doesNotMatch(h.html(),/notification-badge/);
  h.state.authenticatedWallet=A;h.event('artsoul:auth-state-changed');await tick();assert.match(h.html(),/notification-badge/);h.unmount();
});
test('config arriving after opening retires the legacy moderation response and reloads read controls', async () => {
  const config=deferred(),legacy=deferred();
  const h=await harness(async url=>url==='/api/moderation/notifications'?legacy.promise:
    url.includes('summary=1')?summaryReply():url==='/api/moderation/notifications?v=2'?
    Response.json({wallet:A,items:[{id:'2',chain_id:'84532',artwork_id:'34',created_at:'2026-10-25T11:00:00Z',message:'Current moderation',read:false}],nextCursor:null}):response(url),true,true,config.promise);
  h.toggle();config.resolve({auctionNotifications:{enabled:true,summaryEnabled:true,chainId:84532,coreAddress:CORE}});await tick();
  legacy.resolve(Response.json({wallet:A,items:[{id:'1',message:'Obsolete legacy result'}],nextCursor:null}));await tick();
  assert.match(h.html(),/Current moderation/);assert.doesNotMatch(h.html(),/Obsolete legacy result|Notifications could not be loaded/);h.unmount();
});
