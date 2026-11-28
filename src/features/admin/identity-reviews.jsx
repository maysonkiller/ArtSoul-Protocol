import { React } from '../../entries/react-runtime.js';

const statuses = ['pending', 'approved', 'declined', 'revoked'];
const countRefreshMs = 120_000;
const titleCase = word => word[0].toUpperCase() + word.slice(1);
const queuePath = wallet => 'identity-reviews?wallet=' + encodeURIComponent(wallet.toLowerCase());
const lostAccess = error => [401, 403].includes(error.status) && error.code !== 'SEPARATE_REVIEWER_REQUIRED';

export function usePendingIdentityReviews({ api, wallet, epoch, onAccessError }) {
    const [summary, setSummary] = React.useState(null);
    const [revision, setRevision] = React.useState(0);
    const refresh = React.useCallback(() => setRevision(value => value + 1), []);
    const scope = wallet ? wallet.toLowerCase() + ':' + epoch : '';
    const accessError = React.useRef(onAccessError);
    accessError.current = onAccessError;
    React.useEffect(() => {
        if (!scope) {
            setSummary(null);
            return;
        }
        const controller = new AbortController();
        let lastRead = 0;
        let reading = false;
        async function read() {
            if (document.hidden || reading || Date.now() - lastRead < countRefreshMs) return;
            reading = true;
            lastRead = Date.now();
            try {
                const data = await api(queuePath(wallet) + '&summary=1', { signal: controller.signal });
                if (!controller.signal.aborted && Number.isInteger(data.pending)) {
                    setSummary({ scope, label: String(data.pending) + (data.hasMore ? '+' : ''), needsReview: data.needsReview });
                }
            } catch (error) {
                if (!controller.signal.aborted) {
                    setSummary(null);
                    if (lostAccess(error)) accessError.current?.(error);
                }
            } finally {
                reading = false;
            }
        }
        void read();
        const interval = window.setInterval(read, countRefreshMs);
        document.addEventListener('visibilitychange', read);
        return () => {
            controller.abort();
            window.clearInterval(interval);
            document.removeEventListener('visibilitychange', read);
        };
    }, [scope, wallet, api, revision]);
    const current = scope && summary?.scope === scope ? summary : null;
    return { label: current?.label ?? null, needsReview: current?.needsReview ?? null, refresh };
}

