import { React } from '../../entries/react-runtime.js';
import { canSearch, createSearchState } from '../search/search-state.js';

const sourceKinds = {
    founder: ['Founder artist wallet', 'Personal works registered by this wallet receive the Founder frame.'],
    platform: ['Official ArtSoul publisher', 'Artist registrations must match both the publisher wallet and the selected publishing contract.'],
    official_collection: ['Official ArtSoul collection', 'The issuing wallet and collection contract must match on the selected network.'],
    partner: ['Partner collection', 'Choose the partner’s dedicated ERC-721 collection. Its frame follows each verified NFT when it changes hands.'],
    genesis: ['Genesis contract', 'A Genesis frame requires the designated Base mainnet contract and a verified grant for the individual token.']
};

const validAddress = value => /^0x[\da-f]{40}$/i.test(value.trim()) && !/^0x0{40}$/i.test(value.trim());

export function AuraSources({ api, wallet, isSessionCurrent }) {
    const [kind, setKind] = React.useState('founder');
    const [chain, setChain] = React.useState('84532');
    const [deployment, setDeployment] = React.useState('catalog');
    const [issuer, setIssuer] = React.useState('');
    const publisher = kind === 'platform' || kind === 'founder';
    const officialCollection = kind === 'official_collection';
    const genesis = kind === 'genesis';
    function changeKind(value) {
        setKind(value);
        setDeployment('catalog');
        setIssuer('');
        if (value === 'genesis') setChain('8453');
    }
    const query = new URLSearchParams({wallet: wallet.toLowerCase(), kind, chain});
    if (publisher) query.set('deployment', deployment);
    if (officialCollection) query.set('issuer', issuer.trim().toLowerCase());
    return <details className="identity-applications admin-frame-sources"><summary>Manage frame sources</summary>
        <label><span id="admin-frame-kind">Frame source</span><select aria-labelledby="admin-frame-kind" value={kind} onChange={event => changeKind(event.target.value)}>
            {Object.entries(sourceKinds).map(([value, [label]]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <p>{sourceKinds[kind][1]}</p>
        {genesis ? <p>Network / Base mainnet</p> : <label><span id="admin-frame-network">Network</span><select aria-labelledby="admin-frame-network" value={chain} onChange={event => {
            setChain(event.target.value); setDeployment('catalog'); setIssuer('');
        }}><option value="84532">Base Sepolia (testnet)</option><option value="8453">Base mainnet</option></select></label>}
        {publisher && <label><span id="admin-frame-deployment">Publishing contract</span><select aria-labelledby="admin-frame-deployment" value={deployment} onChange={event => setDeployment(event.target.value)}>
            <option value="catalog">{chain === '84532' ? 'Website catalog' : 'Mainnet publishing contract'}</option>
            {chain === '84532' && <option value="rehearsal">New auction rehearsal</option>}
        </select></label>}
        {officialCollection && <label>Original collection issuer wallet<input type="text" value={issuer} placeholder="0x…"
            autoCapitalize="none" spellCheck={false} maxLength={42} onChange={event => setIssuer(event.target.value)} /></label>}
        {(!officialCollection || validAddress(issuer)) && <SourceEditor key={query.toString()}
            path={'aura-sources?' + query.toString()} {...{kind, publisher, api, wallet, isSessionCurrent}} />}
    </details>;
}

function SourceEditor({kind, publisher, path, api, wallet, isSessionCurrent}) {
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
    const label = kind === 'founder' ? 'Artist wallet or profile name' : publisher ? 'Publisher wallet or profile name' : 'NFT collection contract';
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
    const canFind = publisher && canSearch(address) && !address.trim().toLowerCase().startsWith('0x');
    const canChange = source && (!genesis || source.enabled || source.address === source.configuredGenesis);
    return <div>
        {!genesis && <>
            <label>{label}<input value={address} placeholder={publisher ? 'Profile name or 0x…' : '0x…'} maxLength={publisher ? 100 : 42}
                autoCapitalize="none" spellCheck={false} disabled={busy} onChange={event => edit(event.target.value)} /></label>
            {publisher && <button type="button" disabled={busy} onClick={() => load(wallet)}>Use my wallet</button>}
            {canFind ? <button type="button" disabled={busy || matches?.status === 'loading'}
                onClick={() => search.search(address, 'artists')}>Find profile</button> :
                <button type="button" disabled={busy || !validAddress(address)} onClick={() => load(address)}>Check address</button>}
        </>}
        <button type="button" disabled={busy} onClick={() => load(null)}>{genesis ? 'Check Genesis deployment' : 'View sources'}</button>
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
                <p>The Base mainnet Genesis deployment has not been configured.</p>)}
            {list.sources.length ? <ul>{list.sources.map(item => <li key={item.address}>
                <button type="button" disabled={busy} onClick={() => load(item.address)}>{item.address}</button> {item.enabled ? 'Enabled' : 'Disabled'}
            </li>)}</ul> : !genesis && <p>No recorded sources on this page.</p>}
            {list.next && <button type="button" disabled={busy} onClick={() => load(null, list.next)}>Next sources</button>}
        </div>}
        {source && <div>
            <p><strong>{source.enabled ? 'Enabled' : 'Disabled'}</strong> / {source.address}</p>
            {source.scope && <p>{publisher ? 'Publishing contract' : 'Original issuer'} / {source.scope}</p>}
            {publisher && !source.enabled && <p>Enabling this source replaces any {kind === 'founder' ? 'official publisher' : 'Founder'} designation for this wallet on this publishing contract.</p>}
            {canChange && <><label>Reason for the change<textarea value={reason} disabled={busy} maxLength={500} onChange={event => setReason(event.target.value)} /></label>
                <button type="button" disabled={busy || reason.trim().length < 5} onClick={save}>{source.enabled ? 'Disable frame source' : 'Enable frame source'}</button></>}
        </div>}
        <p role="status">{operation || message}</p>
    </div>;
}
