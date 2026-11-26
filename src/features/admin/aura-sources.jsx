import { React } from '../../entries/react-runtime.js';
import { canSearch, createSearchState } from '../search/search-state.js';

export function AuraSources({ api, wallet, isSessionCurrent }) {
    const [kind,setKind] = React.useState('platform');
    const [chain,setChain] = React.useState('84532');
    const [deployment,setDeployment] = React.useState('catalog');
    return <details className="identity-applications"><summary>Manage frame sources</summary>
        <label>Frame source <select value={kind} onChange={e => { setKind(e.target.value); setChain('84532'); }}>
            <option value="platform">Platform publisher wallet</option><option value="partner">Partner collection contract</option>
        </select></label>
        {kind === 'partner' && <label>Network <select value={chain} onChange={e=>setChain(e.target.value)}>
            <option value="84532">Base Sepolia</option><option value="8453">Base</option></select></label>}
        {kind === 'platform' && <label>Publishing contract <select value={deployment} onChange={e => setDeployment(e.target.value)}>
            <option value="catalog">Current website catalog</option><option value="rehearsal">New auction rehearsal</option></select></label>}
        <SourceEditor key={wallet + kind + chain + deployment} {...{kind,chain,deployment,api,wallet,isSessionCurrent}} />
    </details>;
}

function SourceEditor({kind,chain,deployment,api,wallet,isSessionCurrent}) {
    const [address,setAddress] = React.useState('');
    const [source,setSource] = React.useState(null);
    const [list,setList] = React.useState(null);
    const [reason,setReason] = React.useState('');
    const [message,setMessage] = React.useState('');
    const [busy,setBusy] = React.useState(false);
    const [matches,setMatches] = React.useState(null);
    const search = React.useMemo(() => createSearchState({onChange:setMatches}),[]);
    const sequence = React.useRef(0);
    React.useEffect(()=>()=>{sequence.current++; search.cancel();},[search]);
    const path = 'aura-sources?wallet='+encodeURIComponent(wallet.toLowerCase())+'&kind='+kind+'&chain='+chain+
        (kind === 'platform' ? '&deployment='+deployment : '');
    const label = kind === 'partner' ? 'Collection contract' : 'Publisher address or profile name';
    const validAddress = /^0x[\da-f]{40}$/i.test(address.trim());
    function edit(value) { sequence.current++; search.reset(); setAddress(value); setSource(null); setList(null); setReason(''); setMessage(''); setBusy(false); }
    async function load(target,after) {
        const request = ++sequence.current;
        search.reset(); setBusy(true); setSource(null); setReason(''); setMessage('');
        try {
            const data = await api(path + (target ? '&address='+encodeURIComponent(target.trim()) : after ? '&after='+encodeURIComponent(after) : ''));
            if (!isSessionCurrent() || sequence.current !== request) return;
            if (target) { setSource({...data.sources[0],scope:data.scope}); setAddress(data.sources[0].address); }
            else setList(data);
        } catch(error) { if (isSessionCurrent() && sequence.current === request) setMessage(error.message); }
        finally { if (isSessionCurrent() && sequence.current === request) setBusy(false); }
    }
    async function save() {
        if (!source || busy || !isSessionCurrent()) return;
        const request = ++sequence.current;
        setBusy(true);
        try {
            const data = await api(path+'&address='+encodeURIComponent(source.address),{ method:'POST',body:JSON.stringify({
                scope:source.scope,revision:source.revision,enabled:!source.enabled,reason:reason.trim()
            }) });
            if (isSessionCurrent() && sequence.current === request) {
                setSource({...data.sources[0],scope:data.scope}); setReason(''); setList(null);
                setMessage(data.sources[0].enabled ? 'Frame source enabled.' : 'Frame source disabled.');
            }
        } catch(error) { if (isSessionCurrent() && sequence.current === request) { setMessage(error.message); setSource(null); } }
        finally { if (isSessionCurrent() && sequence.current === request) setBusy(false); }
    }
    return <div>
        <p>{kind === 'platform' ? 'Base Sepolia. The original registration must name this publisher on the selected contract. Public frames appear when the catalog verifies the minted NFT.' :
            'Use the exact contract of the partner collection. A verified mint identifies each eligible token, including after a transfer.'}</p>
        <label>{label}<input value={address} placeholder={kind === 'platform' ? 'Name or 0x…' : '0x…'} maxLength={100} disabled={busy} onChange={e=>edit(e.target.value)} /></label>
        {kind === 'platform' && <button type="button" disabled={busy} onClick={()=>edit(wallet)}>Use my wallet</button>}
        {kind === 'platform' && canSearch(address) && !validAddress && !address.trim().startsWith('0x') ?
            <button type="button" disabled={busy || matches?.status === 'loading'} onClick={()=>search.search(address,'artists')}>Find profile</button> :
            <button type="button" disabled={busy || !validAddress} onClick={()=>load(address)}>Check address</button>}
        <button type="button" disabled={busy} onClick={()=>load(null)}>View sources</button>
        {matches?.status === 'loading' && <p role="status">Searching profiles…</p>}
        {matches?.status === 'error' && <p role="status">{matches.error}</p>}
        {matches?.status === 'ready' && <div>
            {matches.groups.artists.items.length ? <ul>{matches.groups.artists.items.map(profile =>
                <li key={profile.wallet_address}><button type="button" onClick={()=>{edit(profile.wallet_address);load(profile.wallet_address);}}>
                    {profile.username || 'Profile'} / {profile.wallet_address}
                </button></li>)}</ul> : <p>No matching public profiles.</p>}
            {matches.nextCursor && <button type="button" onClick={()=>search.search(address,'artists',true)}>More profiles</button>}
        </div>}
        {list && <div><ul>{list.sources.map(s=><li key={s.address}><button type="button" disabled={busy} onClick={()=>load(s.address)}>{s.address}</button> {s.enabled ? 'Enabled' : 'Disabled'}</li>)}</ul>
            {!list.sources.length && <p>No recorded sources on this page.</p>}
            {list.configuredPublisher && <button type="button" disabled={busy} onClick={()=>load(list.configuredPublisher)}>Check configured publisher</button>}
            {list.next && <button type="button" disabled={busy} onClick={()=>load(null,list.next)}>Next sources</button>}</div>}
        {source && <div><p>{source.enabled ? 'Enabled' : 'Disabled'} / {source.address}</p>
            {source.scope && <p>Issuing Core / {source.scope}</p>}
            <label>Reason for the change<textarea value={reason} disabled={busy} maxLength={500} onChange={e=>setReason(e.target.value)} /></label>
            <button type="button" disabled={busy || reason.trim().length < 5} onClick={save}>{source.enabled ? 'Disable frame source' : 'Enable frame source'}</button></div>}
        <p role="status">{busy ? 'Checking…' : message}</p>
    </div>;
}
