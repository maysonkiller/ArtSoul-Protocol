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
  if (owner !== currentSavedWallet() || state.owner !== owner) return null;
  const Card = window.ArtSoulArtworkCard?.ReactCard;
  return <section className="saved-list" aria-label="Saved artworks" aria-busy={state.status === 'loading'}>
    <h3>Saved</h3>
    <p className="saved-explanation">Your private list. Saving does not affect Trust or subscribe you to emails.</p>
    {state.status === 'auth' && <p>Sign in with this wallet to view Saved. <button type="button" className="btn-secondary" onClick={async () => {
      try { if (await signInForSaved() && owner === currentSavedWallet()) await savedStore.load(); } catch { /* Keep the sign-in action available. */ }
    }}>Sign in</button></p>}
    {state.status === 'error' && <p role="status">{state.error} <button type="button" className="btn-secondary" onClick={() => savedStore.load()}>Retry</button></p>}
    {state.status === 'loading' && <p role="status">Loading Saved…</p>}
    {state.status === 'ready' && !state.items.length && <p>No saved artworks yet. Use the bookmark on any artwork.</p>}
    <div className="profile-artwork-grid grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
      {state.items.map(item => item.artwork && Card ? <Card key={savedKey(item)} artwork={item.artwork}
        href={window.ArtSoulArtworkCard.detailHref(item.artwork)} surface="profile" /> : <div key={savedKey(item)} className="saved-unavailable">
        <p>This saved artwork is currently unavailable.</p>
        <button type="button" className="btn-secondary" disabled={state.pending.has(savedKey(item))} onClick={() => savedStore.set({ chain_id: item.chain_id, core_address: item.core_address, artwork_id: item.artwork_id }, false)}>Remove from Saved</button>
      </div>)}
    </div>
    {state.status === 'ready' && state.nextCursor && <button type="button" className="btn-secondary" onClick={() => savedStore.load(state.nextCursor)}>Load more</button>}
  </section>;
}
