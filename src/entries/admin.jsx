import { React, createRoot } from './react-runtime.js';
import { StaffPasskeyDialog } from '../features/admin/staff-passkeys.jsx';
import { StaffFactorDialog } from '../features/admin/staff-factor-dialog.jsx';
import { StaffAuthority } from '../features/admin/staff-authority.jsx';

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

function AccessGate({ state, message, walletAddress }) {
    const copy = {
        loading: ['Checking access', 'Confirming the current server session.'],
        disabled: ['Protocol Admin is disabled', 'The review workspace is not active in this environment.'],
        unauthenticated: walletAddress
            ? ['Verify your staff wallet', 'Confirm this wallet to check its staff role. Switching accounts does not carry over the previous account\'s admin access.']
            : ['Connect your staff wallet', 'Use the wallet assigned to your staff account. You can connect it using the button above.'],
        ineligible: ['Access unavailable', 'This wallet does not have an active staff role.'],
        step_up: ['Verify your admin sign-in', 'Your wallet is connected. Use your passkey or authenticator app to unlock complaints. Verification is required again after access expires or your browser or network changes.'],
        setup: ['Admin panel', 'Set up your sign-in method here. The review workspace is not active yet.'],
        setup_verified: ['Admin access confirmed', 'Your sign-in method is verified. The review workspace is not active yet.'],
        authority: ['Staff access', 'This authority wallet can approve staff access. Reviewing complaints requires a separate staff role and verification.'],
        error: ['Protocol Admin unavailable', message || 'The access check could not be completed.']
    }[state] || ['Protocol Admin', message || 'Access is not ready.'];

    return (
        <section className="protocol-admin-gate protocol-admin-access-guide" aria-live="polite">
            <h2>{copy[0]}</h2>
            <p>{copy[1]}</p>
        </section>
    );
}

