// Keep the guest header independent of React and private notification requests.
const host = document.getElementById('header-notifications');

if (host && !host.dataset.notificationInitialized) {
  host.dataset.notificationInitialized = 'true';
  let root = null;
  let wallet = '';
  let generation = 0;
  let suspended = false;
  let modules;

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
    if (next === wallet) return;
    wallet = next;
    const current = ++generation;
    // Hide synchronously before React cleanup, including while an import waits.
    host.hidden = true;
    root?.unmount();
    root = null;
    if (!next) return;
    try {
      const [{React, createRoot}, {NotificationInbox}] = await loadInbox();
      if (current !== generation || suspended || connectedWallet() !== next) return;
      root = createRoot(host);
      root.render(React.createElement(NotificationInbox, {header: true, wallet: next}));
      host.hidden = false;
    } catch {
      if (current !== generation) return;
      root?.unmount();
      root = null;
      wallet = '';
      host.hidden = true;
      console.warn('Notifications could not load. They will retry when the connection resumes.');
    }
  }

  window.addEventListener('artsoul:wallet-state-changed', sync);
  window.addEventListener('artsoul:wallet-runtime-ready', sync);
  window.addEventListener('pagehide', () => { suspended = true; void sync(); });
  window.addEventListener('pageshow', () => { suspended = false; void sync(); });
  window.addEventListener('online', sync);
  void sync();
}
