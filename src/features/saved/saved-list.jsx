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
    if (owner === currentSavedWallet() && (savedStore.getState().owner !== owner || savedStore.getState().status !== 'loading')) {
      void savedStore.load();
    }
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
  return <section className="saved-list" aria-label="Favorites">
    <h3>Favorites</h3>
    <p className="saved-explanation">Artworks you bookmark appear here. Only you can see this list.</p>
    {signingIn && <p role="status">Waiting for wallet sign-in…</p>}
    {!signingIn && state.status === 'auth' && <p>
      {signInStatus === 'retry' ? 'Sign-in was not completed.' : 'Sign a wallet message to view your private Favorites. No gas fee.'}{' '}
      <button type="button" className="btn-secondary" onClick={handleSignIn}>Sign in</button>
    </p>}
    {!signingIn && state.status === 'error' && <p role="status">{state.error} <button type="button" className="btn-secondary" onClick={() => savedStore.load()}>Retry</button></p>}
    {!signingIn && state.status === 'loading' && !state.items.length && <p role="status">Loading favorites…</p>}
    {!signingIn && state.status === 'ready' && !state.items.length && <p>No favorites yet. <a href="/gallery#all">Explore the gallery</a></p>}
    <div className="profile-artwork-grid grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3" aria-busy={state.status === 'loading'}>
      {state.items.map(item => <SavedArtwork key={savedKey(item)} item={item} pending={state.pending.has(savedKey(item))} />)}
    </div>
    {state.status === 'ready' && state.nextCursor && <button type="button" className="btn-secondary" onClick={() => savedStore.load(state.nextCursor)}>Load more</button>}
  </section>;
}

function SavedArtwork({ item, pending }) {
  const cards = window.ArtSoulArtworkCard;
  const artwork = item.artwork;
  const visible = artwork && cards && !cards.isHidden(artwork);
  const src = visible ? cards.mediaUrl(artwork) : '';
  const href = visible ? cards.detailHref(artwork) : '';
  const [failedSrc, setFailedSrc] = React.useState(null);
  if (visible && cards.hasSafeMedia(artwork) && src !== failedSrc) {
    const Card = cards.ReactCard;
    return <Card artwork={artwork} href={href} surface="profile" onMediaUnavailable={() => setFailedSrc(src)} />;
  }
  return <div className="saved-unavailable">
    {href ? <>
      <a href={href}>{artwork.title || 'View artwork'}</a>
      <p>Preview unavailable.</p>
    </> : <p>This saved artwork is currently unavailable.</p>}
    <button type="button" aria-label="Remove from Favorites" className="btn-secondary" disabled={pending} onClick={() => savedStore.set({
      chain_id: item.chain_id, core_address: item.core_address, artwork_id: item.artwork_id
    }, false)}>Remove</button>
  </div>;
}
