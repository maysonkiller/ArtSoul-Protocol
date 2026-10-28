// Keep the guest header independent of React and private notification requests.
const host = document.getElementById('header-notifications');

if (host && !host.dataset.notificationInitialized) {
  host.dataset.notificationInitialized = 'true';
  let root = null;
  let wallet = '';
  let generation = 0;
  let suspended = false;
  let modules;
  let shellMounted = true;
  let loadFailed = false;
  let connecting = false;
  const shell = host.innerHTML;

  const panel = () => host.querySelector('#notification-preview-panel');

  function preview(address) {
    if (host.dataset.notificationWallet !== address) {
      delete host.dataset.notificationRequested;
      loadFailed = false;
    }
    host.dataset.notificationWallet = address;
    host.hidden = false;
    if (!shellMounted) { host.innerHTML = shell; shellMounted = true; }
    const message = host.querySelector('[data-notification-message]');
    const action = host.querySelector('[data-notification-connect]');
    message.textContent = loadFailed ? 'Notifications could not load. Please try again.'
      : address ? 'Preparing your notifications…'
      : 'Connect your wallet to see bids, auction results and other updates.';
    action.hidden = Boolean(address) && !loadFailed;
    action.disabled = connecting;
    action.textContent = loadFailed ? 'Try again' : 'Connect wallet';
  }

  function connectedWallet() {
    const state = window.artsoulSettledWalletState;
    const address = String(state?.address || '').toLowerCase();
    return window.artsoulWalletStateSettled === true && state?.isConnected === true &&
      /^0x[0-9a-f]{40}$/.test(address) ? address : '';
  }

  function loadInbox() {
    if (!modules) {
      modules = Promise.all([
        import('./react-runtime.js'),
        import('../features/moderation/notification-inbox.jsx')
      ]).catch(error => { modules = null; throw error; });
    }
    return modules;
  }

  async function sync() {
    const next = suspended ? '' : connectedWallet();
    const hint = !suspended && window.artsoulWalletStateSettled !== true
      ? window.ArtSoulHeaderPrepaint?.boot.notificationWallet || '' : '';
    if (next === wallet) {
      if (!root) preview(next || hint);
      if (hint) void loadInbox().catch(() => {});
      return;
    }
    wallet = next;
    const current = ++generation;
    // Hide synchronously before React cleanup, including while an import waits.
    host.hidden = true;
    root?.unmount();
    root = null;
    loadFailed = false;
    preview(next || hint);
    if (!next) {
      if (hint) void loadInbox().catch(() => {});
      return;
    }
    try {
      const [{React, createRoot}, {NotificationInbox}] = await loadInbox();
      if (current !== generation || suspended || connectedWallet() !== next) return;
      const requested = host.dataset.notificationRequested === next;
      const restoreFocus = host.contains(document.activeElement);
      panel()?.hidePopover();
      delete host.dataset.notificationRequested;
      function Inbox() {
        React.useEffect(() => {
          if (connectedWallet() === next) {
            const toggle = host.querySelector('.notification-toggle');
            if (restoreFocus) toggle?.focus();
            if (requested) toggle?.click();
          }
        }, []);
        return React.createElement(NotificationInbox, {header: true, wallet: next});
      }
      root = createRoot(host);
      shellMounted = false;
      root.render(React.createElement(Inbox));
      host.hidden = false;
    } catch {
      if (current !== generation) return;
      root?.unmount();
      root = null;
      wallet = '';
      loadFailed = true;
      preview(next);
      console.warn('Notifications could not load. They will retry when the connection resumes.');
    }
  }

  window.addEventListener('artsoul:wallet-state-changed', sync);
  window.addEventListener('artsoul:wallet-runtime-ready', sync);
  window.addEventListener('pagehide', () => {
    suspended = true;
    panel()?.hidePopover();
    delete host.dataset.notificationRequested;
    void sync();
  });
  window.addEventListener('pageshow', () => { suspended = false; void sync(); });
  window.addEventListener('online', sync);
  host.addEventListener('beforetoggle', event => {
    if (event.target === panel() && event.newState === 'closed') delete host.dataset.notificationRequested;
  }, true);
  host.addEventListener('click', async event => {
    if (suspended) return;
    if (event.target.closest?.('[data-notification-preview]')) {
      void sync(); // The native popover also works before this entry loads.
      return;
    }
    if (!event.target.closest?.('[data-notification-connect]') || connecting) return;
    if (connectedWallet()) { void sync(); return; }
    const action = host.querySelector('[data-notification-connect]');
    const message = host.querySelector('[data-notification-message]');
    if (typeof window.safeConnectWallet !== 'function') {
      message.textContent = 'Wallet connection is still loading. Please try again in a moment.';
      return;
    }
    connecting = true;
    action.disabled = true;
    panel()?.hidePopover();
    try { await window.safeConnectWallet(); }
    catch { message.textContent = 'Wallet connection was not completed. You can try again.'; }
    finally {
      connecting = false;
      action.disabled = false;
      // A wallet change can have replaced the original guest shell meanwhile.
      if (!root) host.querySelector('[data-notification-connect]').disabled = false;
    }
  });
  void sync();
}
