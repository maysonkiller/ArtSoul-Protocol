// Keep the guest header independent of React and private notification requests.
const host = document.getElementById('header-notifications');

if (host && !host.dataset.notificationInitialized) {
  host.dataset.notificationInitialized = 'true';
  let root = null;
  let wallet = '';
  let generation = 0;
  let suspended = false;
  let modules;
  const shell = host.innerHTML;

  function preview(address) {
    if (host.dataset.notificationWallet !== address) delete host.dataset.notificationRequested;
    host.dataset.notificationWallet = address;
    host.hidden = !address;
    if (!root && host.innerHTML !== shell) host.innerHTML = shell;
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
    preview(next || hint);
    if (!next) {
      if (hint) void loadInbox().catch(() => {});
      return;
    }
    try {
      const [{React, createRoot}, {NotificationInbox}] = await loadInbox();
      if (current !== generation || suspended || connectedWallet() !== next) return;
      function Inbox() {
        React.useEffect(() => {
          if (connectedWallet() === next && host.dataset.notificationRequested === next) {
            delete host.dataset.notificationRequested;
            host.querySelector('.notification-toggle')?.click();
          }
        }, []);
        return React.createElement(NotificationInbox, {header: true, wallet: next});
      }
      root = createRoot(host);
      root.render(React.createElement(Inbox));
      host.hidden = false;
    } catch {
      if (current !== generation) return;
      root?.unmount();
      root = null;
      wallet = '';
      preview(next);
      console.warn('Notifications could not load. They will retry when the connection resumes.');
    }
  }

  window.addEventListener('artsoul:wallet-state-changed', sync);
  window.addEventListener('artsoul:wallet-runtime-ready', sync);
  window.addEventListener('pagehide', () => {
    const visible = !host.hidden;
    suspended = true;
    void sync();
    // Keep only the generic shell in the outgoing page snapshot after cleanup.
    host.hidden = !visible;
  });
  window.addEventListener('pageshow', () => { suspended = false; void sync(); });
  window.addEventListener('online', sync);
  host.addEventListener('click', event => {
    if (!event.target.closest?.('[data-notification-preview]')) return;
    host.dataset.notificationRequested = host.dataset.notificationWallet;
    void sync();
  });
  void sync();
}
