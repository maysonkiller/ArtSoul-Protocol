const TYPES = ['auction_created', 'outbid'];
const bigintId = value => typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
const protocolId = value => typeof value === 'string' && /^[1-9][0-9]{0,77}$/.test(value) && BigInt(value) < 2n ** 256n;
const preferencesValid = value => value && Object.keys(value).length === 2 && TYPES.every(type => typeof value[type] === 'boolean');
const revisionValid = value => Number.isInteger(value) && value >= 0 && value <= 2147483647;
const chainRevisionValid = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value);
const empty = (status = 'idle') => ({status, items: [], nextCursor: null, retryCursor: null, preferences: null,
  preferencesRevision: null, chainRevision: null, pendingIds: [], preferencesPending: false, error: '', notice: ''});

// Independent of the moderation cursor. Every write retires earlier reads so a
// delayed page cannot undo durable read state or newly selected preferences.
export function createAuctionNotifications({wallet, getWallet, onChange, fetchPage = fetch, requestTimeoutMs = 20000}) {
  const owner = String(wallet || '').toLowerCase();
  let generation = 0, controller, disposed = false, config = {enabled: false}, state = empty();
  const owns = () => /^0x[0-9a-f]{40}$/.test(owner) && String(getWallet() || '').toLowerCase() === owner;
  const publish = patch => {if (!disposed) {state = {...state, ...patch}; onChange(state);} };
  const busy = () => state.preferencesPending || state.pendingIds.length > 0;
  function invalidate(status = 'idle') {
    generation++; controller?.abort(); controller = null;
    if (!disposed) {state = empty(status); onChange(state);}
  }
  function configure(value) {
    const next = value?.enabled === true && value.chainId === 84532 && /^0x[0-9a-f]{40}$/.test(value.coreAddress || '') && !/^0x0{40}$/.test(value.coreAddress)
      ? value : {enabled: false};
    if (JSON.stringify(next) !== JSON.stringify(config)) {config = next; invalidate(next.enabled ? 'idle' : 'disabled');}
  }
  function begin() {
    generation++; controller?.abort(); controller = new AbortController();
    const epoch = generation;
    return {signal: controller.signal, current: () => !disposed && epoch === generation && owns()};
  }
  async function api(url, operation, body) {
    const activeController = controller;
    const timeout = setTimeout(() => activeController.abort(), requestTimeoutMs);
    try {
      const response = await fetchPage(url, {method: body ? 'PUT' : 'GET', credentials: 'same-origin', cache: 'no-store', signal: operation.signal,
        headers: {'X-ArtSoul-Wallet': owner, ...(body ? {'Content-Type': 'application/json'} : {})}, ...(body ? {body: JSON.stringify(body)} : {})});
      if (!operation.current()) return null;
      if (operation.signal.aborted) throw new Error('The request timed out. Please try again.');
      if (response.status === 401) {if (operation.current()) invalidate('auth'); return null;}
      const result = await response.json();
      if (!operation.current()) return null;
      if (operation.signal.aborted) throw new Error('The request timed out. Please try again.');
      if (response.ok && result.wallet !== owner) {invalidate('auth'); return null;}
      if (!response.ok) throw Object.assign(new Error(result.message || 'Auction notifications could not be updated. Please try again.'), {status: response.status, code: result.error});
      return result;
    } finally {clearTimeout(timeout);}
  }
  function itemValid(item) {
    return item && bigintId(item.id) && TYPES.includes(item.type) && item.chain_id === '84532' && item.core_address === config.coreAddress &&
      protocolId(item.artwork_id) && protocolId(item.auction_id) && /^0x[0-9a-f]{64}$/.test(item.transaction_hash || '') &&
      Number.isFinite(Date.parse(item.created_at)) && typeof item.message === 'string' && item.message.length <= 1000 &&
      typeof item.read === 'boolean' && typeof item.artworkAvailable === 'boolean';
  }
  async function load(cursor = null) {
    if (!owns()) {invalidate('auth'); return;}
    if (!config.enabled) {invalidate('disabled'); return;}
    if (busy() || (cursor !== null && !bigintId(cursor))) return;
    const operation = begin();
    publish({status: 'loading', items: cursor ? state.items : [], nextCursor: cursor ? state.nextCursor : null, retryCursor: cursor, error: ''});
    try {
      const body = await api(`/api/notifications${cursor ? `?before=${cursor}` : ''}`, operation);
      if (!body || !operation.current()) return;
      if (!Array.isArray(body.items) || body.items.length > 20 || !body.items.every(itemValid) ||
          new Set(body.items.map(item => item.id)).size !== body.items.length ||
          !preferencesValid(body.preferences) || !revisionValid(body.preferencesRevision) || !chainRevisionValid(body.chainRevision) ||
          (body.nextCursor !== null && (!bigintId(body.nextCursor) || !body.items.length || body.nextCursor !== body.items.at(-1).id)) ||
          body.items.some(item => !body.preferences[item.type] || (cursor && BigInt(item.id) >= BigInt(cursor)))) throw new Error('Auction notifications returned an invalid response. Please reload.');
      if (cursor && (body.preferencesRevision !== state.preferencesRevision || body.chainRevision !== state.chainRevision)) {
        publish({items: [], nextCursor: null, notice: 'Auction history or settings changed. The latest updates are shown below.'});
        await load(); return;
      }
      const items = new Map((cursor ? state.items : []).map(item => [item.id, item]));
      for (const item of body.items) items.set(item.id, item);
      publish({status: 'ready', items: [...items.values()], nextCursor: body.nextCursor, retryCursor: null,
        preferences: body.preferences, preferencesRevision: body.preferencesRevision, chainRevision: body.chainRevision, error: ''});
    } catch (error) {
      if (operation.current()) publish({status: error.code === 'AUCTION_NOTIFICATIONS_DISABLED' ? 'disabled' : [404, 503].includes(error.status) ? 'unavailable' : 'error', error: error.message});
    }
  }
  async function markRead(ids, read) {
    if (!owns()) {invalidate('auth'); return;}
    if (!config.enabled || busy() || typeof read !== 'boolean' || !Array.isArray(ids) || ids.length < 1 || ids.length > 20 ||
        new Set(ids).size !== ids.length || ids.some(id => !bigintId(id) || !state.items.some(item => item.id === id))) return;
    const operation = begin();
    publish({status: 'ready', pendingIds: ids, error: '', notice: '', retryCursor: null});
    try {
      const body = await api('/api/notifications', operation, {action: 'read', ids, read});
      if (!body || !operation.current()) return;
      if (body.read !== read || !Array.isArray(body.updated) || body.updated.length !== ids.length || new Set(body.updated).size !== ids.length || body.updated.some(id => !ids.includes(id))) throw new Error('The read state could not be verified. Reload notifications.');
      publish({items: state.items.map(item => ids.includes(item.id) ? {...item, read} : item)});
    } catch (error) {
      if (operation.current()) {
        publish({error: error.message});
        if (error.code === 'NOTIFICATION_UNAVAILABLE') {
          publish({pendingIds: [], notice: 'An auction update is no longer available. The list has been refreshed.'});
          await load();
        }
      }
    } finally {if (operation.current()) publish({pendingIds: []});}
  }
  async function setPreference(type, enabled) {
    if (!owns()) {invalidate('auth'); return;}
    if (!config.enabled || busy() || !TYPES.includes(type) || typeof enabled !== 'boolean' || !preferencesValid(state.preferences) || !revisionValid(state.preferencesRevision)) return;
    const preferences = {...state.preferences, [type]: enabled}, expectedRevision = state.preferencesRevision;
    const operation = begin();
    publish({status: 'ready', preferencesPending: true, error: '', notice: '', retryCursor: null});
    try {
      const body = await api('/api/notifications', operation, {action: 'preferences', expected_revision: expectedRevision, preferences});
      if (!body || !operation.current()) return;
      if (!preferencesValid(body.preferences) || TYPES.some(key => body.preferences[key] !== preferences[key]) || body.preferencesRevision !== expectedRevision + 1) throw new Error('Notification settings could not be verified. Reload before trying again.');
      publish({preferences: body.preferences, preferencesRevision: body.preferencesRevision, preferencesPending: false,
        items: state.items.filter(item => preferences[item.type]), nextCursor: null, notice: 'Notification settings saved.'});
      await load();
    } catch (error) {
      if (operation.current()) {
        publish({error: error.message});
        if (error.code === 'NOTIFICATION_PREFERENCES_CONFLICT') {
          publish({preferencesPending: false, notice: 'Settings changed in another tab. The latest settings are loaded; choose again if needed.'});
          await load();
        }
      }
    } finally {if (operation.current()) publish({preferencesPending: false});}
  }
  return {getState: () => state, configure, load, invalidate, markRead, setPreference,
    dispose: () => {disposed = true; generation++; controller?.abort();}};
}
