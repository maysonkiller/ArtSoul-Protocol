import { createSavedStore, savedKey } from './saved-state.js';

export const currentSavedWallet = () => String(window.getCurrentWalletAddress?.() || window.currentWalletAddress || '').toLowerCase();
const listeners = new Set();
let config = { enabled: false }, scheduled = false, walletRevision = 0, contextRevision = 0;
const requested = new Set();
const operations = new Map();
export const savedStore = createSavedStore({ getWallet: currentSavedWallet, onChange: state => {
  paint();
  for (const listener of listeners) listener(state);
} });
export const subscribeSaved = listener => { listeners.add(listener); return () => listeners.delete(listener); };
export const savedConfig = Promise.resolve().then(() => window.ArtSoulPublicConfig?.load?.()).then(data => {
  if (data?.saved?.enabled === true) config = data.saved;
  scan();
  return config;
}).catch(() => config);

function identity(button) {
  if (!config.enabled || Number(button.dataset.savedChain) !== config.chainId) return null;
  const value = { chain_id: config.chainId, core_address: config.coreAddress, artwork_id: button.dataset.savedArtwork };
  return savedKey(value) ? value : null;
}
function controls() { return document.querySelectorAll('[data-saved-artwork]'); }
function paint() {
  const state = savedStore.getState();
  for (const button of controls()) {
    const item = identity(button), key = savedKey(item);
    button.hidden = !item;
    if (!item) continue;
    const saved = state.saved.get(key) === true;
    button.setAttribute('aria-pressed', String(saved));
    button.setAttribute('aria-label', saved ? 'Remove from Saved' : 'Save artwork');
    button.title = saved ? 'Remove from Saved' : 'Save artwork to your private list';
    button.disabled = state.pending.has(key) || operations.has(key);
    button.setAttribute('aria-busy', String(button.disabled));
  }
}
function scan() {
  scheduled = false;
  paint();
  if (!currentSavedWallet() || !config.enabled) return;
  const pending = [];
  for (const button of controls()) {
    const item = identity(button), key = savedKey(item);
    if (key && !requested.has(key)) { requested.add(key); pending.push(item); }
  }
  // Fifty uint256 IDs stay well below intermediary URL-size limits.
  for (let start = 0; start < pending.length; start += 50) void savedStore.lookup(pending.slice(start, start + 50));
}
function scheduleScan() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(scan);
}
function notice(message) {
  let region = document.getElementById('saved-feedback');
  if (!region) {
    region = document.createElement('div');
    region.id = 'saved-feedback';
    region.className = 'saved-feedback';
    region.setAttribute('role', 'status');
    document.body.appendChild(region);
  }
  region.replaceChildren(document.createTextNode(message + ' '));
  const link = document.createElement('a');
  link.href = '/profile#saved'; link.textContent = 'View Saved'; region.appendChild(link);
  clearTimeout(notice.timer);
  notice.timer = setTimeout(() => region.remove(), 6000);
}
export async function signInForSaved() {
  const revision = walletRevision;
  const before = currentSavedWallet();
  const authenticated = await window.ensureAuthenticated?.();
  // Connecting from guest is allowed; a switch between existing accounts is not.
  return Boolean(authenticated && currentSavedWallet() && (!before || (before === currentSavedWallet() && revision === walletRevision)));
}
async function toggle(button) {
  const item = identity(button);
  if (!item || button.disabled) return;
  const key = savedKey(item);
  if (operations.has(key)) return;
  const operation = Symbol();
  operations.set(key, operation);
  const revision = walletRevision;
  const before = currentSavedWallet();
  button.disabled = true;
  try {
    if (!await signInForSaved()) { notice('Sign in with your wallet to save artworks.'); return; }
    if (before && revision !== walletRevision) return;
    // A cold/auth-expired view cannot guess whether an existing save should be
    // removed. Read the real state after sign-in before deciding the action.
    if (!savedStore.getState().saved.has(key) && !await savedStore.lookup([item])) {
      notice('Saved is unavailable. Please try again.'); return;
    }
    const value = savedStore.getState().saved.get(key) !== true;
    const ok = await savedStore.set(item, value);
    if (ok) notice(value ? 'Artwork saved.' : 'Artwork removed from Saved.');
    else if (before === currentSavedWallet()) notice('Saved could not be updated. Please try again.');
  } catch { notice('Sign-in was not completed. Please try again.'); }
  finally { if (operations.get(key) === operation) operations.delete(key); paint(); }
}
// Commands express a desired state, never a toggle. They use the existing
// session without opening a wallet or resuming automatically after sign-in.
export async function setSavedArtwork(artworkId, value) {
  const revision = contextRevision, wallet = currentSavedWallet();
  const changed = () => revision !== contextRevision || wallet !== currentSavedWallet();
  const failure = reason => ({ updated: false, reason });
  if (typeof artworkId !== 'string' || typeof value !== 'boolean' || !/^[1-9][0-9]{0,77}$/.test(artworkId) || BigInt(artworkId) >= 2n ** 256n) {
    return failure('Use one artwork number from its page URL.');
  }
  if (!/^0x[0-9a-f]{40}$/.test(wallet)) return failure('Connect and sign in with your wallet, then repeat the command.');
  await savedConfig;
  if (changed()) return failure('Account changed. Repeat the command for the current account.');
  const item = { chain_id: config.chainId, core_address: config.coreAddress, artwork_id: artworkId };
  const key = savedKey(item);
  if (!config.enabled || !key) return failure('Saved is unavailable. Please try again.');
  if (operations.has(key) || savedStore.getState().pending.has(key)) return failure('This artwork is being updated. Wait for it to finish, then repeat the command.');
  const operation = Symbol();
  operations.set(key, operation);
  paint();
  try {
    const ok = await savedStore.set(item, value);
    if (changed()) return failure('Account or sign-in changed. Repeat the command for the current account.');
    if (!ok) return failure(savedStore.getState().status === 'auth'
      ? 'Sign in with your wallet on the site, then repeat the command.'
      : 'Saved could not be updated. Please try again.');
    return { updated: true, artwork_id: artworkId, saved: value, url: '/profile#saved' };
  } finally { if (operations.get(key) === operation) operations.delete(key); paint(); }
}
window.ArtSoulSaved = { toggle, scheduleScan, setArtwork: setSavedArtwork };
const invalidate = event => {
  contextRevision++;
  if (event?.type === 'artsoul:wallet-state-changed') { walletRevision++; operations.clear(); }
  requested.clear(); savedStore.invalidate();
  document.getElementById('saved-feedback')?.remove();
  if (event?.type !== 'pagehide') scheduleScan();
};
for (const name of ['artsoul:wallet-state-changed', 'artsoul:wallet-state-settled', 'artsoul:auth-state-changed', 'pagehide', 'pageshow']) window.addEventListener(name, invalidate);
window.addEventListener('storage', event => { if (!event.key || event.key === 'artsoul_authenticated_wallet') invalidate(event); });
// React and the plain homepage renderer both insert the same control. Only
// added controls trigger a batched lookup; unrelated DOM changes do no work.
new MutationObserver(records => {
  if (records.some(record => [...record.addedNodes].some(node => node.nodeType === 1 &&
    (node.matches?.('[data-saved-artwork]') || node.querySelector?.('[data-saved-artwork]'))))) scheduleScan();
}).observe(document.documentElement, { subtree: true, childList: true });
