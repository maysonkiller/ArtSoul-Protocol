import { React } from '../../entries/react-runtime.js';
import { savedStore, savedConfig, subscribeSaved, currentSavedWallet, signInForSaved } from './saved-ui.js';
import { savedKey } from './saved-state.js';

export function useSavedEnabled() {
  const [enabled, setEnabled] = React.useState(false);
  React.useEffect(() => { let active = true; savedConfig.then(config => { if (active) setEnabled(config.enabled); }); return () => { active = false; }; }, []);
  return enabled;
}
export function SavedList({ wallet }) {
  const [state, setState] = React.useState(savedStore.getState);
  const [signInStatus, setSignInStatus] = React.useState('idle');
  const signingIn = signInStatus === 'pending';
  const owner = String(wallet || '').toLowerCase();
  React.useEffect(() => {
    const update = next => setState({ ...next });
    const unsubscribe = subscribeSaved(update);
    update(savedStore.getState());
    if (owner === currentSavedWallet()) void savedStore.load();
    return unsubscribe;
  }, [owner]);
  React.useEffect(() => {
    if ((state.status === 'idle' || (state.status === 'ready' && state.listVersion !== state.loadedVersion)) &&
        savedStore.getState().status !== 'loading' && owner === currentSavedWallet()) void savedStore.load();
  }, [state.status, state.listVersion, state.loadedVersion, owner]);
  async function handleSignIn() {
    if (signingIn) return;
    setSignInStatus('pending');
    try {
      if (await signInForSaved() && owner === currentSavedWallet()) {
        const { status } = savedStore.getState();
        if (status !== 'loading' && status !== 'ready') await savedStore.load();
        setSignInStatus('idle');
      } else {
        setSignInStatus('retry');
      }
    } catch {
      setSignInStatus('retry');
    }
  }
  if (owner !== currentSavedWallet() || state.owner !== owner) return null;
  const Card = window.ArtSoulArtworkCard?.ReactCard;
  return <section className="saved-list" aria-label="Favorites">
    <h3>Favorites</h3>
    <p className="saved-explanation">Artworks you bookmark appear here. Only you can see this list.</p>
    {signingIn && <p role="status">Waiting for wallet sign-in…</p>}
    {!signingIn && state.status === 'auth' && <p>
      {signInStatus === 'retry' ? 'Sign-in was not completed.' : 'Sign in with this wallet to view your favorites.'}{' '}
      <button type="button" className="btn-secondary" onClick={handleSignIn}>Sign in</button>
    </p>}
    {!signingIn && state.status === 'error' && <p role="status">{state.error} <button type="button" className="btn-secondary" onClick={() => savedStore.load()}>Retry</button></p>}
    {!signingIn && state.status === 'loading' && <p role="status">Loading favorites…</p>}
    {!signingIn && state.status === 'ready' && !state.items.length && <p>No favorites yet. <a href="/gallery#discover">Explore the gallery</a></p>}
    <div className="profile-artwork-grid grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
      {state.items.map(item => item.artwork && Card ? <Card key={savedKey(item)} artwork={item.artwork}
        href={window.ArtSoulArtworkCard.detailHref(item.artwork)} surface="profile" /> : <div key={savedKey(item)} className="saved-unavailable">
        <p>This saved artwork is currently unavailable.</p>
        <button type="button" className="btn-secondary" disabled={state.pending.has(savedKey(item))} onClick={() => savedStore.set({ chain_id: item.chain_id, core_address: item.core_address, artwork_id: item.artwork_id }, false)}>Remove from Favorites</button>
      </div>)}
    </div>
    {state.status === 'ready' && state.nextCursor && <button type="button" className="btn-secondary" onClick={() => savedStore.load(state.nextCursor)}>Load more</button>}
  </section>;
}
