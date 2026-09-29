import { React } from '../../entries/react-runtime.js';
import { createNotificationInbox } from './notification-inbox-state.js';

const { useEffect, useRef, useState } = React;
const activeWallet = () => String(window.getCurrentWalletAddress?.() || window.currentWalletAddress || '').toLowerCase();

export function NotificationInbox({ wallet }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ status: 'idle', items: [], nextCursor: null });
  const inbox = useRef(null);
  useEffect(() => {
    const model = createNotificationInbox({ wallet, getWallet: activeWallet, onChange: setState });
    inbox.current = model;
    const clear = () => model.invalidate('auth');
    const onStorage = event => { if (!event.key || event.key === 'artsoul_authenticated_wallet') clear(); };
    window.addEventListener('artsoul:wallet-state-changed', clear);
    window.addEventListener('artsoul:auth-state-changed', clear);
    window.addEventListener('storage', onStorage);
    window.addEventListener('pagehide', clear);
    return () => {
      model.invalidate();
      inbox.current = null;
      window.removeEventListener('artsoul:wallet-state-changed', clear);
      window.removeEventListener('artsoul:auth-state-changed', clear);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pagehide', clear);
    };
  }, [wallet]);
  async function signIn() {
    const model = inbox.current;
    try {
      const authenticated = await window.ensureAuthenticated?.();
      if (authenticated && model === inbox.current && activeWallet() === wallet.toLowerCase()) await model.load();
    } catch { if (model === inbox.current) model.invalidate('auth'); }
  }
  return (
    <section className="rounded-xl p-5 mb-5" style={{ color: 'var(--c-text)', background: 'var(--c-surface)', border: '1px solid var(--c-border-soft)' }} aria-label="Your notifications">
      <button type="button" aria-expanded={open} aria-controls="profile-notifications" className="font-semibold" onClick={() => {
        setOpen(!open);
        if (!open) inbox.current?.load();
        else inbox.current?.invalidate();
      }}>Notifications</button>
      {open && <div id="profile-notifications" className="mt-3" aria-busy={state.status === 'loading'}>
        <p className="text-sm opacity-70 mb-3">Moderation updates about your reports and artworks. Visible only to your signed-in wallet.</p>
        <div role="status" aria-live="polite">
          {state.status === 'loading' && <p>Loading notifications…</p>}
          {state.status === 'auth' && <p>Sign in with your connected wallet to view notifications.</p>}
          {state.status === 'unavailable' && <p>Notifications are not available right now. Please try again later.</p>}
          {state.status === 'error' && <p>Notifications could not be loaded. Please try again.</p>}
          {state.status === 'ready' && state.items.length === 0 && <p>No notifications yet.</p>}
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
        {state.status === 'auth' && <button type="button" className="btn-main mt-3" onClick={signIn}>Sign in to view</button>}
        {['error', 'unavailable'].includes(state.status) && <button type="button" className="btn-main mt-3" onClick={() => inbox.current?.load(state.retryCursor)}>Retry</button>}
        {state.status === 'ready' && state.nextCursor && <button type="button" className="btn-main mt-3" onClick={() => inbox.current?.load(state.nextCursor)}>Load older notifications</button>}
      </div>}
    </section>
  );
}