function ProtocolAdminPage() {
    const [accessState, setAccessState] = useState('loading');
    const [access, setAccess] = useState(null);
    const [queueStatus, setQueueStatus] = useState('pending_review');
    const [queueTarget, setQueueTarget] = useState(null);
    const queueTargetRef = useRef(null);
    const [data, setData] = useState({ reports: [], events: [], hidden: [], moderationLog: [], notifications: [] });
    const [section, setSection] = useState('queue');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [decision, setDecision] = useState(null);
    const queueStatusRef = useRef(queueStatus);
    const [setupWallet, setSetupWallet] = useState('');
    const [authorityWallet, setAuthorityWallet] = useState('');
    const [passkeyOpen, setPasskeyOpen] = useState(false);
    const signInIntent = useRef('login'), completedSignIn = useRef('');
    const setupEpoch = useRef(0), openedSetupFor = useRef('');
    const accessRequest = useRef(0), queueRequest = useRef(0), readySession = useRef(null);
    const checkAccessRef = useRef(null);
    const expiryTimer = useRef(null);
    const accessHeading = useRef(null);
    const currentSetupWallet = () => window.artsoulWalletStateSettled === true
        ? String(window.getCurrentWalletAddress?.() || window.currentWalletAddress || '').toLowerCase() : '';
    const sessionIsCurrent = (epoch, wallet) => epoch === setupEpoch.current && wallet === currentSetupWallet();
    const clearProtectedView = () => {
        clearTimeout(expiryTimer.current);
        expiryTimer.current = null;
        readySession.current = null;
        queueRequest.current++;
        setData({ reports: [], events: [], hidden: [], moderationLog: [], notifications: [] });
        setDecision(null);
    };
    const expireView = () => {
        completedSignIn.current = '';
        setupEpoch.current++;
        accessRequest.current++;
        clearProtectedView();
        setAccess(current => current ? { ...current, stepUpActive: false } : null);
        setAccessState('step_up');
        setBusy(false);
        setPasskeyOpen(false);
    };
    useEffect(() => {
        let waitingForWallet = window.artsoulWalletStateSettled !== true;
        let lastWallet = currentSetupWallet();
        let lastAuthenticated = String(window.SupabaseAuth?.getAuthenticatedWallet?.() || '').toLowerCase();
        const clearSession = () => {
            completedSignIn.current = '';
            queueTargetRef.current = null;
            setQueueTarget(null);
            setupEpoch.current++;
            accessRequest.current++;
            openedSetupFor.current = '';
            clearProtectedView();
            setAccess(null);
            setAccessState('unauthenticated');
            setSetupWallet('');
            setAuthorityWallet('');
            setPasskeyOpen(false);
            setBusy(false);
            setMessage('');
        };
        const sessionChanged = (walletEvent = false) => {
            const wallet = currentSetupWallet();
            const authenticated = String(window.SupabaseAuth?.getAuthenticatedWallet?.() || '').toLowerCase();
            if (walletEvent && wallet === lastWallet && authenticated === lastAuthenticated &&
                waitingForWallet === (window.artsoulWalletStateSettled !== true)) return;
            clearSession();
            const restored = waitingForWallet && window.artsoulWalletStateSettled === true;
            const signedIn = authenticated === wallet && (lastAuthenticated !== authenticated || lastWallet !== wallet);
            waitingForWallet = window.artsoulWalletStateSettled !== true;
            lastWallet = wallet;
            lastAuthenticated = authenticated;
            if (/^0x[0-9a-f]{40}$/.test(wallet) && (restored || signedIn)) checkAccessRef.current?.();
        };
        const walletChanged = () => sessionChanged(true);
        const authChanged = () => sessionChanged();
        const storage = event => { if (!event.key || ['artsoul_wallet', 'artsoul_authenticated_wallet'].includes(event.key)) clearSession(); };
        const resume = () => {
            if (document.visibilityState === 'hidden' || !currentSetupWallet()) return;
            // Conceal cached private data before the server checks this context.
            setupEpoch.current++;
            accessRequest.current++;
            clearProtectedView();
            setAccess(current => current ? { ...current, stepUpActive: false } : null);
            setAccessState('loading');
            checkAccessRef.current?.();
        };
        const offline = () => {
            expireView();
            setAccessState('error');
            setMessage('Connection lost. Complaints are locked. Reconnect to check admin access automatically.');
        };
        window.addEventListener('artsoul:wallet-state-changed', walletChanged);
        window.addEventListener('artsoul:auth-state-changed', authChanged);
        window.addEventListener('storage', storage);
        window.addEventListener('pagehide', clearSession);
        window.addEventListener('focus', resume);
        window.addEventListener('online', resume);
        window.addEventListener('offline', offline);
        window.addEventListener('pageshow', resume);
        const connection = window.navigator?.connection;
        connection?.addEventListener('change', resume);
        document.addEventListener('visibilitychange', resume);
        if (!waitingForWallet) checkAccessRef.current?.();
        return () => {
            setupEpoch.current++;
            readySession.current = null;
            clearTimeout(expiryTimer.current);
            window.removeEventListener('artsoul:wallet-state-changed', walletChanged);
            window.removeEventListener('artsoul:auth-state-changed', authChanged);
            window.removeEventListener('storage', storage);
            window.removeEventListener('pagehide', clearSession);
            window.removeEventListener('focus', resume);
            window.removeEventListener('online', resume);
            window.removeEventListener('offline', offline);
            window.removeEventListener('pageshow', resume);
            connection?.removeEventListener('change', resume);
            document.removeEventListener('visibilitychange', resume);
        };
    }, []);

    useEffect(() => {
        if (!passkeyOpen && ['unauthenticated', 'step_up', 'error'].includes(accessState)) {
            accessHeading.current?.scrollIntoView({ block: 'start' });
            accessHeading.current?.focus({ preventScroll: true });
        }
    }, [accessState, passkeyOpen]);

    useEffect(() => {
        queueStatusRef.current = queueStatus;
    }, [queueStatus]);

    const loadQueue = useCallback(async status => {
        const epoch = setupEpoch.current, wallet = currentSetupWallet(), request = ++queueRequest.current;
        if (readySession.current?.epoch !== epoch || readySession.current.wallet !== wallet) return false;
        let result;
        try {
            const target = queueTargetRef.current;
            result = await api(`review-queue?status=${encodeURIComponent(status)}` + (target
                ? `&chainId=${encodeURIComponent(target.chain_id)}&artworkId=${encodeURIComponent(target.artwork_id)}` : ''));
        } catch (error) {
            if (!sessionIsCurrent(epoch, wallet) || request !== queueRequest.current) return false;
            throw error;
        }
        if (!sessionIsCurrent(epoch, wallet) || request !== queueRequest.current) return false;
        setData(result.data || { reports: [], events: [], hidden: [], moderationLog: [], notifications: [] });
        return true;
    }, []);

    const accessFailed = error => {
        clearProtectedView();
        const stepUpRequired = ['STEP_UP_REQUIRED', 'STEP_UP_WALLET_MISMATCH', 'CREDENTIAL_REVOKED'].includes(error.code);
        if (stepUpRequired) {
            setAccess(current => current ? { ...current, stepUpActive: false } : null);
            setAccessState('step_up');
        } else {
            setAccess(null);
            setSetupWallet('');
            setAuthorityWallet('');
            setPasskeyOpen(false);
            setAccessState('error');
        }
        setMessage(error.message);
    };

    const checkAccess = useCallback(async ({ verified = false } = {}) => {
        const wallet = currentSetupWallet(), epoch = setupEpoch.current, request = ++accessRequest.current;
        if (verified && signInIntent.current === 'login') completedSignIn.current = wallet;
        const startedAt = performance.now();
        const isCurrent = () => sessionIsCurrent(epoch, wallet) && request === accessRequest.current;
        if (!/^0x[0-9a-f]{40}$/.test(wallet)) {
            clearProtectedView();
            setAccess(null);
            setSetupWallet('');
            setAuthorityWallet('');
            setPasskeyOpen(false);
            setAccessState('unauthenticated');
            setBusy(false);
            return;
        }
        setBusy(true);
        setMessage('');
        try {
            const result = await api(`access?expectedWallet=${encodeURIComponent(wallet)}`);
            if (!isCurrent()) return;
            // Use the server's remaining lifetime and subtract the whole request
            // duration. Client wall-clock skew and slow responses cannot extend it.
            const remaining = Number.isSafeInteger(result.access?.stepUpExpiresAt) && Number.isSafeInteger(result.serverTime)
                ? Math.min(86400000, result.access.stepUpExpiresAt - result.serverTime) - (performance.now() - startedAt) : 0;
            if (result.access?.stepUpActive && remaining <= 0) result.access = { ...result.access, stepUpActive: false };
            const canSetup = result.setupEnabled === true && result.authenticated === true && result.eligible === true;
            const canApprove = result.setupEnabled === true && result.authenticated === true && result.authorityEligible === true;
            setAuthorityWallet(canApprove ? wallet : '');
            setSetupWallet(canSetup ? wallet : '');
            if (!canSetup) { completedSignIn.current = ''; setPasskeyOpen(false); }
            else if (result.access?.stepUpActive && completedSignIn.current === wallet) {
                // A completed factor still needs a current server access check.
                // A newer focus/network read may supply it; queue loading need not.
                completedSignIn.current = '';
                setPasskeyOpen(false);
            } else if (!canApprove && !result.access?.stepUpActive && openedSetupFor.current !== wallet) {
                signInIntent.current = 'login'; openedSetupFor.current = wallet; setPasskeyOpen(true);
            }
            setAccess(result.access || null);
            clearProtectedView();
            if (canSetup && result.access?.stepUpActive) expiryTimer.current = setTimeout(expireView, remaining);
            if (!result.enabled && !result.setupEnabled) {
                setAccessState('disabled');
            } else if (!result.authenticated) {
                setAccessState('unauthenticated');
            } else if (!result.eligible) {
                setAccessState(canApprove ? 'authority' : 'ineligible');
            } else if (!result.enabled) {
                setAccessState(result.access?.stepUpActive ? 'setup_verified' : 'setup');
            } else if (!result.access?.stepUpActive) {
                setAccessState('step_up');
            } else {
                readySession.current = { epoch, wallet };
                setAccessState('ready');
                await loadQueue(queueStatusRef.current);
            }
        } catch (error) {
            if (isCurrent()) accessFailed(error);
        } finally {
            if (isCurrent()) setBusy(false);
        }
    }, [loadQueue]);
    checkAccessRef.current = checkAccess;

    const authenticate = async () => {
        const epoch = setupEpoch.current, wallet = currentSetupWallet();
        setBusy(true);
        setMessage('');
        try {
            if (typeof window.ensureAuthenticated !== 'function') throw new Error('Wallet authentication is not ready.');
            await window.ensureAuthenticated();
            if (!sessionIsCurrent(epoch, wallet)) return;
            await checkAccess();
        } catch (error) {
            if (!sessionIsCurrent(epoch, wallet)) return;
            setMessage(error.message || 'Wallet verification failed.');
            setAccessState('error');
            setBusy(false);
        }
    };

    const stepUp = () => {
        if (!setupWallet) return;
        completedSignIn.current = '';
        signInIntent.current = access?.stepUpActive ? 'settings' : 'login';
        setPasskeyOpen(true);
    };

    const changeQueueStatus = async (status, target = queueTargetRef.current) => {
        const epoch = setupEpoch.current, wallet = currentSetupWallet();
        if (readySession.current?.epoch !== epoch || readySession.current.wallet !== wallet) return;
        setQueueStatus(status);
        queueTargetRef.current = target;
        setQueueTarget(target);
        queueStatusRef.current = status;
        setBusy(true);
        setMessage('');
        const request = queueRequest.current + 1;
        try {
            await loadQueue(status);
        } catch (error) {
            if (sessionIsCurrent(epoch, wallet) && request === queueRequest.current) accessFailed(error);
        } finally {
            if (sessionIsCurrent(epoch, wallet) && (request === queueRequest.current || readySession.current === null)) setBusy(false);
        }
    };

    const submitDecision = async reason => {
        const epoch = setupEpoch.current, wallet = currentSetupWallet();
        if (!decision || readySession.current?.epoch !== epoch || readySession.current.wallet !== wallet) return;
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
            if (!sessionIsCurrent(epoch, wallet)) return;
            setDecision(null);
            if (!await loadQueue(queueStatusRef.current) || !sessionIsCurrent(epoch, wallet)) return;
            setMessage(
                decision.action === 'restore' && (result.report?.artwork_hidden || result.report?.message_hidden)
                    ? `Report resolved. ${result.report?.message_hidden ? 'Message' : 'Artwork'} remains hidden because another actioned report is active.`
                    : 'Review decision recorded.'
            );
        } catch (error) {
            if (!sessionIsCurrent(epoch, wallet)) return;
            if (['REPORT_REVIEW_CONFLICT', 'REPORT_ALREADY_PENDING', 'REPORT_ACTION_NOT_ALLOWED', 'REPORT_TARGET_MISMATCH'].includes(error.code)) {
                setDecision(null);
                setMessage(error.message);
                try { await loadQueue(queueStatusRef.current); }
                catch (refreshError) { if (sessionIsCurrent(epoch, wallet)) accessFailed(refreshError); }
            } else accessFailed(error);
        } finally {
            if (sessionIsCurrent(epoch, wallet)) setBusy(false);
        }
    };

    const SignInDialog = access?.dualWallet ? StaffFactorDialog : StaffPasskeyDialog;
    const rosterWallet = authorityWallet || (access?.dualWallet && access?.role === 'team' && access?.stepUpActive ? setupWallet : '');
    const authorityControls = rosterWallet && <StaffAuthority key={`${rosterWallet}:${Boolean(authorityWallet)}`} walletAddress={rosterWallet} readOnly={!authorityWallet} api={api} onAccessChanged={checkAccess} />;
    const verification = setupWallet && <section key="verification" className="protocol-admin-setup" aria-label="Admin verification">
        {passkeyOpen && <SignInDialog key={setupWallet} walletAddress={setupWallet} sessionActive={access?.stepUpActive === true}
            api={api} onClose={() => { completedSignIn.current = ''; setPasskeyOpen(false); }} onAccessChanged={checkAccess} onStepUpRequired={() => {
                clearProtectedView();
                setAccess(current => current ? { ...current, stepUpActive: false } : null);
                setAccessState('step_up');
            }} />}
    </section>;

    const groups = useMemo(() => groupReports(data.reports), [data.reports]);
    const connectedWallet = currentSetupWallet();
    const roleLabel = { admin: 'Administrator', moderator: 'Moderator', team: 'Team' }[access?.role];
    const ready = accessState === 'ready';
    const activeSection = section === 'staff' && !rosterWallet ? 'queue' : section;
    const statusLabel = { loading: 'Checking access', unauthenticated: 'Wallet sign-in required', step_up: 'Verification required',
        ready: 'Verified', authority: 'Approval access', setup: 'Set up sign-in', setup_verified: 'Verified',
        error: 'Access needs attention', ineligible: 'No staff role', disabled: 'Unavailable' }[accessState];

    return (
        <div className="protocol-admin-shell">
            <header className="protocol-admin-heading" ref={accessHeading} tabIndex={-1}>
                <div>
                    <p className="protocol-admin-kicker">Protected workspace</p>
                    <h1>Admin panel</h1>
                    <p>{connectedWallet ? `Wallet ${shortWallet(connectedWallet)}` : 'No staff wallet connected'}{roleLabel ? ` · ${roleLabel}` : ''}</p>
                    <span className={`protocol-admin-access-status${ready ? ' is-verified' : ''}`} role="status">{statusLabel}</span>
                </div>
                <div className="protocol-admin-header-actions">
                    {accessState === 'unauthenticated' && <button type="button" className="protocol-admin-primary" onClick={authenticate} disabled={busy}>{connectedWallet ? 'Verify wallet' : 'Connect staff wallet'}</button>}
                    {setupWallet && <button type="button" className={ready ? '' : 'protocol-admin-primary'} disabled={busy} onClick={stepUp} aria-haspopup="dialog" aria-expanded={passkeyOpen}>{access?.stepUpActive ? 'Sign-in settings' : 'Verify admin access'}</button>}
                    <button type="button" onClick={checkAccess} disabled={busy}>{busy ? 'Checking...' : accessState === 'error' ? 'Retry access check' : 'Refresh'}</button>
                </div>
            </header>

            {verification}
            {!ready && <AccessGate state={accessState} message={message} walletAddress={connectedWallet} />}

            {ready && <nav className="protocol-admin-tabs" aria-label="Protocol Admin sections">
                {(rosterWallet ? ['queue', 'hidden', 'audit', 'notifications', 'staff'] : ['queue', 'hidden', 'audit', 'notifications']).map(value => (
                    <button
                        key={value}
                        type="button"
                        className={activeSection === value ? 'is-active' : ''}
                        aria-current={activeSection === value ? 'page' : undefined}
                        onClick={() => setSection(value)}
                    >
                        {value === 'queue' ? 'Review queue' : value === 'hidden' ? 'Hidden artwork' : value === 'audit' ? 'Audit log' : value === 'staff' ? authorityWallet ? 'Staff access' : 'Team directory' : 'Notification ledger'}
                    </button>
                ))}
            </nav>}

            {rosterWallet && <div key="staff" hidden={ready && activeSection !== 'staff'}>{authorityControls}</div>}

            {ready && message && <p className="protocol-admin-message" role="status">{message}</p>}

            {ready && activeSection === 'queue' && (
                <section aria-labelledby="reviewQueueTitle">
                    <div className="protocol-admin-section-heading">
                        <h2 id="reviewQueueTitle">Review queue</h2>
                        <div className="protocol-admin-status-filter">
                            {['pending_review', 'actioned', 'dismissed', 'resolved'].map(status => (
                                <button key={status} type="button" className={queueStatus === status ? 'is-active' : ''} aria-pressed={queueStatus === status} onClick={() => changeQueueStatus(status)}>
                                    {status.replace('_', ' ')}
                                </button>
                            ))}
                        </div>
                    </div>
                    {queueTarget && <p className="protocol-admin-message">
                        Reports for artwork {queueTarget.artwork_id} · Chain {queueTarget.chain_id}. Resolve each active report to restore the artwork.
                        {' '}<button type="button" className="protocol-admin-secondary" disabled={busy} onClick={() => changeQueueStatus(queueStatus, null)}>Show all reports</button>
                    </p>}
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

            {ready && activeSection === 'hidden' && (
                <section aria-labelledby="hiddenTitle">
                    <h2 id="hiddenTitle">Hidden artwork</h2>
                    <p>Review the active reports to restore an artwork. It stays hidden until all active restrictions are resolved.</p>
                    <div className="protocol-admin-ledger">
                        {data.hidden.length === 0 ? <p>No hidden artwork.</p> : data.hidden.map(item => (
                            <div key={`${item.chain_id}:${item.artwork_id}`}>
                                <strong>Artwork {item.artwork_id}</strong>
                                <span>Chain {item.chain_id}</span>
                                <span>{item.hidden_reason || 'No reason recorded'}</span>
                                <button type="button" className="protocol-admin-secondary" disabled={busy} onClick={() => {
                                    setSection('queue'); void changeQueueStatus('actioned', item);
                                }}>Review to restore</button>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {ready && activeSection === 'audit' && (
                <section aria-labelledby="auditTitle">
                    <h2 id="auditTitle">Append-only audit evidence</h2>
                    <div className="protocol-admin-ledger">
                        {[...data.moderationLog, ...data.events]
                            .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
                            .map(item => (
                                <div key={`${item.action || item.event_type}:${item.id}`}>
                                    <strong>{item.action || item.event_type}</strong>
                                    <span>{item.report_id ? `Report ${item.report_id}` : `Artwork ${item.artwork_id}`}</span>
                                    <span>{new Date(item.created_at).toLocaleString()} · {item.actor_wallet ? shortWallet(item.actor_wallet) : 'Identity private'}{item.reason ? ` · ${item.reason}` : ''}</span>
                                </div>
                            ))}
                    </div>
                </section>
            )}

            {ready && activeSection === 'notifications' && (
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

            {ready && decision && <DecisionDialog decision={decision} onClose={() => !busy && setDecision(null)} onSubmit={submitDecision} busy={busy} />}
        </div>
    );
}

createRoot(document.getElementById('app')).render(<ProtocolAdminPage />);
