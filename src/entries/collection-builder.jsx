import { React, createRoot } from './react-runtime.js';
import { Field, LocalDraftNotice, NetworkLabel, PanelTitle, PhaseTable, UtilityList } from './collection-components.jsx';
import { MintReservationTerms } from './mint-reservation-terms.jsx';
import { CollectionScheduleField } from './collection-schedule-field.jsx';
import { COLLECTION_NETWORKS } from '../config/collection-networks.js';
import {
    changeDraftSupply, createAuctionMintDraft, createDraft, createFirstArtworkDraft, createMintReservationDraft, createOriginDraft, createPhase, ELIGIBILITY, hasFirstWorkMint, loadDraft,
    MAX_DRAFT_ITEMS, MECHANISMS, parseDraft, reservationPublicMint, reviewConfig, saveDraft, setsMintPrice, supportsPhaseCallReview, UNUSED_SUPPLY
} from '../features/collections/launch-config.js';
import '../features/collections/collections.css';
import { ExplainedAction } from '../ui/explained-action.jsx';

const { useEffect, useRef, useState } = React;
const STEPS = ['Collection', 'Phases', 'Review'];

function downloadJson(filename, json) {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

function initialDraft() {
    try {
        const saved = loadDraft(window.localStorage);
        return { draft: saved || createDraft(), message: saved ? 'Saved browser draft restored.' : '' };
    } catch {
        return { draft: createDraft(), message: 'The saved draft could not be loaded. Existing storage has not been changed; you can import a valid copy or start a new draft.' };
    }
}

function Builder() {
    const [initial] = useState(initialDraft);
    const [draft, setDraft] = useState(initial.draft);
    const [step, setStep] = useState(0);
    const [message, setMessage] = useState(initial.message);
    const [savedJSON, setSavedJSON] = useState(JSON.stringify(initial.draft));
    const [previousDraft, setPreviousDraft] = useState(null);
    const importInput = useRef(null);
    const importSequence = useRef(0);
    const dirty = JSON.stringify(draft) !== savedJSON;
    const review = reviewConfig(draft);

    useEffect(() => {
        if (!dirty) return;
        const warn = event => { event.preventDefault(); event.returnValue = ''; };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [dirty]);

    const update = (key, value) => setDraft(current => ({ ...current, [key]: value }));
    const updateGroup = (key, field, value) => setDraft(current => ({ ...current, [key]: { ...current[key], [field]: value } }));
    const updatePhase = (index, key, value, group) => setDraft(current => ({ ...current, phases: current.phases.map((phase, i) => i !== index ? phase : {
        ...phase, [group || key]: group ? { ...phase[group], [key]: value } : value
    }) }));

    function changeMechanism(index, mechanism) {
        setDraft(current => ({ ...current, phases: current.phases.map((phase, i) => {
            if (i !== index) return phase;
            const next = { ...phase, mechanism };
            if (mechanism !== 'mint-reservation') delete next.reservation;
            return next;
        }) }));
    }

    function replaceDraft(next, description) {
        setPreviousDraft(draft);
        setDraft(next);
        setMessage(description + ' Your previous working draft can be restored with Undo replacement. Browser storage changes only when you save.');
    }

    function save() {
        try {
            saveDraft(window.localStorage, draft);
            setSavedJSON(JSON.stringify(draft));
            setMessage('Draft saved in this browser. Nothing has been published or deployed.');
        } catch {
            setMessage('Could not save this draft. Existing storage has not been changed. Export a JSON copy to keep your work.');
        }
    }

    function restore() {
        try {
            const saved = loadDraft(window.localStorage);
            if (!saved) { setMessage('No saved draft exists in this browser.'); return; }
            replaceDraft(saved, 'Saved draft loaded.');
            setSavedJSON(JSON.stringify(saved));
        } catch {
            setMessage('Saved draft could not be loaded. Your current draft and browser storage have been kept.');
        }
    }

    function exportDraft() {
        try {
            const json = JSON.stringify(draft);
            parseDraft(json);
            downloadJson('artsoul-collection-draft.json', json);
            setMessage('JSON copy exported. It is a draft, not a deployed or approved launch.');
        } catch {
            setMessage('Could not export this draft. Check the imported fields and try again.');
        }
    }

    async function exportPhaseCalls() {
        try {
            const { preparePhaseCallReview } = await import('../features/collections/phase-call-review.js');
            const calls = preparePhaseCallReview(JSON.stringify(draft));
            downloadJson('artsoul-testnet-phase-calls.json', JSON.stringify(calls, null, 2));
            setMessage('Testnet phase calls downloaded. Nothing was submitted to a wallet.');
        } catch (error) {
            setMessage(error.message || 'The phase calls could not be prepared.');
        }
    }

    async function importDraft(event) {
        const file = event.target.files?.[0];
        if (!file) return;
        const sequence = ++importSequence.current;
        try {
            if (file.size > 1000000) throw new Error('File is too large');
            const imported = parseDraft(await file.text());
            if (sequence !== importSequence.current) return;
            replaceDraft(imported, 'Draft imported.');
        } catch {
            if (sequence === importSequence.current) setMessage('Import failed: unsupported, malformed, or oversized draft. Your current draft and saved copy have been kept.');
        } finally {
            event.target.value = '';
        }
    }

    function movePhase(index, delta) {
        setDraft(current => {
            const phases = [...current.phases];
            [phases[index], phases[index + delta]] = [phases[index + delta], phases[index]];
            return { ...current, phases };
        });
        setMessage('Phase order changed. Review the schedule, price references, and unused supply destinations before saving.');
    }

    const phaseInput = (phase, index, key, label, options = {}, group) => <Field label={label} {...options}
        value={(group ? phase[group][key] : phase[key]) ?? ''}
        onChange={event => updatePhase(index, key, event.target.value, group)} />;

    return <main className="launch-page">
        <div className="launch-topline">
            <a href="/upload">← Create a single artwork</a>
            <span className="launch-pill">Local draft / Unpublished</span>
        </div>
        <div className="launch-hero">
            <div><h1>Create a collection</h1><p>Choose how collectors get their first NFT and how the remaining mints are priced.</p></div>
            <div className="launch-actions"><button type="button" className="launch-primary" data-save-collection-draft="" onClick={save}>Save draft</button></div>
        </div>
        <LocalDraftNotice />
        <div className="launch-draft-tools">
            <div className="launch-actions" role="group" aria-label="Collection templates">
                <button type="button" onClick={() => replaceDraft(createFirstArtworkDraft(), 'First artwork draft opened. The first sale sets one price for the remaining mints.')}>First artwork auction and public mint</button>
                <button type="button" onClick={() => replaceDraft(createAuctionMintDraft(), 'Edition auction draft opened. When all auction units sell, the lowest winning bid sets the public mint price.')}>Edition auction then public mint</button>
                <button type="button" onClick={() => replaceDraft(createMintReservationDraft(), 'Mint reservation draft opened. Set the price to mint with a place and the public mint price before bidding.')}>Auction mint reservations</button>
            </div>
            <details className="launch-details">
                <summary>Manage drafts</summary>
                <div className="launch-actions">
                    <button type="button" onClick={() => importInput.current?.click()} title="Open a previously downloaded collection draft">Open draft file</button>
                    <button type="button" onClick={exportDraft} title="Download a draft file to keep or open on another device">Download draft</button>
                    <button type="button" onClick={restore} title="Restore the last draft saved in this browser">Load saved draft</button>
                    <button type="button" onClick={() => replaceDraft(createDraft(), 'Blank draft opened.')}>New draft</button>
                    <button type="button" onClick={() => replaceDraft(createOriginDraft(), 'Origin proposal opened. Supply, allocations, pricing and utility are proposals, not approved launch settings.')}>Origin proposal</button>
                    <input ref={importInput} type="file" accept="application/json,.json" aria-label="Import collection draft" hidden onChange={importDraft} />
                </div>
            </details>
            {previousDraft && <button type="button" onClick={() => { setDraft(previousDraft); setPreviousDraft(null); setMessage('Previous working draft restored.'); }}>Undo replacement</button>}
            <p className="launch-banner-status" role="status" aria-live="polite">{message} {dirty ? 'Unsaved changes.' : ''}</p>
        </div>
        <div data-visit-slot="collection-steps" hidden />
        <div className="launch-layout">
            <nav className="launch-steps" aria-label="Collection draft steps">{STEPS.map((name, index) => <button key={name} type="button" data-draft-step={name} aria-current={step === index ? 'step' : undefined} onClick={() => setStep(index)}><span className="launch-step-index">0{index + 1}</span>{name}</button>)}</nav>
            <section className="launch-panel" aria-label={STEPS[step]}>
                {step === 0 && <>
                    <div data-visit-slot="collection-name" hidden />
                    <PanelTitle title="The collection">Describe your work and its boundaries. These are draft settings; choosing a network does not switch your wallet.</PanelTitle>
                    <div className="launch-stack">
                        <div className="launch-grid">
                            <Field label="Collection name" id="collectionName" maxLength={160} value={draft.name} onChange={event => update('name', event.target.value)} />
                            <Field label="Draft network"><select value={draft.chainId} onChange={event => update('chainId', Number(event.target.value))}>
                                {!COLLECTION_NETWORKS.some(network => network.chainId === Number(draft.chainId)) && <option value={draft.chainId}>Unsupported imported network</option>}
                                {COLLECTION_NETWORKS.map(network => <option key={network.chainId} value={network.chainId}>{network.name} / draft only</option>)}
                            </select></Field>
                        </div>
                        <Field label="Description"><textarea value={draft.description} maxLength={20000} onChange={event => update('description', event.target.value)} /></Field>
                        <div className="launch-grid">
                            <Field label="Maximum supply" inputMode="numeric" value={draft.maxSupply}
                                onChange={event => { const value = event.target.value; setDraft(current => changeDraftSupply(current, value)); }}
                                hint={hasFirstWorkMint(draft) ? 'Set a total of at least 2. One NFT goes to the opening auction and the rest to the public mint.' : 'Choose your own draft supply. This does not lock a contract.'} />
                            <Field label="Metadata base URI" placeholder="ipfs://CID/" value={draft.media.metadataBaseURI} onChange={event => updateGroup('media', 'metadataBaseURI', event.target.value)} hint={review.tokenOneMetadataURI ? <>Token #1 metadata URI / <bdi>{review.tokenOneMetadataURI}</bdi></> : 'Enter the prefix for numbered metadata files. For a directory, include the final slash.'} />
                        </div>
                        <Field label="Holder rights and licensing"><textarea value={draft.holderRights} maxLength={20000} onChange={event => update('holderRights', event.target.value)} /></Field>
                        <details className="launch-details"><summary>Story, artwork references, and links</summary><div className="launch-stack">
                            <Field label="Collection story"><textarea value={draft.story} maxLength={20000} onChange={event => update('story', event.target.value)} /></Field>
                            <div className="launch-grid">{[['bannerUrl', 'Banner image URL'], ['avatarUrl', 'Collection image URL']].map(([key, label]) => <Field key={key} label={label} value={draft.media[key]} onChange={event => updateGroup('media', key, event.target.value)} />)}</div>
                            {Object.entries({ website: 'Website', x: 'X profile', discord: 'Discord community' }).map(([key, label]) => <Field key={key} label={label} value={draft.links[key]} onChange={event => updateGroup('links', key, event.target.value)} />)}
                        </div></details>
                    </div>
                </>}
                {step === 1 && <>
                    <PanelTitle title="A launch in phases">Set allocations and eligibility in sequence. Draft options below do not imply deployed support. All dates and times are UTC.</PanelTitle>
                    <div className="launch-stack">{draft.phases.map((phase, index) => <article className="launch-phase" key={phase.id + ':' + index} aria-label={`Phase ${index + 1}`}>
                        <div className="launch-row launch-phase-head"><h3>{index + 1}. {phase.name || 'Untitled phase'}</h3><div className="launch-actions">
                            <button type="button" aria-label={`Move phase ${index + 1} up`} disabled={index === 0} onClick={() => movePhase(index, -1)}>↑</button>
                            <button type="button" aria-label={`Move phase ${index + 1} down`} disabled={index === draft.phases.length - 1} onClick={() => movePhase(index, 1)}>↓</button>
                            <button type="button" aria-label={`Remove phase ${index + 1}`} onClick={() => { setPreviousDraft(draft); update('phases', draft.phases.filter((_, i) => i !== index)); setMessage('Phase removed. Use Undo replacement to restore it.'); }}>Remove</button>
                        </div></div>
                        <div className="launch-grid">
                            {phaseInput(phase, index, 'name', 'Phase name', { maxLength: 160 })}
                            <Field label="Mechanism"><select value={phase.mechanism} onChange={event => changeMechanism(index, event.target.value)}>{!Object.hasOwn(MECHANISMS, phase.mechanism) && <option value={phase.mechanism}>Unsupported imported mechanism</option>}{Object.entries(MECHANISMS).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></Field>
                            {phaseInput(phase, index, 'allocation', 'Allocation', { inputMode: 'numeric' })}
                            {phaseInput(phase, index, 'walletLimit', 'Per-wallet limit', { inputMode: 'numeric' })}
                            {['startAt', 'endAt'].map(key => <CollectionScheduleField key={key} label={key === 'startAt' ? 'Starts (UTC)' : 'Ends (UTC)'}
                                value={phase[key]} onChange={value => updatePhase(index, key, value)} />)}
                            {phaseInput(phase, index, 'priceEth', phase.mechanism === 'mint-reservation' ? 'Minimum bid for a place (ETH)' : setsMintPrice(phase) ? 'Auction reserve (ETH)' : 'Price (ETH)', { inputMode: 'decimal', hint: 'Exact decimal ETH, up to 18 places.' }, 'pricing')}
                            <Field label="Or reference a previous auction"><select value={phase.pricing.sourcePhaseId} onChange={event => updatePhase(index, 'sourcePhaseId', event.target.value, 'pricing')}>
                                <option value="">No price reference</option>
                                {phase.pricing.sourcePhaseId && !draft.phases.slice(0, index).some(p => p.id === phase.pricing.sourcePhaseId && setsMintPrice(p)) && <option value={phase.pricing.sourcePhaseId}>Invalid or missing source — review required</option>}
                                {draft.phases.slice(0, index).filter(setsMintPrice).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select></Field>
                            <Field label="Eligibility"><select value={phase.eligibility.kind} onChange={event => updatePhase(index, 'kind', event.target.value, 'eligibility')}>{!Object.hasOwn(ELIGIBILITY, phase.eligibility.kind) && <option value={phase.eligibility.kind}>Unsupported imported eligibility</option>}{Object.entries(ELIGIBILITY).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></Field>
                            <Field label="Unused allocation"><select value={phase.unusedSupply} onChange={event => updatePhase(index, 'unusedSupply', event.target.value)}>{!Object.hasOwn(UNUSED_SUPPLY, phase.unusedSupply) && <option value={phase.unusedSupply}>Unsupported imported destination</option>}{Object.entries(UNUSED_SUPPLY).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></Field>
                        </div>
                        {phase.mechanism === 'first-artwork-auction' && <p className="launch-help">Each bidder funds one bid in full. Token #1 is reserved for the winning collector. The settled bid sets the price for the remaining mints.</p>}
                        {index === 0 && review.contractCompatibility.firstWorkArtifact && <p className="launch-help">If the auction gets no bids, the author can retry twice. Each retry shifts the public mint window with it. A third bidless auction cancels this launch. The author can request a new review 30 days after that auction ends.</p>}
                        {phase.mechanism === 'mint-reservation' && <MintReservationTerms phase={phase}
                            publicPriceEth={reservationPublicMint(draft.phases, index)?.pricing.priceEth}
                            updateReservation={(key, value) => updatePhase(index, key, value, 'reservation')} />}
                        {phase.pricing.sourcePhaseId && <p className="launch-help">Leave the price field empty when referencing an auction. Minting stays closed until the auction establishes its price.</p>}
                        {phase.eligibility.kind !== 'public' && <div className="launch-stack launch-footer">
                            <p className="launch-help">{['merkle', 'wallet-allowlist'].includes(phase.eligibility.kind)
                                ? 'Joining the allowlist is free. The phase price applies when an eligible wallet mints while supply lasts.'
                                : 'Eligibility is a proposal until its proof path is verified. Selecting Genesis does not grant Genesis eligibility or change its allocation rules.'}</p>
                            <div className="launch-grid">
                                {phaseInput(phase, index, 'chainId', 'Eligibility chain ID', { inputMode: 'numeric' }, 'eligibility')}
                                {phaseInput(phase, index, 'contractAddress', 'Holder contract address', {}, 'eligibility')}
                            </div>
                            {phaseInput(phase, index, 'merkleRoot', 'Allowlist Merkle root', {}, 'eligibility')}
                            <Field label="Eligibility proof and holder instructions"><textarea value={phase.eligibility.note} onChange={event => updatePhase(index, 'note', event.target.value, 'eligibility')} /></Field>
                        </div>}
                    </article>)}</div>
                    {!draft.phases.length && <p className="launch-muted">No phases yet. Add one to start configuring your launch.</p>}
                    <div className="launch-footer"><button type="button" disabled={draft.phases.length >= MAX_DRAFT_ITEMS} onClick={() => update('phases', [...draft.phases, createPhase(draft.phases.length + 1)])}>Add phase</button></div>
                </>}
                {step === 2 && <>
                    <PanelTitle title="Review the draft">These are deterministic configuration checks, not an AI review or an approval to launch.</PanelTitle>
                    {review.tokenOneMetadataURI && <p className="launch-note">Token #1 metadata URI / <bdi>{review.tokenOneMetadataURI}</bdi>. Verify the file before launch.</p>}
                    <PhaseTable config={draft} />
                    <div className="launch-footer"><h3>{review.findings.length ? `${review.findings.length} configuration items to review` : 'Configuration checks passed'}</h3>
                        {review.findings.map((finding, index) => <p className="launch-finding" key={finding.code + ':' + index}><strong>{finding.category}</strong>{finding.message}</p>)}
                    </div>
                    <section className="launch-footer" aria-label="Local contract compatibility">
                        <h3>Local contract compatibility</h3>
                        {review.contractCompatibility.firstWorkArtifact && <p className="launch-help">This template uses the local <code>{review.contractCompatibility.firstWorkArtifact}</code> contract. Any author can use it. ArtSoul reviews Partner status and identity verification separately.</p>}
                        <p className="launch-help">{review.contractCompatibility.compatible ? 'These draft settings fit the current local contract checks. Deployment and sale approval are still required.' : 'This draft needs changes before it can fit the current local contracts. Resolve the configuration items above and the limitations below.'}</p>
                        {review.contractCompatibility.findings.map((finding, index) => <p className="launch-finding" key={finding.code + ':' + index}>{finding.message}</p>)}
                        {review.contractCompatibility.compatible && supportsPhaseCallReview(draft) &&
                            <button type="button" onClick={exportPhaseCalls}>Download testnet phase calls</button>}
                        <details className="launch-details"><summary>How the local contracts interpret these settings</summary>{review.contractCompatibility.notes.map(note => <p className="launch-finding" key={note}>{note}</p>)}</details>
                    </section>
                    <details className="launch-details"><summary>Utility and financial declarations</summary><div className="launch-stack">
                        <UtilityList config={draft} />
                        <p className="launch-help">Imported utility, crafting, creator earnings and support fields are preserved in your export. This first draft editor does not activate them or verify their enforcement.</p>
                        <dl className="launch-definition"><div><dt>Creator earnings proposal</dt><dd>{draft.creatorEarnings.bps} bps{review.contractCompatibility.firstWorkArtifact && !draft.creatorEarnings.recipients.length ? ' to the collection creator' : ''}</dd></div><div><dt>Support proposal</dt><dd>{draft.support.bps} bps / {draft.support.destination}</dd></div><div><dt>Crafting proposal</dt><dd>{draft.crafting.enabled ? `${draft.crafting.inputCount} inputs; ${draft.crafting.outputMaxSupply} outputs maximum` : 'Not enabled'}</dd></div></dl>
                    </div></details>
                    <div className="launch-footer"><h3>Publishing is unavailable</h3>{review.deploymentBlockers.map(item => <p className="launch-finding" key={item}>{item}</p>)}<ExplainedAction explanationTitle="This collection is a draft"
                        reason="Collection publishing is not enabled yet. You can review and save this draft. A supported deployment and its launch settings must be verified before a collection can accept payments.">Publish unavailable</ExplainedAction></div>
                </>}
                <div className="launch-footer launch-row"><button type="button" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</button>{step < STEPS.length - 1 ? <button type="button" className="launch-primary" onClick={() => setStep(step + 1)}>Continue to {STEPS[step + 1].toLowerCase()}</button> : <button type="button" className="launch-primary" onClick={save}>Save reviewed draft</button>}</div>
            </section>
            <aside className="launch-panel launch-summary" aria-label="Draft summary">
                <p className="launch-eyebrow">Your draft</p><h3>{draft.name || 'Untitled collection'}</h3>
                <dl><div><dt>Network</dt><dd><NetworkLabel chainId={draft.chainId} /></dd></div><div><dt>Maximum supply</dt><dd>{draft.maxSupply || 'Not set'}</dd></div><div><dt>Allocated</dt><dd>{review.allocationTotal}</dd></div><div><dt>Unallocated</dt><dd>{review.reserve ?? 'Not set'}</dd></div><div><dt>Phases</dt><dd>{draft.phases.length}</dd></div></dl>
                <div className="launch-progress" aria-hidden="true">{review.factors.map(factor => <span key={factor.category} data-passed={factor.passed} />)}</div>
                <p className="launch-help">{review.passedFactors} of {review.factors.length} configuration categories pass. {review.contractCompatibility.compatible ? 'Local contract checks pass.' : 'Local contract compatibility needs review.'} Publishing remains unavailable.</p>
            </aside>
        </div>
    </main>;
}

const root = import.meta.hot?.data.root ?? createRoot(document.getElementById('app'));
if (import.meta.hot) import.meta.hot.data.root = root;
root.render(<Builder />);
