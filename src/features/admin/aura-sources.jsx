import { React } from '../../entries/react-runtime.js';
import { canSearch, createSearchState } from '../search/search-state.js';

const sources = {
    'ArtSoul Founder': [['artist_founder','Artist wallet'],['founder','Earlier publishing contract designation']],
    'ArtSoul Partner': [['artist_partner','Artist wallet'],['partner','NFT collection']],
    'ArtSoul Genesis': [['artist_genesis','Artist wallet'],['genesis','Genesis NFT contract']],
    'Official ArtSoul': [['platform','Publishing wallet'],['official_collection','NFT collection']]
};
const instructions = {
    artist_founder: 'Give the Founder frame to verified works created by this wallet.',
    artist_partner: 'Give the Partner frame to verified works created by this wallet.',
    artist_genesis: 'Give this artist the Genesis frame for their works. This visual designation grants no Genesis token, holder status or benefits.',
    founder: 'Review an earlier Founder designation recorded for a specific publishing contract.',
    platform: 'The official mark applies to verified ArtSoul publications from this wallet on the selected publishing contract.',
    official_collection: 'Enter the collection contract. ArtSoul reads its original issuer and verifies its deployed code.',
    partner: 'Approve a dedicated Partner collection. The frame follows each verified NFT when it changes hands.',
    genesis: 'A finalized grant from the dedicated Base mainnet contract identifies each Genesis NFT. The reviewed deployment appears here after launch.'
};

const validAddress = value => /^0x[\da-f]{40}$/i.test(value.trim()) && !/^0x0{40}$/i.test(value.trim());

