// Request ownership is independent of React rendering, so late responses cannot
// repaint private history after a wallet change, sign-out, or unmount.
export function createNotificationInbox({ wallet, getWallet, onChange, fetchPage = fetch }) {
  const owner = wallet.toLowerCase();
  let generation = 0, controller;
  const deadlines = new Set();
  let readEnabled = false;
  let state = { status: 'idle', items: [], nextCursor: null, retryCursor: null, staffReview: null, pendingIds: [] };
  const publish = next => { state = next; onChange(state); };
  function cancelRequests() {
    controller?.abort();
    for (const timer of deadlines) clearTimeout(timer);
    deadlines.clear();
  }
  function deadline(active) {
    const timer = setTimeout(() => {deadlines.delete(timer); active.abort();}, 15000);
    deadlines.add(timer);
    return () => {clearTimeout(timer); deadlines.delete(timer);};
  }
  function invalidate(status = 'idle') {
    generation++;
    cancelRequests();
    publish({ status, items: [], nextCursor: null, retryCursor: null, staffReview: null, pendingIds: [] });
  }
  async function loadStaffReview(current, options) {
    let eligible = false;
    const stopDeadline = deadline(controller);
    try {
      const response = await fetchPage(`/api/moderation/access?expectedWallet=${encodeURIComponent(owner)}`, options);
      if (!current()) return;
      if (options.signal.aborted) throw new Error('Staff access timed out');
      if (response.status === 401) { invalidate('auth'); return; }
      if (!response.ok) throw new Error('Staff access unavailable');
      const access = await response.json();
      if (!current()) return;
      if (options.signal.aborted) throw new Error('Staff access timed out');
      if (access.authenticated !== true || access.eligible !== true) return;
      eligible = true;
      if (access.enabled !== true) { publish({ ...state, staffReview: { status: 'disabled' } }); return; }
      if (access.access?.stepUpActive !== true) { publish({ ...state, staffReview: { status: 'verify' } }); return; }
      publish({ ...state, staffReview: { status: 'loading' } });
      const queueResponse = await fetchPage('/api/moderation/review-queue?status=pending_review', options);
      if (!current()) return;
      if (options.signal.aborted) throw new Error('Staff review timed out');
      if (queueResponse.status === 401) { invalidate('auth'); return; }
      const queue = await queueResponse.json();
      if (!current()) return;
      if (options.signal.aborted) throw new Error('Staff review timed out');
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
    } finally { stopDeadline(); }
  }
  async function load(cursor = null) {
    if (!owner || getWallet().toLowerCase() !== owner) { invalidate('auth'); return; }
    if (state.pendingIds?.length) return;
    const request = ++generation;
    cancelRequests();
    controller = new AbortController();
    publish({ status: 'loading', items: cursor ? state.items : [], nextCursor: null, retryCursor: cursor,
      staffReview: cursor ? (state.staffReview?.status === 'loading' ? {status: 'unavailable'} : state.staffReview) : null, pendingIds: [] });
    const current = () => request === generation && getWallet().toLowerCase() === owner;
    const stopDeadline = deadline(controller);
    try {
      const options = {
        credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { 'X-ArtSoul-Wallet': owner }
      };
      const query = new URLSearchParams();
      if (readEnabled) query.set('v','2');
      if (cursor) query.set('before',cursor);
      const pageRequest = fetchPage(`/api/moderation/notifications${query.size ? '?'+query : ''}`, options);
      const staffRequest = cursor ? null : loadStaffReview(current, options);
      const response = await pageRequest;
      if (!current()) return;
      if (options.signal.aborted) throw new Error('Notifications request timed out');
      if (response.status === 401) { invalidate('auth'); return; }
      if ([404, 503].includes(response.status)) { invalidate('unavailable'); return; }
      if (!response.ok) throw new Error('Notifications request failed');
      const data = await response.json();
      if (!current()) return;
      if (options.signal.aborted) throw new Error('Notifications request timed out');
      if (data.wallet !== owner) { invalidate('auth'); return; }
      if (!Array.isArray(data.items)) throw new Error('Invalid notifications response');
      if (readEnabled && data.items.some(item=>typeof item.read!=='boolean')) throw new Error('Invalid read state');
      const items = [...state.items];
      for (const item of data.items) if (!items.some(existing => existing.id === item.id)) items.push(item);
      stopDeadline();
      // Personal history and read actions do not wait for the optional staff check.
      publish({ status: 'ready', items, nextCursor: data.nextCursor || null, retryCursor: null, staffReview: state.staffReview, pendingIds: [] });
      if (!cursor) await staffRequest;
    } catch {
      if (current()) publish({ ...state, status: 'error' });
    } finally { stopDeadline(); }
  }
  async function updateItems(ids,read,removing=false) {
    if (!owner || getWallet().toLowerCase()!==owner) {invalidate('auth');return;}
    if (!readEnabled || !['ready','error'].includes(state.status) || state.pendingIds?.length || (!removing && typeof read!=='boolean') ||
      !Array.isArray(ids) || ids.length<1 || ids.length>20 || new Set(ids).size!==ids.length ||
      ids.some(id=>typeof id!=='string' || !/^[1-9][0-9]{0,18}$/.test(id) || BigInt(id)>9223372036854775807n || !state.items.some(item=>item.id===id))) return;
    const request=++generation;cancelRequests();controller=new AbortController();
    const current=()=>request===generation && getWallet().toLowerCase()===owner;
    publish({...state,staffReview:state.staffReview?.status==='loading'?{status:'unavailable'}:state.staffReview,pendingId:ids[0],pendingIds:ids,error:''});
    const active=controller, stopDeadline=deadline(active);
    try {
      const response=await fetchPage('/api/moderation/notifications?v=2',{method:'PUT',credentials:'same-origin',cache:'no-store',signal:active.signal,
        headers:{'X-ArtSoul-Wallet':owner,'Content-Type':'application/json'},body:JSON.stringify(removing ? {action:'remove',ids} : {action:'read',ids,read})});
      if (!current()) return;
      if (response.status===401) {invalidate('auth');return;}
      const data=await response.json();
      if (!current()) return;
      if (data.wallet!==owner && response.ok) {invalidate('auth');return;}
      const acknowledged=removing ? data.removed : data.updated;
      if (!response.ok || active.signal.aborted || (!removing && data.read!==read) || !Array.isArray(acknowledged) ||
        acknowledged.length!==ids.length || new Set(acknowledged).size!==ids.length || acknowledged.some(id=>!ids.includes(id))) throw new Error('Notification update unavailable');
      publish({...state,items:removing ? state.items.filter(item=>!ids.includes(item.id)) : state.items.map(item=>ids.includes(item.id)?{...item,read}:item)});
    } catch {if(current())publish({...state,error:removing ? 'Notifications could not be deleted. Please try again.' : 'Read state could not be saved. Please try again.'});}
    finally {stopDeadline();if(current())publish({...state,pendingId:null,pendingIds:[]});}
  }
  return {getState:()=>state,load,invalidate,markRead:(id,read)=>updateItems([id],read),remove:ids=>updateItems(ids,undefined,true),configure(config){const next=config?.summaryEnabled===true;if(next!==readEnabled){readEnabled=next;invalidate();}}};
}
