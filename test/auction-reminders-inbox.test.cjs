const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');

const source = fs.readFileSync('src/features/moderation/notification-inbox.jsx', 'utf8')
  .replace(/^import .*;\r?$/gm, '').replace(/^export /gm, '');
const elements = (node, predicate) => Array.isArray(node) ? node.flatMap(child => elements(child, predicate))
  : React.isValidElement(node) && node.type?.name === 'NotificationSettings' ? elements(node.type(node.props), predicate)
  : React.isValidElement(node) ? [...(predicate(node) ? [node] : []), ...elements(node.props.children, predicate)] : [];
let compiled;
async function components(runtime = React, bindings = {}) {
  const [{transformWithOxc}, {notificationHeading}] = await Promise.all([
    import('vite'), import('../src/features/moderation/auction-notification-types.js')]);
  compiled ||= (await transformWithOxc(source, 'auction-reminders-fixture.jsx', {jsx: {runtime: 'classic'}})).code;
  const scope = {React: runtime, notificationHeading, ...bindings};
  vm.runInNewContext(compiled + '\nthis.Category = AuctionNotifications; this.Settings = ReminderSettings; this.Upcoming = UpcomingReminders; this.Inbox = NotificationInbox;', scope);
  return scope;
}
const reminder = (extra = {}) => ({id: 'ending:84532:66:60', type: 'auction_ending',
  created_at: '2026-10-25T10:00:00Z', chain_id: '84532', core_address: '0x' + 'c'.repeat(40),
  artwork_id: '34', auction_id: '66', transaction_hash: '0x' + 'd'.repeat(64),
  read: false, artworkAvailable: true, message: 'An auction you follow is ending.',
  deadline: '1792926000', offset_minutes: 60, ...extra});
const inboxState = (extra = {}) => ({status: 'ready', pendingIds: [], preferencesPending: false,
  preferences: {auction_created: true, outbid: true, lifecycle: true, reminders: true},
  reminderMinutes: [60], reminders: [reminder()], remindersCapped: false, remindersStatus: 'ready',
  serverTime: '1792922400', items: [], nextCursor: null, ...extra});

async function settingsHarness(extra = {}) {
  const values = [], effects = []; let index = 0, effectIndex = 0, pending = [];
  const calls = [], props = {minutes: [60], enabled: true, busy: false, model: {setReminderMinutes: value => calls.push([...value])}, ...extra};
  const scope = await components({...React,
    useState(initial) {const i = index++; if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial;
      return [values[i], value => {values[i] = typeof value === 'function' ? value(values[i]) : value;}];},
    useEffect(fn, dependencies) {const i = effectIndex++, old = effects[i];
      if (!old || dependencies.some((value, position) => value !== old[position])) pending.push(() => {effects[i] = dependencies; fn();});}
  });
  const harness = {props, calls,
    render() {index = effectIndex = 0; pending = []; const result = scope.Settings(props); pending.forEach(fn => fn()); return result;},
    find(predicate) {return elements(harness.render(), predicate)[0];},
    change(number, property, value) {harness.find(node => node.props['aria-label'] === `Reminder ${number} ${property}`).props.onChange({target: {value}});},
    click(label) {harness.find(node => node.type === 'button' && (node.props.children === label || node.props['aria-label'] === label)).props.onClick();},
    submit() {harness.find(node => node.type === 'form').props.onSubmit({preventDefault() {}});},
    html() {return renderToStaticMarkup(harness.render());}
  };
  harness.render(); return harness;
}

