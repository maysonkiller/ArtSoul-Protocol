import { React } from '../../entries/react-runtime.js';
import { createPortal } from 'react-dom';

const categories = [
    ['copyright', 'Copyright or ownership'],
    ['impersonation', 'Impersonation'],
    ['prohibited_content', 'Prohibited or harmful content'],
    ['spam', 'Spam or misleading content'],
    ['other', 'Other concern']
];
const currentWallet = () => String(window.getCurrentWalletAddress?.() || '').toLowerCase();

export function ProfileContentReport({ profileWallet, onClose }) {
    const dialog = React.useRef(null);
    const active = React.useRef(true);
    const request = React.useRef(null);
    const reporter = React.useRef(currentWallet());
    const close = React.useRef(onClose);
    close.current = onClose;
    const [category, setCategory] = React.useState('copyright');
    const [details, setDetails] = React.useState('');
    const [referenceUrl, setReferenceUrl] = React.useState('');
    const [goodFaith, setGoodFaith] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState('');
    const [receipt, setReceipt] = React.useState(null);

    React.useEffect(() => {
        active.current = true;
        const element = dialog.current;
        const trigger = document.activeElement;
        element.showModal();
        const walletChanged = () => {
            const wallet = currentWallet();
            if (reporter.current && reporter.current !== wallet) {
                active.current = false;
                request.current?.abort();
                close.current();
            } else reporter.current = wallet;
        };
        window.addEventListener('artsoul:wallet-state-changed', walletChanged);
        return () => {
            active.current = false;
            request.current?.abort();
            window.removeEventListener('artsoul:wallet-state-changed', walletChanged);
            element.close();
            if (trigger?.isConnected) trigger.focus({ preventScroll: true });
        };
    }, [profileWallet]);

    async function submit(event) {
        event.preventDefault();
        if (request.current) return;
        const wallet = currentWallet();
        const target = String(profileWallet || '').toLowerCase();
        if (!/^0x[0-9a-f]{40}$/.test(wallet)) { setError('Connect your wallet before submitting a report.'); return; }
        if (!/^0x[0-9a-f]{40}$/.test(target) || target === wallet) { setError('Choose another public profile to report.'); return; }
        if (!details.trim() || !goodFaith) { setError('Add the details and confirm that your report is made in good faith.'); return; }
        const controller = new AbortController();
        request.current = controller;
        reporter.current = wallet;
        const current = () => active.current && !controller.signal.aborted && request.current === controller && currentWallet() === wallet;
        setBusy(true);
        setError('');
        try {
            if (!await window.ensureAuthenticated?.()) throw new Error('Verify your wallet to submit this report.');
            if (!current()) return;
            if (String(window.SupabaseAuth?.getAuthenticatedWallet?.() || '').toLowerCase() !== wallet) {
                throw new Error('Your sign-in wallet changed. Please try again.');
            }
            const response = await fetch('/api/moderation/reports', {
                method: 'POST', credentials: 'include', signal: controller.signal,
                headers: { 'Content-Type': 'application/json', 'X-ArtSoul-Wallet': wallet },
                body: JSON.stringify({ target_type: 'profile_content', profile_wallet: target, category,
                    details: details.trim(), reference_url: referenceUrl.trim() || null, good_faith_confirmed: goodFaith })
            });
            const result = await response.json().catch(() => ({}));
            if (!current()) return;
            if (String(window.SupabaseAuth?.getAuthenticatedWallet?.() || '').toLowerCase() !== wallet) {
                throw new Error('Your sign-in wallet changed. Please try again.');
            }
            if (!response.ok || !result.success) throw new Error(result.message || result.error || 'Your report could not be submitted. Please try again.');
            setReceipt({ reference: result.report?.reference, alreadySubmitted: result.alreadySubmitted === true });
        } catch (failure) {
            if (current()) setError(failure.message || 'Your report could not be submitted. Please try again.');
        } finally {
            if (request.current === controller) request.current = null;
            if (active.current) setBusy(false);
        }
    }

    return createPortal(<dialog ref={dialog} className="report-modal artwork-moderation-dialog" aria-labelledby="profileReportTitle"
        onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
        <div className="report-modal-header">
            <div><p className="report-modal-eyebrow">Notice and takedown</p><h2 id="profileReportTitle">Report this profile</h2></div>
            <button type="button" className="report-modal-close" aria-label="Close profile report" disabled={busy} onClick={onClose} autoFocus>×</button>
        </div>
        {receipt ? <div className="report-confirmation" role="status">
            <h3>{receipt.alreadySubmitted ? 'Report already received' : 'Report received'}</h3>
            <p>{receipt.alreadySubmitted ? 'Your report for this profile content and category is already pending review.' : 'Your report is stored for moderator review. A report does not change wallet ownership or remove artworks.'}</p>
            {receipt.reference && <p className="report-reference">Reference: <code>{receipt.reference}</code></p>}
            <div className="report-modal-actions"><button type="button" className="btn-main" onClick={onClose}>Done</button></div>
        </div> : <form onSubmit={submit}>
            <p className="report-modal-copy">Report a concern about this profile’s name, bio, avatar or social links. Moderators review the captured content; wallet identity and artwork ownership stay unchanged.</p>
            <label className="report-field-label" htmlFor="profileReportCategory">Reason</label>
            <select id="profileReportCategory" className="report-field" value={category} disabled={busy} onChange={event => setCategory(event.target.value)}>
                {categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <label className="report-field-label" htmlFor="profileReportDetails">Details</label>
            <textarea id="profileReportDetails" className="report-field report-details" value={details} maxLength="2000" required disabled={busy}
                placeholder="Explain what should be reviewed" onChange={event => setDetails(event.target.value)} />
            <p className="report-character-count">{details.length}/2000</p>
            <label className="report-field-label" htmlFor="profileReportReference">Supporting URL <span>(optional)</span></label>
            <input id="profileReportReference" className="report-field" type="url" inputMode="url" maxLength="500" placeholder="https://"
                value={referenceUrl} disabled={busy} onChange={event => setReferenceUrl(event.target.value)} />
            <label className="report-confirmation-check"><input type="checkbox" checked={goodFaith} required disabled={busy} onChange={event => setGoodFaith(event.target.checked)} />
                <span>I believe this report is accurate and submitted in good faith.</span></label>
            {error && <p className="report-modal-error" role="alert">{error}</p>}
            <div className="report-modal-actions">
                <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>Cancel</button>
                <button type="submit" className="btn-main" disabled={busy || !details.trim() || !goodFaith}>{busy ? 'Submitting…' : 'Submit report'}</button>
            </div>
        </form>}
    </dialog>, document.body);
}
