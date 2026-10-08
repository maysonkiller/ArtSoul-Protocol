import { React } from '../../entries/react-runtime.js';
import { verifyMessage } from 'ethers';

const { useEffect, useRef, useState } = React;
const STORAGE_KEY = 'artsoul_staff_authority_request';
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

// Only the short-lived public proposal ID and its approval signatures survive
// an account switch. No session, code, secret or complaint is stored here.
function savedApproval() {
    try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (!raw || raw.length > 2048) return null;
        const saved = JSON.parse(raw);
        if (!/^[0-9a-f-]{36}$/.test(saved.id) || !Number.isFinite(saved.expiresAt) || saved.expiresAt <= Date.now() ||
            !Array.isArray(saved.signatures) || saved.signatures.length > 2 || saved.signatures.some(value => !/^0x[0-9a-fA-F]{130}$/.test(value))) return null;
        return saved;
    } catch { return null; }
}
function matchingSignatures(request, signatures) {
    const byWallet = new Map();
    for (const signature of signatures) {
        try {
            const signer = verifyMessage(request.message, signature).toLowerCase();
            if (request.proposal.authorities.includes(signer)) byWallet.set(signer, signature);
        } catch { /* Untrusted browser state is never proof. */ }
    }
    return byWallet;
}

export function StaffAuthority({ walletAddress, api, onAccessChanged }) {
    const wallet = walletAddress.toLowerCase(), epoch = useRef(0), busyRef = useRef(false);
    const currentWallet = () => String(window.getCurrentWalletAddress?.() || window.currentWalletAddress || '').toLowerCase();
    const [request, setRequest] = useState(null), [signatures, setSignatures] = useState([]);
    const [action, setAction] = useState('grant_role'), [target, setTarget] = useState(wallet), [role, setRole] = useState('moderator');
    const [nextA, setNextA] = useState(''), [nextB, setNextB] = useState('');
    const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
    const post = body => api('authority', { method: 'POST', body: JSON.stringify({ ...body, expectedWallet: wallet }) });
    function discard() {
        epoch.current++; busyRef.current = false; setBusy(false); setRequest(null); setSignatures([]);
        try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* Storage may be unavailable. */ }
    }
    function save(next, approvals) {
        const record = { id: next.proposal.requestId, expiresAt: Date.parse(next.proposal.expiresAt), signatures: approvals };
        // If storage is blocked, stop before requesting a signature that cannot
        // survive the required wallet switch.
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(record));
        setRequest(next); setSignatures(approvals);
    }
    async function run(work) {
        if (busyRef.current || currentWallet() !== wallet) return;
        const token = ++epoch.current, current = () => token === epoch.current && currentWallet() === wallet;
        busyRef.current = true; setBusy(true); setMessage('');
        try { await work(current); }
        catch (error) {
            if (!current()) return;
            const expired = ['AUTHORITY_REQUEST_UNAVAILABLE', 'AUTHORITY_POLICY_CHANGED', 'AUTHORITY_REQUEST_NOT_APPLIED'].includes(error.code);
            if (expired) { discard(); setMessage('This approval expired or the staff policy changed. Review a new request.'); }
            else setMessage(error.code === 'BOTH_AUTHORITY_SIGNATURES_REQUIRED' ? 'Both current authority wallets must sign the same request.' :
                error.code === 4001 || error.code === 'ACTION_REJECTED' ? 'Signature cancelled. Nothing was changed.' :
                'The request could not be completed. Check the target wallet and role, then retry.');
        } finally { if (current()) { busyRef.current = false; setBusy(false); } }
    }
    useEffect(() => {
        const saved = savedApproval();
        if (saved) run(async current => {
            const result = await api(`authority?expectedWallet=${encodeURIComponent(wallet)}&requestId=${encodeURIComponent(saved.id)}`);
            if (current()) save(result.request, [...matchingSignatures(result.request, saved.signatures).values()]);
        });
        const invalidate = () => { epoch.current++; busyRef.current = false; setRequest(null); setSignatures([]); setBusy(false); };
        window.addEventListener('artsoul:wallet-state-changed', invalidate);
        window.addEventListener('artsoul:auth-state-changed', invalidate);
        window.addEventListener('pagehide', invalidate);
        return () => {
            epoch.current++;
            window.removeEventListener('artsoul:wallet-state-changed', invalidate);
            window.removeEventListener('artsoul:auth-state-changed', invalidate);
            window.removeEventListener('pagehide', invalidate);
        };
    }, [wallet]);
    useEffect(() => {
        if (!request) return;
        const timer = setTimeout(() => { discard(); setMessage('Approval expired. Prepare a new request.'); }, Math.max(0, Date.parse(request.proposal.expiresAt) - Date.now()));
        return () => clearTimeout(timer);
    }, [request]);
    const create = event => {
        event.preventDefault();
        run(async current => {
            const rotation = action === 'rotate_authority';
            const result = await post({ operation: 'request', action, targetWallet: rotation ? '' : target, role: rotation ? '' : role,
                nextAuthorities: rotation ? [nextA, nextB] : [] });
            if (current()) save(result.request, []);
        });
    };
    const sign = () => run(async current => {
        const fresh = await api(`authority?expectedWallet=${encodeURIComponent(wallet)}&requestId=${encodeURIComponent(request.proposal.requestId)}`);
        if (!current()) return;
        const approved = matchingSignatures(fresh.request, signatures);
        if (approved.has(wallet)) { setMessage('This wallet has already signed. Switch to the other authority wallet.'); return; }
        const provider = await window.web3Modal?.getWalletProvider?.();
        if (!current() || !provider?.request) return;
        const rpc = payload => window.requestArtSoulWalletProvider ? window.requestArtSoulWalletProvider(provider, payload) : provider.request(payload);
        const accounts = await rpc({ method: 'eth_accounts' });
        if (!current() || String(accounts?.[0] || '').toLowerCase() !== wallet) throw new Error('WALLET_CHANGED');
        const hex = '0x' + [...new TextEncoder().encode(fresh.request.message)].map(byte => byte.toString(16).padStart(2, '0')).join('');
        const signature = await rpc({ method: 'personal_sign', params: [hex, wallet] });
        if (!current()) return;
        if (verifyMessage(fresh.request.message, signature).toLowerCase() !== wallet) throw new Error('SIGNER_MISMATCH');
        approved.set(wallet, signature); save(fresh.request, [...approved.values()]);
        setMessage(approved.size === 2 ? 'Both signatures are ready. Apply this exact request below.' : 'First signature saved in this browser tab. Switch to the other authority wallet, verify wallet login, then open Staff access again.');
    });
    const apply = () => run(async current => {
        await post({ operation: 'complete', requestId: request.proposal.requestId, signatures });
        if (!current()) return;
        discard(); setMessage('Staff access updated. Approved sign-in setup is available for 15 minutes after a grant or reset.');
        await onAccessChanged();
    });
    const signed = request ? matchingSignatures(request, signatures) : new Map();
    return <section className="protocol-admin-gate protocol-admin-authority" aria-label="Staff access">
        <h2>Staff access</h2>
        <p>Both authority wallets approve role changes and sign-in resets. These signatures cost no gas and do not change contract ownership.</p>
        {!request ? <form onSubmit={create}>
            <label htmlFor="staffAuthorityAction">Action</label>
            <select id="staffAuthorityAction" value={action} onChange={event => setAction(event.target.value)} disabled={busy}>
                <option value="grant_role">Assign a staff role</option><option value="revoke_role">Remove a staff role</option>
                <option value="renew_setup">Reset sign-in method</option><option value="rotate_authority">Replace authority wallets</option>
            </select>
            {action === 'rotate_authority' ? <>
                <label htmlFor="staffAuthorityNextA">New first authority wallet</label><input id="staffAuthorityNextA" value={nextA} onChange={event => setNextA(event.target.value.trim())} required spellCheck={false} />
                <label htmlFor="staffAuthorityNextB">New second authority wallet</label><input id="staffAuthorityNextB" value={nextB} onChange={event => setNextB(event.target.value.trim())} required spellCheck={false} />
            </> : <>
                <label htmlFor="staffAuthorityTarget">Staff wallet</label><input id="staffAuthorityTarget" value={target} onChange={event => setTarget(event.target.value.trim())} required spellCheck={false} />
                <label htmlFor="staffAuthorityRole">Role</label><select id="staffAuthorityRole" value={role} onChange={event => setRole(event.target.value)}><option value="moderator">Moderator</option><option value="admin">Administrator</option><option value="team">Team</option></select>
            </>}
            <button type="submit" disabled={busy || (action === 'rotate_authority' ? !ADDRESS.test(nextA) || !ADDRESS.test(nextB) : !ADDRESS.test(target))}>Review request</button>
        </form> : <>
            <p>Expires at {new Date(request.proposal.expiresAt).toLocaleTimeString()}. Review the complete request before signing.</p>
            <pre className="protocol-admin-approval-message">{request.message}</pre>
            <ul>{request.proposal.authorities.map(address => <li key={address}>{address}: {signed.has(address) ? 'Signed' : 'Signature needed'}</li>)}</ul>
            <button type="button" onClick={sign} disabled={busy || signed.has(wallet)}>Sign with connected wallet</button>
            <button type="button" onClick={apply} disabled={busy || signed.size !== 2}>Apply approved request</button>
            <button type="button" onClick={discard} disabled={busy}>Discard request</button>
        </>}
        {message && <p role="status" className="protocol-admin-message">{message}</p>}
    </section>;
}
