import { React } from '../../entries/react-runtime.js';

export function AuraSources({ api, wallet, isSessionCurrent }) {
    const [kind,setKind] = React.useState('platform');
    const [chain,setChain] = React.useState('84532');
    return <details className="identity-applications"><summary>Manage frame sources</summary>
        <label>Frame source <select value={kind} onChange={e => { setKind(e.target.value); setChain('84532'); }}>
            <option value="platform">Platform publisher wallet</option><option value="partner">Partner collection contract</option>
        </select></label>
        {kind === 'partner' && <label>Network <select value={chain} onChange={e=>setChain(e.target.value)}>
            <option value="84532">Base Sepolia</option><option value="8453">Base</option></select></label>}
        <SourceEditor key={wallet + kind + chain} {...{kind,chain,api,wallet,isSessionCurrent}} />
    </details>;
}

function SourceEditor({kind,chain,api,wallet,isSessionCurrent}) {
    const [address,setAddress] = React.useState('');
    const [source,setSource] = React.useState(null);
    const [list,setList] = React.useState(null);
    const [reason,setReason] = React.useState('');
    const [message,setMessage] = React.useState('');
    const [busy,setBusy] = React.useState(false);
    const sequence = React.useRef(0);
    React.useEffect(()=>()=>{sequence.current++;},[]);
    const path = 'aura-sources?wallet='+encodeURIComponent(wallet.toLowerCase())+'&kind='+kind+'&chain='+chain;
    const label = kind === 'partner' ? 'Collection contract' : 'Publisher wallet';
    function edit(value) { sequence.current++; setAddress(value); setSource(null); setReason(''); setMessage(''); setBusy(false); }
    async function load(target,after) {
        const request = ++sequence.current;
        setBusy(true); setSource(null); setMessage('');
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
        <p>{kind === 'platform' ? 'Base Sepolia. The original registration must name this publisher on the active Core. Buying or receiving an NFT does not make the owner a publisher.' :
            'Use the exact contract of the partner collection. A verified mint identifies each eligible token, including after a transfer.'}</p>
        <label>{label}<input value={address} placeholder="0x…" disabled={busy} onChange={e=>edit(e.target.value)} /></label>
        {kind === 'platform' && <button type="button" disabled={busy} onClick={()=>edit(wallet)}>Use my wallet</button>}
        <button type="button" disabled={busy || !/^0x[\da-f]{40}$/i.test(address.trim())} onClick={()=>load(address)}>Check address</button>
        <button type="button" disabled={busy} onClick={()=>load(null)}>View sources</button>
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
