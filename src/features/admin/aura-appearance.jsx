import { React } from '../../entries/react-runtime.js';
import { auraFrameClassName, auraWords, auraCaption } from '../../ui/components/aura-frame.js';
import { AuraSources } from './aura-sources.jsx';

const sourceMessages = {
    awaiting_ownership: 'Verified mint receipts can identify official ArtSoul NFTs in the Base Sepolia catalog. Current-owner history is verified separately.',
    awaiting_publisher: 'Public Platform frames are waiting for a designated publisher.',
    unavailable: 'Public frame verification is currently unavailable.'
};
const eligibility = {
    platform: 'The NFT comes from a verified ArtSoul publication by the designated publisher.',
    genesis: 'The NFT itself has a verified grant from the designated Genesis contract on Base mainnet.',
    partner: 'The NFT belongs to the specific collection approved as an ArtSoul Partner.'
};

export function AuraAppearance({ api, wallet, isSessionCurrent }) {
    const [setting, setSetting] = React.useState(null);
    const [busy, setBusy] = React.useState(true);
    const [message, setMessage] = React.useState('');
    const [pending, setPending] = React.useState(null);
    const [reload, setReload] = React.useState(0);
    const [preview, setPreview] = React.useState('platform');
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
        <p>Cards and artwork pages show one eligible frame. Platform takes priority, followed by Genesis and Partner.</p>
        {setting && <figure className="admin-aura-preview">
            <figcaption><label>Frame preview <select value={preview} onChange={event => setPreview(event.currentTarget.value)}>
                <option value="platform">Platform</option><option value="genesis">Genesis</option><option value="partner">Partner</option>
            </select></label></figcaption>
            <div className={auraFrameClassName(preview)} aria-hidden="true">
                <img src="/brand/artsoul-audio-cover-384.webp" alt="" width="96" height="96" />
                {enabled && auraCaption(React.createElement, auraWords[preview])}
            </div>
            <p aria-live="polite">{eligibility[preview]}</p>
            <p className="admin-aura-classic-note">Classic shows the frame alone. Switch to Future in the header to see its label.</p>
        </figure>}
        {setting && sourceMessages[setting.publicFrameSource] && !(setting.sourcesEnabled && setting.publicFrameSource === 'awaiting_publisher') && <p>{sourceMessages[setting.publicFrameSource]}</p>}
        {setting?.sourcesEnabled && <AuraSources {...{api,wallet,isSessionCurrent}} />}
        <p>The ArtSoul logo identifies an official NFT. For a blue identity check beside your name, open <a href="/profile">your profile</a>, choose Edit Profile, then Identity verification.</p>
        {!setting && !busy && <button type="button" onClick={() => { setMessage(''); setReload(value => value + 1); }}>Reload setting</button>}
        <p role="status">{pending !== null ? 'Saving frame labels…' : busy ? 'Loading appearance setting…' : message}</p>
    </section>;
}
