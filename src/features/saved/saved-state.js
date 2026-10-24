// Private, session-scoped bookmarks. Never persisted to browser storage and
// never sent to the discovery signal endpoint.
export function savedKey(item) {
  const id = String(item?.artwork_id ?? '');
  const core = String(item?.core_address || '').toLowerCase();
  const chain = Number(item?.chain_id);
  if (!Number.isSafeInteger(chain) || chain <= 0 || !/^0x[0-9a-f]{40}$/.test(core) ||
      /^0x0{40}$/.test(core) || !/^[1-9][0-9]{0,77}$/.test(id) || BigInt(id) >= 2n ** 256n) return '';
  return `${chain}:${core}:${id}`;
}

export function createSavedStore({ getWallet, request = fetch, onChange = () => {} }) {
  let generation = 0, listRequest = 0;
  let owner = String(getWallet() || '').toLowerCase();
  let state = { owner, status: 'idle', items: [], nextCursor: null, saved: new Map(), pending: new Set(), error: '', listVersion: 0, loadedVersion: 0 };
  const controllers = new Set();
  const versions = new Map();
  const publish = patch => { state = { ...state, ...patch }; onChange(state); };
  function invalidate() {
    generation++;
    listRequest++;
    for (const controller of controllers) controller.abort();
    controllers.clear();
    versions.clear();
    owner = String(getWallet() || '').toLowerCase();
    publish({ owner, status: 'idle', items: [], nextCursor: null, saved: new Map(), pending: new Set(), error: '', listVersion: 0, loadedVersion: 0 });
  }
  async function run(url, options, commit, relevant = () => true) {
    if (owner !== String(getWallet() || '').toLowerCase()) invalidate();
    if (!/^0x[0-9a-f]{40}$/.test(owner)) { publish({ status: 'auth', error: '' }); return false; }
    const revision = generation, expected = owner;
    const controller = new AbortController();
    controllers.add(controller);
    const current = () => revision === generation && expected === String(getWallet() || '').toLowerCase() && relevant();
    try {
      const response = await request(url, { credentials: 'same-origin', cache: 'no-store', ...options,
        signal: controller.signal, headers: { 'Content-Type': 'application/json', 'X-ArtSoul-Wallet': expected } });
      if (!current()) return false;
      if (response.status === 401) { invalidate(); publish({ status: 'auth' }); return false; }
      if (!response.ok) throw new Error('Saved request failed');
      const data = await response.json();
      if (!current()) return false;
      if (data.wallet !== expected) { invalidate(); publish({ status: 'auth' }); return false; }
      commit(data);
      return true;
    } catch {
      if (current()) publish({ status: 'error', error: 'Saved could not be updated. Please try again.' });
      return false;
    } finally { controllers.delete(controller); }
  }
  async function lookup(identities) {
    const knownVersions = new Map(identities.map(item => [savedKey(item), versions.get(savedKey(item)) || 0]));
    const ids = [...new Set(identities.map(item => String(item.artwork_id)))];
    if (!ids.length) return;
    const deployment = identities[0];
    if (identities.some(item => !savedKey(item) || item.chain_id !== deployment.chain_id || item.core_address !== deployment.core_address)) return false;
    return run(`/api/saved?artwork_ids=${encodeURIComponent(ids.join(','))}&chain_id=${deployment.chain_id}&core_address=${deployment.core_address}`, {}, data => {
      if (!Array.isArray(data.artworkIds) || data.chainId !== deployment.chain_id || data.coreAddress !== deployment.core_address) throw new Error('Invalid saved response');
      const present = new Set(data.artworkIds);
      const saved = new Map(state.saved);
      for (const item of identities) {
        const key = savedKey(item);
        if (key && knownVersions.get(key) === (versions.get(key) || 0)) saved.set(key, present.has(String(item.artwork_id)));
      }
      publish({ saved, error: '' });
    });
  }
  async function load(before = null) {
    const listRevision = ++listRequest;
    const listVersion = state.listVersion;
    const knownVersions = new Map(versions);
    publish({ status: 'loading', error: '' });
    return run(`/api/saved${before ? `?before=${encodeURIComponent(before)}` : ''}`, {}, data => {
      if (listRevision !== listRequest) return;
      if (!Array.isArray(data.items) || data.items.some(item => !savedKey(item))) throw new Error('Invalid saved page');
      const items = before ? [...state.items] : [];
      const saved = new Map(state.saved);
      for (const item of data.items) {
        const key = savedKey(item);
        if ((knownVersions.get(key) || 0) !== (versions.get(key) || 0) && state.saved.get(key) === false) continue;
        if (!items.some(previous => savedKey(previous) === key)) items.push(item);
        saved.set(key, true);
      }
      publish({ status: 'ready', items, saved, nextCursor: data.nextCursor || null, error: '', loadedVersion: listVersion });
    }, () => listRevision === listRequest);
  }
  async function set(item, value) {
    if (owner !== String(getWallet() || '').toLowerCase()) invalidate();
    const key = savedKey(item);
    if (!key || typeof value !== 'boolean' || state.pending.has(key)) return false;
    const revision = generation;
    versions.set(key, (versions.get(key) || 0) + 1);
    publish({ pending: new Set(state.pending).add(key), error: '' });
    const ok = await run('/api/saved', { method: 'PUT', body: JSON.stringify({ chain_id: item.chain_id, core_address: item.core_address, artwork_id: item.artwork_id, saved: value }) }, data => {
      if (data.saved !== value) throw new Error('Invalid saved acknowledgement');
      versions.set(key, (versions.get(key) || 0) + 1);
      const saved = new Map(state.saved).set(key, value);
      publish({ saved, items: value ? state.items : state.items.filter(row => savedKey(row) !== key),
        status: state.status === 'loading' ? 'loading' : 'ready', error: '', listVersion: state.listVersion + 1 });
    });
    if (revision === generation) {
      const pending = new Set(state.pending); pending.delete(key); publish({ pending });
    }
    return ok;
  }
  return { invalidate, lookup, load, set, getState: () => state };
}
