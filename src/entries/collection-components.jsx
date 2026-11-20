import { React } from './react-runtime.js';
import { MECHANISMS, parseEth, setsMintPrice } from '../features/collections/launch-config.js';
import { getCollectionNetwork } from '../config/collection-networks.js';

export function Field({ label, hint, children, ...input }) {
    return <label className="launch-field"><span>{label}</span>{children || <input {...input} />}{hint && <span className="launch-help">{hint}</span>}</label>;
}

export function PanelTitle({ title, children }) {
    return <div className="launch-panel-title"><h2>{title}</h2>{children && <p>{children}</p>}</div>;
}

export function PhaseTable({ config }) {
    const hasPublicAuction = config.phases.some(phase => phase.mechanism === 'uniform-auction' && phase.eligibility.kind === 'public');
    const hasFirstArtwork = config.phases.some(phase => phase.mechanism === 'first-artwork-auction');
    const hasAllowlistMint = config.phases.some(phase => ['fixed', 'fcfs', 'free', 'claim'].includes(phase.mechanism) &&
        ['merkle', 'wallet-allowlist'].includes(phase.eligibility.kind));
    return <>
        <div className="launch-table-wrap"><table className="launch-table">
            <thead><tr><th>Phase</th><th>Allocation</th><th>Mechanism</th><th>Price</th></tr></thead>
            <tbody>{config.phases.map((phase, index) => {
                const { priceEth, sourcePhaseId, fallback } = phase.pricing;
                let price = 'Not configured';
                if (sourcePhaseId) {
                    const source = config.phases.slice(0, index).find(p => p.id === sourcePhaseId &&
                        setsMintPrice(p) && p.eligibility.kind === 'public');
                    price = 'Price reference needs review';
                    if (source && fallback === 'pause' && !priceEth && ['fixed', 'fcfs'].includes(phase.mechanism)) {
                        price = source.mechanism === 'first-artwork-auction'
                            ? `Settled sale price of ${source.name}. Minting stays closed until it sells.`
                            : `Lowest winning bid in ${source.name} once it sells out. Otherwise minting stays closed.`;
                    }
                } else if (['claim', 'free'].includes(phase.mechanism)) {
                    price = !priceEth || parseEth(priceEth) === 0n ? 'Free' : 'Invalid free-claim price';
                } else if (phase.mechanism === 'mint-reservation') {
                    const minimum = priceEth ? `${priceEth} ETH minimum bid per place` : 'Minimum place bid not set';
                    const mint = phase.reservation?.mintPriceEth;
                    price = `${minimum}. ${mint ? `${mint} ETH due at mint.` : 'Holder mint payment not set.'} The creator pays 2.5% on earned place and mint proceeds. Reselling the place carries a 0% fee.`;
                } else if (priceEth) {
                    price = `${priceEth} ETH${setsMintPrice(phase) ? ' reserve' : ''}`;
                }
                return <tr key={phase.id + ':' + index}>
                    <td>{phase.name}</td><td>{phase.allocation}</td>
                    <td>{Object.hasOwn(MECHANISMS, phase.mechanism) ? MECHANISMS[phase.mechanism] : 'Unconfigured'}</td><td>{price}</td>
                </tr>;
            })}</tbody>
        </table></div>
        {hasPublicAuction && <div className="launch-help">
            <p>Each wallet funds one bid for one NFT. If all units sell, every winner pays the lowest winning bid. If any units remain, winners pay the reserve.</p>
            <p>After settlement, winners can claim their NFT and withdraw any excess. Losing bidders can withdraw their full bid.</p>
        </div>}
        {hasFirstArtwork && <p className="launch-help">Token #1 is reserved for the first artwork. The highest funded bid becomes the price per remaining NFT when the opening sale settles.</p>}
        {config.launchTemplate === 'first-work' && <p className="launch-help">Up to three opening auctions can run, one at a time. If all three end without bids, minting stays closed and the author can request a new review after 30 days. If the first sale settles late, collectors still get the full public mint window.</p>}
        {hasAllowlistMint && <p className="launch-help">Joining the allowlist is free. An eligible wallet can mint at the phase price up to its allowance while units remain.</p>}
    </>;
}

export function NetworkLabel({ chainId }) {
    return getCollectionNetwork(chainId)?.name || 'Unsupported network';
}

export function LocalDraftNotice() {
    return <p className="launch-note">Your draft stays in this browser. To take a copy with you, choose Download draft under Manage drafts.</p>;
}

export function UtilityList({ config }) {
    if (!config.utilities.length) return <p className="launch-muted">No utility commitments have been declared.</p>;
    return <div className="launch-stack">{config.utilities.map(utility => <div className="launch-phase" key={utility.id}><div className="launch-row"><h3>{utility.label}</h3><span className="launch-pill">{utility.enforcement === 'onchain' ? 'Onchain proposal · unverified' : 'Creator / partner provided'}</span></div><p className="launch-muted" style={{ marginTop: 12 }}>{utility.description}</p>{utility.enforcement === 'onchain' && <p className="launch-help" style={{ marginTop: 12 }}>{utility.contractAddress ? 'Enforcing contract supplied; bytecode and behavior have not been verified.' : 'No enforcing deployment is configured.'}</p>}</div>)}</div>;
}
