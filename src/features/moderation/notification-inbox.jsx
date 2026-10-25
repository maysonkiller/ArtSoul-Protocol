import { React } from '../../entries/react-runtime.js';
import { createNotificationInbox } from './notification-inbox-state.js';
import { createAuctionNotifications } from './auction-notifications-state.js';
import { createNotificationSummary } from './notification-summary-state.js';
import { notificationHeading } from './auction-notification-types.js';

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

function UpcomingReminders({state, model, busy}) {
  const ready = state.preferences.reminders && state.remindersStatus === 'ready';
  const checking = ['idle', 'loading'].includes(state.remindersStatus);
  return <section className="notification-category notification-upcoming" aria-labelledby="upcoming-reminders-heading" aria-busy={checking || busy}>
    <h3 id="upcoming-reminders-heading">Upcoming</h3>
    <p className="notification-help">Checked while Notifications is open. In-app only, with no email or push notifications. Saving an artwork does not subscribe you.</p>
    <div role="status" aria-live="polite">
      {!state.preferences.reminders && <p>Reminders are off. Enable them in Notification settings.</p>}
      {state.preferences.reminders && checking && <p>Checking upcoming deadlines…</p>}
      {state.preferences.reminders && state.remindersStatus === 'unavailable' && <p>Upcoming reminders are temporarily unavailable.</p>}
      {ready && state.reminders.length === 0 && <p>No upcoming deadlines within your reminder times.</p>}
    </div>
    {ready && state.reminders.length > 0 && <ul className="notification-items">{state.reminders.map(item => {
      const deadline = new Date(Number(item.deadline) * 1000);
      const validDeadline = Number.isFinite(deadline.getTime());
      return <li key={item.id} className={item.read ? 'notification-read' : 'notification-unread'}>
        <div className="notification-item-heading"><strong>{item.type === 'payment_due' ? 'Payment due soon' : 'Auction ending soon'}</strong><span>{item.read ? 'Read' : 'Unread'}</span></div>
        {item.artworkAvailable ? <a className="underline" href={`/artwork/v41:${item.chain_id}:${item.artwork_id}`}>Artwork #{item.artwork_id} · Auction #{item.auction_id}</a> : <span>Artwork #{item.artwork_id} · Currently unavailable</span>}
        <p>{item.message}</p>
        <p className="notification-help">{item.type === 'payment_due' ? 'Payment deadline' : 'Auction ends'}: {validDeadline ? <time dateTime={deadline.toISOString()}>{deadline.toLocaleString()}</time> : 'Deadline unavailable'}</p>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => model?.markRead([item.id], !item.read)}>{state.pendingIds.includes(item.id) ? 'Saving…' : item.read ? 'Mark unread' : 'Mark read'}</button>
      </li>;
    })}</ul>}
    {ready && state.remindersCapped && <p className="notification-help">Showing the next 20 reminders. Open your auctions for the full list.</p>}
    {state.preferences.reminders && state.remindersStatus === 'unavailable' && <button type="button" className="btn-secondary" disabled={busy} onClick={() => model?.refreshReminders()}>Retry reminders</button>}
  </section>;
}

