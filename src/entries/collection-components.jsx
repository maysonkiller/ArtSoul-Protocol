import { React } from './react-runtime.js';
import { MECHANISMS, parseEth } from '../features/collections/launch-config.js';
import { getCollectionNetwork } from '../config/collection-networks.js';

export function Field({ label, hint, children, ...input }) {
    return <label className="launch-field"><span>{label}</span>{children || <input {...input} />}{hint && <span className="launch-help">{hint}</span>}</label>;
}

export function PanelTitle({ title, children }) {
    return <div className="launch-panel-title"><h2>{title}</h2>{children && <p>{children}</p>}</div>;
}

export function PhaseTable({ config }) {
    return <div className="launch-table-wrap"><table className="launch-table"><thead><tr><th>Phase</th><th>Allocation</th><th>Mechanism</th><th>Price</th></tr></thead><tbody>{config.phases.map((phase, index) => <tr key={phase.id + ':' + index}><td>{phase.name}</td><td>{phase.allocation}</td><td>{Object.hasOwn(MECHANISMS, phase.mechanism) ? MECHANISMS[phase.mechanism] : 'Unconfigured'}</td><td>{phase.pricing.sourcePhaseId ? `Clearing price of ${config.phases.find(p => p.id === phase.pricing.sourcePhaseId)?.name || 'missing phase'}` : ['claim', 'free'].includes(phase.mechanism) ? (phase.pricing.priceEth === '' || parseEth(phase.pricing.priceEth) === 0n ? 'Free' : 'Invalid free-claim price') : phase.pricing.priceEth ? `${phase.pricing.priceEth} ETH${phase.mechanism === 'uniform-auction' ? ' reserve' : ''}` : 'Not configured'}</td></tr>)}</tbody></table></div>;
}

export function NetworkLabel({ chainId }) {
    return getCollectionNetwork(chainId)?.name || 'Unsupported network';
}

export function LocalDraftNotice() {
    return <div className="launch-note">Local draft only. Nothing is published, deployed or minted. Saving stores this draft in this browser; export a copy to keep it. No wallet signature is required.</div>;
}

export function UtilityList({ config }) {
    if (!config.utilities.length) return <p className="launch-muted">No utility commitments have been declared.</p>;
    return <div className="launch-stack">{config.utilities.map(utility => <div className="launch-phase" key={utility.id}><div className="launch-row"><h3>{utility.label}</h3><span className="launch-pill">{utility.enforcement === 'onchain' ? 'Onchain proposal · unverified' : 'Creator / partner provided'}</span></div><p className="launch-muted" style={{ marginTop: 12 }}>{utility.description}</p>{utility.enforcement === 'onchain' && <p className="launch-help" style={{ marginTop: 12 }}>{utility.contractAddress ? 'Enforcing contract supplied; bytecode and behavior have not been verified.' : 'No enforcing deployment is configured.'}</p>}</div>)}</div>;
}