test('upcoming deadlines precede recorded activity and only link to their artwork', async () => {
  const scope = await components();
  const state = inboxState({reminders: [reminder(), reminder({id: 'payment:67:60', type: 'payment_due', auction_id: '67', artwork_id: '35', message: 'Payment is due for your winning bid.'})]});
  const html = renderToStaticMarkup(React.createElement(scope.Category, {state, model: {}}));
  assert.ok(html.indexOf('Upcoming</h3>') < html.indexOf('Your activity</h3>'));
  assert.match(html, /Auction ending soon/); assert.match(html, /Payment due soon/);
  assert.match(html, /Auction ends:/); assert.match(html, /Payment deadline:/);
  assert.match(html, new RegExp(`dateTime="${new Date(Number(state.reminders[0].deadline) * 1000).toISOString()}"`, 'i'));
  assert.match(html, /Checked while Notifications is open/);
  assert.match(html, /no email or push/); assert.match(html, /Saving an artwork does not subscribe/);
  const links = [...html.matchAll(/href="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(links, ['/artwork/v41:84532:34', '/artwork/v41:84532:35']);
  assert.doesNotMatch(html, />Pay now<|>Settle<|walletconnect|etherscan|basescan/);
});

test('legacy notification responses do not expose reminder settings or upcoming content', async () => {
  const scope = await components();
  for (const extra of [{preferences: {auction_created: true, outbid: true, lifecycle: true}}, {reminders: undefined}]) {
    const html = renderToStaticMarkup(React.createElement(scope.Category, {state: inboxState(extra), model: {}}));
    assert.doesNotMatch(html, /Upcoming|Save reminder times|Show upcoming deadline reminders/);
    assert.match(html, /Your activity/);
  }
});

test('unavailable and disabled reminder lists never render stale deadline items', async () => {
  const scope = await components();
  for (const extra of [{remindersStatus: 'unavailable'}, {remindersStatus: 'idle'}, {remindersStatus: 'loading'}, {preferences: {auction_created: true, outbid: true, lifecycle: true, reminders: false}}]) {
    const html = renderToStaticMarkup(React.createElement(scope.Category, {state: inboxState(extra), model: {}}));
    assert.doesNotMatch(html, /An auction you follow is ending|href="\/artwork/);
  }
  const capped = renderToStaticMarkup(React.createElement(scope.Category, {state: inboxState({remindersCapped: true}), model: {}}));
  assert.match(capped, /Showing the next 20 reminders\. Open your auctions for the full list\./);
  const empty = renderToStaticMarkup(React.createElement(scope.Category, {state: inboxState({reminders: []}), model: {}}));
  assert.match(empty, /No upcoming deadlines within your reminder times/);
  const initial = renderToStaticMarkup(React.createElement(scope.Category, {state: inboxState({remindersStatus: 'idle'}), model: {}}));
  assert.match(initial, /Checking upcoming deadlines/);
  assert.match(initial, /aria-busy="true"/);
});

test('opening a reminder uses its existing identifier and unavailable artwork stays unlinked', async () => {
  const scope = await components(), calls = [];
  const state = inboxState({reminders: [reminder({read: false, artworkAvailable: false})]});
  const view = scope.Upcoming({state, busy: false, model: {openMessage: id => calls.push(id)}});
  const html = renderToStaticMarkup(view);
  assert.match(html, /Currently unavailable/); assert.doesNotMatch(html, /href=/);
  elements(view, node => node.type === 'details')[0].props.onToggle({currentTarget:{open:true}});
  assert.deepEqual(calls, [state.reminders[0].id]);
  const busy = renderToStaticMarkup(scope.Upcoming({state: {...state, pendingIds: [state.reminders[0].id]}, busy: true, model: {}}));
  assert.match(busy, /Saving…/); assert.doesNotMatch(busy, /Mark read|Mark unread/);
});

test('the off toggle is independent of time editing and activity hidden state ignores reminder preferences', async () => {
  const scope = await components(), calls = [];
  const state = inboxState({preferences: {auction_created: false, outbid: false, lifecycle: false, reminders: true}});
  const view = scope.Category({state, model: {setPreference: (...args) => calls.push(args)}});
  const label = elements(view, node => node.type === 'label' && React.Children.toArray(node.props.children).includes('Show upcoming deadline reminders'))[0];
  elements(label, node => node.type === 'input')[0].props.onChange({target: {checked: false}});
  assert.deepEqual(calls, [['reminders', false]]);
  assert.match(renderToStaticMarkup(view), /Activity updates are hidden/);
});

test('one hour is the initial setting and edits submit once only after explicit save', async () => {
  const h = await settingsHarness();
  assert.equal(h.find(node => node.props['aria-label'] === 'Reminder 1 time').props.value, '1');
  assert.equal(h.find(node => node.props['aria-label'] === 'Reminder 1 unit').props.value, 'hours');
  h.change(1, 'time', '1,5');
  assert.equal(h.calls.length, 0);
  h.submit(); assert.deepEqual(h.calls, [[90]]);
});

test('times normalize into unique ascending whole minutes up to twenty-four hours', async () => {
  const h = await settingsHarness();
  h.change(1, 'time', '1.05');
  h.click('Add reminder'); h.change(2, 'time', '1');
  h.click('Add reminder'); h.change(3, 'time', '24'); h.change(3, 'unit', 'hours');
  assert.equal(h.find(node => node.type === 'button' && node.props.children === 'Add reminder').props.disabled, true);
  h.submit(); assert.deepEqual(h.calls, [[1, 63, 1440]]);
  h.click('Remove reminder 3'); h.click('Remove reminder 2');
  assert.equal(h.find(node => node.props['aria-label'] === 'Remove reminder 1').props.disabled, true);
});

for (const [value, unit] of [['', 'minutes'], ['0', 'minutes'], ['1441', 'minutes'], ['1e2', 'minutes'], ['-1', 'minutes'], ['1.0000000001', 'minutes'], ['0.01', 'hours'], ['24.1', 'hours']]) {
  test(`invalid reminder ${JSON.stringify(value)} ${unit} stays local with an accessible error`, async () => {
    const h = await settingsHarness(); h.change(1, 'time', value); h.change(1, 'unit', unit); h.submit();
    assert.equal(h.calls.length, 0); assert.match(h.html(), /role="alert"/);
    assert.equal(h.find(node => node.props['aria-label'] === 'Reminder 1 time').props['aria-invalid'], true);
    assert.equal(h.find(node => node.props['aria-label'] === 'Reminder 1 time').props['aria-describedby'], 'auction-reminder-times-error');
  });
}

test('equivalent minutes and hours are rejected as duplicate reminders', async () => {
  const h = await settingsHarness(); h.click('Add reminder'); h.change(2, 'time', '60'); h.submit();
  assert.equal(h.calls.length, 0); assert.match(h.html(), /Choose a different time for each reminder/);
});

test('refreshing equal saved times preserves an unsaved draft while confirmed changes replace it', async () => {
  const h = await settingsHarness(); h.change(1, 'time', '2');
  h.props.minutes = [60]; h.render();
  assert.equal(h.find(node => node.props['aria-label'] === 'Reminder 1 time').props.value, '2');
  h.props.minutes = [30]; h.render();
  assert.equal(h.find(node => node.props['aria-label'] === 'Reminder 1 time').props.value, '30');
  assert.equal(h.find(node => node.props['aria-label'] === 'Reminder 1 unit').props.value, 'minutes');
});

test('disabled or saving preferences cannot submit a reminder draft', async () => {
  for (const extra of [{enabled: false}, {busy: true}]) {
    const h = await settingsHarness(extra); h.change(1, 'time', '2'); h.submit();
    assert.equal(h.calls.length, 0); assert.equal(h.find(node => node.type === 'fieldset').props.disabled, true);
  }
});

test('rapid reminder opens finish both saves after closing while the first write is pending', async t => {
  const [{createAuctionNotifications}, {createNotificationInbox}, {createNotificationSummary}, {createNotificationReadQueue}] = await Promise.all([
    import('../src/features/moderation/auction-notifications-state.js'), import('../src/features/moderation/notification-inbox-state.js'),
    import('../src/features/moderation/notification-summary-state.js'), import('../src/features/moderation/notification-read-queue.js')]);
  const wallet = '0x' + 'a'.repeat(40), tick = () => new Promise(resolve => setImmediate(resolve));
  const values = [], refs = [], effects = [], writes = [], saved = new Set();
  let si, ri, ei, pending, auctionState, releaseFirst;
  const firstWrite = new Promise(resolve => {releaseFirst = resolve;});
  const rows = ['4', '5'].map((id, index) => reminder({id, auction_id: String(66 + index),
    deadline: String(Date.parse('2026-10-25T10:00:00Z') / 1000 + 1800)}));
  const fetchPage = async (url, options) => {
    if (options.method === 'PUT') {
      const body = JSON.parse(options.body);
      writes.push({id: body.ids[0], signal: options.signal});
      if (writes.length === 1) await firstWrite;
      assert.equal(options.signal.aborted, false, 'closing must not abort an opened reminder save');
      assert.equal(body.read, true);
      saved.add(body.ids[0]);
      return Response.json({wallet, updated: body.ids, read: true});
    }
    if (url === '/api/notifications?v=3') return Response.json({wallet, items: [], nextCursor: null,
      preferences: {...inboxState().preferences}, preferencesRevision: 0, chainRevision: '0',
      serverTime: '2026-10-25T10:00:00.000Z', reminderMinutes: [60], remindersAvailable: true,
      remindersCapped: false, reminders: rows.map(row => ({...row, read: saved.has(row.id)}))});
    if (url.startsWith('/api/moderation/access')) return Response.json({authenticated: true, eligible: false});
    return Response.json({wallet, items: [], nextCursor: null});
  };
  const scope = await components({...React,
    useState(initial) {const i = si++; if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial;
      return [values[i], value => {values[i] = typeof value === 'function' ? value(values[i]) : value;}];},
    useRef(initial) {return refs[ri++] ||= {current: initial};},
    useEffect(fn, deps) {const i = ei++, old = effects[i]; if (!old || deps.some((value, index) => value !== old.deps[index])) {
      pending.push(() => {old?.cleanup?.(); effects[i] = {deps, cleanup: fn()};});}}
  }, {document: {visibilityState: 'visible', addEventListener() {}, removeEventListener() {}},
    window: {getCurrentWalletAddress: () => wallet, addEventListener() {}, removeEventListener() {}, setInterval() {return 1;}, clearInterval() {},
      ArtSoulPublicConfig: {load: async () => ({auctionNotifications: {enabled: true, lifecycleEnabled: true,
        remindersEnabled: true, chainId: 84532, coreAddress: rows[0].core_address}})}}, createNotificationReadQueue,
    createNotificationSummary: options => createNotificationSummary({...options, fetchPage}),
    createNotificationInbox: options => createNotificationInbox({...options, fetchPage}),
    createAuctionNotifications: options => createAuctionNotifications({...options, fetchPage,
      onChange: state => {auctionState = state; options.onChange(state);}})});
  const render = () => {si = ri = ei = 0; pending = []; const view = scope.Inbox({wallet, compact: true}); pending.forEach(fn => fn()); return view;};
  const toggle = () => {elements(render(), node => node.type === 'button' && node.props['aria-controls'] === 'profile-notifications')[0].props.onClick(); return render();};
  t.after(() => effects.forEach(effect => effect.cleanup?.()));
  render(); await tick(); toggle(); await tick();
  assert.equal(auctionState.reminders.length, 2);
  const upcoming = elements(render(), node => node.type === scope.Upcoming)[0];
  const messages = elements(scope.Upcoming(upcoming.props), node => node.type === 'details');
  for (const message of messages) message.props.onToggle({currentTarget: {open: true}});
  await tick();
  assert.deepEqual(writes.map(write => write.id), ['4']);
  const closed = toggle();
  assert.equal(elements(closed, node => node.props.id === 'profile-notifications').length, 0);
  releaseFirst(); await tick(); await tick();
  assert.deepEqual(writes.map(write => write.id), ['4', '5']);
  assert.deepEqual([...saved], ['4', '5']);
  assert.deepEqual(auctionState.reminders, [], 'closed private models clear after queued saves finish');
  toggle(); await tick();
  assert.equal(auctionState.reminders.length, 2);
  assert.ok(auctionState.reminders.every(row => row.read), 'reopening retains both acknowledged read states');
});

test('reminder polling runs only while open and visible, resumes on focus and removes listeners on close', async t => {
  const [{createAuctionNotifications}, {createNotificationInbox}, {createNotificationSummary}, {createNotificationReadQueue}] = await Promise.all([
    import('../src/features/moderation/auction-notifications-state.js'), import('../src/features/moderation/notification-inbox-state.js'), import('../src/features/moderation/notification-summary-state.js'), import('../src/features/moderation/notification-read-queue.js')]);
  const wallet = '0x' + 'a'.repeat(40), core = '0x' + 'c'.repeat(40), tick = () => new Promise(resolve => setImmediate(resolve));
  const values = [], refs = [], effects = [], listeners = new Map(), intervals = new Map();
  let si = 0, ri = 0, ei = 0, pending = [], timerId = 0, reads = 0, auctionState, delayNext = false, release;
  const add = (name, fn) => {if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn);};
  const remove = (name, fn) => listeners.get(name)?.delete(fn);
  const document = {visibilityState: 'visible', addEventListener: add, removeEventListener: remove};
  const window = {getCurrentWalletAddress: () => wallet, addEventListener: add, removeEventListener: remove,
    setInterval(fn, delay) {const id = ++timerId; intervals.set(id, {fn, delay}); return id;}, clearInterval: id => intervals.delete(id),
    ArtSoulPublicConfig: {load: async () => ({auctionNotifications: {enabled: true, lifecycleEnabled: true, remindersEnabled: true, chainId: 84532, coreAddress: core}})}};
  const reply = () => ({wallet, items: [], nextCursor: null, preferences: {...inboxState().preferences}, preferencesRevision: 0,
    chainRevision: '0', serverTime: '2026-10-25T10:00:00.000Z', reminderMinutes: [60], remindersAvailable: true,
    remindersCapped: false, reminders: [reminder({id: '4', deadline: String(Date.parse('2026-10-25T10:00:00Z') / 1000 + 1800)})]});
  const fetchPage = async url => {
    if (url === '/api/notifications?v=3') {
      reads++;
      if (delayNext) {delayNext = false; return {ok: true, status: 200, json: () => new Promise(resolve => {release = () => resolve(reply());})};}
      return Response.json(reply());
    }
    if (url.startsWith('/api/moderation/access')) return Response.json({authenticated: true, eligible: false});
    return Response.json({wallet, items: [], nextCursor: null});
  };
  const scope = await components({...React,
    useState(initial) {const i = si++; if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial;
      return [values[i], value => {values[i] = typeof value === 'function' ? value(values[i]) : value;}];},
    useRef(initial) {return refs[ri++] ||= {current: initial};},
    useEffect(fn, deps) {const i = ei++, old = effects[i]; if (!old || deps.some((value, index) => value !== old.deps[index])) {
      pending.push(() => {old?.cleanup?.(); effects[i] = {deps, cleanup: fn()};});}}
  }, {window, document, createNotificationReadQueue,
    createNotificationSummary: options => createNotificationSummary({...options,fetchPage}),
    createNotificationInbox: options => createNotificationInbox({...options, fetchPage}),
    createAuctionNotifications: options => createAuctionNotifications({...options, fetchPage,
      onChange: state => {auctionState = state; options.onChange(state);}})});
  const render = () => {si = ri = ei = 0; pending = []; const view = scope.Inbox({wallet, compact: true}); pending.forEach(fn => fn()); return view;};
  const toggle = () => {elements(render(), node => node.type === 'button' && node.props['aria-controls'] === 'profile-notifications')[0].props.onClick(); render();};
  const emit = name => [...(listeners.get(name) || [])].forEach(fn => fn({}));
  const cleanup = () => effects.forEach(effect => effect.cleanup?.());
  t.after(cleanup);
  render(); await tick(); assert.equal(reads, 0); assert.equal(intervals.size, 0);
  toggle(); await tick(); render(); assert.equal(reads, 1); assert.equal(intervals.size, 1);
  assert.equal([...intervals.values()][0].delay, 30000); assert.equal(auctionState.reminders.length, 1);
  [...intervals.values()][0].fn(); await tick(); assert.equal(reads, 2);
  document.visibilityState = 'hidden'; emit('visibilitychange');
  assert.deepEqual(auctionState.reminders, []);
  [...intervals.values()][0].fn(); emit('focus'); emit('online'); await tick(); assert.equal(reads, 2);
  document.visibilityState = 'visible'; emit('visibilitychange'); await tick(); assert.equal(reads, 3);
  assert.equal(auctionState.reminders.length, 1);
  emit('focus'); emit('online'); await tick(); assert.equal(reads, 4);
  delayNext = true; emit('focus'); await tick(); assert.equal(reads, 5);
  toggle(); assert.equal(intervals.size, 0);
  for (const name of ['visibilitychange', 'focus', 'online']) assert.equal(listeners.get(name)?.size, 0);
  release(); await tick(); assert.deepEqual(auctionState.reminders, []);
  emit('focus'); emit('online'); await tick(); assert.equal(reads, 5);
  cleanup(); assert.ok([...listeners.values()].every(set => set.size === 0));
});