export function AuctionNotifications({state, model}) {
  if (state.status === 'disabled') return null;
  const busy = state.preferencesPending || state.pendingIds.length > 0;
  const hasReminders = typeof state.preferences?.reminders === 'boolean' && Array.isArray(state.reminders);
  return <>{hasReminders && <UpcomingReminders state={state} model={model} busy={busy} />}
    <section className="notification-category" aria-labelledby="auction-notifications-heading" aria-busy={state.status === 'loading' || busy}>
    <h3 id="auction-notifications-heading">Your activity</h3>
    <p className="notification-help">Recorded updates for your wallet. Open an artwork to see its current state.</p>
    {state.preferences && <details className="notification-settings"><summary>Notification settings</summary><fieldset className="notification-preferences" disabled={busy || state.status === 'loading'}>
      <legend>Updates shown in this inbox</legend>
      <label><input type="checkbox" checked={state.preferences.auction_created} onChange={event => model?.setPreference('auction_created', event.target.checked)} />Show auction creation updates</label>
      <label><input type="checkbox" checked={state.preferences.outbid} onChange={event => model?.setPreference('outbid', event.target.checked)} />Show outbid updates</label>
      {typeof state.preferences.lifecycle === 'boolean' && <label><input type="checkbox" checked={state.preferences.lifecycle} onChange={event => model?.setPreference('lifecycle', event.target.checked)} />Show bids, auction results, purchases and sales</label>}
      {hasReminders && <>
        <label><input type="checkbox" checked={state.preferences.reminders} onChange={event => model?.setPreference('reminders', event.target.checked)} />Show upcoming deadline reminders</label>
        <ReminderSettings minutes={state.reminderMinutes} enabled={state.preferences.reminders} busy={busy} model={model} />
      </>}
      <p className="notification-help">These settings hide or show existing updates without deleting them. They apply only to this inbox and do not subscribe you to email.</p>
    </fieldset></details>}
    <div role="status" aria-live="polite">
      {state.status === 'loading' && <p>Loading auction updates…</p>}
      {state.status === 'auth' && <p>Sign in with your connected wallet to view auction updates.</p>}
      {state.status === 'unavailable' && <p>Auction notifications are temporarily unavailable.</p>}
      {state.status === 'ready' && state.items.length === 0 && <p>{state.preferences && ['auction_created', 'outbid', 'lifecycle'].every(key => !state.preferences[key]) ? 'Activity updates are hidden. Enable a category above to see its updates.' : 'No activity updates to show.'}</p>}
      {state.preferencesPending && <p>Saving notification settings…</p>}
      {state.notice && <p>{state.notice}</p>}
      {state.error && <p>{state.error}</p>}
    </div>
    {state.items.length > 0 && <ul className="notification-items">{state.items.map(item => <li key={item.id} className={item.read ? 'notification-read' : 'notification-unread'}>
      <div className="notification-item-heading"><strong>{notificationHeading(item.type)}</strong><span>{item.read ? 'Read' : 'Unread'}</span></div>
      {item.artworkAvailable ? <a className="underline" href={`/artwork/v41:${item.chain_id}:${item.artwork_id}`}>Artwork #{item.artwork_id}{item.auction_id && ` · Auction #${item.auction_id}`}</a> : <span>Artwork #{item.artwork_id} · Currently unavailable</span>}
      <p className="notification-help">Base Sepolia{item.token_id != null && ` · NFT #${item.token_id}`}</p>
      <p>{item.message}</p>
      <div className="notification-item-heading"><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => model?.markRead([item.id], !item.read)}>{state.pendingIds.includes(item.id) ? 'Saving…' : item.read ? 'Mark unread' : 'Mark read'}</button></div>
    </li>)}</ul>}
    {['error', 'unavailable'].includes(state.status) && <button type="button" className="btn-secondary" onClick={() => model?.load(state.retryCursor)}>Retry auction updates</button>}
    {state.status === 'ready' && state.nextCursor && <button type="button" className="btn-secondary" disabled={busy} onClick={() => model?.load(state.nextCursor)}>Load older auction updates</button>}
  </section></>;
}

