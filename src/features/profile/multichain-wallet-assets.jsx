import { React } from '../../entries/react-runtime.js';

// B36: Wallet presentation only. No background reads, transfers or listings.
const OPTIONS = [
  ['base-mainnet', 'Base', 'B'], ['eth-mainnet', 'Ethereum', 'Ξ'],
  ['arb-mainnet', 'Arbitrum', 'A'], ['opt-mainnet', 'Optimism', 'OP'],
  ['matic-mainnet', 'Polygon', 'P'], ['linea-mainnet', 'Linea', 'L'],
  ['bnb-mainnet', 'BNB Chain', 'BNB'], ['avax-mainnet', 'Avalanche', 'AVAX']
];
const five = OPTIONS.slice(0, 5).map(n => n[0]);
const current = () => String(window.getCurrentWalletAddress?.() || window.currentWalletAddress || '').toLowerCase();
const empty = () => ({ status: 'idle', page: null, message: '' });
const events = ['artsoul:wallet-state-changed', 'artsoul:wallet-state-settled', 'artsoul:auth-state-changed', 'pagehide'];
const networkName = slug => OPTIONS.find(row => row[0] === slug)?.[1] || 'Unknown network';
const BRAND_ICONS = Object.freeze({
  'base-mainnet': '/brand/base.svg',
  'eth-mainnet': '/brand/eth.png',
  'arb-mainnet': '/brand/wallet-networks/arbitrum-one.svg',
  'opt-mainnet': '/brand/wallet-networks/optimism.svg',
  'matic-mainnet': '/brand/wallet-networks/polygon.svg',
  'linea-mainnet': '/brand/wallet-networks/linea.svg',
  'bnb-mainnet': '/brand/wallet-networks/binance-smart-chain.svg',
  'avax-mainnet': '/brand/wallet-networks/avalanche.svg'
});

