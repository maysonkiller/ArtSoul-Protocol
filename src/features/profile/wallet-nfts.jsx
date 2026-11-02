import { React } from '../../entries/react-runtime.js';

const currentWallet = () => String(window.getCurrentWalletAddress?.() || window.currentWalletAddress || '').toLowerCase();
const empty = () => ({ status: 'idle', page: null, message: '' });
const contextEvents = ['artsoul:wallet-state-changed', 'artsoul:wallet-state-settled', 'artsoul:auth-state-changed', 'pagehide'];

// Separate inventory: external ownership does not create an ArtSoul artwork,
// listing, sale record, Trust signal or permission to transact on mainnet.
export function WalletNfts({ wallet }) {
  const owner = String(wallet || '').toLowerCase();
  const [enabled, setEnabled] = React.useState(false);
  const [state, setState] = React.useState(empty);
  const request = React.useRef(null);
  const generation = React.useRef(0);
  const live = React.useRef(false);
  React.useEffect(() => {
    let active = true;
    Promise.resolve(window.ArtSoulPublicConfig?.load?.()).then(config => {
      if (active) setEnabled(config?.externalBaseNftsEnabled === true);
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  React.useEffect(() => {
    live.current = true;
    const clear = () => {
      generation.current++;
      request.current?.abort(); request.current = null;
      setState(empty());
    };
    const storage = event => { if (!event.key || event.key === 'artsoul_authenticated_wallet') clear(); };
    clear();
    contextEvents.forEach(name => window.addEventListener(name, clear));
    window.addEventListener('storage', storage);
    return () => {
      live.current = false;
      generation.current++;
      request.current?.abort(); request.current = null;
      contextEvents.forEach(name => window.removeEventListener(name, clear));
      window.removeEventListener('storage', storage);
    };
  }, [owner]);

  async function load(cursor) {
    if (!enabled || request.current || currentWallet() !== owner) return;
    const revision = generation.current;
    const controller = new AbortController(); request.current = controller;
    const valid = () => generation.current === revision && currentWallet() === owner;
    const timeout = setTimeout(() => controller.abort(), 10_000);
    setState(previous => ({ ...previous, status: 'loading', message: '' }));
    try {
      const response = await fetch('/api/wallet-nfts' + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''), {
        credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { 'X-ArtSoul-Wallet': owner }
      });
      if (!valid()) return;
      if (response.status === 401) { setState({ ...empty(), status: 'auth' }); return; }
      if (!response.ok) {
        const retry = Number(response.headers.get('retry-after'));
        const message = response.status === 429
          ? `Please wait${Number.isFinite(retry) && retry > 0 ? ` ${Math.ceil(retry / 60)} minute(s)` : ''} before trying again.`
          : 'Wallet NFTs are unavailable right now. Please try again later.';
        setState(previous => ({ ...previous, status: 'error', message })); return;
      }
      const page = await response.json();
      if (!valid()) return;
      if (page.wallet !== owner || page.chainId !== 8453 || !Array.isArray(page.items) || page.items.length > 12) throw new Error('Invalid inventory');
      setState({ status: 'ready', page, message: '' });
    } catch {
      if (valid()) setState(previous => ({ ...previous, status: 'error', message: 'Wallet NFTs could not be loaded. Please try again.' }));
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) request.current = null;
    }
  }
  async function signIn() {
    try {
      if (await window.ensureAuthenticated?.() && live.current && owner === currentWallet()) {
        // Signing in emits an auth event that retires the old response.
        setState(empty());
      }
    } catch { if (live.current && owner === currentWallet()) setState({ ...empty(), status: 'auth' }); }
  }
  if (!enabled || owner !== currentWallet()) return null;
  const page = state.page;
  return <section className="wallet-nfts" aria-label="Other NFTs in your Base wallet" aria-busy={state.status === 'loading'}>
    <h3>In your Base wallet</h3>
    <p>NFTs from other collections on Base mainnet. Viewing them does not switch your wallet network.</p>
    <p className="wallet-nfts-note">Purchase prices and venues are not available in this inventory. A transfer does not prove a purchase. Unsolicited NFTs may appear; collection names are not verification.</p>
    {state.status === 'auth' ? <p role="status">Sign in with this wallet to view its NFTs. <button type="button" className="btn-secondary" onClick={signIn}>Sign in</button></p> :
      <div className="wallet-nfts-actions">
        <button type="button" className="btn-secondary" disabled={state.status === 'loading'} onClick={() => void load()}>{page ? 'Reload first page' : 'Load wallet NFTs'}</button>
        {page?.nextCursor && <button type="button" className="btn-secondary" disabled={state.status === 'loading'} onClick={() => void load(page.nextCursor)}>Next page</button>}
        {state.status === 'loading' && <span role="status">Loading NFTs…</span>}
      </div>}
    {state.message && <p role="status">{state.message}</p>}
    {page && <>
      <p className="wallet-nfts-note">Indexed by Alchemy · {page.items.length} shown on this page{page.validAt ? ` · Base block ${page.validAt.blockNumber}` : ''}.
        {page.omittedCount > 0 && ' Some unsupported items were omitted.'}</p>
      {!page.items.length && <p>No supported NFTs on this page.{page.nextCursor ? ' You can check the next page.' : ''}</p>}
      <div className="wallet-nfts-grid">
        {page.items.map(item => <article key={item.id} className="wallet-nft-card">
          <div className="wallet-nft-image">
            <span>Preview unavailable</span>
            {item.imageUrl && <img src={item.imageUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={event => { event.currentTarget.hidden = true; }} />}
          </div>
          <div className="wallet-nft-body">
            <h4>{item.name || `Token ${item.tokenId}`}</h4>
            <p>{item.collection || 'Unnamed collection'}</p>
            <p>Base · {item.tokenType}{item.quantity !== '1' ? ` · Quantity ${item.quantity}` : ''}</p>
            <details>
              <summary>NFT details</summary>
              <dl><dt>Token ID</dt><dd>{item.tokenId}</dd><dt>Contract</dt><dd>{item.contractAddress}</dd>
                {item.traits.map((trait, i) => <React.Fragment key={i}><dt>{trait.name}</dt><dd>{trait.value}</dd></React.Fragment>)}
              </dl>
              <a href={`https://basescan.org/token/${item.contractAddress}?a=${item.tokenId}`} target="_blank" rel="noopener noreferrer">View on Base explorer ↗</a>
            </details>
          </div>
        </article>)}
      </div>
    </>}
  </section>;
}
