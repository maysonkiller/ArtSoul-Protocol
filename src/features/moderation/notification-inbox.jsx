import { React } from '../../entries/react-runtime.js';
import { createNotificationInbox } from './notification-inbox-state.js';
import { createAuctionNotifications } from './auction-notifications-state.js';
import { notificationHeading } from './auction-notification-types.js';

const { useEffect, useRef, useState } = React;
const activeWallet = () => String(window.getCurrentWalletAddress?.() || window.currentWalletAddress || '').toLowerCase();

export function AuctionNotifications({state, model}) {
  if (state.status === 'disabled') return null;
  const busy = state.preferencesPending || state.pendingIds.length > 0;
  return <section className="notification-category" aria-labelledby="auction-notifications-heading" aria-busy={state.status === 'loading' || busy}>
    <h3 id="auction-notifications-heading">Your activity</h3>
    <p className="notification-help">Recorded updates for your wallet. Open an artwork to see its current state.</p>
    {state.preferences && <details className="notification-settings"><summary>Notification settings</summary><fieldset className="notification-preferences" disabled={busy || state.status === 'loading'}>
      <legend>Updates shown in this inbox</legend>
      <label><input type="checkbox" checked={state.preferences.auction_created} onChange={event => model?.setPreference('auction_created', event.target.checked)} />Show auction creation updates</label>
      <label><input type="checkbox" checked={state.preferences.outbid} onChange={event => model?.setPreference('outbid', event.target.checked)} />Show outbid updates</label>
      {typeof state.preferences.lifecycle === 'boolean' && <label><input type="checkbox" checked={state.preferences.lifecycle} onChange={event => model?.setPreference('lifecycle', event.target.checked)} />Show bids, auction results, purchases and sales</label>}
      <p className="notification-help">These settings hide or show existing updates without deleting them. They apply only to this inbox and do not subscribe you to email.</p>
    </fieldset></details>}
    <div role="status" aria-live="polite">
      {state.status === 'loading' && <p>Loading auction updates…</p>}
      {state.status === 'auth' && <p>Sign in with your connected wallet to view auction updates.</p>}
      {state.status === 'unavailable' && <p>Auction notifications are temporarily unavailable.</p>}
      {state.status === 'ready' && state.items.length === 0 && <p>{state.preferences && Object.values(state.preferences).every(value => !value) ? 'Activity updates are hidden. Enable a category above to see its updates.' : 'No activity updates to show.'}</p>}
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
  </section>;
}

