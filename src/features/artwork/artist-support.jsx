import { React } from '../../entries/react-runtime.js';
import { parseUserEthAmount } from '../auction/eth-amount.js';
import { donationMessageState } from './donation-message.js';
import { donationIdentityKey, donationOperations } from './donation-operation.js';
import './artist-support.css';

const { useEffect, useRef, useState } = React;
function eth(value) {
    const wei = BigInt(value || 0), whole = wei / 10n ** 18n;
    const fraction = (wei % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '');
    return `${whole}${fraction ? `.${fraction}` : ''}`;
}
function Donor({ donation }) {
    if (donation.anonymous) return 'Anonymous';
    return <a href={`/profile.html?address=${encodeURIComponent(donation.donor)}`}>
        {donation.donor_name || `${donation.donor.slice(0, 6)}…${donation.donor.slice(-4)}`}
    </a>;
}

export function ArtistSupport({ deployment, artworkId, creator, creatorName, connectedWallet, onReportDonation, initialOpen = false }) {
    const dialog = useRef(null), trigger = useRef(null), busyRef = useRef(false), generation = useRef(0);
    const openedFromCard = useRef(false);
    const [open, setOpen] = useState(false), [amount, setAmount] = useState('');
    const [message, setMessage] = useState(''), [anonymous, setAnonymous] = useState(false);
    const [accepted, setAccepted] = useState(false), [busy, setBusy] = useState(false);
    const [error, setError] = useState(''), [receipt, setReceipt] = useState('');
    const [confirmationVerified, setConfirmationVerified] = useState(false);
    const [receiptReverted, setReceiptReverted] = useState(false), [checking, setChecking] = useState(false);
    const [feed, setFeed] = useState(null), [feedError, setFeedError] = useState(false);
    const [list, setList] = useState(false), [sort, setSort] = useState('newest'), [offset, setOffset] = useState(0);
    const [refresh, setRefresh] = useState(0);
    const [walletBalance, setWalletBalance] = useState('');
    const enabled = deployment?.enabled === true && deployment.chainId === 84532 && Boolean(artworkId && creator);
    const identity = donationIdentityKey({chainId: deployment?.chainId, deployment: deployment?.address,
        artworkId, creator, wallet: connectedWallet});
    useEffect(() => {
        generation.current += 1;
        setOpen(false); setAccepted(false); setChecking(false);
        const apply = record => {
            busyRef.current = record?.status === 'pending'; setBusy(busyRef.current);
            setReceipt(record?.hash || ''); setConfirmationVerified(record?.status === 'confirmed');
            setReceiptReverted(record?.status === 'reverted');
            setError(record?.error || '');
            if (record?.status === 'confirmed') setRefresh(value => value + 1);
        };
        apply(donationOperations.read(identity));
        return donationOperations.subscribe(identity, apply);
    }, [identity, artworkId, creator, enabled]);
    useEffect(() => {
        if (enabled && initialOpen && !openedFromCard.current) {
            openedFromCard.current = true;
            setOpen(true);
        }
    }, [enabled, initialOpen]);
    useEffect(() => {
        setFeed(null); setFeedError(false); setList(false); setSort('newest'); setOffset(0);
    }, [artworkId, creator, deployment?.address]);
    useEffect(() => {
        if (!enabled) return;
        const abort = new AbortController();
        setFeed(null); setFeedError(false);
        fetch(`/api/public/donations?chain_id=84532&artwork_id=${encodeURIComponent(artworkId)}&sort=${sort}&offset=${offset}`,
            {signal: abort.signal}).then(async response => {
            if (!response.ok) throw new Error('Support history is unavailable.');
            const data = await response.json();
            if (data.creator?.toLowerCase() !== creator.toLowerCase() || data.contract_address !== deployment.address) {
                throw new Error('Support history does not match this artwork.');
            }
            if (!abort.signal.aborted) setFeed(data);
        }).catch(() => { if (!abort.signal.aborted) setFeedError(true); });
        return () => abort.abort();
    }, [enabled, artworkId, creator, deployment?.address, sort, offset, refresh]);
    useEffect(() => {
        if (open) {
            setWalletBalance(document.querySelector('[data-network-balance]')?.textContent || '');
            dialog.current?.showModal();
        }
        else if (dialog.current?.open) { dialog.current.close(); trigger.current?.focus(); }
    }, [open]);
    useEffect(() => () => { generation.current += 1; }, []);
    if (!enabled) return null;
    const messageState = donationMessageState(message);
    const close = () => { if (!busyRef.current) setOpen(false); };
    async function checkTransaction() {
        const operation = donationOperations.read(identity);
        if (busyRef.current || !receipt || operation?.status !== 'unverified' || operation.hash !== receipt) return;
        const current = generation.current;
        busyRef.current = true; setBusy(true); setChecking(true); setError('');
        try {
            if (!window.ArtSoulContracts) throw new Error('Reconnect your wallet to check this transaction.');
            const outcome = await window.ArtSoulContracts.checkArtistDonation(deployment.address, artworkId,
                creator, receipt, {expectedWallet:connectedWallet, expectedChainId:84532});
            if (donationOperations.read(identity) === operation) donationOperations.update(identity, outcome);
        } catch (failure) {
            if (current === generation.current) setError(window.ArtSoulTransactionErrors?.message?.(failure) || failure.message);
        } finally {
            if (current === generation.current) { busyRef.current = false; setBusy(false); setChecking(false); }
        }
    }
    async function submit(event) {
        event.preventDefault();
        if (busyRef.current || receipt) return;
        setError('');
        const current = generation.current;
        let reserved = false;
        try {
            if (!accepted) throw new Error('Confirm the support notice before continuing.');
            if (!messageState.valid) throw new Error('The message is too long. Please shorten it.');
            const parsed = parseUserEthAmount(amount);
            if (!connectedWallet) {
                await window.ensureWalletConnected?.();
                throw new Error('Connect your wallet, then review this donation again.');
            }
            if (!identity) throw new Error('Reconnect your wallet and review this support again.');
            reserved = donationOperations.begin(identity);
            if (!reserved) return;
            busyRef.current = true; setBusy(true);
            const provider = await window.web3Modal?.getWalletProvider?.();
            if (!provider || !window.ArtSoulContracts) throw new Error('Reconnect your wallet and try again.');
            await window.ArtSoulContracts.init(provider);
            if (current !== generation.current) { donationOperations.clear(identity); return; }
            const hash = await window.ArtSoulContracts.donateToArtist(
                deployment.address, artworkId, creator, parsed.eth, message, anonymous,
                {expectedWallet: connectedWallet, expectedChainId: 84532,
                    onSubmitted: hash => donationOperations.update(identity, {status:'pending', hash})});
            donationOperations.update(identity, {status:'confirmed', hash});
        } catch (failure) {
            const message = window.ArtSoulTransactionErrors?.message?.(failure) || failure.message;
            if (reserved) {
                if (failure.transactionHash) donationOperations.update(identity,
                    {status:'unverified', hash:failure.transactionHash, error:message});
                else donationOperations.clear(identity);
            }
            if (current === generation.current) {
                setError(message);
            }
        } finally {
            if (current === generation.current) { busyRef.current = false; setBusy(false); }
        }
    }
    return <section className="artist-support" aria-label="Support the artist">
        <button type="button" data-allow-rapid="true" ref={trigger} className="btn-secondary artwork-page-compact-action"
            onClick={() => { setOpen(true); setError(''); }}>Donate</button>
        {feed?.top && <p className="artist-support-top">Largest support: <Donor donation={feed.top}/> · {eth(feed.top.amount)} ETH</p>}
        <button type="button" data-allow-rapid="true" className="btn-secondary artwork-page-compact-action" onClick={() => setList(value => !value)}>
            {list ? 'Close history' : 'View all support'}</button>
        {feedError && <p role="status">Support history is unavailable. <button type="button" data-allow-rapid="true" onClick={() => setRefresh(value => value + 1)}>Retry</button></p>}
        {list && <div className="artist-support-history">
            <label>Order <select value={sort} onChange={event => { setSort(event.target.value); setOffset(0); }}>
                <option value="newest">Newest first</option><option value="amount">Largest first</option>
            </select></label>
            {!feed && !feedError && <p role="status">Loading support…</p>}
            {feed?.donations?.length === 0 && <p>No support recorded yet.</p>}
            {feed?.donations?.map(donation => <article key={`${donation.transaction_hash}:${donation.log_index}`}>
                <p><Donor donation={donation}/> · {eth(donation.amount)} ETH</p>
                {donation.message && <p className="artist-support-message">{donation.message}</p>}
                {donation.message && onReportDonation && <button type="button" data-allow-rapid="true" className="btn-secondary"
                    onClick={() => onReportDonation({transaction_hash: donation.transaction_hash, log_index: donation.log_index})}>Report message</button>}
                <time dateTime={donation.recorded_at}>{new Date(donation.recorded_at).toLocaleString()}</time>
            </article>)}
            {offset > 0 && <button type="button" data-allow-rapid="true" onClick={() => setOffset(value => Math.max(0, value - 20))}>Previous</button>}
            {feed?.next_offset !== null && feed?.next_offset !== undefined &&
                <button type="button" data-allow-rapid="true" onClick={() => setOffset(feed.next_offset)}>Next</button>}
        </div>}
        <dialog ref={dialog} className="artist-support-dialog reauction-modal" aria-labelledby="artistSupportTitle"
            onCancel={event => { event.preventDefault(); close(); }} onClose={() => {
                setOpen(false); window.requestAnimationFrame(() => trigger.current?.focus());
            }}>
            <h2 id="artistSupportTitle">Support the artist</h2>
            <p>{creatorName || 'Creator'}</p><p className="artist-support-address">{creator}</p>
            {walletBalance && <p>Wallet balance: {walletBalance}</p>}
            <p>100% goes to the creator. This does not buy the artwork or provide protocol benefits.</p>
            {receipt ? <div role="status"><p>{checking ? 'Checking transaction…' : busy ? 'Donation sent. Waiting for confirmation…' : receiptReverted
                ? 'The transaction reverted. No donation was completed. You can review the details and try again.' : confirmationVerified
                ? 'Donation confirmed. History may take a moment to update.'
                : 'Your transaction was sent. Its donation result is not verified yet. Check it before sending another donation.'}</p>
                <a href={`https://sepolia.basescan.org/tx/${receipt}`} target="_blank" rel="noopener noreferrer">View transaction</a>
                {error && <p role="alert">{error}</p>}
                {!confirmationVerified && !receiptReverted && !busy && <button type="button" data-allow-rapid="true" className="btn-secondary" onClick={checkTransaction}>Check transaction</button>}
                {(confirmationVerified || receiptReverted) && <button type="button" data-allow-rapid="true" className="btn-main" onClick={() => {
                    if (busyRef.current || !['confirmed','reverted'].includes(donationOperations.read(identity)?.status)) return;
                    donationOperations.clear(identity);
                    setAmount(''); setMessage(''); setAnonymous(false); setAccepted(false); setError('');
                }}>{receiptReverted ? 'Try again' : 'Send another donation'}</button>}
                <button type="button" data-allow-rapid="true" className="btn-secondary" onClick={close} disabled={busy}>Close</button></div> : <form onSubmit={submit}>
                <label>Amount in test ETH<input inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} disabled={busy} required/></label>
                <label>Message (optional)<textarea value={message} onChange={event => setMessage(event.target.value)} disabled={busy} maxLength={1120}/></label>
                <p>{messageState.characters ?? 'Too many'} / 140 characters</p>
                {!messageState.valid && <p role="alert">The message is too long. Please shorten it.</p>}
                <p>You can add a message with any donation greater than zero.</p>
                <label className="artist-support-check"><input type="checkbox" checked={anonymous} onChange={event => setAnonymous(event.target.checked)} disabled={busy}/> Show me as Anonymous on ArtSoul</label>
                <p>Your wallet address and message remain public on-chain.</p>
                <label className="artist-support-check"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} disabled={busy}/> I understand this is voluntary, irreversible and non-refundable.</label>
                {error && <p role="alert">{error}</p>}
                <div className="reauction-modal-actions"><button type="button" data-allow-rapid="true" className="btn-secondary" onClick={close} disabled={busy}>Cancel</button>
                    <button type="submit" data-allow-rapid="true" className="btn-main" disabled={busy || !accepted || !messageState.valid}>{busy ? 'Waiting for your wallet…' : 'Confirm in wallet'}</button></div>
            </form>}
        </dialog>
    </section>;
}
