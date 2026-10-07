// Request ownership is independent of React rendering, so late responses cannot
// repaint private history after a wallet change, sign-out, or unmount.
export function createNotificationInbox({ wallet, getWallet, onChange, fetchPage = fetch }) {
  const owner = wallet.toLowerCase();
  let generation = 0, controller;
  let state = { status: 'idle', items: [], nextCursor: null, retryCursor: null, staffReview: null };
  const publish = next => { state = next; onChange(state); };
  function invalidate(status = 'idle') {
    generation++;
    controller?.abort();
    publish({ status, items: [], nextCursor: null, retryCursor: null, staffReview: null });
  }
  async function loadStaffReview(current, options) {
    let eligible = false;
    try {
      const response = await fetchPage(`/api/moderation/access?expectedWallet=${encodeURIComponent(owner)}`, options);
      if (!current()) return;
      if (response.status === 401) { invalidate('auth'); return; }
      if (!response.ok) throw new Error('Staff access unavailable');
      const access = await response.json();
      if (!current()) return;
      if (access.authenticated !== true || access.eligible !== true) return;
      eligible = true;
      if (access.enabled !== true) { publish({ ...state, staffReview: { status: 'disabled' } }); return; }
      if (access.access?.stepUpActive !== true) { publish({ ...state, staffReview: { status: 'verify' } }); return; }
      const queueResponse = await fetchPage('/api/moderation/review-queue?status=pending_review', options);
      if (!current()) return;
      if (queueResponse.status === 401) { invalidate('auth'); return; }
      const queue = await queueResponse.json();
      if (!current()) return;
      if (!queueResponse.ok) {
        if (['STEP_UP_REQUIRED', 'STEP_UP_WALLET_MISMATCH', 'CREDENTIAL_REVOKED'].includes(queue.error)) {
          publish({ ...state, staffReview: { status: 'verify' } }); return;
        }
        if (queue.error === 'ADMIN_REQUIRED') { publish({ ...state, staffReview: null }); return; }
        if (queue.error === 'PROTOCOL_ADMIN_DISABLED') { publish({ ...state, staffReview: { status: 'disabled' } }); return; }
        throw new Error('Review queue unavailable');
      }
      const reports = queue.data?.reports;
      if (!Array.isArray(reports) || reports.length > 200 || reports.some(report =>
        !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(report.id || '') || !Number.isFinite(Date.parse(report.created_at)))) {
        throw new Error('Invalid review queue');
      }
      // Keep only the small notice projection, never complaint text or evidence.
      publish({ ...state, staffReview: { status: 'ready', count: reports.length, capped: reports.length === 200,
        reports: reports.slice(0, 5).map(report => ({ reference: report.id, createdAt: report.created_at })) } });
    } catch {
      if (current() && eligible) publish({ ...state, staffReview: { status: 'unavailable' } });
    }
  }
  async function load(cursor = null) {
    if (!owner || getWallet().toLowerCase() !== owner) { invalidate('auth'); return; }
    const request = ++generation;
    controller?.abort();
    controller = new AbortController();
    publish({ status: 'loading', items: cursor ? state.items : [], nextCursor: null, retryCursor: cursor, staffReview: cursor ? state.staffReview : null });
    const current = () => request === generation && getWallet().toLowerCase() === owner;
    try {
      const options = {
        credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { 'X-ArtSoul-Wallet': owner }
      };
      const response = await fetchPage(`/api/moderation/notifications${cursor ? `?before=${encodeURIComponent(cursor)}` : ''}`, options);
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
      publish({ status: cursor ? 'ready' : 'loading', items, nextCursor: data.nextCursor || null, retryCursor: null, staffReview: state.staffReview });
      if (!cursor) {
        await loadStaffReview(current, options);
        if (current()) publish({ ...state, status: 'ready' });
      }
    } catch {
      if (current()) publish({ ...state, status: 'error' });
    }
  }
  return { load, invalidate };
}