export function NotificationInbox({ wallet, compact = false }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ status: 'idle', items: [], nextCursor: null });
  const inbox = useRef(null);
  const auctions = useRef(null);
  const openRef = useRef(false);
  const signInGeneration = useRef(0);
  const [auctionState, setAuctionState] = useState({status: 'disabled', items: [], pendingIds: [], preferences: null});
  useEffect(() => {
    let clearing = false, active = true;
    const clear = (status = 'auth') => {
      if (clearing) return;
      clearing = true; model.invalidate(status); auctionModel.invalidate(status); clearing = false;
    };
    const model = createNotificationInbox({ wallet, getWallet: activeWallet, onChange: next => {setState(next); if (next.status === 'auth') clear();} });
    const auctionModel = createAuctionNotifications({wallet, getWallet: activeWallet, onChange: next => {setAuctionState(next); if (next.status === 'auth') clear();}});
    inbox.current = model;
    auctions.current = auctionModel;
    Promise.resolve(window.ArtSoulPublicConfig?.load?.()).then(config => {
      if (!active) return;
      auctionModel.configure(config?.auctionNotifications);
      if (openRef.current) void auctionModel.load();
    }, () => {if (active) auctionModel.invalidate('unavailable');});
    const onWalletChange = () => {signInGeneration.current++; clear();};
    const onAuthChange = () => clear();
    const onStorage = event => { if (!event.key || event.key === 'artsoul_authenticated_wallet') {signInGeneration.current++; clear();} };
    window.addEventListener('artsoul:wallet-state-changed', onWalletChange);
    window.addEventListener('artsoul:auth-state-changed', onAuthChange);
    window.addEventListener('storage', onStorage);
    window.addEventListener('pagehide', onWalletChange);
    return () => {
      active = false; signInGeneration.current++;
      model.invalidate();
      auctionModel.dispose();
      inbox.current = null;
      auctions.current = null;
      window.removeEventListener('artsoul:wallet-state-changed', onWalletChange);
      window.removeEventListener('artsoul:auth-state-changed', onAuthChange);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pagehide', onWalletChange);
    };
  }, [wallet]);
  async function signIn() {
    const model = inbox.current;
    const auctionModel = auctions.current;
    const generation = ++signInGeneration.current;
    try {
      const authenticated = await window.ensureAuthenticated?.();
      if (authenticated && generation === signInGeneration.current && openRef.current && model === inbox.current && auctionModel === auctions.current && activeWallet() === wallet.toLowerCase()) {
        await Promise.all([model.load(), auctionModel.load()]);
      }
    } catch { if (generation === signInGeneration.current && model === inbox.current) {model.invalidate('auth'); auctionModel?.invalidate('auth');} }
  }
  return (
    <section className={compact ? 'notification-inbox profile-notification-inbox' : 'notification-inbox rounded-xl p-5 mb-5'} style={compact ? undefined : { color: 'var(--c-text)', background: 'var(--c-surface)', border: '1px solid var(--c-border-soft)' }} aria-label="Your notifications">
      <button type="button" aria-expanded={open} aria-controls="profile-notifications" className="font-semibold" onClick={() => {
        const next = !openRef.current;
        openRef.current = next; setOpen(next);
        if (next) {inbox.current?.load(); auctions.current?.load();}
        else {signInGeneration.current++; inbox.current?.invalidate(); auctions.current?.invalidate();}
      }}>{compact && <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M10 21h4"/></svg>}Notifications</button>
      {open && <div id="profile-notifications" className="mt-3" aria-busy={state.status === 'loading'}>
        <p className="text-sm opacity-70 mb-3">Your private updates. Visible only to your signed-in wallet.</p>
        {state.staffReview && <section className="mb-3" aria-label="Staff review notices">
          <h3 className="font-semibold">Reports awaiting review</h3>
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
        <AuctionNotifications state={auctionState} model={auctions.current} />
        <section className="notification-category" aria-labelledby="moderation-notifications-heading">
        <h3 id="moderation-notifications-heading">Moderation</h3>
        <p className="notification-help">Updates about your reports, artworks and donation messages.</p>
        <div role="status" aria-live="polite">
          {state.status === 'loading' && <p>Loading notifications…</p>}
          {state.status === 'auth' && <p>Sign in with your connected wallet to view notifications.</p>}
          {state.status === 'unavailable' && <p>Notifications are not available right now. Please try again later.</p>}
          {state.status === 'error' && <p>Notifications could not be loaded. Please try again.</p>}
          {state.status === 'ready' && state.items.length === 0 && <p>{state.staffReview ? 'No personal updates yet.' : 'No notifications yet.'}</p>}
        </div>
        {state.items.length > 0 && <ul className="space-y-3 mt-3">
          {state.items.map(item => <li key={item.id}>
            <a className="underline" href={`/artwork/v41:${item.chain_id}:${item.artwork_id}`}>
              Artwork #{item.artwork_id} · {({'84532': 'Base Sepolia', '11155111': 'Ethereum Sepolia (legacy)', '8453': 'Base'})[item.chain_id] || `Chain ${item.chain_id}`}
            </a>
            <p>{item.message}</p>
            <time className="text-xs opacity-70" dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time>
          </li>)}
        </ul>}
        {['error', 'unavailable'].includes(state.status) && <button type="button" className="btn-main mt-3" onClick={() => inbox.current?.load(state.retryCursor)}>Retry</button>}
        {state.status === 'ready' && state.nextCursor && <button type="button" className="btn-main mt-3" onClick={() => inbox.current?.load(state.nextCursor)}>Load older notifications</button>}
        </section>
        {(state.status === 'auth' || auctionState.status === 'auth') && <button type="button" className="btn-main mt-3" onClick={signIn}>Sign in to view</button>}
      </div>}
    </section>
  );
}
