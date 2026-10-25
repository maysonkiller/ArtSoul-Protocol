// Counts have their own lifetime: closing the inbox clears its private contents,
// while the collapsed control may still show a fresh, server-proven unread badge.
export function createNotificationSummary({wallet, getWallet, onChange, fetchPage = fetch, canRead = () => true,
  clock = () => performance.now(), schedule = setTimeout, cancelSchedule = clearTimeout}) {
  const owner = String(wallet || '').toLowerCase();
  let enabled = false, generation = 0, controller, expiry, disposed = false, pending = false, lastRequest = -Infinity;
  let state = {status: 'disabled', count: null, complete: false};
  const owns = () => canRead() && /^0x[0-9a-f]{40}$/.test(owner) && String(getWallet() || '').toLowerCase() === owner;
  const publish = next => {if (!disposed) {state = next; onChange(next);}};
  function invalidate(status = 'idle') {
    generation++; controller?.abort(); controller = null; pending = false;
    cancelSchedule(expiry); expiry = undefined;
    publish({status, count: null, complete: false});
  }
  function configure(config) {enabled = config?.summaryEnabled === true; invalidate(enabled ? 'idle' : 'disabled');}
  function cancelRefresh() {
    // Keep the last verified count until its normal expiry while a read saves.
    // Only a fresh summary may replace it; privacy invalidation still clears it.
    generation++; controller?.abort(); controller = null; pending = false;
  }
  async function refresh(force = false) {
    if (disposed || !enabled) return;
    if (!owns()) {invalidate('auth'); return;}
    if (!force && (pending || state.status === 'auth' || clock()-lastRequest<5000)) return;
    controller?.abort(); controller = new AbortController();
    const active = controller, epoch = ++generation, started = clock();
    lastRequest = started; pending = true;
    const current = () => !disposed && epoch === generation && owns();
    const timeout = setTimeout(() => active.abort(),15000);
    try {
      const response = await fetchPage('/api/notifications?summary=1',{credentials:'same-origin',cache:'no-store',signal:active.signal,
        headers:{'X-ArtSoul-Wallet':owner}});
      if (!current()) return;
      if (response.status===401) {invalidate('auth'); return;}
      if (!response.ok) throw new Error('Summary unavailable');
      const data = await response.json();
      if (!current()) return;
      if (data.wallet!==owner) {invalidate('auth'); return;}
      const counts = [data.auctionCount,data.moderationCount,data.reminderCount];
      const server = Date.parse(data.serverTime), deadline = data.nextReminderDeadline;
      if (active.signal.aborted || counts.some(value=>!Number.isInteger(value)||value<0||value>100) ||
        !Number.isFinite(server) || typeof data.remindersAvailable!=='boolean' ||
        !(data.chainRevision===null || (typeof data.chainRevision==='string' && /^(0|[1-9][0-9]{0,77})$/.test(data.chainRevision))) ||
        !Number.isInteger(data.preferencesRevision) || data.preferencesRevision<0 || data.preferencesRevision>2147483647 ||
        (deadline!==null && (typeof deadline!=='string' || !/^[1-9][0-9]{0,12}$/.test(deadline) || Number(deadline)*1000<=server)) ||
        (data.reminderCount>0)!==(deadline!==null) || (!data.remindersAvailable && data.reminderCount!==0)) throw new Error('Invalid summary');
      const life = Math.min(60000,deadline===null ? Infinity : Number(deadline)*1000-server)-Math.max(0,clock()-started);
      if (life<=0) throw new Error('Expired summary');
      cancelSchedule(expiry);
      publish({status:'ready',count:Math.min(100,counts.reduce((sum,value)=>sum+value,0)),complete:data.remindersAvailable});
      expiry=schedule(()=>invalidate('unavailable'),life); expiry?.unref?.();
    } catch {if (current()) invalidate('unavailable');}
    finally {clearTimeout(timeout); if (epoch===generation) pending=false;}
  }
  return {configure,refresh,invalidate,cancelRefresh,getState:()=>state,dispose(){invalidate('disabled');disposed=true;}};
}
