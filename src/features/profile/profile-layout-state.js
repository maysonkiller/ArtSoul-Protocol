import {defaultProfileLayout, validateProfileLayout, profileArtworkKey as layoutArtworkKey, layoutArtworks,
  canFeatureArtwork, MAX_PROFILE_WORKS} from './profile-layout.js';
export {defaultProfileLayout};
const clone = value => JSON.parse(JSON.stringify(value));
export function validProfileLayout(layout) {
  try {validateProfileLayout(layout); return true;} catch {return false;}
}
export const profileArtworkKey = value => value ? layoutArtworkKey(value) : null;
export function profileArtworkPointer(card, config) {
  const id = String(card?.artwork_id || card?.blockchain_id || '');
  if (card?.source !== 'v41_projection' || Number(card.chain_id) !== config?.chainId || !/^[1-9][0-9]{0,77}$/.test(id) ||
      !/^0x[0-9a-f]{40}$/.test(config?.coreAddress || '') || card.is_hidden || card.moderation_hidden || card.is_blocked || card.is_deleted) return null;
  const pinned = {chain_id: config.chainId, core_address: config.coreAddress, artwork_id: id};
  try {return validateProfileLayout({...defaultProfileLayout(), pinned}).pinned;} catch {return null;}
}
export function canSelectProfileArtwork(card, wallet, config) {
  if (!profileArtworkPointer(card, config)) return false;
  return canFeatureArtwork(card, wallet, config.selectionPolicy);
}
export function selectedProfileArtworkKeys(layout) {
  return new Set(layoutArtworks(layout).map(profileArtworkKey));
}
export function moveProfileItem(items, index, direction) {
  const next = [...items], target = index + direction;
  if (index < 0 || index >= next.length || target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

// Public layout reads and private edit operations have separate generations.
// Cancelling, signing out or switching accounts retires every outstanding edit.
export function createProfileLayoutState({wallet, request = fetch, getWallet, authenticate, onChange = () => {}}) {
  wallet = String(wallet || '').toLowerCase();
  let generation = 0, editGeneration = 0, disposed = false, authenticating = false;
  const controllers = new Set();
  let state = {wallet, status: 'idle', revision: 0, layout: defaultProfileLayout(), cards: [], editing: false,
    draft: null, preview: false, busy: '', error: '', conflict: false};
  const publish = patch => { if (!disposed) {state = {...state, ...patch}; onChange(state);} };
  const owns = () => String(getWallet?.() || '').toLowerCase() === wallet;
  const relevant = (epoch, operation) => !disposed && epoch === generation && operation === editGeneration && owns();
  function cancel() {
    editGeneration++;
    for (const controller of controllers) controller.abort();
    controllers.clear(); authenticating = false;
    publish({editing: false, draft: null, preview: false, busy: '', error: '', conflict: false});
  }
  async function api(url, options = {}) {
    const response = await request(url, {cache: 'no-store', credentials: 'omit', ...options});
    const body = await response.json();
    if (!response.ok) throw Object.assign(new Error(body.message || 'Profile layout could not be loaded. Please try again.'), {status: response.status, code: body.error || body.code});
    if (body.wallet !== wallet || !Number.isSafeInteger(body.revision) || body.revision < 0) throw new Error('The profile layout response could not be verified.');
    return body;
  }
  async function readCards(revision, epoch) {
    try {
      const body = await api(`/api/profile/layout?address=${wallet}&view=artworks`);
      if (disposed || epoch !== generation || revision !== state.revision) return;
      if (body.revision !== revision || !Array.isArray(body.cards) || body.cards.length > MAX_PROFILE_WORKS) throw new Error('The profile layout changed. Reload to see the latest version.');
      publish({cards: body.cards});
    } catch (error) {
      if (!disposed && epoch === generation && revision === state.revision) publish({cards: [], error: error.message});
    }
  }
  async function load() {
    cancel(); const epoch = ++generation;
    publish({status: 'loading', cards: [], error: ''});
    try {
      const body = await api(`/api/profile/layout?address=${wallet}`);
      if (disposed || epoch !== generation) return;
      if (!validProfileLayout(body.layout)) throw new Error('The saved profile layout is unavailable.');
      publish({status: 'ready', revision: body.revision, layout: body.layout});
      if (selectedProfileArtworkKeys(body.layout).size) await readCards(body.revision, epoch);
    } catch (error) { if (!disposed && epoch === generation) publish({status: 'error', error: error.message}); }
  }
  function edit() {
    if (!owns() || state.status !== 'ready' || state.busy) return;
    editGeneration++; publish({editing: true, draft: clone(state.layout), preview: false, error: '', conflict: false});
  }
  function change(update) {
    if (!owns() || !state.editing || state.busy) return;
    const next = typeof update === 'function' ? update(clone(state.draft)) : clone(update);
    publish({draft: next, error: ''});
  }
  async function operate(kind, operation) {
    if (!owns() || !state.editing || state.busy) return;
    const epoch = generation, editEpoch = ++editGeneration;
    const controller = new AbortController(); controllers.add(controller);
    publish({busy: kind, error: ''});
    try {
      authenticating = true;
      let signedIn;
      try { signedIn = await authenticate?.(); } finally { if (editEpoch === editGeneration) authenticating = false; }
      if (!relevant(epoch, editEpoch)) return;
      if (!signedIn) throw new Error('Sign in with this profile wallet to save changes.');
      await operation(controller.signal, () => relevant(epoch, editEpoch));
    } catch (error) {
      const conflict = error.status === 409 && error.code === 'LAYOUT_CONFLICT';
      if (relevant(epoch, editEpoch)) publish({error: conflict ? 'This profile was changed elsewhere. Your draft is kept. Load the latest layout before saving again.' : error.message || 'The change could not be completed. Please try again.', conflict});
    } finally {
      controllers.delete(controller);
      if (relevant(epoch, editEpoch)) publish({busy: ''});
    }
  }
  async function save() {
    if (!owns() || !state.editing || !state.draft || state.busy) return;
    const draft = clone(state.draft), revision = state.revision;
    await operate('saving', async (signal, current) => {
      const body = await api('/api/profile/layout', {method: 'PUT', credentials: 'include', signal,
        headers: {'Content-Type': 'application/json', 'X-ArtSoul-Wallet': wallet}, body: JSON.stringify({expected_revision: revision, layout: draft})});
      if (!current()) return;
      if (!validProfileLayout(body.layout) || body.revision <= revision) throw new Error('The saved profile layout could not be verified. Reload before trying again.');
      publish({layout: body.layout, revision: body.revision, editing: false, draft: null, preview: false, cards: [], conflict: false});
      if (selectedProfileArtworkKeys(body.layout).size) await readCards(body.revision, generation);
    });
  }
  function authChanged(authenticatedWallet) {
    if (!owns() || (String(authenticatedWallet || '').toLowerCase() !== wallet && !authenticating)) cancel();
    else if (authenticatedWallet && String(authenticatedWallet).toLowerCase() !== wallet) cancel();
  }
  return {getState: () => state, load, edit, change, cancel, save, authChanged,
    preview: value => {if (owns() && state.editing && !state.busy) publish({preview: Boolean(value)});},
    dispose: () => {disposed = true; cancel(); generation++;}};
}