export function IdentityReviews({ api, wallet, isSessionCurrent, onQueueChange, onAccessError }) {
    const [status, setStatus] = React.useState('pending');
    const [after, setAfter] = React.useState('0');
    const [result, setResult] = React.useState(null);
    const [notes, setNotes] = React.useState({});
    const [saving, setSaving] = React.useState(false);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState('');
    const [message, setMessage] = React.useState('');
    const [revision, setRevision] = React.useState(0);
    const path = queuePath(wallet);
    const session = React.useRef({ isSessionCurrent, onAccessError });
    session.current = { isSessionCurrent, onAccessError };
    React.useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setError('');
        api(path + '&status=' + status + '&after=' + after, { signal: controller.signal }).then(data => {
            if (!controller.signal.aborted && session.current.isSessionCurrent()) setResult(data);
        }).catch(reason => {
            if (!controller.signal.aborted && session.current.isSessionCurrent()) {
                setResult(null);
                setError(reason.message);
                if (lostAccess(reason)) session.current.onAccessError?.(reason);
            }
        }).finally(() => {
            if (!controller.signal.aborted && session.current.isSessionCurrent()) setLoading(false);
        });
        return () => controller.abort();
    }, [path, api, status, after, revision]);

    function changePage(nextStatus, cursor) {
        setResult(null);
        setMessage('');
        setError('');
        setLoading(true);
        setStatus(nextStatus);
        setAfter(cursor);
    }
    function refresh() {
        setRevision(value => value + 1);
        onQueueChange?.();
    }
    async function decide(id, action) {
        if (saving || loading || !session.current.isSessionCurrent()) return;
        setSaving(true);
        setError('');
        setMessage('');
        try {
            await api(path, { method: 'POST', body: JSON.stringify({ id, action, note: notes[id] }) });
            if (session.current.isSessionCurrent()) {
                setNotes(current => { const next = { ...current }; delete next[id]; return next; });
                setResult(null);
                setLoading(true);
                setMessage('Decision saved for request #' + id + '.');
                refresh();
            }
        } catch (reason) {
            if (session.current.isSessionCurrent()) {
                setError(reason.message);
                if (lostAccess(reason)) {
                    setResult(null);
                    session.current.onAccessError?.(reason);
                } else if (reason.status === 409) {
                    setMessage(reason.message);
                    setResult(null);
                    setLoading(true);
                    refresh();
                }
            }
        } finally {
            if (session.current.isSessionCurrent()) setSaving(false);
        }
    }
    return <section className="protocol-admin-setup identity-applications">
        <h2>Identity reviews</h2>
        <p>Review blue check requests for profiles and collections.</p>
        <div className="identity-review-toolbar">
            <label>Request status <select value={status} disabled={saving} onChange={event => changePage(event.target.value, '0')}>
                {statuses.map(value => <option key={value} value={value}>{titleCase(value)}</option>)}
            </select></label>
            <button type="button" disabled={saving || loading} onClick={refresh}>Refresh requests</button>
        </div>
        <p role="status">{message || (loading ? 'Loading requests…' : '')}</p>
        {error && <p role="alert">{error}</p>}
        {result?.applications.length === 0 && <p>No {status} requests on this page.</p>}
        {result?.applications.map(row => {
            const own = row.wallet.toLowerCase() === wallet.toLowerCase();
            const actionable = status === 'pending' || status === 'approved';
            const note = notes[row.id] || '';
            return <article className="identity-review-card protocol-admin-report-text" key={row.id} aria-labelledby={'identity-title-' + row.id}>
                <p className="identity-review-meta">{row.chain_id ? 'Collection identity' : 'Profile identity'} / Request #{row.id} / {titleCase(status)}</p>
                <h3 id={'identity-title-' + row.id}>{row.profile_name}</h3>
                <dl className="identity-review-facts">
                    <div><dt>Applicant profile</dt><dd><a target="_blank" rel="noopener noreferrer" href={'/profile?address=' + row.wallet}>{row.wallet}</a></dd></div>
                    {row.chain_id && <div><dt>Collection on {row.chain_id === 8453 ? 'Base' : 'Base Sepolia'}</dt><dd>{row.collection_address}</dd></div>}
                    <div><dt>Evidence from applicant</dt><dd><a href={row.evidence} target="_blank" rel="noreferrer noopener nofollow">{row.evidence}</a></dd></div>
                </dl>
                {actionable && (own ? <div className="identity-review-notice">
                    <strong>This request belongs to your wallet.</strong>
                    <p>A different authorized reviewer must sign in with their own staff wallet and open Identity reviews to decide this request.</p>
                </div> : <>
                    <p>{row.chain_id ? 'Match the creator, network and collection contract to the official source.'
                        : 'Match the profile’s connected X account to the official account, or check that the official source identifies this wallet.'}</p>
                    <label htmlFor={'identity-note-' + row.id}>Decision note</label>
                    <textarea id={'identity-note-' + row.id} value={note} maxLength={500} disabled={saving}
                        aria-describedby={'identity-hint-' + row.id} onChange={event => {
                            const value = event.target.value;
                            setNotes(current => ({ ...current, [row.id]: value }));
                        }}/>
                    <small id={'identity-hint-' + row.id}>Visible to the applicant. Enter 5–500 characters.</small>
                    <div className="protocol-admin-card-actions">
                        {(status === 'pending' ? ['approve', 'decline'] : ['revoke']).map(action => <button type="button" key={action}
                            className={action === 'approve' ? 'protocol-admin-primary' : undefined}
                            disabled={saving || loading || note.trim().length < 5} onClick={() => decide(row.id, action)}>{titleCase(action)}</button>)}
                    </div>
                </>)}
            </article>;
        })}
        {result?.next && <button type="button" disabled={saving || loading} onClick={() => changePage(status, result.next)}>Next requests</button>}
        {after !== '0' && <button type="button" disabled={saving || loading} onClick={() => changePage(status, '0')}>First page</button>}
    </section>;
}
