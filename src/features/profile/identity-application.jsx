import { React } from '../../entries/react-runtime.js';
import { VerificationMark } from '../../ui/components/verification-mark.jsx';

export function VerifiedCollections({ collections }) {
    if (!collections?.length) return null;
    return <details className="profile-connections identity-applications"><summary>Verified collections ({collections.length})</summary>
        <ul>{collections.map(c => <li key={c.chain_id + c.collection_address}>
            <VerificationMark label="Verified collection origin" /> {c.chain_id === 8453 ? 'Base' : 'Base Sepolia'} /{' '}
            <a href={'https://' + (c.chain_id === 8453 ? '' : 'sepolia.') + 'basescan.org/address/' + c.collection_address}
                target="_blank" rel="noopener noreferrer">{c.collection_address}</a>
        </li>)}</ul></details>;
}

export function IdentityApplication({ wallet, profile, connectedX }) {
    const [open,setOpen] = React.useState(false);
    const [kind,setKind] = React.useState('profile');
    const [chain,setChain] = React.useState(8453);
    const [contract,setContract] = React.useState('');
    const [profileLink,setProfileLink] = React.useState(null);
    const [collectionLink,setCollectionLink] = React.useState('');
    const [rows,setRows] = React.useState(null);
    const [message,setMessage] = React.useState('');
    const [busy,setBusy] = React.useState(false);
    const [reload,setReload] = React.useState(0);
    const isProfile = kind === 'profile';
    const linkedAccount = connectedX ? 'https://x.com/' + connectedX : '';
    const evidence = isProfile ? (profileLink ?? linkedAccount) : collectionLink;
    const name = profile?.username;
    const verified = isProfile ? profile?.profile_identity_verified === true : profile?.verified_collections?.some(
        row => Number(row.chain_id) === chain && row.collection_address === contract.trim().toLowerCase());
    const pending = rows?.some(row => row.status === 'pending' &&
        (isProfile ? !row.chain_id : Number(row.chain_id) === chain && row.collection_address === contract.trim().toLowerCase()));
    async function request(options) {
        const response = await fetch('/api/profile/verification',{ credentials:'same-origin', cache:'no-store', ...options,
            headers:{ 'X-ArtSoul-Wallet':wallet.toLowerCase(), ...(options.body ? {'Content-Type':'application/json'} : {}) } });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Verification is unavailable.');
        return data;
    }
    React.useEffect(() => {
        if (!open) return;
        const controller = new AbortController();
        request({signal:controller.signal}).then(data => {
            if (!controller.signal.aborted) setRows(data.applications);
        }).catch(error => { if (!controller.signal.aborted) setMessage(error.message); });
        return () => controller.abort();
    },[wallet,open,reload]);
    async function submit() {
        if (busy || pending || verified) return;
        setBusy(true);
        try {
            const data = await request({ method:'POST', body:JSON.stringify({ evidence:evidence.trim(),
                chain:kind === 'profile' ? null : chain, collection:kind === 'profile' ? null : contract.trim() }) });
            setMessage('Request #' + data.id + ' is awaiting review.');
            setReload(n => n+1);
        } catch (error) { setMessage(error.message); }
        finally { setBusy(false); }
    }
    return <details className="profile-connections identity-applications" onToggle={event => setOpen(event.currentTarget.open)}>
        <summary>Identity verification</summary>
        <label>Request a free blue check for <select value={kind} disabled={busy} onChange={e => {setKind(e.target.value); setMessage('');}}>
            <option value="profile">My profile</option><option value="collection">My NFT collection</option></select></label>
        {isProfile ? <p>Your application includes your saved ArtSoul profile and wallet.
            {connectedX ? ' Your connected X account is included below. You can use another official source.' :
                ' Link an official post or website that identifies you and this wallet.'}</p> :
            <p>Verify that you created this collection. Link a public announcement or project website that identifies its creator, network and contract.</p>}
        {kind === 'collection' && <><label>Network <select value={chain} onChange={e => setChain(Number(e.target.value))}>
            <option value={8453}>Base</option><option value={84532}>Base Sepolia</option></select></label>
            <label>Collection contract <input className="profile-detail-input" value={contract} onChange={e => setContract(e.target.value)} placeholder="0x…" /></label></>}
        <label>{isProfile ? 'Official account or website' : 'Official collection announcement or website'}
            <input className="profile-detail-input" type="url" maxLength={512} value={evidence}
            placeholder="https://" onChange={e => (isProfile ? setProfileLink : setCollectionLink)(e.target.value)} /></label>
        {name ? <p>Applying as {name}<br />{wallet}</p> : <p>Save a profile name before applying.</p>}
        <button type="button" className="btn-main" disabled={!name || busy || pending || verified || !evidence.trim() || (kind === 'collection' && !contract.trim())}
            onClick={submit}>{busy ? 'Submitting…' : pending ? 'Awaiting review' : verified ? 'Verified' : 'Request verification'}</button>
        <p role="status">{message}</p>
        {rows?.length > 0 && <ul aria-label="Your recent requests">{rows.map(row => <li key={row.id}>#{row.id} / {row.chain_id ?
            (row.chain_id === 8453 ? 'Base' : 'Base Sepolia') + ' / ' + row.collection_address : row.profile_name} / {row.status}{row.note && ' — ' + row.note}</li>)}</ul>}
    </details>;
}
