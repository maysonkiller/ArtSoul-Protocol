import { React } from '../../entries/react-runtime.js';

export function IdentityReviews({ api, wallet, isSessionCurrent }) {
    const [status,setStatus] = React.useState('pending');
    const [after,setAfter] = React.useState('0');
    const [result,setResult] = React.useState(null);
    const [notes,setNotes] = React.useState({});
    const [busy,setBusy] = React.useState(false);
    const [message,setMessage] = React.useState('');
    const [reload,setReload] = React.useState(0);
    const path = 'identity-reviews?wallet=' + encodeURIComponent(wallet.toLowerCase());
    React.useEffect(() => {
        const controller = new AbortController();
        setResult(null); setNotes({});
        api(path + '&status=' + status + '&after=' + after,{signal:controller.signal}).then(data => {
            if (!controller.signal.aborted && isSessionCurrent()) setResult(data);
        }).catch(error => { if (!controller.signal.aborted && isSessionCurrent()) setMessage(error.message); });
        return () => controller.abort();
    },[path,api,status,after,reload]);
    async function decide(id,action) {
        if (busy || !isSessionCurrent()) return;
        setBusy(true);
        try {
            await api(path,{ method:'POST',body:JSON.stringify({id,action,note:notes[id]}) });
            if (isSessionCurrent()) { setResult(null); setMessage('Decision saved for request #' + id + '.'); setReload(n => n+1); }
        } catch (error) { if (isSessionCurrent()) { setMessage(error.message); if (error.status === 409) setReload(n => n+1); } }
        finally { if (isSessionCurrent()) setBusy(false); }
    }
    return <section className="protocol-admin-setup identity-applications"><h2>Identity reviews</h2>
        <p>Confirm that an independent official source identifies the applicant wallet. For a collection, also verify the network, contract and creator. Your decision note is visible to the applicant.</p>
        <label>Requests <select value={status} disabled={busy} onChange={e => {setStatus(e.target.value); setAfter('0'); setMessage('');}}>
            {['pending','approved','declined','revoked'].map(s => <option key={s} value={s}>{s[0].toUpperCase()+s.slice(1)}</option>)}</select></label>
        <button type="button" disabled={busy} onClick={() => { setMessage(''); setReload(n => n+1); }}>Refresh requests</button>
        <p role="status">{message || (!result ? 'Loading requests…' : '')}</p>
        {result?.applications.length === 0 && <p>No {status} requests on this page.</p>}
        {result?.applications.map(row => <article className="protocol-admin-report-text" key={row.id}>
            <h3>{row.profile_name} / {row.chain_id ? 'Collection origin' : 'Profile identity'} / #{row.id}</h3>
            <p>Applicant <a href={'/profile?address=' + row.wallet}>{row.wallet}</a></p>
            {row.chain_id && <p>{row.chain_id === 8453 ? 'Base' : 'Base Sepolia'} / {row.collection_address}</p>}
            <p>Evidence supplied by applicant / <a href={row.evidence} target="_blank" rel="noreferrer noopener nofollow">{row.evidence}</a></p>
            {row.wallet === wallet.toLowerCase() ? <p>Another authorized reviewer must decide this request.</p> :
                ['pending','approved'].includes(status) && <><label>Decision note <textarea value={notes[row.id] || ''} maxLength={500}
                    onChange={e => setNotes({...notes,[row.id]:e.target.value})}/></label>
                    {(status === 'pending' ? ['approve','decline'] : ['revoke']).map(action => <button key={action} type="button"
                        disabled={busy || (notes[row.id] || '').trim().length < 5} onClick={() => decide(row.id,action)}>
                        {action[0].toUpperCase()+action.slice(1)}</button>)}</>}
        </article>)}
        {result?.next && <button type="button" disabled={busy} onClick={() => setAfter(result.next)}>Next requests</button>}
        {after !== '0' && <button type="button" disabled={busy} onClick={() => setAfter('0')}>First page</button>}
    </section>;
}
