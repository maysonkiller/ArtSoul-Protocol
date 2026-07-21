import { React, createRoot } from './react-runtime.js';

const { useCallback, useEffect, useMemo, useRef, useState } = React;

function loadWebAuthnBrowser() {
    return import('@simplewebauthn/browser');
}

function shortWallet(value = '') {
    const wallet = String(value || '');
    return wallet.length > 12 ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}` : wallet;
}

function safeExternalUrl(value = '') {
    try {
        const url = new URL(String(value || ''));
        return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
    } catch {
        return '';
    }
}

async function api(path, options = {}) {
    const response = await fetch(`/api/moderation/${path}`, {
        credentials: 'include',
        ...options,
        headers: options.body === undefined
            ? (options.headers || {})
            : { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(result.message || result.error || 'Protocol Admin request failed.');
        error.code = result.error || 'PROTOCOL_ADMIN_REQUEST_FAILED';
        error.status = response.status;
        throw error;
    }
    return result;
}

function groupReports(reports = []) {
    const groups = new Map();
    for (const report of reports) {
        const key = `${report.chain_id}:${report.artwork_id}`;
        const group = groups.get(key) || {
            key,
            chainId: report.chain_id,
            artworkId: report.artwork_id,
            reports: []
        };
        group.reports.push(report);
        groups.set(key, group);
    }
    return [...groups.values()];
}

function DecisionDialog({ decision, onClose, onSubmit, busy }) {
    const dialogRef = useRef(null);
    const reasonRef = useRef(null);
    const previousFocusRef = useRef(null);
    const [reason, setReason] = useState('');

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog || !decision) return undefined;
        previousFocusRef.current = document.activeElement;
        dialog.showModal();
        reasonRef.current?.focus();
        const onKeyDown = event => {
            if (event.key === 'Escape' && !busy) {
                event.preventDefault();
                onClose();
                return;
            }
            if (event.key !== 'Tab') return;
            const focusable = [...dialog.querySelectorAll('textarea, button:not([disabled])')];
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        dialog.addEventListener('keydown', onKeyDown);
        return () => {
            dialog.removeEventListener('keydown', onKeyDown);
            previousFocusRef.current?.focus?.();
        };
    }, [busy, decision, onClose]);

    if (!decision) return null;
    return (
        <dialog ref={dialogRef} className="protocol-admin-dialog" aria-labelledby="reviewDecisionTitle">
            <form
                method="dialog"
                onSubmit={event => {
                    event.preventDefault();
                    onSubmit(reason);
                }}
            >
                <h2 id="reviewDecisionTitle">Record {decision.action} decision</h2>
                <p>Report {decision.report.id}</p>
                <label htmlFor="reviewDecisionReason">Review reason</label>
                <textarea
                    id="reviewDecisionReason"
                    ref={reasonRef}
                    value={reason}
                    maxLength="500"
                    required
                    onChange={event => setReason(event.target.value)}
                />
                <div className="protocol-admin-dialog-actions">
                    <button type="button" className="protocol-admin-secondary" disabled={busy} onClick={onClose}>Cancel</button>
                    <button type="submit" className="protocol-admin-primary" disabled={busy || !reason.trim()}>
                        {busy ? 'Recording...' : 'Confirm decision'}
                    </button>
                </div>
            </form>
        </dialog>
    );
}

function ReportActions({ report, onChoose }) {
    if (report.status === 'pending_review') {
        return (
            <div className="protocol-admin-card-actions">
                <button type="button" onClick={() => onChoose(report, 'hide')}>Hide pending review</button>
                <button type="button" onClick={() => onChoose(report, 'dismiss')}>Dismiss</button>
            </div>
        );
    }
    if (report.status === 'actioned') {
        return (
            <div className="protocol-admin-card-actions">
                <button type="button" onClick={() => onChoose(report, 'restore')}>Resolve and restore if clear</button>
                <button type="button" onClick={() => onChoose(report, 'reopen')}>Reopen report</button>
            </div>
        );
    }
    if (report.status === 'dismissed') {
        return (
            <div className="protocol-admin-card-actions">
                <button type="button" onClick={() => onChoose(report, 'reopen')}>Reopen report</button>
            </div>
        );
    }
    return null;
}

function AccessGate({ state, busy, message, onAuthenticate, onStepUp, onRetry }) {
    const copy = {
        loading: ['Checking access', 'Confirming the current server session.'],
        disabled: ['Protocol Admin is disabled', 'The review workspace is not active in this environment.'],
        unauthenticated: ['Wallet verification required', 'Verify the connected wallet before the server checks staff access.'],
        ineligible: ['Access unavailable', 'This wallet does not have an active staff role.'],
        step_up: ['Passkey verification required', 'Verify a registered passkey to open a 15-minute moderation session.'],
        error: ['Protocol Admin unavailable', message || 'The access check could not be completed.']
    }[state] || ['Protocol Admin', message || 'Access is not ready.'];

    return (
        <section className="protocol-admin-gate" aria-live="polite">
            <h1>{copy[0]}</h1>
            <p>{copy[1]}</p>
            {state === 'unauthenticated' && <button type="button" onClick={onAuthenticate} disabled={busy}>Verify wallet</button>}
            {state === 'step_up' && <button type="button" onClick={onStepUp} disabled={busy}>{busy ? 'Verifying...' : 'Verify passkey'}</button>}
            {state === 'error' && <button type="button" onClick={onRetry} disabled={busy}>Retry</button>}
        </section>
    );
}

function ProtocolAdminPage() {
    const [accessState, setAccessState] = useState('loading');
    const [access, setAccess] = useState(null);
    const [queueStatus, setQueueStatus] = useState('pending_review');
    const [data, setData] = useState({ reports: [], events: [], hidden: [], moderationLog: [], notifications: [] });
    const [section, setSection] = useState('queue');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [decision, setDecision] = useState(null);
    const queueStatusRef = useRef(queueStatus);

    useEffect(() => {
        queueStatusRef.current = queueStatus;
    }, [queueStatus]);

    const loadQueue = useCallback(async status => {
        const result = await api(`review-queue?status=${encodeURIComponent(status)}`);
        setData(result.data || { reports: [], events: [], hidden: [], moderationLog: [], notifications: [] });
    }, []);

    const checkAccess = useCallback(async () => {
        setBusy(true);
        setMessage('');
        try {
            const result = await api('access');
            setAccess(result.access || null);
            if (!result.enabled) {
                setAccessState('disabled');
            } else if (!result.authenticated) {
                setAccessState('unauthenticated');
            } else if (!result.eligible) {
                setAccessState('ineligible');
            } else if (!result.access?.stepUpActive) {
                setAccessState('step_up');
            } else {
                setAccessState('ready');
                await loadQueue(queueStatusRef.current);
            }
        } catch (error) {
            setMessage(error.message);
            setAccessState(error.code === 'STEP_UP_REQUIRED' ? 'step_up' : 'error');
        } finally {
            setBusy(false);
        }
    }, [loadQueue]);

    useEffect(() => {
        checkAccess();
    }, [checkAccess]);

    const authenticate = async () => {
        setBusy(true);
        setMessage('');
        try {
            if (typeof window.ensureAuthenticated !== 'function') throw new Error('Wallet authentication is not ready.');
            await window.ensureAuthenticated();
            await checkAccess();
        } catch (error) {
            setMessage(error.message || 'Wallet verification failed.');
            setAccessState('error');
            setBusy(false);
        }
    };

    const stepUp = async () => {
        setBusy(true);
        setMessage('');
        try {
            const { startAuthentication } = await loadWebAuthnBrowser();
            const optionsResult = await api('passkey-auth-options', { method: 'POST' });
            const assertion = await startAuthentication({ optionsJSON: optionsResult.options });
            await api('passkey-auth-verify', { method: 'POST', body: JSON.stringify({ response: assertion }) });
            await checkAccess();
        } catch (error) {
            setMessage(error.message || 'Passkey verification failed.');
            setAccessState('step_up');
            setBusy(false);
        }
    };

    const changeQueueStatus = async status => {
        setQueueStatus(status);
        setBusy(true);
        setMessage('');
        try {
            await loadQueue(status);
        } catch (error) {
            if (error.code === 'STEP_UP_REQUIRED') setAccessState('step_up');
            setMessage(error.message);
        } finally {
            setBusy(false);
        }
    };

    const submitDecision = async reason => {
        if (!decision) return;
        setBusy(true);
        setMessage('');
        try {
            const result = await api('review-action', {
                method: 'POST',
                body: JSON.stringify({
                    report_id: decision.report.id,
                    expected_updated_at: decision.report.updated_at,
                    action: decision.action,
                    reason
                })
            });
            setDecision(null);
            await loadQueue(queueStatus);
            setMessage(
                decision.action === 'restore' && result.report?.artwork_hidden
                    ? 'Report resolved. Artwork remains hidden because another actioned report is active.'
                    : 'Review decision recorded.'
            );
        } catch (error) {
            if (error.code === 'STEP_UP_REQUIRED') setAccessState('step_up');
            setMessage(error.message);
            if (error.code === 'REPORT_REVIEW_CONFLICT') await loadQueue(queueStatus);
        } finally {
            setBusy(false);
        }
    };

    const groups = useMemo(() => groupReports(data.reports), [data.reports]);

    if (accessState !== 'ready') {
        return (
            <div className="protocol-admin-shell">
                <AccessGate
                    state={accessState}
                    busy={busy}
                    message={message}
                    onAuthenticate={authenticate}
                    onStepUp={stepUp}
                    onRetry={checkAccess}
                />
            </div>
        );
    }

    return (
        <div className="protocol-admin-shell">
            <header className="protocol-admin-heading">
                <div>
                    <p className="protocol-admin-kicker">Protected workspace</p>
                    <h1>Protocol Admin</h1>
                    <p>Role: {access?.role || 'staff'} · passkey session active for up to 15 minutes</p>
                </div>
                <button type="button" onClick={() => changeQueueStatus(queueStatus)} disabled={busy}>Refresh</button>
            </header>

            <nav className="protocol-admin-tabs" aria-label="Protocol Admin sections">
                {['queue', 'hidden', 'audit', 'notifications'].map(value => (
                    <button
                        key={value}
                        type="button"
                        className={section === value ? 'is-active' : ''}
                        aria-current={section === value ? 'page' : undefined}
                        onClick={() => setSection(value)}
                    >
                        {value === 'queue' ? 'Review queue' : value === 'hidden' ? 'Hidden artwork' : value === 'audit' ? 'Audit log' : 'Notification ledger'}
                    </button>
                ))}
            </nav>

            {message && <p className="protocol-admin-message" role="status">{message}</p>}

            {section === 'queue' && (
                <section aria-labelledby="reviewQueueTitle">
                    <div className="protocol-admin-section-heading">
                        <h2 id="reviewQueueTitle">Review queue</h2>
                        <div className="protocol-admin-status-filter">
                            {['pending_review', 'actioned', 'dismissed'].map(status => (
                                <button key={status} type="button" className={queueStatus === status ? 'is-active' : ''} onClick={() => changeQueueStatus(status)}>
                                    {status.replace('_', ' ')}
                                </button>
                            ))}
                        </div>
                    </div>
                    {groups.length === 0 ? <p className="protocol-admin-empty">No reports in this state.</p> : groups.map(group => (
                        <article key={group.key} className="protocol-admin-group">
                            <header>
                                <div>
                                    <h3>Artwork {group.artworkId}</h3>
                                    <p>Chain {group.chainId} · {group.reports.length} independent report{group.reports.length === 1 ? '' : 's'}</p>
                                </div>
                                <a href={`artwork.html?id=v41:${group.chainId}:${group.artworkId}`}>Open artwork</a>
                            </header>
                            <div className="protocol-admin-report-grid">
                                {group.reports.map(report => (
                                    <section key={report.id} className="protocol-admin-report-card">
                                        <div className="protocol-admin-card-meta">
                                            <span>{report.category.replace('_', ' ')}</span>
                                            <span>{new Date(report.created_at).toLocaleString()}</span>
                                        </div>
                                        <p className="protocol-admin-report-text">{report.details}</p>
                                        {safeExternalUrl(report.reference_url) && (
                                            <a href={safeExternalUrl(report.reference_url)} target="_blank" rel="noopener noreferrer">Reference evidence</a>
                                        )}
                                        <p className="protocol-admin-wallet">Reporter {shortWallet(report.reporter_wallet)}</p>
                                        {report.decision_reason && <p>Last decision: {report.decision_reason}</p>}
                                        <ReportActions report={report} onChoose={(selected, action) => setDecision({ report: selected, action })} />
                                    </section>
                                ))}
                            </div>
                        </article>
                    ))}
                </section>
            )}

            {section === 'hidden' && (
                <section aria-labelledby="hiddenTitle">
                    <h2 id="hiddenTitle">Hidden artwork</h2>
                    <div className="protocol-admin-ledger">
                        {data.hidden.length === 0 ? <p>No hidden artwork.</p> : data.hidden.map(item => (
                            <div key={`${item.chain_id}:${item.artwork_id}`}>
                                <strong>Artwork {item.artwork_id}</strong>
                                <span>Chain {item.chain_id}</span>
                                <span>{item.hidden_reason || 'No reason recorded'}</span>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {section === 'audit' && (
                <section aria-labelledby="auditTitle">
                    <h2 id="auditTitle">Append-only audit evidence</h2>
                    <div className="protocol-admin-ledger">
                        {[...data.moderationLog, ...data.events]
                            .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
                            .map(item => (
                                <div key={`${item.action || item.event_type}:${item.id}`}>
                                    <strong>{item.action || item.event_type}</strong>
                                    <span>{item.report_id ? `Report ${item.report_id}` : `Artwork ${item.artwork_id}`}</span>
                                    <span>{new Date(item.created_at).toLocaleString()} · {shortWallet(item.actor_wallet)}{item.reason ? ` · ${item.reason}` : ''}</span>
                                </div>
                            ))}
                    </div>
                </section>
            )}

            {section === 'notifications' && (
                <section aria-labelledby="notificationsTitle">
                    <h2 id="notificationsTitle">Notification ledger</h2>
                    <p className="protocol-admin-section-copy">Persisted delivery obligations. Delivery failures cannot roll back review decisions.</p>
                    <div className="protocol-admin-ledger">
                        {data.notifications.length === 0 ? <p>No notification obligations.</p> : data.notifications.map(item => (
                            <div key={item.id}>
                                <strong>{item.notification_type}</strong>
                                <span>Recipient {shortWallet(item.recipient_wallet)}</span>
                                <span>{new Date(item.created_at).toLocaleString()}</span>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            <DecisionDialog decision={decision} onClose={() => !busy && setDecision(null)} onSubmit={submitDecision} busy={busy} />
        </div>
    );
}

createRoot(document.getElementById('app')).render(<ProtocolAdminPage />);
