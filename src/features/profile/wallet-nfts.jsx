import { React } from '../../entries/react-runtime.js';
import { createPortal } from 'react-dom';
import { MultiChainWalletAssets } from './multichain-wallet-assets.jsx';

const currentWallet = () => String(window.getCurrentWalletAddress?.() || window.currentWalletAddress || '').toLowerCase();
const empty = () => ({ status: 'idle', page: null, index: 0, message: '' });
const contextEvents = ['artsoul:wallet-state-changed', 'artsoul:wallet-state-settled', 'artsoul:auth-state-changed', 'pagehide'];

// Separate inventory: external ownership does not create an ArtSoul artwork,
// listing, sale record, Trust signal or permission to transact on mainnet.
export function useWalletNftsEnabled() {
  const [enabled, setEnabled] = React.useState(false);
  React.useEffect(() => {
    let active = true;
    Promise.resolve(window.ArtSoulPublicConfig?.load?.()).then(config => {
      if (active) {
        setEnabled(config?.externalBaseNftsEnabled === true);
      }
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  return enabled;
}

function NftPreview({ item }) {
  const [loaded, setLoaded] = React.useState(null);
  const [failed, setFailed] = React.useState(null);
  const available = item.imageUrl && failed !== item.imageUrl;
  return <div className="wallet-nft-image">
    {(!available || loaded !== item.imageUrl) && <span>{available ? 'Loading preview…' : 'Preview unavailable'}</span>}
    {available && <img key={item.imageUrl} src={item.imageUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onLoad={() => setLoaded(item.imageUrl)} onError={() => setFailed(item.imageUrl)} />}
    <span className="wallet-asset-overlay" aria-label="Network: Base" title="Base">
      <span className="wallet-chain-chip" data-chain="base-mainnet">
        <img src="/brand/base.svg" alt="" loading="lazy" decoding="async" /><span>Base</span>
      </span>
    </span>
  </div>;
}

function NftDetails({ item, quote, onClose }) {
  const dialog = React.useRef(null);
  React.useEffect(() => {
    const element = dialog.current, trigger = document.activeElement;
    element.showModal();
    return () => { element.close(); if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
  }, []);
  const title = item.name || `Token ${item.tokenId}`;
  return createPortal(<dialog ref={dialog} className="wallet-nft-dialog" aria-labelledby="walletNftTitle"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="wallet-nft-dialog-heading"><div><p className="wallet-nfts-note">Base · {item.tokenType}</p><h2 id="walletNftTitle">{title}</h2></div>
      <button type="button" className="btn-secondary" onClick={onClose} autoFocus>Close</button></header>
    <div className="wallet-nft-detail-layout">
      <NftPreview item={item} />
      <div className="wallet-nft-detail-info">
        <p className="wallet-nft-collection">{item.collection || 'Unnamed collection'}</p>
        <div className="wallet-nft-value-panel">
          <dl><dt>Your purchase price</dt><dd>Not verified</dd><dt>Purchase venue</dt><dd>Not verified</dd></dl>
          <p className="wallet-nfts-note">This inventory confirms ownership, not a purchase. Transfers, gifts and collection floors are not a price paid by you.</p>
          <div className="wallet-nft-quote" role="status">
            <span>ETH / USD reference rate</span>
            <strong>{quote?.data ? `1 ETH ≈ ${new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(Number(quote.data.amount))}` : quote?.status === 'loading' ? 'Loading rate…' : 'Rate unavailable'}</strong>
            {quote?.data && <small>Coinbase · retrieved <time dateTime={quote.data.fetchedAt}>{new Date(quote.data.fetchedAt).toLocaleString()}</time></small>}
          </div>
          <p className="wallet-nfts-note">The token rate is not a valuation or offer for this NFT.</p>
        </div>
        <dl className="wallet-nft-identifiers"><dt>Network</dt><dd>Base mainnet</dd><dt>Token ID</dt><dd>{item.tokenId}</dd><dt>Contract</dt><dd>{item.contractAddress}</dd><dt>Quantity</dt><dd>{item.quantity}</dd></dl>
        {item.traits.length > 0 && <><h3>Traits</h3><dl className="wallet-nft-traits">{item.traits.map((trait, i) => <div key={i}><dt>{trait.name}</dt><dd>{trait.value}</dd></div>)}</dl></>}
        <a href={`https://basescan.org/token/${item.contractAddress}?a=${item.tokenId}`} target="_blank" rel="noopener noreferrer">View on Base explorer ↗</a>
      </div>
    </div>
  </dialog>, document.body);
}

export function WalletNfts({ wallet }) {
  const [config, setConfig] = React.useState(null);
  React.useEffect(() => {
    let active = true;
    Promise.resolve(window.ArtSoulPublicConfig?.load?.()).then(value => {
      if (active) setConfig(value || {});
    }).catch(() => { if (active) setConfig({}); });
    return () => { active = false; };
  }, []);
  if (!config?.externalBaseNftsEnabled) return null;
  return config.multichainWalletAssetsEnabled === true
    ? <MultiChainWalletAssets key={wallet} wallet={wallet} />
    : <BaseWalletNfts key={wallet} wallet={wallet} />;
}

function BaseWalletNfts({ wallet }) {
  const owner = String(wallet || '').toLowerCase();
  const enabled = useWalletNftsEnabled();
  const [state, setState] = React.useState(empty);
  const [selected, setSelected] = React.useState(null);
  const [quote, setQuote] = React.useState(null);
  const request = React.useRef(null);
  const quoteRequest = React.useRef(null);
  const generation = React.useRef(0);
  const live = React.useRef(false);
  const cursors = React.useRef([undefined]);
  const swipe = React.useRef(null);
  React.useEffect(() => {
    live.current = true;
    const clear = () => {
      generation.current++;
      request.current?.abort(); request.current = null;
      quoteRequest.current?.abort(); quoteRequest.current = null;
      cursors.current = [undefined];
      setSelected(null); setQuote(null);
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
      quoteRequest.current?.abort(); quoteRequest.current = null;
      contextEvents.forEach(name => window.removeEventListener(name, clear));
      window.removeEventListener('storage', storage);
    };
  }, [owner]);

  // Mounted only after the owner selects Wallet NFTs; no inventory read on other profile tabs.
  React.useEffect(() => { if (enabled) void load(); }, [enabled, owner]);

  async function load(cursor, index = 0) {
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
      if (index === 0) cursors.current = [undefined];
      cursors.current[index] = cursor;
      setSelected(null);
      setState({ status: 'ready', page, index, message: '' });
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
        void load();
      }
    } catch { if (live.current && owner === currentWallet()) setState({ ...empty(), status: 'auth' }); }
  }
  async function openDetails(item) {
    setSelected(item);
    if (quoteRequest.current || (quote?.until > Date.now())) return;
    const revision = generation.current;
    const controller = new AbortController(); quoteRequest.current = controller;
    const valid = () => live.current && generation.current === revision && currentWallet() === owner;
    const timeout = setTimeout(() => controller.abort(), 5000);
    setQuote({ status: 'loading' });
    try {
      const response = await fetch('/api/wallet-nfts?quote=eth-usd', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal, headers: { 'X-ArtSoul-Wallet': owner } });
      if (!valid()) return;
      if (response.status === 401) { setSelected(null); setState({ ...empty(), status: 'auth' }); return; }
      const payload = response.ok ? await response.json() : null;
      if (!valid()) return;
      const data = payload?.quote;
      const usable = data?.symbol === 'ETH' && data.currency === 'USD' && data.source === 'Coinbase' &&
        typeof data.amount === 'string' && /^\d{1,10}(?:\.\d{1,18})?$/.test(data.amount) && Number(data.amount) > 0 && Number.isFinite(Date.parse(data.fetchedAt));
      setQuote({ status: 'ready', data: usable ? data : null, until: Date.now() + (usable ? 5 * 60_000 : 60_000) });
    } catch { if (valid()) setQuote({ status: 'ready', data: null, until: Date.now() + 60_000 }); }
    finally { clearTimeout(timeout); if (quoteRequest.current === controller) quoteRequest.current = null; }
  }
  if (!enabled || owner !== currentWallet()) return null;
  const page = state.page;
  const busy = state.status === 'loading';
  const previous = () => { if (state.index > 0) void load(cursors.current[state.index - 1], state.index - 1); };
  const next = () => { if (page?.nextCursor) void load(page.nextCursor, state.index + 1); };
  return <section className="wallet-nfts" aria-label="Wallet NFTs" aria-busy={busy}>
    <div className="wallet-nfts-heading"><div><h3>Wallet NFTs</h3><p>NFTs you hold on Base mainnet.</p></div><span className="wallet-nfts-network">Base · Read only</span></div>
    <p className="wallet-nfts-note">Separate from ArtSoul listings. Your wallet stays on its selected network. Unsolicited NFTs may appear; collection names are not verification.</p>
    {state.status === 'auth' ? <p role="status">Sign in with this wallet to view its NFTs. <button type="button" className="btn-secondary" onClick={signIn}>Sign in</button></p> :
      <nav className="wallet-nfts-actions" aria-label="Wallet NFT pages">
        <button type="button" className="btn-secondary" disabled={busy || state.index === 0} onClick={previous}>← Previous</button>
        <span role="status">{busy ? 'Loading NFTs…' : page ? `Page ${state.index + 1}` : 'Wallet inventory'}</span>
        <button type="button" className="btn-secondary" disabled={busy || !page?.nextCursor} onClick={next}>Next →</button>
        {(state.index > 0 || state.status === 'error' || state.status === 'idle') && <button type="button" className="btn-secondary wallet-nfts-first" disabled={busy} onClick={() => void load()}>{state.status === 'error' ? 'Retry first page' : 'First page'}</button>}
      </nav>}
    {state.message && <p role="status">{state.message}</p>}
    {page && <>
      <p className="wallet-nfts-note">Indexed by Alchemy · {page.items.length} shown on this page{page.validAt ? ` · Base block ${page.validAt.blockNumber}` : ''}.
        {page.omittedCount > 0 && ' Some unsupported items were omitted.'}</p>
      {!page.items.length && <p>No supported NFTs on this page.{page.nextCursor ? ' You can check the next page.' : ''}</p>}
      <div className="wallet-nfts-grid" onTouchStart={event => { const p = event.touches[0]; swipe.current = event.touches.length === 1 && !event.target.closest('button,a') ? { x: p.clientX, y: p.clientY } : null; }}
        onTouchEnd={event => { const start = swipe.current; swipe.current = null; const end = event.changedTouches[0]; if (!start || !end || busy || event.touches.length) return; const dx = end.clientX - start.x, dy = end.clientY - start.y; if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 2) { if (dx < 0) next(); else previous(); } }} onTouchCancel={() => { swipe.current = null; }}>
        {page.items.map(item => <article key={item.id} className="wallet-nft-card">
          <NftPreview item={item} />
          <div className="wallet-nft-body">
            <h4 title={item.name || `Token ${item.tokenId}`}>{item.name || `Token ${item.tokenId}`}</h4>
            <p className="wallet-nft-collection" title={item.collection || ''}>{item.collection || 'Unnamed collection'}</p>
            <p className="wallet-nfts-note">{item.tokenType}{item.quantity !== '1' ? ` · Quantity ${item.quantity}` : ''}</p>
            <button type="button" className="btn-secondary" aria-label={`View details for ${item.name || `Token ${item.tokenId}`}`} onClick={() => void openDetails(item)}>View details ↗</button>
          </div>
        </article>)}
      </div>
    </>}
    {selected && <NftDetails item={selected} quote={quote} onClose={() => setSelected(null)} />}
  </section>;
}
