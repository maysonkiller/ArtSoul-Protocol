import { React } from '../../entries/react-runtime.js';
import '../../ui/components/artwork-player.js';
import './workspace.css';
const { useEffect, useRef, useState } = React;

export function AdminArtworkPreview({ artwork }) {
    const [failed, setFailed] = useState(false);
    const [started, setStarted] = useState(false);
    const source = artwork?.media_type === 'image' || artwork?.media_type === 'gif'
        ? artwork.media_url : artwork?.poster_url;
    useEffect(() => { setFailed(false); setStarted(false); }, [source, artwork?.media_url]);
    return <div className="protocol-admin-artwork-preview admin-review-media" data-kind={artwork?.media_type}>
        {artwork?.media_type === 'video' && artwork.media_url
            ? <artsoul-media-player key={'video-' + artwork.media_url}>
                <video src={artwork.media_url} poster={source || undefined} playsInline preload="none" onPlay={() => setStarted(true)} aria-label={artwork.title || 'Video artwork'} />
                {!started && !source && <span className="admin-video-hint" aria-hidden="true">▶</span>}
            </artsoul-media-player>
            : artwork?.media_type === 'audio' && artwork.media_url
            ? <artsoul-media-player key={'audio-' + artwork.media_url}>
                <img className="admin-audio-cover" src={source && !failed ? source : '/brand/artsoul-audio-cover-384.webp'} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
                <audio crossOrigin={window.ArtSoulStorageImage?.isValidStorageUrl(artwork.media_url) ? 'anonymous' : undefined}
                    src={artwork.media_url} preload="none" aria-label={artwork.title || 'Audio artwork'} />
            </artsoul-media-player>
            : source && !failed
            ? <img src={source} alt={artwork?.title || 'Artwork preview'} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
            : <span>{artwork?.media_type === 'audio' ? 'Audio artwork' : artwork?.media_type === 'video' ? 'Video artwork' : 'Preview unavailable'}</span>}
    </div>;
}

function VisibilityDialog({ artwork, busy, onClose, onSubmit }) {
    const dialog = useRef(null), reasonInput = useRef(null);
    const [reason, setReason] = useState('');
    useEffect(() => {
        const previous = document.activeElement;
        dialog.current?.showModal(); reasonInput.current?.focus();
        return () => previous?.isConnected && previous.focus?.();
    }, []);
    return <dialog ref={dialog} className="protocol-admin-dialog" aria-labelledby="visibilityDecisionTitle"
        onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
        <form method="dialog" onSubmit={event => {event.preventDefault(); onSubmit(reason);}}>
            <h2 id="visibilityDecisionTitle">{artwork.hidden ? 'Restore artwork' : 'Hide artwork'}</h2>
            <p>{artwork.title} / Artwork {artwork.artwork_id}</p>
            <p>{artwork.hidden ? 'Restore public visibility only after all active artwork reports have been resolved.' : 'This removes the work from public discovery. Ownership and contract records remain unchanged.'}</p>
            <label htmlFor="visibilityDecisionReason">Review reason</label>
            <textarea id="visibilityDecisionReason" ref={reasonInput} value={reason} onChange={event => setReason(event.target.value)} required maxLength="500" />
            <div className="protocol-admin-dialog-actions">
                <button type="button" className="protocol-admin-secondary" disabled={busy} onClick={onClose}>Cancel</button>
                <button type="submit" className="protocol-admin-primary" disabled={busy || !reason.trim()}>{busy ? 'Recording...' : 'Confirm decision'}</button>
            </div>
        </form>
    </dialog>;
}

