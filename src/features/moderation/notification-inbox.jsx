import { React } from '../../entries/react-runtime.js';
import { createNotificationInbox } from './notification-inbox-state.js';
import { createAuctionNotifications } from './auction-notifications-state.js';
import { createNotificationSummary } from './notification-summary-state.js';
import { notificationHeading } from './auction-notification-types.js';
import { createNotificationReadQueue } from './notification-read-queue.js';

const { useEffect, useRef, useState } = React;
const activeWallet = () => String(window.getCurrentWalletAddress?.() || window.currentWalletAddress || '').toLowerCase();

function reminderRows(minutes) {
  return (Array.isArray(minutes) && minutes.length ? minutes : [60]).map(value => ({
    amount: String(value % 60 === 0 ? value / 60 : value), unit: value % 60 === 0 ? 'hours' : 'minutes'
  }));
}

function normalizeReminderTimes(rows) {
  if (!rows.length || rows.length > 3) return {error: 'Choose between one and three reminder times.'};
  const minutes = [];
  for (const row of rows) {
    const value = String(row.amount).trim().replace(',', '.');
    const parts = value.match(/^(\d+)(?:\.(\d+))?$/);
    if (!['minutes', 'hours'].includes(row.unit) || value.length > 12 || !parts) {
      return {error: 'Use whole minutes between 1 minute and 24 hours. For example, 30 minutes or 1.5 hours.'};
    }
    const scale = 10n ** BigInt(parts[2]?.length || 0);
    const converted = BigInt(parts[1] + (parts[2] || '')) * (row.unit === 'hours' ? 60n : 1n);
    if (converted % scale !== 0n || converted < scale || converted > 1440n * scale) {
      return {error: 'Use whole minutes between 1 minute and 24 hours. For example, 30 minutes or 1.5 hours.'};
    }
    minutes.push(Number(converted / scale));
  }
  if (new Set(minutes).size !== minutes.length) return {error: 'Choose a different time for each reminder.'};
  return {minutes: minutes.sort((a, b) => a - b)};
}

function ReminderSettings({minutes, enabled, busy, model}) {
  const savedKey = (Array.isArray(minutes) && minutes.length ? minutes : [60]).join(',');
  const [rows, setRows] = useState(() => reminderRows(minutes));
  const [error, setError] = useState('');
  useEffect(() => {setRows(reminderRows(minutes)); setError('');}, [savedKey]);
  const normalized = normalizeReminderTimes(rows);
  const unchanged = normalized.minutes?.join(',') === savedKey;
  const update = (index, patch) => {setRows(values => values.map((row, position) => position === index ? {...row, ...patch} : row)); setError('');};
  return <form className="notification-reminder-form" noValidate onSubmit={event => {
    event.preventDefault();
    if (busy || !enabled) return;
    const result = normalizeReminderTimes(rows);
    if (result.error) {setError(result.error); return;}
    setError('');
    if (!unchanged) void model?.setReminderMinutes(result.minutes);
  }}>
    <fieldset disabled={busy || !enabled} aria-describedby="auction-reminder-times-help">
      <legend>Remind me before each deadline</legend>
      <p className="notification-help" id="auction-reminder-times-help">Up to three times, from 1 minute to 24 hours before an auction ends or a payment is due. Default: 1 hour.</p>
      {rows.map((row, index) => <div className="notification-reminder-row" key={index}>
        <label>Time<input type="text" inputMode="decimal" maxLength={12} value={row.amount} aria-label={`Reminder ${index + 1} time`} aria-invalid={Boolean(error)} aria-describedby={error ? 'auction-reminder-times-error' : undefined} onChange={event => update(index, {amount: event.target.value})} /></label>
        <label>Unit<select value={row.unit} aria-label={`Reminder ${index + 1} unit`} onChange={event => update(index, {unit: event.target.value})}><option value="minutes">Minutes</option><option value="hours">Hours</option></select></label>
        <button type="button" className="btn-secondary notification-reminder-remove" aria-label={`Remove reminder ${index + 1}`} disabled={rows.length === 1} onClick={() => {setRows(values => values.filter((_, position) => position !== index)); setError('');}}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </div>)}
      <div className="notification-reminder-actions">
        <button type="button" className="btn-secondary" disabled={rows.length >= 3} onClick={() => {setRows(values => [...values, {amount: '', unit: 'minutes'}]); setError('');}}>Add reminder</button>
        <button type="submit" className="btn-secondary" disabled={unchanged}>Save reminder times</button>
      </div>
      {error && <p id="auction-reminder-times-error" role="alert">{error}</p>}
    </fieldset>
  </form>;
}

