// Request ownership is independent of React rendering, so late responses cannot
// repaint private history after a wallet change, sign-out, or unmount.
export function createNotificationInbox({ wallet, getWallet, onChange, fetchPage = fetch }) {
  const owner = wallet.toLowerCase();
  let generation = 0, controller;
  let state = { status: 'idle', items: [], nextCursor: null, retryCursor: null };
  const publish = next => { state = next; onChange(state); };
  function invalidate(status = 'idle') {
    generation++;
    controller?.abort();
    publish({ status, items: [], nextCursor: null, retryCursor: null });
  }
  async function load(cursor = null) {
    if (!owner || getWallet().toLowerCase() !== owner) { invalidate('auth'); return; }
    const request = ++generation;
    controller?.abort();
    controller = new AbortController();
    publish({ status: 'loading', items: cursor ? state.items : [], nextCursor: null, retryCursor: cursor });
    const current = () => request === generation && getWallet().toLowerCase() === owner;
    try {
      const response = await fetchPage(`/api/moderation/notifications${cursor ? `?before=${encodeURIComponent(cursor)}` : ''}`, {
        credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { 'X-ArtSoul-Wallet': owner }
      });
      if (!current()) return;
      if (response.status === 401) { invalidate('auth'); return; }
      if ([404, 503].includes(response.status)) { invalidate('unavailable'); return; }
      if (!response.ok) throw new Error('Notifications request failed');
      const data = await response.json();
      if (!current()) return;
      if (data.wallet !== owner) { invalidate('auth'); return; }
      if (!Array.isArray(data.items)) throw new Error('Invalid notifications response');
      const items = [...state.items];
      for (const item of data.items) if (!items.some(existing => existing.id === item.id)) items.push(item);
      publish({ status: 'ready', items, nextCursor: data.nextCursor || null, retryCursor: null });
    } catch {
      if (current()) publish({ ...state, status: 'error' });
    }
  }
  return { load, invalidate };
}
