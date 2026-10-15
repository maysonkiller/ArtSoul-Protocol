import { React } from '../../entries/react-runtime.js';

const { useEffect, useRef, useState } = React;

export function StaffFactorDialog({ walletAddress, api, onClose, onAccessChanged, sessionActive }) {
    const wallet = String(walletAddress || '').toLowerCase();
    const currentWallet = () => String(window.getCurrentWalletAddress?.() || window.currentWalletAddress || '').toLowerCase();
    const dialog = useRef(null), closeButton = useRef(null), epoch = useRef(0), busyRef = useRef(false);
    const nativeCancel = useRef(null), qrEpoch = useRef(0);
    const [status, setStatus] = useState(null), [setup, setSetup] = useState(null), [code, setCode] = useState('');
    const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
    const [qrCode, setQrCode] = useState(null);
    const post = (route, body) => api(route, { method: 'POST', body: JSON.stringify({ ...body, expectedWallet: wallet }) });
    const factor = (operation, body) => post('factor-setup', { operation, ...body });
    function clearQr() { qrEpoch.current++; setQrCode(null); }
    function cancelNative() { const cancel = nativeCancel.current; nativeCancel.current = null; cancel?.(); }
    function clear() { epoch.current++; cancelNative(); busyRef.current = false; setSetup(null); clearQr(); setCode(''); setStatus(null); setBusy(false); }
    function close() { clear(); onClose(); }
    async function run(work) {
        if (busyRef.current || currentWallet() !== wallet) return;
        busyRef.current = true; setBusy(true); setMessage('');
        const token = ++epoch.current, current = () => token === epoch.current && currentWallet() === wallet;
        try { await work(current); }
        catch (error) {
            if (!current()) return;
            const messages = {
                SETUP_PERMISSION_REQUIRED: 'Setup approval expired or was already used. Both authority wallets must approve a new setup.',
                SETUP_PERMISSION_INVALID: 'Setup approval expired or was already used. Both authority wallets must approve a new setup.',
                TOTP_THROTTLED: 'Too many attempts. Wait five minutes before trying again.',
                CODE_NOT_VERIFIED: 'The code did not match. Enter the current six-digit code from your authenticator app.',
                STEP_REPLAYED: 'This code was already used. Wait for the next code in your app.',
                TOTP_ATTEMPT_UNAVAILABLE: 'This check expired. Enter a new code and try again.',
                NO_CREDENTIALS: 'No passkey is available for this wallet. Choose an approved setup method below.',
                STAFF_AUTHORIZATION_CHANGED: 'Staff access changed. Close this window and check access again.',
                TOTP_NOT_CONFIGURED: 'Authenticator app setup is not available yet. You can use a passkey.'
            };
            setMessage(messages[error.code] || (error.name === 'NotAllowedError' ? 'The device did not complete the passkey request. It may have been cancelled or timed out. Try again and complete your device or password manager prompt.' : 'Verification could not be completed. Try again or ask an administrator to check access.'));
            if (['SETUP_PERMISSION_REQUIRED', 'SETUP_PERMISSION_INVALID', 'STAFF_AUTHORIZATION_CHANGED'].includes(error.code)) { setSetup(null); clearQr(); setStatus(null); }
        } finally { if (current()) { busyRef.current = false; setBusy(false); } }
    }
    async function refresh(current) {
        const result = await api(`factor-setup?expectedWallet=${encodeURIComponent(wallet)}`);
        if (current()) setStatus(result);
    }
    useEffect(() => {
        const previous = document.activeElement;
        dialog.current?.showModal(); closeButton.current?.focus();
        run(refresh);
        const invalidate = () => close();
        const storage = event => { if (!event.key || ['artsoul_authenticated_wallet', 'artsoul_wallet'].includes(event.key)) invalidate(); };
        window.addEventListener('artsoul:wallet-state-changed', invalidate);
        window.addEventListener('artsoul:auth-state-changed', invalidate);
        window.addEventListener('storage', storage);
        window.addEventListener('pagehide', invalidate);
        return () => {
            epoch.current++; cancelNative(); dialog.current?.close();
            window.removeEventListener('artsoul:wallet-state-changed', invalidate);
            window.removeEventListener('artsoul:auth-state-changed', invalidate);
            window.removeEventListener('storage', storage);
            window.removeEventListener('pagehide', invalidate);
            if (previous?.isConnected) previous.focus();
        };
    }, [wallet]);
    useEffect(() => {
        if (!status?.setup) return;
        const timer = setTimeout(() => {
            epoch.current++; cancelNative(); busyRef.current = false; setBusy(false); setSetup(null); clearQr(); setCode(''); setStatus(null);
            setMessage('Setup approval expired. Both authority wallets must approve a new setup.');
        }, Math.max(0, Date.parse(status.setup.expiresAt) - Date.now()));
        return () => clearTimeout(timer);
    }, [status?.setup]);
    useEffect(() => {
        let active = true;
        clearQr();
        const token = qrEpoch.current, current = () => active && token === qrEpoch.current && currentWallet() === wallet;
        if (!setup?.uri) return;
        // Encode locally: neither the key nor its QR is sent to an image service.
        import('qrcode').then(({ default: encoder }) => {
            if (!current()) return;
            const { modules } = encoder.create(setup.uri, { errorCorrectionLevel: 'M' });
            const cells = [];
            for (let y = 0; y < modules.size; y++) for (let x = 0; x < modules.size; x++) {
                if (modules.get(y, x)) cells.push(`M${x + 4} ${y + 4}h1v1h-1z`);
            }
            setQrCode({ setup, size: modules.size + 8, path: cells.join('') });
        }).catch(() => { if (current()) setQrCode({ setup, failed: true }); });
        return () => { active = false; };
    }, [setup, wallet]);
    const passkey = enrolling => run(async current => {
        const approval = enrolling ? { mode: 'authority-setup', permissionId: status?.setup?.id } : {};
        const browser = await import('@simplewebauthn/browser');
        if (!current()) return;
        const options = await post(enrolling ? 'passkey-register-options' : 'passkey-auth-options', approval);
        if (!current()) return;
        const cancel = () => browser.WebAuthnAbortService.cancelCeremony();
        nativeCancel.current = cancel;
        let response;
        try {
            response = enrolling ? await browser.startRegistration({ optionsJSON: options.options }) : await browser.startAuthentication({ optionsJSON: options.options });
        } finally { if (nativeCancel.current === cancel) nativeCancel.current = null; }
        if (!current()) return;
        await post(enrolling ? 'passkey-register-verify' : 'passkey-auth-verify', { ...approval, response });
        if (!current()) return;
        setSetup(null); clearQr(); setCode('');
        await refresh(current);
        if (!current()) return;
        setMessage(enrolling ? 'Passkey saved. Select Verify passkey to enter the admin panel.' : 'Verified. Admin access lasts up to 24 hours. Verify again on a new browser or network.');
        await onAccessChanged();
    });
    const prepareApp = () => run(async current => {
        setSetup(null); clearQr();
        const result = await factor('totp-setup', { permissionId: status.setup.id });
        if (current()) { setSetup(result); setCode(''); }
    });
    const verifyCode = event => {
        event.preventDefault();
        const entered = code; setCode('');
        run(async current => {
            const pending = Boolean(setup), factorId = pending ? setup.factorId : status.totpFactorId;
            const attempt = await factor('totp-begin', { factorId, purpose: pending ? 'enrollment' : 'authentication' });
            if (!current()) return;
            await factor('totp-verify', { attemptId: attempt.attemptId, code: entered });
            if (!current()) return;
            setSetup(null); clearQr(); setMessage('Verified. Admin access lasts up to 24 hours. Verify again on a new browser or network.');
            await refresh(current);
            if (current()) await onAccessChanged();
        });
    };
    return <dialog ref={dialog} className="protocol-admin-dialog protocol-admin-passkeys" aria-labelledby="staffFactorTitle"
        onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
        <div className="protocol-admin-passkey-content">
            <header><h2 id="staffFactorTitle">Verify admin access</h2><button ref={closeButton} type="button" onClick={close}>Close</button></header>
            <p>Use your authenticator app or a saved passkey. Your wallet identifies your staff account.</p>
            {sessionActive && <p role="status">Admin verification is active for up to 24 hours. Verify again on a new browser or network.</p>}
            {status?.passkeyAvailable && <button type="button" disabled={busy} onClick={() => passkey(false)}>Verify passkey</button>}
            {status?.setup && <section aria-label="Approved sign-in setup">
                <h3>Choose your sign-in method</h3>
                <p>Both authority wallets approved setup until {new Date(status.setup.expiresAt).toLocaleTimeString()}. Choose one method.</p>
                <button type="button" disabled={busy} onClick={() => passkey(true)}>Set up passkey</button>
                {status.totpAvailable && <button type="button" disabled={busy} onClick={prepareApp}>Set up authenticator app</button>}
            </section>}
            {setup && <section aria-label="Authenticator app setup">
                <h3>Add ArtSoul to your authenticator app</h3>
                <p>In Google Authenticator or another authenticator app, choose “Add account” then “Scan a QR code”. Scan the code below, then enter the six-digit code to finish.</p>
                {qrCode?.setup === setup && qrCode.path ? <svg className="protocol-admin-setup-qr" role="img" aria-label="QR code for authenticator app setup"
                    viewBox={`0 0 ${qrCode.size} ${qrCode.size}`} width="256" height="256" shapeRendering="crispEdges">
                    <rect width="100%" height="100%" fill="var(--c-qr-background)" />
                    <path d={qrCode.path} fill="var(--c-qr-foreground)" />
                </svg> : <p role="status">{qrCode?.setup === setup && qrCode.failed ? 'QR code could not be displayed. Use the setup key below.' : 'Preparing QR code...'}</p>}
                <p>On the same device, open your authenticator using the link below. Or choose “Enter setup key”, name the account ArtSoul and select time-based codes. Keep the QR code and key private.</p>
                <label htmlFor="staffAuthenticatorSecret">Setup key</label>
                <input id="staffAuthenticatorSecret" readOnly autoComplete="off" value={setup.secret} spellCheck={false} onFocus={event => event.target.select()} />
                <a href={setup.uri}>Open authenticator app on this device</a>
            </section>}
            {(setup || status?.totpFactorId) && <form onSubmit={verifyCode}>
                <label htmlFor="staffAuthenticatorCode">Six-digit authentication code</label>
                <input id="staffAuthenticatorCode" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code}
                    onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} disabled={busy} required />
                <button type="submit" disabled={busy || code.length !== 6}>{busy ? 'Verifying...' : 'Verify code'}</button>
            </form>}
            {status && !status.setup && !status.passkeyAvailable && !status.totpFactorId && <p>Ask both authority wallets to approve sign-in setup for this wallet. Wallet login alone does not grant admin access.</p>}
            <p>Lost your sign-in method? Both authority wallets can approve a replacement in Staff access. The previous method stops working when they approve it.</p>
            {!status && <button type="button" disabled={busy} onClick={() => run(refresh)}>{busy ? 'Checking...' : 'Check setup approval'}</button>}
            {message && <p role="status" className="protocol-admin-message">{message}</p>}
        </div>
    </dialog>;
}