function NetworkBadge({ network }) {
  const info = OPTIONS.find(row => row[0] === network);
  if (!info) return null;
  return <span className="wallet-chain-chip" data-chain={network}>
    {BRAND_ICONS[network] ? <img src={BRAND_ICONS[network]} alt="" /> :
      <span className="wallet-chain-glyph" aria-hidden="true">{info[2]}</span>}
    <span>{info[1]}</span>
  </span>;
}
function NftCard({ item }) {
  return <article className="wallet-asset-card">
    <div className="wallet-asset-art">
      <span className="wallet-asset-placeholder" aria-hidden="true">NFT</span>
      {item.imageUrl && <img src={item.imageUrl} alt="" loading="lazy" decoding="async"
        referrerPolicy="no-referrer" onError={e => { e.currentTarget.hidden = true; }}/>}
      <div className="wallet-asset-overlay"><NetworkBadge network={item.network}/></div>
    </div>
    <div className="wallet-asset-copy">
      <h4 title={item.name || item.tokenId}>{item.name || ('NFT #' + item.tokenId)}</h4>
      <p className="wallet-asset-collection">{item.collection || 'Unnamed collection'}</p>
      <p className="wallet-asset-brief">{item.tokenType}{item.quantity !== '1' ? ' · ×' + item.quantity : ''}</p>
      <details className="wallet-asset-details"><summary>NFT details</summary>
        {item.description && <p className="wallet-asset-description">{item.description}</p>}
        <dl><dt>Network</dt><dd>{item.networkName}</dd><dt>Contract</dt><dd><code>{item.contractAddress}</code></dd>
          <dt>Token ID</dt><dd><code>{item.tokenId}</code></dd><dt>Type</dt><dd>{item.tokenType}</dd>
          {(item.traits || []).map((trait,i) => <React.Fragment key={trait.name + i}>
            <dt>{trait.name}</dt><dd>{trait.value}</dd></React.Fragment>)}</dl>
        <div className="wallet-asset-links">
          {item.explorerUrl && <a href={item.explorerUrl} target="_blank" rel="noopener noreferrer">Explorer ↗</a>}
          {item.openseaUrl && <a href={item.openseaUrl} target="_blank" rel="noopener noreferrer">View on OpenSea ↗</a>}
        </div>
        <p className="wallet-assets-disclaimer">External site only. ArtSoul has not verified a listing or sale price.</p>
      </details>
    </div>
  </article>;
}
function TokenCard({ item }) {
  return <article className="wallet-token-card"><NetworkBadge network={item.network}/>
    <div className="wallet-token-top">
      <span className="wallet-token-symbol">{item.symbol.slice(0,3).toUpperCase()}</span>
      <div><h4>{item.name}</h4><p>{item.symbol}</p></div>
    </div>
    <p className="wallet-token-balance">{item.balance === null ? 'Units unavailable' : item.balance}
      {item.balance !== null && <span> {item.symbol}</span>}</p>
    {item.priceUsd && <p className="wallet-assets-note">Reference price: {'$'}{item.priceUsd} per token</p>}
    <details className="wallet-asset-details"><summary>Token details</summary>
      <dl><dt>Network</dt><dd>{item.networkName}</dd><dt>Contract</dt>
        <dd><code>{item.contractAddress || 'Native token'}</code></dd>
        {item.balanceRaw !== null && <><dt>Exact raw balance (decimals not verified)</dt>
          <dd><code>{item.balanceRaw}</code></dd></>}</dl>
      {item.explorerUrl && <a href={item.explorerUrl} target="_blank" rel="noopener noreferrer">Explorer ↗</a>}
    </details>
  </article>;
}
export function MultiChainWalletAssets({ wallet }) {
  const owner = String(wallet || '').toLowerCase();
  const [view, setView] = React.useState('nfts');
  const [network, setNetwork] = React.useState('base-mainnet');
  const [state, setState] = React.useState(empty);
  const pending = React.useRef(null), revision = React.useRef(0), mounted = React.useRef(false);
  const reset = () => { revision.current++; pending.current?.abort(); pending.current = null; setState(empty()); };
  React.useEffect(() => {
    mounted.current = true;
    const changed = () => reset();
    const storage = e => { if (!e.key || e.key === 'artsoul_authenticated_wallet') changed(); };
    events.forEach(name => window.addEventListener(name, changed));
    window.addEventListener('storage', storage);
    return () => {
      mounted.current = false; revision.current++; pending.current?.abort(); pending.current = null;
      events.forEach(name => window.removeEventListener(name, changed));
      window.removeEventListener('storage', storage);
    };
  }, [owner]);
  const chooseView = value => { if (value !== view) { reset(); setView(value); } };
  const chooseNetwork = value => { if (value !== network && (value === 'all' || OPTIONS.some(n => n[0] === value))) { reset(); setNetwork(value); } };
  async function load(cursor) {
    if (!mounted.current || pending.current || current() !== owner) return;
    const original = revision.current, controller = new AbortController();
    pending.current = controller;
    const valid = () => mounted.current && original === revision.current && current() === owner;
    const timer = setTimeout(() => controller.abort(), 12000);
    setState(s => ({ ...s, status: 'loading', message: '' }));
    try {
      const query = new URLSearchParams({ view: view === 'nfts' ? 'multichain-nfts' : 'multichain-tokens',
        network, ...(cursor ? { cursor } : {}) });
      const response = await fetch('/api/wallet-nfts?' + query, { credentials: 'same-origin', cache: 'no-store',
        signal: controller.signal, headers: { 'X-ArtSoul-Wallet': owner } });
      if (!valid()) return;
      if (response.status === 401) { setState({ ...empty(), status: 'auth' }); return; }
      if (!response.ok) {
        const seconds = Number(response.headers.get('retry-after'));
        setState(s => ({ ...s, status: 'error', message: response.status === 429
          ? 'Read budget reached. Try later' + (Number.isFinite(seconds) && seconds > 0 ? ' (after ' + seconds + 's).' : '.')
          : 'Portfolio temporarily unavailable. Previous page preserved.' }));
        return;
      }
      const data = await response.json();
      const allowed = network === 'all' ? five : [network];
      if (!valid()) return;
      if (data.wallet !== owner || data.view !== view || data.selectedNetwork !== network ||
          !Array.isArray(data.items) || data.items.length > (view === 'nfts' ? 12 : 100) ||
          data.items.some(item => !allowed.includes(item.network)) || !Array.isArray(data.partialNetworks))
        throw new Error('Unexpected portfolio data');
      setState({ status: 'ready', page: data, message: '' });
    } catch {
      if (valid()) setState(s => ({ ...s, status: 'error', message: 'Unable to load this page. Previous data preserved.' }));
    } finally { clearTimeout(timer); if (pending.current === controller) pending.current = null; }
  }
  async function signIn() {
    try { if (await window.ensureAuthenticated?.() && current() === owner && mounted.current) reset(); }
    catch { if (mounted.current) setState(s => ({ ...s, status: 'auth' })); }
  }
  if (owner !== current()) return null;
  const page = state.page, loading = state.status === 'loading';
  return <section className="wallet-nfts wallet-multichain" aria-label="Multichain wallet collection" aria-busy={loading}>
    <header className="wallet-multichain-heading">
      <div><p className="wallet-multichain-kicker">YOUR WALLET · READ ONLY</p>
        <h3>Onchain collection</h3>
        <p className="wallet-assets-note">One place for NFTs and tokens. Viewing never switches your wallet network.</p></div>
      <div className="wallet-asset-tabs" role="group" aria-label="Choose asset type">
        <button type="button" aria-pressed={view === 'nfts'} onClick={() => chooseView('nfts')}>NFTs</button>
        <button type="button" aria-pressed={view === 'tokens'} onClick={() => chooseView('tokens')}>Tokens</button>
      </div>
    </header>
    <div className="wallet-asset-toolbar">
      <label htmlFor="wallet-asset-network">Network</label>
      <select id="wallet-asset-network" value={network} onChange={e => chooseNetwork(e.target.value)}>
        <option value="all">All major networks (5)</option>
        {OPTIONS.map(item => <option key={item[0]} value={item[0]}>{item[1]}</option>)}
      </select>
      <button className="btn-main" type="button" onClick={() => void load()} disabled={loading}>
        {loading ? 'Loading…' : page ? 'Reload' : 'Load assets'}</button>
      {page?.nextCursor && <button className="btn-secondary" type="button" onClick={() => void load(page.nextCursor)}
        disabled={loading}>Next page</button>}
    </div>
    <div className="wallet-asset-quick-networks" role="group" aria-label="Popular network filters">
      {OPTIONS.slice(0, 5).map(option => <button key={option[0]} type="button"
        aria-pressed={network === option[0]} onClick={() => chooseNetwork(option[0])}>
        <NetworkBadge network={option[0]}/></button>)}
      <button type="button" aria-pressed={network === 'all'} onClick={() => chooseNetwork('all')}>All 5</button>
    </div>
    <p className="wallet-assets-note">Only requested pages are loaded; more networks consume more free provider quota.
      Unsolicited NFTs and missing images are possible. No NFT is offered for sale here.</p>
    {state.status === 'auth' && <p role="status">Sign in with this wallet.
      <button type="button" className="btn-secondary" onClick={() => void signIn()}>Sign in</button></p>}
    {state.message && <p role="status" className="wallet-asset-error">{state.message}</p>}
    {page && <>
      <p className="wallet-assets-note">{page.items.length} displayed · indexed by Alchemy · fetched {new Date(page.fetchedAt).toLocaleString()}
        {page.omittedCount > 0 ? ' · ' + page.omittedCount + ' unsupported items omitted' : ''}</p>
      {page.partialNetworks.length > 0 && <p role="status" className="wallet-asset-warning">
        Some networks did not respond: {page.partialNetworks.map(networkName).join(', ')}.
        Successful NFTs remain visible; you can select the affected network separately.</p>}
      {!page.items.length && <p className="wallet-assets-empty">No supported assets on this page.
        {page.partialNetworks.length > 0 ? ' Some networks were unavailable.' : ''}</p>}
      <div className="wallet-asset-grid">{page.items.map(item => view === 'nfts'
        ? <NftCard key={item.id} item={item} /> : <TokenCard key={item.id} item={item}/>)}</div>
    </>}
  </section>;
}