export function NotificationInbox({ wallet, compact = false }) {
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState('personal');
  const [state, setState] = useState({ status: 'idle', items: [], nextCursor: null });
  const inbox = useRef(null);
  const auctions = useRef(null);
  const summary = useRef(null);
  const toggleButton = useRef(null);
  const mutations = useRef(0);
  const openRef = useRef(false);
  const signInGeneration = useRef(0);
  const [auctionState, setAuctionState] = useState({status: 'disabled', items: [], pendingIds: [], preferences: null});
  const [summaryState, setSummaryState] = useState({status:'disabled',count:null,complete:false});
  const [summaryEnabled, setSummaryEnabled] = useState(false);
  useEffect(() => {
    let clearing = false, active = true;
    const clear = (status = 'auth') => {
      if (clearing) return;
      clearing = true; setGroup('personal'); model.invalidate(status); auctionModel.invalidate(status); summaryModel.invalidate(status); clearing = false;
    };
    const model = createNotificationInbox({ wallet, getWallet: activeWallet, onChange: next => {setState(next); if (next.status === 'auth') clear();} });
    const auctionModel = createAuctionNotifications({wallet, getWallet: activeWallet, onChange: next => {setAuctionState(next); if (next.status === 'auth') clear();}});
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
    const onWalletChange = () => {signInGeneration.current++; clear();openRef.current=false;setOpen(false);};
    const onAuthChange = () => {clear();if(hasAuthHint() && document.visibilityState!=='hidden')void summaryModel.refresh(true);};
    const onStorage = event => { if (!event.key || event.key === 'artsoul_authenticated_wallet') {signInGeneration.current++; clear();} };
    const onPageShow = () => {if(hasAuthHint() && document.visibilityState!=='hidden')void summaryModel.refresh(true);};
    window.addEventListener('artsoul:wallet-state-changed', onWalletChange);
    window.addEventListener('artsoul:auth-state-changed', onAuthChange);
    window.addEventListener('storage', onStorage);
    window.addEventListener('pagehide', onWalletChange);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      active = false; signInGeneration.current++;
      model.invalidate();
      auctionModel.dispose();
      summaryModel.dispose();
      inbox.current = null;
      auctions.current = null;
      summary.current = null;
      window.removeEventListener('artsoul:wallet-state-changed', onWalletChange);
      window.removeEventListener('artsoul:auth-state-changed', onAuthChange);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pagehide', onWalletChange);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [wallet]);
  useEffect(() => {
    if (!open && !summaryEnabled) return;
    const model = auctions.current;
    const refresh = () => {
      if (document.visibilityState === 'hidden') {model?.pauseReminders();summary.current?.invalidate();}
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
      if (open) model?.pauseReminders();
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
    current?.invalidate();
    try {await operation();}
    finally {
      if (current === summary.current) {
        mutations.current--;
        if (!mutations.current && document.visibilityState!=='hidden') void current?.refresh(true);
      }
    }
  }
  function toggle(next = !openRef.current, restoreFocus = false) {
    openRef.current=next;setOpen(next);
    if(next){inbox.current?.load();auctions.current?.load();summary.current?.refresh();}
    else {setGroup('personal');signInGeneration.current++;inbox.current?.invalidate();auctions.current?.invalidate();}
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
    markRead:(...args)=>mutate(()=>auctions.current?.markRead(...args)),
    setPreference:(...args)=>mutate(()=>auctions.current?.setPreference(...args)),
    setReminderMinutes:(...args)=>mutate(()=>auctions.current?.setReminderMinutes(...args))};
  return (
    <section className={compact ? 'notification-inbox profile-notification-inbox' : 'notification-inbox rounded-xl p-5 mb-5'} style={compact ? undefined : { color: 'var(--c-text)', background: 'var(--c-surface)', border: '1px solid var(--c-border-soft)' }} aria-label="Your notifications">
      <button ref={toggleButton} type="button" aria-expanded={open} aria-controls="profile-notifications" aria-label={unreadLabel} className="notification-toggle" onClick={() => toggle()}>
        <span className="notification-toggle-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M10 21h4"/></svg>
          {hasUnread && <span className={`notification-badge${summaryState.complete?'':' notification-badge-dot'}`} aria-hidden="true">{summaryState.complete ? summaryState.count>=100?'99+':summaryState.count : null}</span>}
        </span><span className="notification-toggle-label">Notifications</span>
        <svg className="notification-toggle-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      {open && <div id="profile-notifications" className="notification-panel" aria-busy={state.status === 'loading'} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();toggle(false,true);}}}>
        <div className="notification-panel-heading"><div><h2>Notifications</h2><p className="notification-help">{visibleSummary && summaryState.complete && summaryState.count===0 ? 'Your personal updates are all read.' : 'Your private updates, in one place.'}</p></div>
          <button className="notification-close" type="button" aria-label="Close notifications" onClick={()=>toggle(false,true)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button>
        </div>
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
        <AuctionNotifications state={auctionState} model={auctionActions} />
        <section className="notification-category" aria-labelledby="moderation-notifications-heading">
        <h3 id="moderation-notifications-heading">Your reports and artwork updates</h3>
        <p className="notification-help">Updates about your reports, artworks and donation messages.</p>
        <div role="status" aria-live="polite">
          {state.status === 'loading' && <p>Loading notifications…</p>}
          {state.status === 'auth' && <p>Sign in with your connected wallet to view notifications.</p>}
          {state.status === 'unavailable' && <p>Notifications are not available right now. Please try again later.</p>}
          {state.status === 'error' && <p>Notifications could not be loaded. Please try again.</p>}
          {state.error && <p>{state.error}</p>}
          {state.status === 'ready' && state.items.length === 0 && <p>{state.staffReview ? 'No personal updates yet.' : 'No notifications yet.'}</p>}
        </div>
        {state.items.length > 0 && <ul className="notification-items">
          {state.items.map(item => <li key={item.id} className={item.read===false?'notification-unread':'notification-read'}>
            {typeof item.read==='boolean' && <div className="notification-item-heading"><strong>Moderation update</strong><span>{item.read?'Read':'Unread'}</span></div>}
            <a className="underline" href={`/artwork/v41:${item.chain_id}:${item.artwork_id}`}>
              Artwork #{item.artwork_id} · {({'84532': 'Base Sepolia', '11155111': 'Ethereum Sepolia (legacy)', '8453': 'Base'})[item.chain_id] || `Chain ${item.chain_id}`}
            </a>
            <p>{item.message}</p>
            <div className="notification-item-heading"><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time>
              {typeof item.read==='boolean' && <button type="button" className="btn-secondary" disabled={Boolean(state.pendingId) || state.status!=='ready'} onClick={()=>mutate(()=>inbox.current?.markRead(item.id,!item.read))}>{state.pendingId===item.id?'Saving…':item.read?'Mark unread':'Mark read'}</button>}
            </div>
          </li>)}
        </ul>}
        {['error', 'unavailable'].includes(state.status) && <button type="button" className="btn-main mt-3" onClick={() => inbox.current?.load(state.retryCursor)}>Retry</button>}
        {state.status === 'ready' && state.nextCursor && <button type="button" className="btn-main mt-3" disabled={Boolean(state.pendingId)} onClick={() => inbox.current?.load(state.nextCursor)}>Load older notifications</button>}
        </section>
        </div>
        {(state.status === 'auth' || auctionState.status === 'auth') && <button type="button" className="btn-main mt-3" onClick={signIn}>Sign in to view</button>}
      </div>}
    </section>
  );
}
