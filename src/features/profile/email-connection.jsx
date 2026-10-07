import {React} from '../../entries/react-runtime.js';

const {useState, useEffect, useRef} = React;
const activeWallet = () => String(window.getCurrentWalletAddress?.() || window.currentWalletAddress || '').toLowerCase();

export function EmailConnection({walletAddress}) {
  const wallet = String(walletAddress || '').toLowerCase();
  const [connection, setConnection] = useState(null);
  const [email, setEmail] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const requestRef = useRef(0);
  const operationRef = useRef(0);
  const authenticatingRef = useRef(null);
  const busyRef = useRef(false);
  const tokenRef = useRef(new URLSearchParams(window.location.hash.slice(1)).get('verify_email') || '');
  const [hasToken, setHasToken] = useState(Boolean(tokenRef.current));

  async function api(body) {
    const response = await fetch('/api/profile/email', {
      method: body ? 'POST' : 'GET', credentials: 'include',
      headers: {'Content-Type': 'application/json', 'X-ArtSoul-Wallet': wallet},
      ...(body ? {body: JSON.stringify(body)} : {})
    });
    const result = await response.json();
    if (!response.ok || result.success !== true) throw Object.assign(new Error(result.message || 'Email verification is unavailable. Please try again.'), {status: response.status});
    if (result.wallet !== wallet) throw new Error('The wallet changed. Open your profile and try again.');
    return result;
  }

  async function refresh() {
    const requestId = ++requestRef.current;
    try {
      const result = await api();
      if (requestId === requestRef.current && activeWallet() === wallet) setConnection(result);
    } catch (error) {
      if (requestId !== requestRef.current || activeWallet() !== wallet) return;
      setConnection(error.status === 401 ? {available: true, needsSignIn: true} : {available: false});
    }
  }

  useEffect(() => {
    const onAuthChange = () => {
      const authenticatedWallet = String(window.SupabaseAuth?.getAuthenticatedWallet?.() || '').toLowerCase();
      requestRef.current++;
      setConnection(null);
      setEmail('');
      setEditing(false);
      setNotice('');
      // Session checks and successful SIWE also emit this event while signing in.
      // Retire requests already using the old session, not the sign-in itself.
      if (authenticatingRef.current !== operationRef.current || activeWallet() !== wallet || (authenticatedWallet && authenticatedWallet !== wallet)) {
        operationRef.current++;
        busyRef.current = false;
        setBusy(false);
      }
      if (authenticatedWallet === wallet && activeWallet() === wallet) void refresh();
      else setConnection({available: true, needsSignIn: true});
    };
    const onHashChange = () => {
      tokenRef.current = new URLSearchParams(window.location.hash.slice(1)).get('verify_email') || '';
      setHasToken(Boolean(tokenRef.current));
    };
    void refresh();
    window.addEventListener('artsoul:auth-state-changed', onAuthChange);
    window.addEventListener('hashchange', onHashChange);
    return () => {
      requestRef.current++; operationRef.current++;
      window.removeEventListener('artsoul:auth-state-changed', onAuthChange);
      window.removeEventListener('hashchange', onHashChange);
    };
  }, [wallet]);

  async function manage(action) {
    if (busyRef.current || activeWallet() !== wallet) return;
    busyRef.current = true;
    const operationId = ++operationRef.current;
    const confirmationToken = action === 'confirm' ? tokenRef.current : '';
    setBusy(true);
    setNotice('');
    let requestId;
    try {
      authenticatingRef.current = operationId;
      let authenticated;
      try { authenticated = await window.ensureAuthenticated?.(); }
      finally { if (authenticatingRef.current === operationId) authenticatingRef.current = null; }
      if (!authenticated) throw new Error('Sign in with your wallet to manage email.');
      if (operationId !== operationRef.current || activeWallet() !== wallet || (action === 'confirm' && tokenRef.current !== confirmationToken)) return;
      requestId = ++requestRef.current;
      if (action === 'open') {
        const result = await api();
        if (requestId !== requestRef.current || activeWallet() !== wallet) return;
        setConnection(result);
        setEditing(result.available === true && result.verified !== true);
        return;
      }
      await api(action === 'request' ? {action, email} : action === 'confirm' ? {action, token: confirmationToken} : {action});
      if (requestId !== requestRef.current || activeWallet() !== wallet || (action === 'confirm' && tokenRef.current !== confirmationToken)) return;
      if (action === 'request') {
        setEditing(false);
        setNotice('Open the link in your email, connect this wallet, then select Confirm email. Check spam too.');
      } else {
        if (action === 'confirm') {
          const hash = new URLSearchParams(window.location.hash.slice(1));
          hash.delete('verify_email');
          window.history.replaceState(null, '', window.location.pathname + window.location.search + (hash.size ? '#' + hash.toString() : ''));
        }
        tokenRef.current = '';
        setHasToken(false);
        setNotice(action === 'confirm' ? 'Email verified.' : 'Email removed.');
        setEmail('');
        setEditing(false);
      }
      await refresh();
    } catch (error) {
      if (operationId === operationRef.current && activeWallet() === wallet && (requestId === undefined || requestId === requestRef.current) && (action !== 'confirm' || tokenRef.current === confirmationToken)) setNotice(error.message);
    } finally {
      if (operationId === operationRef.current && activeWallet() === wallet) {busyRef.current = false; setBusy(false);}
    }
  }

  return (
    <section className="profile-email-connection" aria-label="Private email">
      <p className="profile-connection-help">Email stays private. Your wallet signs you in.</p>
      {connection?.verified === true ? (
        <div className="profile-connection-row profile-email-summary">
          <span className="profile-email-address">{connection.email}</span>
          <span>Verified email</span>
          <button type="button" className="btn-secondary" data-allow-rapid="true" disabled={busy} onClick={() => manage('disconnect')}>Disconnect email</button>
        </div>
      ) : connection?.available === false ? <p className="text-sm opacity-70">Email verification is not available yet.</p> : (
        <button type="button" className="profile-connection-row" data-allow-rapid="true" disabled={busy || !connection} onClick={() => manage('open')}>Connect email</button>
      )}
      {editing && (
        <form className="flex gap-3 flex-wrap mt-3" onSubmit={event => { event.preventDefault(); void manage('request'); }}>
          <label className="text-sm">Email address
            <input type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)}
              placeholder="name@gmail.com" className="w-full px-3 py-2 rounded-lg" style={{background: 'var(--c-surface)', color: 'var(--c-text)', border: '1px solid var(--c-border)'}} />
          </label>
          <button type="submit" className="btn-main" data-allow-rapid="true" disabled={busy}>Send verification email</button>
        </form>
      )}
      {hasToken && <button type="button" className="btn-main mt-3" data-allow-rapid="true" disabled={busy || connection?.available !== true} onClick={() => manage('confirm')}>Confirm email</button>}
      {busy && <p className="text-sm mt-2" role="status">Please wait...</p>}
      {notice && <p className="text-sm mt-2" role="status">{notice}</p>}
    </section>
  );
}
