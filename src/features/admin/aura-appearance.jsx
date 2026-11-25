import { React } from '../../entries/react-runtime.js';
import { auraFrameClassName, auraFrameLabels } from '../../ui/components/aura-frame.js';

const sourceMessages = {
    awaiting_ownership: 'Public frames are waiting for ownership verification on this deployment.',
    awaiting_publisher: 'Public Platform frames are waiting for a designated publisher.',
    unavailable: 'Public frame verification is currently unavailable.'
};

export function AuraAppearance({ api, wallet, isSessionCurrent }) {
    const [setting, setSetting] = React.useState(null);
    const [busy, setBusy] = React.useState(true);
    const [message, setMessage] = React.useState('');
    const [pending, setPending] = React.useState(null);
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
    async function change(enabled) {
        if (busy || !setting || !isSessionCurrent()) return;
        setBusy(true);
        setPending(enabled);
        setMessage('');
        try {
            const saved = await api(path, { method: 'PUT', body: JSON.stringify({ enabled, revision: setting.revision }) });
            if (!isSessionCurrent()) return;
            setSetting(saved);
            setMessage(saved.enabled ? 'Frame labels enabled.' : 'Frame labels disabled.');
        } catch (error) {
            if (!isSessionCurrent()) return;
            setMessage(error.message || 'Could not save the appearance setting.');
            setReload(value => value + 1);
        } finally {
            if (isSessionCurrent()) { setPending(null); setBusy(false); }
        }
    }
    const enabled = pending ?? setting?.enabled;
    return <section className="protocol-admin-setup admin-aura-setting" aria-labelledby="aura-appearance-heading">
        <h2 id="aura-appearance-heading">NFT appearance</h2>
        <label><input type="checkbox" checked={enabled === true} disabled={busy || !setting}
            onChange={event => change(event.currentTarget.checked)} /> Show labels on verified NFT frames in Future</label>
        <p>Labels appear on NFT cards and artwork pages that have a verified Platform, Genesis or Partner frame.</p>
        {setting && <figure className="admin-aura-preview">
            <figcaption>Platform frame preview</figcaption>
            <div className={auraFrameClassName('platform')} aria-hidden="true">
                <img src="/brand/artsoul-audio-cover-384.webp" alt="" width="96" height="96" />
                {enabled && <span className="artsoul-aura-caption">{auraFrameLabels.platform}</span>}
            </div>
            <p className="admin-aura-classic-note">Classic shows the frame alone. Switch to Future in the header to see its label.</p>
        </figure>}
        {setting && sourceMessages[setting.publicFrameSource] && <p>{sourceMessages[setting.publicFrameSource]}</p>}
        {!setting && !busy && <button type="button" onClick={() => { setMessage(''); setReload(value => value + 1); }}>Reload setting</button>}
        <p role="status">{pending !== null ? 'Saving frame labels…' : busy ? 'Loading appearance setting…' : message}</p>
    </section>;
}