export function AuraSources({ api, wallet, isSessionCurrent }) {
    const [frame, setFrame] = React.useState('ArtSoul Founder');
    const [kind, setKind] = React.useState('artist_founder');
    const [chain, setChain] = React.useState('84532');
    const [deployment, setDeployment] = React.useState('catalog');
    const publisher = kind === 'platform' || kind === 'founder';
    const walletSource = publisher || kind.startsWith('artist_');
    const genesis = kind === 'genesis';
    function changeKind(value) {
        setKind(value);
        setDeployment('catalog');
        if (value === 'genesis') setChain('8453');
    }
    const query = new URLSearchParams({wallet: wallet.toLowerCase(), kind, chain});
    if (publisher) query.set('deployment', deployment);
    return <section className="identity-applications admin-frame-sources" aria-labelledby="admin-frame-sources-title">
        <h3 id="admin-frame-sources-title">Manage frame sources</h3>
        <label><span id="admin-frame-selection">Frame</span><select aria-labelledby="admin-frame-selection" value={frame} onChange={event => {
            const selection = event.target.value;
            setFrame(selection); changeKind(sources[selection][0][0]);
        }}>{Object.keys(sources).map(label => <option key={label}>{label}</option>)}</select></label>
        <label><span id="admin-frame-kind">Apply to</span><select aria-labelledby="admin-frame-kind" value={kind} onChange={event => changeKind(event.target.value)}>
            {sources[frame].map(([value,label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <p>{instructions[kind]}</p>
        {genesis ? <p>Network / Base mainnet</p> : <label><span id="admin-frame-network">Network</span><select aria-labelledby="admin-frame-network" value={chain} onChange={event => {
            setChain(event.target.value); setDeployment('catalog');
        }}><option value="84532">Base Sepolia (testnet)</option><option value="8453">Base mainnet</option></select></label>}
        {publisher && <label><span id="admin-frame-deployment">Publishing contract</span><select aria-labelledby="admin-frame-deployment" value={deployment} onChange={event => setDeployment(event.target.value)}>
            <option value="catalog">{chain === '84532' ? 'Website catalog' : 'Mainnet publishing contract'}</option>
            {chain === '84532' && <option value="rehearsal">New auction rehearsal</option>}
        </select></label>}
        <SourceEditor key={query.toString()} path={'aura-sources?' + query.toString()} {...{kind, publisher, walletSource, api, wallet, isSessionCurrent}} />
    </section>;
}

function SourceEditor({kind, publisher, walletSource, path, api, wallet, isSessionCurrent}) {
    const [address, setAddress] = React.useState('');
    const [source, setSource] = React.useState(null);
    const [list, setList] = React.useState(null);
    const [reason, setReason] = React.useState('');
    const [message, setMessage] = React.useState('');
    const [operation, setOperation] = React.useState('');
    const [matches, setMatches] = React.useState(null);
    const search = React.useMemo(() => createSearchState({onChange: setMatches}), []);
    const sequence = React.useRef(0);
    React.useEffect(() => () => { sequence.current++; search.cancel(); }, [search]);
    const current = request => isSessionCurrent() && sequence.current === request;
    const genesis = kind === 'genesis';
    const label = kind === 'platform' ? 'Publisher wallet or profile name' : walletSource ? 'Artist wallet or profile name' : 'NFT collection contract';
    const busy = Boolean(operation);
    function edit(value) {
        sequence.current++; search.reset(); setAddress(value); setSource(null); setList(null); setReason(''); setMessage('');
    }
    async function load(target, after) {
        if (!isSessionCurrent()) return;
        const request = ++sequence.current;
        search.reset(); setOperation('Loading source…'); setSource(null); setList(null); setReason(''); setMessage('');
        if (target) setAddress(target.trim());
        try {
            const suffix = target ? '&address=' + encodeURIComponent(target.trim()) : after ? '&after=' + encodeURIComponent(after) : '';
            const data = await api(path + suffix);
            if (!current(request)) return;
            if (target) {
                const entry = data.sources[0];
                if (entry?.address !== target.trim().toLowerCase()) throw Error('Could not verify this source address.');
                setSource({...entry, scope: data.scope, configuredGenesis: data.configuredGenesis});
                setAddress(entry.address);
            } else setList(data);
        } catch (error) {
            if (current(request)) setMessage(error.message || 'Could not load frame sources.');
        } finally {
            if (current(request)) setOperation('');
        }
    }
    async function save() {
        if (!source || busy || reason.trim().length < 5 || !isSessionCurrent()) return;
        if (genesis && !source.enabled && source.configuredGenesis !== source.address) return;
        const request = ++sequence.current;
        setOperation('Saving source…'); setMessage('');
        try {
            const data = await api(path + '&address=' + encodeURIComponent(source.address), { method: 'POST', body: JSON.stringify({
                scope: source.scope, revision: source.revision, enabled: !source.enabled, reason: reason.trim()
            }) });
            if (!current(request)) return;
            const saved = data.sources[0];
            if (saved?.address !== source.address || saved.enabled !== !source.enabled || saved.revision !== source.revision + 1 || data.scope !== source.scope) {
                throw Error('Check the source again to verify its current status.');
            }
            setSource({...saved, scope: data.scope, configuredGenesis: data.configuredGenesis}); setReason(''); setList(null);
            setMessage(saved.enabled ? 'Frame source enabled.' : 'Frame source disabled.');
        } catch (error) {
            if (current(request)) { setMessage(error.message || 'Could not save this frame source.'); setSource(null); }
        } finally {
            if (current(request)) setOperation('');
        }
    }
    const canFind = walletSource && canSearch(address) && !address.trim().toLowerCase().startsWith('0x');
    const canChange = source && (!genesis || source.enabled || source.address === source.configuredGenesis);
    return <div>
        {!genesis && <>
            <label>{label}<input value={address} placeholder={walletSource ? 'Profile name or 0x…' : '0x…'} maxLength={walletSource ? 100 : 42}
                autoCapitalize="none" spellCheck={false} disabled={busy} onChange={event => edit(event.target.value)} /></label>
            {walletSource && <button type="button" disabled={busy} onClick={() => load(wallet)}>Use my wallet</button>}
            {canFind ? <button type="button" disabled={busy || matches?.status === 'loading'}
                onClick={() => search.search(address, 'artists')}>Find profile</button> :
                <button type="button" disabled={busy || !validAddress(address)} onClick={() => load(address)}>Check address</button>}
        </>}
        <button type="button" disabled={busy} onClick={() => load(null)}>{genesis ? 'View Genesis deployment' : 'View sources'}</button>
        {matches?.status === 'loading' && <p role="status">Searching profiles…</p>}
        {matches?.status === 'error' && <p role="status">{matches.error}</p>}
        {matches?.status === 'ready' && <div>
            {matches.groups.artists.items.length ? <ul>{matches.groups.artists.items.map(profile =>
                <li key={profile.wallet_address}><button type="button" disabled={busy} onClick={() => load(profile.wallet_address)}>
                    {profile.username || 'Profile'} / {profile.wallet_address}
                </button></li>)}</ul> : <p>No matching public profiles.</p>}
            {matches.nextCursor && <button type="button" onClick={() => search.search(address, 'artists', true)}>More profiles</button>}
        </div>}
        {list && <div>
            {genesis && (list.configuredGenesis ?
                <p>Designated Genesis contract <button type="button" disabled={busy} onClick={() => load(list.configuredGenesis)}>{list.configuredGenesis}</button></p> :
                <p>The Genesis NFT contract has not been configured on Base mainnet. After deployment, configure the reviewed contract, its code hash, Safe and founder wallet and index the confirmed grants.</p>)}
            {list.sources.length ? <ul>{list.sources.map(item => <li key={item.address}>
                <button type="button" disabled={busy} onClick={() => load(item.address)}>{item.address}</button> {item.enabled ? 'Enabled' : 'Disabled'}
            </li>)}</ul> : !genesis && <p>No recorded sources on this page.</p>}
            {list.next && <button type="button" disabled={busy} onClick={() => load(null, list.next)}>Next sources</button>}
        </div>}
        {source && <div>
            <p><strong>{source.enabled ? 'Enabled' : 'Disabled'}</strong> / {source.address}</p>
            {source.active_frame && !source.enabled && <p>Saving replaces this wallet’s current {source.active_frame} artist frame.</p>}
            {source.scope && <p>{publisher ? 'Publishing contract' : 'Original issuer'} / {source.scope}</p>}
            {publisher && !source.enabled && <p>Enabling this source replaces any {kind === 'founder' ? 'official publisher' : 'Founder'} designation for this wallet on this publishing contract.</p>}
            {canChange && <><label>Reason for the change<textarea value={reason} disabled={busy} maxLength={500} onChange={event => setReason(event.target.value)} /></label>
                <button type="button" disabled={busy || reason.trim().length < 5} onClick={save}>{source.enabled ? 'Disable frame source' : 'Enable frame source'}</button></>}
        </div>}
        <p role="status">{operation || message}</p>
    </div>;
}
