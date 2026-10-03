import { React, createRoot } from './react-runtime.js';
import { StaffPasskeyDialog } from '../features/admin/staff-passkeys.jsx';

const { useCallback, useEffect, useMemo, useRef, useState } = React;

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
        const targetType = report.target_type || 'artwork';
        const key = `${report.chain_id}:${report.artwork_id}:${targetType}:${targetType === 'donation_message' ? `${report.donation_transaction_hash}:${report.donation_log_index}` : ''}`;
        const group = groups.get(key) || {
            key,
            chainId: report.chain_id,
            artworkId: report.artwork_id,
            targetType,
            transactionHash: report.donation_transaction_hash,
            logIndex: report.donation_log_index,
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
                {decision.report.target_type === 'donation_message' && <p>This decision affects only the donation message. The donation and artwork remain recorded.</p>}
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
                <button type="button" onClick={() => onChoose(report, 'hide')}>{report.target_type === 'donation_message' ? 'Hide message pending review' : 'Hide pending review'}</button>
                <button type="button" onClick={() => onChoose(report, 'dismiss')}>Dismiss</button>
            </div>
        );
    }
    if (report.status === 'actioned') {
        // An actioned report is active: it may only be resolved/restored.
        // Reopening it would leave the artwork hidden with no active report.
        return (
            <div className="protocol-admin-card-actions">
                <button type="button" onClick={() => onChoose(report, 'restore')}>{report.target_type === 'donation_message' ? 'Resolve and restore message if clear' : 'Resolve and restore if clear'}</button>
            </div>
        );
    }
    if (report.status === 'dismissed' || report.status === 'resolved') {
        return (
            <div className="protocol-admin-card-actions">
                <button type="button" onClick={() => onChoose(report, 'reopen')}>Reopen report</button>
            </div>
        );
    }
    return null;
}