function UpcomingReminders({state, model, busy, view = 'all', opened = [], selection}) {
  const ready = state.preferences.reminders && state.remindersStatus === 'ready';
  const checking = ['idle', 'loading'].includes(state.remindersStatus);
  const reminders = state.reminders.filter(item => view === 'all' || !item.read || opened.includes(`activity:${item.id}`));
  return <section className="notification-category notification-upcoming" aria-labelledby="upcoming-reminders-heading" aria-busy={checking || busy}>
    <h3 id="upcoming-reminders-heading">Upcoming</h3>
    <p className="notification-help">Checked while Notifications is open. In-app only, with no email or push notifications. Saving an artwork does not subscribe you.</p>
    <div role="status" aria-live="polite">
      {!state.preferences.reminders && <p>Reminders are off. Enable them in Notification settings.</p>}
      {state.preferences.reminders && checking && <p>Checking upcoming deadlines…</p>}
      {state.preferences.reminders && state.remindersStatus === 'unavailable' && <p>Upcoming reminders are temporarily unavailable.</p>}
      {ready && reminders.length === 0 && <p>No upcoming deadlines within your reminder times.</p>}
    </div>
    {ready && reminders.length > 0 && <ul className="notification-items">{reminders.map(item => {
      const deadline = new Date(Number(item.deadline) * 1000);
      const validDeadline = Number.isFinite(deadline.getTime());
      return <li key={item.id} className={item.read ? 'notification-read' : 'notification-unread'}>
        <MessageSelection id={`activity:${item.id}`} title={`reminder ${item.id}`} selection={selection} />
        <details className="notification-message" onToggle={event => {if (event.currentTarget.open && !item.read) model?.openMessage(item.id);}}>
        <summary><strong>{item.type === 'payment_due' ? 'Payment due soon' : 'Auction ending soon'}</strong><span className="notification-read-label">{state.pendingIds.includes(item.id) ? 'Saving…' : item.read ? 'Read' : 'Unread'}</span></summary>
        {item.artworkAvailable ? <a className="underline" href={`/artwork/v41:${item.chain_id}:${item.artwork_id}`}>Artwork #{item.artwork_id} · Auction #{item.auction_id}</a> : <span>Artwork #{item.artwork_id} · Currently unavailable</span>}
        <p>{item.message}</p>
        <p className="notification-help">{item.type === 'payment_due' ? 'Payment deadline' : 'Auction ends'}: {validDeadline ? <time dateTime={deadline.toISOString()}>{deadline.toLocaleString()}</time> : 'Deadline unavailable'}</p>
        </details>
      </li>;
    })}</ul>}
    {ready && state.remindersCapped && <p className="notification-help">Showing the next 20 reminders. Open your auctions for the full list.</p>}
    {state.preferences.reminders && state.remindersStatus === 'unavailable' && <button type="button" className="btn-secondary" disabled={busy} onClick={() => model?.refreshReminders()}>Retry reminders</button>}
  </section>;
}

function MessageSelection({id, title, selection}) {
  if (!selection) return null;
  return <label className="notification-select"><input type="checkbox" checked={selection.ids.includes(id)}
    disabled={selection.busy} onChange={() => selection.toggle(id)} aria-label={`Select ${title}`} /><span>Select</span></label>;
}

function AuctionMessage({item, state, model, selection}) {
  return <li className={item.read ? 'notification-read' : 'notification-unread'}>
    <MessageSelection id={`activity:${item.id}`} title={`${notificationHeading(item.type)} ${item.id}`} selection={selection} />
    <details className="notification-message" onToggle={event => {if (event.currentTarget.open && !item.read) model?.openMessage(item.id);}}>
    <summary><strong>{notificationHeading(item.type)}</strong><span className="notification-read-label">{state.pendingIds.includes(item.id) ? 'Saving…' : item.read ? 'Read' : 'Unread'}</span><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time></summary>
    {item.artworkAvailable ? <a className="underline" href={`/artwork/v41:${item.chain_id}:${item.artwork_id}`}>Artwork #{item.artwork_id}{item.auction_id && ` · Auction #${item.auction_id}`}</a> : <span>Artwork #{item.artwork_id} · Currently unavailable</span>}
    <p className="notification-help">Base Sepolia{item.token_id != null && ` · NFT #${item.token_id}`}</p>
    <p>{item.message}</p>
    </details>
  </li>;
}

function ReportMessage({item, state, onOpen, selection}) {
  return <li className={item.read===false?'notification-unread':'notification-read'}>
    <MessageSelection id={`report:${item.id}`} title={`report update ${item.id}`} selection={selection} />
    <details className="notification-message" onToggle={event=>{if(event.currentTarget.open && item.read===false)onOpen?.(item.id);}}>
    <summary><strong>Report and artwork update</strong>{typeof item.read==='boolean' && <span className="notification-read-label">{state.pendingId===item.id?'Saving…':item.read?'Read':'Unread'}</span>}<time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time></summary>
    <a className="underline" href={`/artwork/v41:${item.chain_id}:${item.artwork_id}`}>
      Artwork #{item.artwork_id} · {({'84532': 'Base Sepolia', '11155111': 'Ethereum Sepolia (legacy)', '8453': 'Base'})[item.chain_id] || `Chain ${item.chain_id}`}
    </a>
    <p>{item.message}</p>
    </details>
  </li>;
}

export function PersonalHistory({activity, reports, model, onReportOpen, view = 'all', opened = [], selection}) {
  const items = [...activity.items.map(item => ({item, source: 'activity'})),
    ...reports.items.map(item => ({item, source: 'report'}))].filter(({item, source}) =>
      view === 'all' || item.read !== true || opened.includes(`${source}:${item.id}`));
  items.sort((a, b) => (Date.parse(b.item.created_at) || 0) - (Date.parse(a.item.created_at) || 0)
    || `${a.source}:${a.item.id}`.localeCompare(`${b.source}:${b.item.id}`));
  if (!items.length) return view === 'new' && activity.status === 'ready' && reports.status === 'ready'
    ? <p className="notification-help">{activity.nextCursor || reports.nextCursor ? 'No new updates in the loaded list. Load older updates to check earlier messages.' : 'No new updates. Open All to see your earlier notifications.'}</p> : null;
  return <section className="notification-category" aria-label="Latest personal updates">
    <h3>Latest updates</h3>
    <ul className="notification-items">{items.map(({item, source}) => source === 'activity'
      ? <AuctionMessage key={`activity:${item.id}`} item={item} state={activity} model={model} selection={selection} />
      : <ReportMessage key={`report:${item.id}`} item={item} state={reports} onOpen={onReportOpen} selection={selection} />)}</ul>
  </section>;
}

export function NotificationSettings({state, model}) {
  if (!state.preferences || state.status === 'disabled') return null;
  const busy = state.preferencesPending || state.pendingIds.length > 0;
  const hasReminders = typeof state.preferences.reminders === 'boolean' && Array.isArray(state.reminders);
  return (<section className="notification-settings" aria-label="Notification settings"><h3>Notification settings</h3><fieldset className="notification-preferences" disabled={busy || state.status === 'loading'}>
      <legend>Updates shown in this inbox</legend>
      <label><input type="checkbox" checked={state.preferences.auction_created} onChange={event => model?.setPreference('auction_created', event.target.checked)} />Show auction creation updates</label>
      <label><input type="checkbox" checked={state.preferences.outbid} onChange={event => model?.setPreference('outbid', event.target.checked)} />Show outbid updates</label>
      {typeof state.preferences.lifecycle === 'boolean' && <label><input type="checkbox" checked={state.preferences.lifecycle} onChange={event => model?.setPreference('lifecycle', event.target.checked)} />Show bids, auction results, purchases and sales</label>}
      {hasReminders && <>
        <label><input type="checkbox" checked={state.preferences.reminders} onChange={event => model?.setPreference('reminders', event.target.checked)} />Show upcoming deadline reminders</label>
        <ReminderSettings minutes={state.reminderMinutes} enabled={state.preferences.reminders} busy={busy} model={model} />
      </>}
      <p className="notification-help">These settings hide or show existing updates without deleting them. They apply only to this inbox and do not subscribe you to email.</p>
    </fieldset></section>);
}

export function AuctionNotifications({state, model, history = true, settings = true, reminders = true}) {
  if (state.status === 'disabled') return null;
  const busy = state.preferencesPending || state.pendingIds.length > 0;
  const hasReminders = typeof state.preferences?.reminders === 'boolean' && Array.isArray(state.reminders);
  return <>{reminders && hasReminders && <UpcomingReminders state={state} model={model} busy={busy} />}
    <section className="notification-category" aria-label="Your activity" aria-busy={state.status === 'loading' || busy}>
    {history && <><h3 id="auction-notifications-heading">Your activity</h3>
    <p className="notification-help">Recorded updates for your wallet. Open an artwork to see its current state.</p></>}
    {settings && <NotificationSettings state={state} model={model} />}
    <div role="status" aria-live="polite">
      {state.status === 'loading' && <p>Loading auction updates…</p>}
      {state.status === 'auth' && <p>Sign in with your connected wallet to view auction updates.</p>}
      {state.status === 'unavailable' && <p>Auction notifications are temporarily unavailable.</p>}
      {history && state.status === 'ready' && state.items.length === 0 && <p>{state.preferences && ['auction_created', 'outbid', 'lifecycle'].every(key => !state.preferences[key]) ? 'Activity updates are hidden. Enable a category in settings to see its updates.' : 'No activity updates to show.'}</p>}
      {state.preferencesPending && <p>Saving notification settings…</p>}
      {state.notice && <p>{state.notice}</p>}
      {state.error && <p>{state.error}</p>}
    </div>
    {history && state.items.length > 0 && <ul className="notification-items">{state.items.map(item => <AuctionMessage key={item.id} item={item} state={state} model={model} />)}</ul>}
    {['error', 'unavailable'].includes(state.status) && <button type="button" className="btn-secondary" onClick={() => model?.load(state.retryCursor)}>Retry auction updates</button>}
    {state.status === 'ready' && state.nextCursor && <button type="button" className="btn-secondary" disabled={busy} onClick={() => model?.load(state.nextCursor)}>Load older auction updates</button>}
  </section></>;
}

export function NotificationInbox({ wallet, compact = false, header = false }) {
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState('personal');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [view, setView] = useState('new');
  const [opened, setOpened] = useState([]);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState([]);
  const [removing, setRemoving] = useState(false);
  const [state, setState] = useState({ status: 'idle', items: [], nextCursor: null });
  const inbox = useRef(null);
  const auctions = useRef(null);
  const summary = useRef(null);
  const toggleButton = useRef(null);
  const container = useRef(null);
  const readQueue = useRef(null);
  const mutations = useRef(0);
  const openRef = useRef(false);
  const signInGeneration = useRef(0);
  const actionGeneration = useRef(0);
  const [auctionState, setAuctionState] = useState({status: 'disabled', items: [], pendingIds: [], preferences: null});
  const [summaryState, setSummaryState] = useState({status:'disabled',count:null,complete:false});
  const [summaryEnabled, setSummaryEnabled] = useState(false);
  useEffect(() => {
    let clearing = false, active = true;
    const queue = createNotificationReadQueue({canRun:()=>{
      const personal=inbox.current?.getState(), auction=auctions.current?.getState();
      return !['loading','idle'].includes(personal?.status) && !personal?.pendingId &&
        auction?.status!=='loading' && !auction?.preferencesPending && !auction?.pendingIds.length;
    },onIdle:()=>{if(!openRef.current){inbox.current?.invalidate();auctions.current?.invalidate();}}});
    readQueue.current = queue;
    const clear = (status = 'auth') => {
      if (clearing) return;
      clearing = true; actionGeneration.current++; queue.reset(); setGroup('personal'); setSettingsOpen(false); setView('new'); setOpened([]); setSelecting(false); setSelected([]); setRemoving(false); model.invalidate(status); auctionModel.invalidate(status); summaryModel.invalidate(status); clearing = false;
    };
    const model = createNotificationInbox({ wallet, getWallet: activeWallet, onChange: next => {setState(next); if (next.status === 'auth') clear(); else void Promise.resolve().then(()=>queue.flush());} });
    const auctionModel = createAuctionNotifications({wallet, getWallet: activeWallet, onChange: next => {setAuctionState(next); if (next.status === 'auth') clear(); else void Promise.resolve().then(()=>queue.flush());}});
    // This hint can deny passive loading after local logout; SIWE remains the authority.
    const hasAuthHint = () => String(window.SupabaseAuth?.getAuthenticatedWallet?.() || '').toLowerCase()===wallet.toLowerCase();
    const summaryModel = createNotificationSummary({wallet,getWallet:activeWallet,canRead:hasAuthHint,onChange:next=>{setSummaryState(next);if(next.status==='auth')clear();}});
    inbox.current = model;
    auctions.current = auctionModel;
    summary.current = summaryModel;
    mutations.current = 0;
    Promise.resolve(window.ArtSoulPublicConfig?.load?.()).then(config => {
      if (!active) return;
      auctionModel.configure(config?.auctionNotifications);
      model.configure(config?.auctionNotifications);
      summaryModel.configure(config?.auctionNotifications);
      setSummaryEnabled(config?.auctionNotifications?.summaryEnabled===true);
      if (document.visibilityState !== 'hidden') void summaryModel.refresh();
      if (openRef.current) {void model.load();void auctionModel.load();}
    }, () => {if (active) {auctionModel.invalidate('unavailable');summaryModel.invalidate('unavailable');}});
    const onPageHide = () => {signInGeneration.current++; clear();openRef.current=false;setOpen(false);};
    const onWalletChange = () => {if(activeWallet()!==wallet.toLowerCase())onPageHide();};
    const onAuthChange = () => {clear();if(hasAuthHint() && document.visibilityState!=='hidden')void summaryModel.refresh(true);};
    const onStorage = event => { if (!event.key || event.key === 'artsoul_authenticated_wallet') {signInGeneration.current++; clear();} };
    const onPageShow = () => {if(hasAuthHint() && document.visibilityState!=='hidden')void summaryModel.refresh(true);};
    window.addEventListener('artsoul:wallet-state-changed', onWalletChange);
    window.addEventListener('artsoul:auth-state-changed', onAuthChange);
    window.addEventListener('storage', onStorage);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      active = false; signInGeneration.current++; actionGeneration.current++;
      queue.reset();
      model.invalidate();
      auctionModel.dispose();
      summaryModel.dispose();
      inbox.current = null;
      auctions.current = null;
      summary.current = null;
      window.removeEventListener('artsoul:wallet-state-changed', onWalletChange);
      window.removeEventListener('artsoul:auth-state-changed', onAuthChange);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [wallet]);
  useEffect(() => {
    if (!header || !open) return;
    const outside = event => {if (!container.current?.contains(event.target)) toggle(false);};
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [header, open]);
  useEffect(() => {
    if (!open && !summaryEnabled) return;
    const model = auctions.current;
    const refresh = () => {
      if (document.visibilityState === 'hidden') {if(!readQueue.current?.hasWork())model?.pauseReminders();summary.current?.invalidate();}
      else {
        if (!mutations.current) void summary.current?.refresh();
        if (open) void model?.refreshReminders();
      }
    };
    const timer = window.setInterval(refresh, 30000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    refresh();
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      if (open && !readQueue.current?.hasWork()) model?.pauseReminders();
    };
  }, [open, wallet, summaryEnabled]);
  async function signIn() {
    const model = inbox.current;
    const auctionModel = auctions.current;
    const generation = ++signInGeneration.current;
    try {
      const authenticated = await window.ensureAuthenticated?.();
      if (authenticated && generation === signInGeneration.current && openRef.current && model === inbox.current && auctionModel === auctions.current && activeWallet() === wallet.toLowerCase()) {
        await Promise.all([model.load(), auctionModel.load(), summary.current?.refresh(true)]);
      }
    } catch { if (generation === signInGeneration.current && model === inbox.current) {model.invalidate('auth'); auctionModel?.invalidate('auth');} }
  }
  async function mutate(operation) {
    const current = summary.current;
    mutations.current++;
    current?.cancelRefresh();
    try {return await operation();}
    finally {
      if (current === summary.current) {
        mutations.current--;
        if (!mutations.current && document.visibilityState!=='hidden') void current?.refresh(true);
      }
    }
  }
  function toggle(next = !openRef.current, restoreFocus = false) {
    openRef.current=next;setOpen(next);
    if(next){if(!readQueue.current?.hasWork()){inbox.current?.load();auctions.current?.load();}summary.current?.refresh();}
    else {setGroup('personal');setSettingsOpen(false);setView('new');setOpened([]);setSelecting(false);setSelected([]);signInGeneration.current++;if(!readQueue.current?.hasWork()){inbox.current?.invalidate();auctions.current?.invalidate();}}
    if(restoreFocus)toggleButton.current?.focus();
  }
  const visibleSummary = activeWallet()===wallet.toLowerCase() && summaryState.status==='ready';
  const hasUnread = visibleSummary && summaryState.count>0;
  const staff = state.staffReview;
  const activeGroup = staff && group === 'moderation' ? 'moderation' : 'personal';
  const unreadLabel = hasUnread ? summaryState.complete
    ? `${summaryState.count>=100?'99+':summaryState.count} unread ${summaryState.count===1?'notification':'notifications'}`
    : 'Unread notifications. Some counts are temporarily unavailable.' : 'Notifications';
  const auctionActions = auctions.current && {...auctions.current,
    openMessage:id=>{setOpened(values=>values.includes(`activity:${id}`)?values:[...values,`activity:${id}`]);return readQueue.current?.add(`auction:${id}`,async()=>{
      const model=auctions.current;
      if(activeWallet()!==wallet.toLowerCase() || !model) return;
      const current=model.getState();
      if([...current.items,...current.reminders].some(item=>item.id===id && !item.read)) await mutate(()=>model.markRead([id],true));
    });},
    markRead:(...args)=>mutate(()=>auctions.current?.markRead(...args)),
    setPreference:(...args)=>mutate(()=>auctions.current?.setPreference(...args)),
    setReminderMinutes:(...args)=>mutate(()=>auctions.current?.setReminderMinutes(...args))};
  const shown = [...auctionState.items.map(item=>({item,source:'activity'})),
    ...(auctionState.preferences?.reminders && auctionState.remindersStatus==='ready' ? auctionState.reminders : []).map(item=>({item,source:'activity'})),
    ...state.items.map(item=>({item,source:'report'}))].filter(({item,source})=>view==='all'||item.read!==true||opened.includes(`${source}:${item.id}`)).map(({item,source})=>`${source}:${item.id}`);
  const selection = selecting ? {ids:selected,busy:removing,toggle:id=>setSelected(values=>values.includes(id)?values.filter(value=>value!==id):[...values,id])} : null;
  const selectedShown = selected.filter(id=>shown.includes(id));
  function showSettings(next) {
    setSettingsOpen(next);
    const panel=container.current?.querySelector('#profile-notifications');
    if(panel) panel.scrollTop=0;
  }
  function removeSelected() {
    if (removing || !selectedShown.length) return;
    const activityModel=auctions.current, reportModel=inbox.current;
    const generation=actionGeneration.current;
    const current=()=>generation===actionGeneration.current && activeWallet()===wallet.toLowerCase() && activityModel===auctions.current && reportModel===inbox.current;
    const targets=selectedShown;
    setRemoving(true);
    void readQueue.current?.add('remove-selected',async()=>{
      try {
        for (const [source,model] of [['activity',activityModel],['report',reportModel]]) {
          const ids=targets.filter(id=>id.startsWith(`${source}:`)).map(id=>id.slice(source.length+1));
          for(let offset=0;offset<ids.length;offset+=20) {
            if(!current()) return;
            await mutate(()=>model.remove(ids.slice(offset,offset+20)));
            if(!current() || model.getState().error || model.getState().status==='auth') return;
          }
        }
      } finally {
        if(current()) {
          const remaining=new Set([...activityModel.getState().items,...(activityModel.getState().reminders||[])].map(item=>`activity:${item.id}`).concat(reportModel.getState().items.map(item=>`report:${item.id}`)));
          setSelected(values=>values.filter(id=>remaining.has(id))); setRemoving(false);
        }
      }
    });
  }
  return (
    <section ref={container} className={header ? 'notification-inbox header-notification-inbox' : compact ? 'notification-inbox profile-notification-inbox' : 'notification-inbox rounded-xl p-5 mb-5'} style={compact || header ? undefined : { color: 'var(--c-text)', background: 'var(--c-surface)', border: '1px solid var(--c-border-soft)' }} aria-label="Your notifications">
      <button ref={toggleButton} type="button" title="Notifications" aria-expanded={open} aria-controls="profile-notifications" aria-label={unreadLabel} className="notification-toggle" onClick={() => toggle()}>
        <span className="notification-toggle-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M10 21h4"/></svg>
          {hasUnread && <span className={`notification-badge${summaryState.complete?'':' notification-badge-dot'}`} aria-hidden="true">{summaryState.complete ? summaryState.count>=100?'99+':summaryState.count : null}</span>}
        </span>{!header && <><span className="notification-toggle-label">Notifications</span>
        <svg className="notification-toggle-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></>}
      </button>
      {open && <div id="profile-notifications" className="notification-panel" aria-busy={state.status === 'loading'} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();toggle(false,true);}}}>
        <div className="notification-panel-heading"><div><h2>Notifications</h2><p className="notification-help">{visibleSummary && summaryState.complete && summaryState.count===0 ? 'Your personal updates are all read.' : 'Your private updates, in one place.'}</p></div>
          <button className="notification-close" type="button" title="Notification settings" aria-label="Notification settings" aria-expanded={settingsOpen} aria-controls="notification-settings-view" onClick={()=>showSettings(!settingsOpen)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m9 3-.6 2.4-2.1 1.2L4 6l-2 3.5 1.8 1.7v2.5L2 15.5 4 19l2.3-.6 2.1 1.2L9 22h4l.6-2.4 2.1-1.2 2.3.6 2-3.5-1.8-1.8v-2.5L20 9.5 18 6l-2.3.6-2.1-1.2L13 3Z"/><circle cx="11" cy="12.5" r="3"/></svg></button>
          <button className="notification-close" type="button" autoFocus={header} aria-label="Close notifications" onClick={()=>toggle(false,true)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button>
        </div>
        <div id="notification-settings-view" hidden={!settingsOpen}>
          <button type="button" className="btn-secondary" onClick={()=>showSettings(false)}>Back to notifications</button>
          <NotificationSettings state={auctionState} model={auctionActions} />
          {auctionState.error && <p role="alert">{auctionState.error}</p>}
        </div>
        <div hidden={settingsOpen}>
        {summaryState.status==='unavailable' && <p className="notification-help">Unread counts are temporarily unavailable.</p>}
        {staff && <div className="notification-groups" role="group" aria-label="Notification categories">
          <button type="button" aria-pressed={activeGroup === 'personal'} aria-controls="personal-notifications" onClick={() => setGroup('personal')}>
            <span>Personal</span>{hasUnread && <span className={`notification-group-count${summaryState.complete ? '' : ' notification-group-dot'}`} aria-label={unreadLabel}>{summaryState.complete ? summaryState.count>=100?'99+':summaryState.count : null}</span>}
          </button>
          <button type="button" aria-pressed={activeGroup === 'moderation'} aria-controls={activeGroup === 'moderation' ? 'staff-notifications' : undefined} onClick={() => setGroup('moderation')}>
            <span>Moderation</span>{staff.status === 'ready' && staff.count > 0 && <span className="notification-group-count notification-queue-count" aria-label={`${staff.count}${staff.capped ? '+' : ''} ${staff.count === 1 ? 'report' : 'reports'} awaiting review`}>{staff.count}{staff.capped ? '+' : ''}</span>}
          </button>
        </div>}
        {activeGroup === 'moderation' && <section id="staff-notifications" className="notification-category" aria-labelledby="staff-notifications-heading">
          <h3 id="staff-notifications-heading">Reports awaiting review</h3>
          <p className="notification-help">Your moderation workspace. Review and resolve reports in Admin. This queue is separate from your personal unread messages.</p>
          {state.staffReview.status === 'loading' && <p role="status">Checking reports awaiting review…</p>}
          {state.staffReview.status === 'disabled' && <p>The review workspace is not active yet.</p>}
          {state.staffReview.status === 'verify' && <p><a className="underline" href="/admin">Verify admin access</a> to check reports awaiting review.</p>}
          {state.staffReview.status === 'unavailable' && <p>Review notices are temporarily unavailable. <a className="underline" href="/admin">Open Admin panel</a></p>}
          {state.staffReview.status === 'ready' && <>
            <p>{state.staffReview.count}{state.staffReview.capped ? '+' : ''} {state.staffReview.count === 1 ? 'report awaits' : 'reports await'} review. <a className="underline" href="/admin">Open Admin panel</a></p>
            {state.staffReview.reports.length > 0 && <ul className="mt-2 space-y-2">
              {state.staffReview.reports.map(report => <li key={report.reference}>
                <a className="underline" href="/admin">Report {report.reference.slice(0, 8)}</a>{' · '}
                <time dateTime={report.createdAt}>{new Date(report.createdAt).toLocaleString()}</time>
              </li>)}
            </ul>}
          </>}
        </section>}
        <div id="personal-notifications" hidden={activeGroup !== 'personal'}>
        <div className="notification-list-toolbar">
          <div className="notification-groups" role="group" aria-label="Personal notification view">{['new','all'].map(value=><button key={value} type="button" aria-pressed={view===value} disabled={removing} onClick={()=>{setView(value);setOpened([]);setSelected([]);}}>{value==='new'?'New':'All'}</button>)}</div>
          <button type="button" className="btn-secondary" disabled={!summaryEnabled || removing || !shown.length && !selecting} onClick={()=>{setSelecting(value=>!value);setSelected([]);}}>{selecting?'Done':'Select'}</button>
        </div>
        {selecting && <div className="notification-selection-bar">
          <label><input type="checkbox" disabled={removing || !shown.length} checked={shown.length>0 && shown.every(id=>selected.includes(id))} onChange={event=>setSelected(event.target.checked?shown:[])} />Select all shown</label>
          <button type="button" className="btn-secondary" disabled={removing || !selectedShown.length} onClick={removeSelected}>{removing?'Deleting…':`Delete selected (${selectedShown.length})`}</button>
          <p className="notification-help">Removed only from your inbox. Reports and protocol records are kept.</p>
        </div>}
        {Array.isArray(auctionState.reminders) && typeof auctionState.preferences?.reminders==='boolean' && <UpcomingReminders state={auctionState} model={auctionActions} busy={removing} view={view} opened={opened} selection={selection} />}
        <PersonalHistory activity={auctionState} reports={state} model={auctionActions} view={view} opened={opened} selection={selection}
          onReportOpen={id=>{setOpened(values=>values.includes(`report:${id}`)?values:[...values,`report:${id}`]);return readQueue.current?.add(`outcome:${id}`,()=>mutate(()=>inbox.current?.markRead(id,true)));}} />
        <AuctionNotifications state={auctionState} model={auctionActions} history={false} settings={false} reminders={false} />
        <section className="notification-category" aria-label="Your reports and artwork updates">
        <div role="status" aria-live="polite">
          {state.status === 'loading' && <p>Loading notifications…</p>}
          {state.status === 'auth' && <p>Sign in with your connected wallet to view notifications.</p>}
          {state.status === 'unavailable' && <p>Notifications are not available right now. Please try again later.</p>}
          {state.status === 'error' && <p>Notifications could not be loaded. Please try again.</p>}
          {state.error && <p>{state.error}</p>}
        </div>
        {['error', 'unavailable'].includes(state.status) && <button type="button" className="btn-main mt-3" onClick={() => inbox.current?.load(state.retryCursor)}>Retry</button>}
        {state.status === 'ready' && state.nextCursor && <button type="button" className="btn-main mt-3" disabled={Boolean(state.pendingId)} onClick={() => inbox.current?.load(state.nextCursor)}>Load older notifications</button>}
        </section>
        </div>
        </div>
        {(state.status === 'auth' || auctionState.status === 'auth') && <button type="button" className="btn-main mt-3" onClick={signIn}>Sign in to view</button>}
      </div>}
    </section>
  );
}
