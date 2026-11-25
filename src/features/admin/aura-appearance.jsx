import { React } from '../../entries/react-runtime.js';

export function AuraAppearance({ api, wallet, isSessionCurrent }) {
    const [setting, setSetting] = React.useState(null);
    const [busy, setBusy] = React.useState(true);
    const [message, setMessage] = React.useState('');
    const [reload, setReload] = React.useState(0);
    const path = 'aura-border?wallet=' + encodeURIComponent(wallet.toLowerCase());
    React.useEffect(() => {
        const controller = new AbortController();
        setBusy(true);
        setSetting(null);
        api(path, { signal: controller.signal }).then(value => {
            if (!controller.signal.aborted && isSessionCurrent()) setSetting(value);
        }, () => {
            if (!controller.signal.aborted && isSessionCurrent()) setMessage('Could not load the appearance setting.');
        }).finally(() => {
            if (!controller.signal.aborted && isSessionCurrent()) setBusy(false);
        });
        return () => controller.abort();
    }, [api, path, reload]);
    async function change() {
        if (busy || !setting || !isSessionCurrent()) return;
        setBusy(true);
        setMessage('');
        try {
            const saved = await api(path, { method: 'PUT', body: JSON.stringify({ enabled: !setting.enabled, revision: setting.revision }) });
            if (!isSessionCurrent()) return;
            setSetting(saved);
            setMessage('Appearance setting saved.');
        } catch (error) {
            if (!isSessionCurrent()) return;
            setMessage(error.message || 'Could not save the appearance setting.');
            setReload(value => value + 1);
        } finally {
            if (isSessionCurrent()) setBusy(false);
        }
    }
    return <section className="protocol-admin-setup" aria-labelledby="aura-appearance-heading">
        <h2 id="aura-appearance-heading">NFT appearance</h2>
        <label><input type="checkbox" checked={setting?.enabled === true} disabled={busy || !setting}
            onChange={change} /> Show a label along verified NFT frames in Future</label>
        <p>The label stays still for Genesis and when a visitor prefers reduced motion.</p>
        {!setting && !busy && <button type="button" onClick={() => { setMessage(''); setReload(value => value + 1); }}>Reload setting</button>}
        <p role="status">{busy ? 'Loading appearance setting…' : message}</p>
    </section>;
}