function AccessGate({ state, busy, message, onAuthenticate, onStepUp, onRetry, setupAvailable }) {
    const copy = {
        loading: ['Checking access', 'Confirming the current server session.'],
        disabled: ['Protocol Admin is disabled', 'The review workspace is not active in this environment.'],
        unauthenticated: ['Wallet verification required', 'Verify the connected wallet before the server checks staff access.'],
        ineligible: ['Access unavailable', 'This wallet does not have an active staff role.'],
        step_up: ['Admin panel', 'Open verification below to use a saved passkey or add your first one.'],
        setup: ['Admin panel', 'Set up your passkeys here. The review workspace is not active yet.'],
        setup_verified: ['Admin access confirmed', 'Your passkey is verified. The review workspace is not active yet.'],
        error: ['Protocol Admin unavailable', message || 'The access check could not be completed.']
    }[state] || ['Protocol Admin', message || 'Access is not ready.'];

    return (
        <section className="protocol-admin-gate" aria-live="polite">
            <h1>{copy[0]}</h1>
            <p>{copy[1]}</p>
            {state === 'unauthenticated' && <button type="button" onClick={onAuthenticate} disabled={busy}>Verify wallet</button>}
            {state === 'step_up' && setupAvailable && <button type="button" onClick={onStepUp} disabled={busy}>Verify admin access</button>}
            {(state === 'error' || (!setupAvailable && ['setup', 'setup_verified', 'step_up'].includes(state))) && <button type="button" onClick={onRetry} disabled={busy}>Retry</button>}
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
    const [setupWallet, setSetupWallet] = useState('');
    const [passkeyOpen, setPasskeyOpen] = useState(false);
    const setupEpoch = useRef(0), openedSetupFor = useRef('');
    const currentSetupWallet = () => window.artsoulWalletStateSettled === true
        ? String(window.getCurrentWalletAddress?.() || window.currentWalletAddress || '').toLowerCase() : '';
    useEffect(() => {
        const clearSetup = () => { setupEpoch.current++; openedSetupFor.current = ''; setSetupWallet(''); setPasskeyOpen(false); };
        const storage = event => { if (!event.key || ['artsoul_wallet', 'artsoul_authenticated_wallet'].includes(event.key)) clearSetup(); };
        window.addEventListener('artsoul:wallet-state-changed', clearSetup);
        window.addEventListener('artsoul:auth-state-changed', clearSetup);
        window.addEventListener('storage', storage);
        window.addEventListener('pagehide', clearSetup);
        return () => {
            setupEpoch.current++;
            window.removeEventListener('artsoul:wallet-state-changed', clearSetup);
            window.removeEventListener('artsoul:auth-state-changed', clearSetup);
            window.removeEventListener('storage', storage);
            window.removeEventListener('pagehide', clearSetup);
        };
    }, []);

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
            const wallet = currentSetupWallet(), epoch = setupEpoch.current;
            const result = await api(`access${wallet ? `?expectedWallet=${encodeURIComponent(wallet)}` : ''}`);
            const canSetup = result.setupEnabled === true && result.authenticated === true && result.eligible === true &&
                /^0x[0-9a-f]{40}$/.test(wallet) && wallet === currentSetupWallet() && epoch === setupEpoch.current;
            if (epoch === setupEpoch.current) {
                setSetupWallet(canSetup ? wallet : '');
                if (!canSetup) setPasskeyOpen(false);
                else if (!result.access?.stepUpActive && openedSetupFor.current !== wallet) { openedSetupFor.current = wallet; setPasskeyOpen(true); }
            }
            setAccess(result.access || null);
            if (!result.enabled && !result.setupEnabled) {
                setAccessState('disabled');
            } else if (!result.authenticated) {
                setAccessState('unauthenticated');
            } else if (!result.eligible) {
                setAccessState('ineligible');
            } else if (!result.enabled) {
                setAccessState(result.access?.stepUpActive ? 'setup_verified' : 'setup');
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
        if (window.artsoulWalletStateSettled === true) { checkAccess(); return undefined; }
        const ready = () => {
            if (window.artsoulWalletStateSettled !== true) return;
            window.removeEventListener('artsoul:wallet-state-changed', ready);
            checkAccess();
        };
        window.addEventListener('artsoul:wallet-state-changed', ready);
        return () => window.removeEventListener('artsoul:wallet-state-changed', ready);
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

    const stepUp = () => { if (setupWallet) setPasskeyOpen(true); };

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
                    target_type: decision.report.target_type || 'artwork',
                    reason
                })
            });
            setDecision(null);
            await loadQueue(queueStatus);
            setMessage(
                decision.action === 'restore' && (result.report?.artwork_hidden || result.report?.message_hidden)
                    ? `Report resolved. ${result.report?.message_hidden ? 'Message' : 'Artwork'} remains hidden because another actioned report is active.`
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

    const verification = setupWallet && <section className="protocol-admin-setup" aria-label="Admin verification">
        {accessState !== 'step_up' && <button type="button" className="protocol-admin-primary" disabled={busy} onClick={stepUp}>{access?.stepUpActive ? 'Manage passkeys' : 'Verify admin access'}</button>}
        <p>Only your device can approve a passkey request. Enrollment codes stay on this page and are cleared when you close verification.</p>
        {passkeyOpen && <StaffPasskeyDialog key={setupWallet} walletAddress={setupWallet} sessionActive={access?.stepUpActive === true}
            api={api} onClose={() => setPasskeyOpen(false)} onAccessChanged={checkAccess} onStepUpRequired={() => {
                setAccess(current => current ? { ...current, stepUpActive: false } : null);
                setAccessState('step_up');
            }} />}
    </section>;

    const groups = useMemo(() => groupReports(data.reports), [data.reports]);

    if (accessState !== 'ready') {
        return (
            <div className="protocol-admin-shell">
                <AccessGate
                    state={accessState}
                    setupAvailable={Boolean(setupWallet)}
                    busy={busy}
                    message={message}
                    onAuthenticate={authenticate}
                    onStepUp={stepUp}
                    onRetry={checkAccess}
                />
                {verification}
            </div>
        );
    }

    return (
        <div className="protocol-admin-shell">
            <header className="protocol-admin-heading">
                <div>
                    <p className="protocol-admin-kicker">Protected workspace</p>
                    <h1>Admin panel</h1>
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
                            {['pending_review', 'actioned', 'dismissed', 'resolved'].map(status => (
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
                                    <h3>{group.targetType === 'donation_message' ? 'Donation message for artwork' : 'Artwork'} {group.artworkId}</h3>
                                    <p>Chain {group.chainId} · {group.reports.length} independent report{group.reports.length === 1 ? '' : 's'}</p>
                                    {group.targetType === 'donation_message' && <p>Transaction {shortWallet(group.transactionHash)} · Log {group.logIndex}</p>}
                                </div>
                                <a href={window.ArtSoulArtworkUrl.artworkPath(`v41:${group.chainId}:${group.artworkId}`)}>Open artwork</a>
                            </header>
                            <div className="protocol-admin-report-grid">
                                {group.reports.map(report => (
                                    <section key={report.id} className="protocol-admin-report-card">
                                        <div className="protocol-admin-card-meta">
                                            <span>{report.category.replace('_', ' ')}</span>
                                            <span>{new Date(report.created_at).toLocaleString()}</span>
                                        </div>
                                        <p className="protocol-admin-report-text">{report.details}</p>
                                        {report.target_type === 'donation_message' && <div className="protocol-admin-report-text">
                                            <strong>Indexed donation message{report.donation_message_hidden ? ' (hidden from public view)' : ''}</strong>
                                            <p>{report.donation_message_available
                                                ? report.donation_message || 'No displayable message is present.'
                                                : 'Message is temporarily unavailable from the indexed chain history.'}</p>
                                        </div>}
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
            {verification}
        </div>
    );
}

createRoot(document.getElementById('app')).render(<ProtocolAdminPage />);
