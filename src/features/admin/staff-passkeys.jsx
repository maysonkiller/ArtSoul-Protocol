import { React } from '../../entries/react-runtime.js';

const { useState, useEffect, useRef } = React;

function loadWebAuthnBrowser() {
    return import('@simplewebauthn/browser');
}

function AdditionalPasskeyGrant({walletAddress, api, onStepUpRequired}) {
    const wallet = String(walletAddress || '').toLowerCase();
    const activeWallet = () => String(window.getCurrentWalletAddress?.() || window.currentWalletAddress || '').toLowerCase();
    const [grant, setGrant] = useState(null);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState('');
    const operationRef = useRef(0);
    const busyRef = useRef(false);
    const grantRef = useRef(null);
    function clearGrant() {
        operationRef.current++;
        grantRef.current = null;
        busyRef.current = false;
        setGrant(null); setBusy(false); setNotice('');
    }
    useEffect(() => {
        const invalidate = () => {clearGrant(); onStepUpRequired();};
        const storage = event => {if (!event.key || event.key === 'artsoul_authenticated_wallet') invalidate();};
        window.addEventListener('artsoul:wallet-state-changed', invalidate);
        window.addEventListener('artsoul:auth-state-changed', invalidate);
        window.addEventListener('storage', storage);
        window.addEventListener('pagehide', clearGrant);
        return () => {
            operationRef.current++; grantRef.current = null;
            window.removeEventListener('artsoul:wallet-state-changed', invalidate);
            window.removeEventListener('artsoul:auth-state-changed', invalidate);
            window.removeEventListener('storage', storage);
            window.removeEventListener('pagehide', clearGrant);
        };
    }, [wallet]);
    useEffect(() => {
        if (!grant) return;
        const timer = setTimeout(() => {
            if (grantRef.current !== grant) return;
            clearGrant();
            setNotice('The enrollment code expired. Verify your passkey before creating another.');
            onStepUpRequired();
        }, Math.max(0, grant.expiresAt - Date.now()));
        return () => clearTimeout(timer);
    }, [grant]);
    async function issueGrant() {
        if (busyRef.current || grantRef.current || !wallet || activeWallet() !== wallet) return;
        busyRef.current = true; setBusy(true); setNotice('');
        const operation = ++operationRef.current;
        try {
            const authenticated = await window.ensureAuthenticated?.();
            if (operation !== operationRef.current || activeWallet() !== wallet) return;
            if (!authenticated) {onStepUpRequired(); return;}
            // The existing route rechecks SIWE, role and the live passkey session.
            const result = await api('passkey-grant');
            if (operation !== operationRef.current || activeWallet() !== wallet) return;
            const expiresAt = Math.min(Date.parse(result.expires_at), Date.now() + 15 * 60 * 1000);
            if (result.success !== true || !/^[A-Za-z0-9_-]{43}$/.test(result.token || '') || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('INVALID_GRANT');
            const next = {token: result.token, expiresAt};
            grantRef.current = next; setGrant(next);
        } catch (error) {
            if (operation !== operationRef.current || activeWallet() !== wallet) return;
            if (['STEP_UP_REQUIRED', 'STEP_UP_WALLET_MISMATCH', 'CREDENTIAL_REVOKED', 'ADMIN_REQUIRED', 'PASSKEY_DISABLED'].includes(error.code)) onStepUpRequired();
            else setNotice('Could not create an enrollment code. Verify your passkey and try again.');
        } finally {
            if (operation === operationRef.current && activeWallet() === wallet) {busyRef.current = false; setBusy(false);}
        }
    }
    async function copyGrant() {
        const current = grantRef.current;
        if (!current || activeWallet() !== wallet || current.expiresAt <= Date.now()) {clearGrant(); return;}
        const operation = operationRef.current;
        try {
            await navigator.clipboard.writeText(current.token);
            if (operation === operationRef.current && activeWallet() === wallet) setNotice('Code copied. Paste it only into Enroll passkey on your other device.');
        } catch {
            if (operation === operationRef.current && activeWallet() === wallet) setNotice('Select the code and copy it manually.');
        }
    }
    return (
        <div className="space-y-2" aria-label="Add another passkey">
            {!grant && <button type="button" className="btn-secondary w-full" data-allow-rapid="true" disabled={busy} onClick={issueGrant}>{busy ? 'Creating code...' : 'Add a passkey on another device'}</button>}
            {grant && <>
                <p className="text-sm">On your other device, sign in with this wallet, open Admin panel and select Enroll passkey. Use an independent authenticator.</p>
                <label className="block text-sm">One-time enrollment code
                    <input readOnly autoComplete="off" spellCheck={false} value={grant.token} className="w-full px-3 py-2 rounded-lg" style={{background: 'var(--c-surface)', color: 'var(--c-text)', border: '1px solid var(--c-border)'}} />
                </label>
                <p className="text-xs">Expires at {new Date(grant.expiresAt).toLocaleTimeString()}. Keep it private. Clearing this page does not revoke a copied code.</p>
                <button type="button" className="btn-secondary" data-allow-rapid="true" onClick={copyGrant}>Copy code</button>
            </>}
            {(grant || busy) && <button type="button" className="btn-secondary" data-allow-rapid="true" onClick={clearGrant}>{busy ? 'Cancel' : 'Clear code'}</button>}
            {notice && <p className="text-sm" role="status">{notice}</p>}
        </div>
    );
}

export function StaffPasskeyDialog({ walletAddress, sessionActive, api, onClose, onAccessChanged, onStepUpRequired }) {
    const wallet = String(walletAddress || '').toLowerCase();
    const activeWallet = () => String(window.getCurrentWalletAddress?.() || window.currentWalletAddress || '').toLowerCase();
    const dialogRef = useRef(null), closeRef = useRef(null), generation = useRef(0), busyRef = useRef(false);
    const [enrollmentCode, setEnrollmentCode] = useState('');
    const [credentials, setCredentials] = useState(null);
    const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
    function clear() {
        generation.current++; busyRef.current = false;
        setEnrollmentCode(''); setCredentials(null); setMessage(''); setBusy(false);
    }
    function close() { clear(); onClose(); }
    useEffect(() => {
        const previousFocus = document.activeElement;
        dialogRef.current?.showModal();
        closeRef.current?.focus();
        const invalidate = () => { clear(); onClose(); };
        const storage = event => { if (!event.key || ['artsoul_authenticated_wallet', 'artsoul_wallet'].includes(event.key)) invalidate(); };
        window.addEventListener('artsoul:wallet-state-changed', invalidate);
        window.addEventListener('artsoul:auth-state-changed', invalidate);
        window.addEventListener('storage', storage);
        window.addEventListener('pagehide', invalidate);
        return () => {
            generation.current++;
            dialogRef.current?.close();
            window.removeEventListener('artsoul:wallet-state-changed', invalidate);
            window.removeEventListener('artsoul:auth-state-changed', invalidate);
            window.removeEventListener('storage', storage);
            window.removeEventListener('pagehide', invalidate);
            if (previousFocus?.isConnected) previousFocus.focus();
        };
    }, [wallet]);
    const post = (path, payload) => api(path, { method: 'POST', ...(payload ? { body: JSON.stringify(payload) } : {}) });
    async function perform(action, credentialId = '') {
        if (busyRef.current || !wallet || activeWallet() !== wallet) return;
        const token = enrollmentCode.trim();
        if (action === 'enroll' && !token) { setMessage('Paste the enrollment code first.'); return; }
        busyRef.current = true; setBusy(true); setMessage('');
        const operation = ++generation.current;
        const current = () => operation === generation.current && activeWallet() === wallet;
        try {
            if (action === 'show') {
                const result = await api('passkeys');
                if (current()) setCredentials(result.credentials || []);
            } else if (action === 'revoke') {
                if (!sessionActive) { onStepUpRequired(); return; }
                await post('passkeys', { action: 'revoke', credential_id: credentialId });
                if (!current()) return;
                setCredentials(null); setMessage('Passkey removed. Show your passkeys to refresh the list.');
                await onAccessChanged();
            } else {
                if (action === 'add' && !sessionActive) { onStepUpRequired(); return; }
                const browser = await loadWebAuthnBrowser();
                if (!current()) return;
                const enrolling = ['enroll', 'setup', 'add'].includes(action);
                let approval = action === 'setup' ? { mode: 'approved-bootstrap' } : { token };
                if (action === 'add') {
                    // Existing step-up-protected self-grant, kept only for this
                    // explicit native registration. No code is displayed or saved.
                    const result = await post('passkey-grant');
                    if (!current()) return;
                    if (result.success !== true || !/^[A-Za-z0-9_-]{43}$/.test(result.token || '') ||
                        !(Date.parse(result.expires_at) > Date.now())) throw new Error('INVALID_GRANT');
                    approval = { token: result.token };
                }
                const options = await post(enrolling ? 'passkey-register-options' : 'passkey-auth-options', enrolling ? approval : undefined);
                if (!current()) return;
                const response = enrolling
                    ? await browser.startRegistration({ optionsJSON: options.options })
                    : await browser.startAuthentication({ optionsJSON: options.options });
                if (!current()) return;
                await post(enrolling ? 'passkey-register-verify' : 'passkey-auth-verify', enrolling ? { ...approval, response } : { response });
                if (!current()) return;
                setEnrollmentCode(''); setCredentials(null);
                setMessage(enrolling ? 'Passkey saved. Select Verify passkey to continue.' : 'Verified. Your admin session is active for up to 15 minutes.');
                await onAccessChanged();
            }
        } catch (error) {
            if (!current()) return;
            const messages = {
                NO_CREDENTIALS: 'No passkey is saved for this wallet. Select Set up passkey if your first enrollment has been approved.',
                FIRST_ENROLLMENT_UNAVAILABLE: 'First passkey setup is not available for this wallet right now. Use a saved passkey, or ask the administrator to check your enrollment approval.',
                LAST_ACTIVE_CREDENTIAL: 'Keep at least one active passkey. Add another before removing this one.',
                ENROLLMENT_GRANT_REQUIRED: 'This enrollment code is invalid or expired. Use a new code.',
                STEP_UP_REQUIRED: 'Verify your passkey before managing saved passkeys.'
            };
            setMessage(messages[error.code] || (error.name === 'NotAllowedError' ? 'Verification was cancelled. You can try again.' : 'The passkey request could not be completed. Check your code or try again.'));
            if (error.status === 401) await onAccessChanged();
            else if (['STEP_UP_REQUIRED', 'STEP_UP_WALLET_MISMATCH', 'CREDENTIAL_REVOKED'].includes(error.code)) onStepUpRequired();
        } finally {
            if (current()) { busyRef.current = false; setBusy(false); }
        }
    }
    return (
        <dialog ref={dialogRef} className="protocol-admin-dialog protocol-admin-passkeys" aria-labelledby="adminPasskeyTitle" aria-describedby="adminPasskeyDescription"
            onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
            <div className="protocol-admin-passkey-content">
                <header><h2 id="adminPasskeyTitle">Verify admin access</h2><button ref={closeRef} type="button" onClick={close} aria-label="Close verification">Close</button></header>
                <p id="adminPasskeyDescription">Use your device's fingerprint, face recognition, or security key to confirm it is you. Your wallet stays the same.</p>
                {!sessionActive && <section aria-labelledby="firstPasskeyTitle">
                    <h3 id="firstPasskeyTitle">Set up your first passkey</h3>
                    <p>If your first enrollment is approved, your device will guide you through saving a passkey. No enrollment code is needed.</p>
                    <button type="button" className="protocol-admin-primary" disabled={busy} onClick={() => perform('setup')}>Set up passkey</button>
                </section>}
                <section aria-labelledby="existingPasskeyTitle">
                    <h3 id="existingPasskeyTitle">Already have a passkey?</h3>
                    <p>Select Verify passkey, then follow your device's instructions.</p>
                    <button type="button" className="protocol-admin-primary" disabled={busy} onClick={() => perform('verify')}>{busy ? 'Please wait...' : 'Verify passkey'}</button>
                    {sessionActive && <p role="status">Admin verification is active for up to 15 minutes.</p>}
                </section>
                {sessionActive && <section aria-labelledby="additionalPasskeyTitle">
                    <h3 id="additionalPasskeyTitle">Add a backup passkey</h3>
                    <p>Your device will offer available passkey options. Choose an independent device or security key for a separate backup.</p>
                    <button type="button" className="protocol-admin-primary" disabled={busy} onClick={() => perform('add')}>Add another passkey</button>
                </section>}
                <details>
                    <summary>Advanced: another device or recovery code</summary>
                    <section aria-labelledby="newPasskeyTitle">
                    <h3 id="newPasskeyTitle">Use an enrollment code</h3>
                    <p>For an additional device or approved recovery, paste your private code and save a passkey on this device. Then verify it above.</p>
                    <label htmlFor="adminEnrollmentCode">Enrollment code</label>
                    <input id="adminEnrollmentCode" type="password" autoComplete="off" spellCheck={false} value={enrollmentCode} disabled={busy}
                        onChange={event => setEnrollmentCode(event.target.value)} />
                    <button type="button" className="protocol-admin-secondary" disabled={busy || !enrollmentCode.trim()} onClick={() => perform('enroll')}>Enroll passkey</button>
                    </section>
                {sessionActive && <AdditionalPasskeyGrant walletAddress={wallet} api={post} onStepUpRequired={onStepUpRequired} />}
                </details>
                <section aria-labelledby="savedPasskeysTitle">
                    <h3 id="savedPasskeysTitle">Saved passkeys</h3>
                    <button type="button" className="protocol-admin-secondary" disabled={busy} onClick={() => perform('show')}>Show my passkeys</button>
                    {credentials && <ul>{credentials.length === 0 && <li>No passkeys saved yet.</li>}{credentials.map((credential, index) => <li key={credential.credential_id}>
                        <span>{credential.label || `Passkey ${index + 1}`}{credential.revoked_at ? ' (removed)' : ''}</span>
                        {!credential.revoked_at && <button type="button" disabled={busy || !sessionActive} onClick={() => perform('revoke', credential.credential_id)}>Remove passkey</button>}
                    </li>)}</ul>}
                    <p>Keep two passkeys on independent devices so you have a backup.</p>
                </section>
                {message && <p className="protocol-admin-message" role="status">{message}</p>}
            </div>
        </dialog>
    );
}