export function AdminArtworkCatalog({ api, isSessionCurrent, onAccessError, onReview, onChanged }) {
    const [page, setPage] = useState({artworks:[],next:null});
    const [cursor, setCursor] = useState(null), [history,setHistory] = useState([]);
    const [busy,setBusy] = useState(false), [loaded,setLoaded] = useState(false);
    const [message,setMessage] = useState(''), [decision,setDecision] = useState(null);
    const request = useRef(0), mounted = useRef(true), cursorRef = useRef(null);
    const isCurrent = token => mounted.current && token === request.current && isSessionCurrent();
    const fail = error => {
        if (error.status === 401 || error.status === 403) onAccessError(error);
        else setMessage(error.message || 'The artwork catalog could not be loaded.');
    };
    const load = async before => {
        if (!isSessionCurrent()) return;
        const token = ++request.current;
        setBusy(true); setMessage('');
        try {
            const result = await api(`artwork-catalog${before ? `?before=${encodeURIComponent(before)}` : ''}`);
            if (!isCurrent(token)) return false;
            setPage(result.data); setLoaded(true); setCursor(before); cursorRef.current=before;
            return true;
        } catch(error) { if (isCurrent(token)) fail(error); }
        finally { if (isCurrent(token)) setBusy(false); }
    };
    useEffect(() => {
        mounted.current=true; void load(null);
        return () => {mounted.current=false;request.current++;};
    }, []);
    const submit = async reason => {
        if (!decision || !isSessionCurrent()) return;
        const token=++request.current, target=decision;
        setBusy(true); setMessage('');
        try {
            await api('artwork-visibility',{method:'POST',body:JSON.stringify({
                chain_id:target.chain_id, artwork_id:target.artwork_id, hidden:!target.hidden,
                expected_updated_at:target.visibility_updated_at, reason
            })});
            if (!isCurrent(token)) return;
            setDecision(null);
            const refreshed = await load(cursorRef.current);
            if (!mounted.current || !isSessionCurrent()) return;
            onChanged();
            if (!refreshed) { setPage({artworks:[],next:null}); setLoaded(false); }
            setMessage(refreshed ? 'Visibility decision recorded.'
                : 'Decision recorded. Refresh artworks before making another decision.');
        } catch(error) {
            if (!isCurrent(token)) return;
            if (error.status === 409) {
                setDecision(null); await load(cursorRef.current);
                if (mounted.current && isSessionCurrent()) setMessage(error.message);
            } else fail(error);
        } finally { if (mounted.current && isSessionCurrent()) setBusy(false); }
    };
    return <section aria-labelledby="adminArtworkCatalogTitle" className="protocol-admin-catalog">
        <div className="protocol-admin-section-heading">
            <h2 id="adminArtworkCatalogTitle">Artworks</h2>
            <button type="button" className="protocol-admin-secondary" disabled={busy} onClick={() => load(cursor)}>Refresh artworks</button>
        </div>
        <p className="admin-catalog-intro">Public and hidden works on Base Sepolia</p>
        {message && <p className="protocol-admin-message" role="status">{message}</p>}
        {!loaded ? <p role="status">{busy ? 'Loading artworks...' : 'The catalog is unavailable. Retry with Refresh artworks.'}</p> : <>
            <div className="protocol-admin-catalog-grid" aria-busy={busy}>
                {page.artworks.map(artwork => <article className="protocol-admin-catalog-card" data-pending={artwork.pending_count > 0} key={artwork.artwork_id}>
                    <AdminArtworkPreview artwork={artwork} />
                    <div className="admin-catalog-card-body">
                    <div className="admin-catalog-card-meta">
                        <span>#{artwork.artwork_id}{artwork.media_type && ' / ' + artwork.media_type}</span>
                        <span className="admin-visibility" data-hidden={artwork.hidden}>{artwork.hidden ? 'Hidden' : 'Public'}</span>
                    </div>
                    <h3 title={artwork.title}>{artwork.title}</h3>
                    <p>{artwork.report_count === 0 ? 'No artwork reports' : `${artwork.report_count} artwork ${artwork.report_count === 1 ? 'report' : 'reports'} (${artwork.pending_count} pending, ${artwork.actioned_count} active)`}</p>
                    {artwork.donation_report_count > 0 && <p>{artwork.donation_report_count} donation-message {artwork.donation_report_count === 1 ? 'report' : 'reports'}</p>}
                    {artwork.hidden && artwork.hidden_reason && <p className="protocol-admin-report-text">Hidden: {artwork.hidden_reason}</p>}
                    <div className="protocol-admin-card-actions">
                        {artwork.report_count > 0 && <button type="button" disabled={busy} onClick={() => onReview(artwork, artwork.actioned_count > 0 ? 'actioned' : artwork.pending_count > 0 ? 'pending_review' : 'all')}>Review artwork reports</button>}
                        {artwork.donation_report_count > 0 && <button type="button" disabled={busy} onClick={() => onReview({...artwork,target_type:'donation_message'},'all')}>Review donation reports</button>}
                        {(!artwork.hidden || artwork.actioned_count === 0) && <button type="button" disabled={busy} onClick={() => setDecision(artwork)}>{artwork.hidden ? 'Restore artwork' : 'Hide artwork'}</button>}
                    </div>
                    {artwork.hidden && artwork.actioned_count > 0 && <p>Resolve active artwork reports before restoring.</p>}
                    </div>
                </article>)}
            </div>
            {page.artworks.length === 0 && <p>No artworks on this page.</p>}
            <div className="protocol-admin-card-actions" aria-label="Artwork pages">
                <button type="button" disabled={busy || !history.length} onClick={async () => {
                    const previous=history.at(-1); if (await load(previous)) setHistory(values => values.slice(0,-1));
                }}>Previous</button>
                <button type="button" disabled={busy || !page.next} onClick={async () => {
                    if (await load(page.next)) setHistory(values => [...values,cursor]);
                }}>Next</button>
            </div>
        </>}
        {decision && <VisibilityDialog artwork={decision} busy={busy} onClose={() => !busy && setDecision(null)} onSubmit={submit} />}
    </section>;
}
