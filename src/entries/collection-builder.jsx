import { React, createRoot } from './react-runtime.js';
import { Field, LocalDraftNotice, NetworkLabel, PanelTitle, PhaseTable, UtilityList } from './collection-components.jsx';
import { COLLECTION_NETWORKS } from '../config/collection-networks.js';
import {
    createDraft, createOriginDraft, createPhase, ELIGIBILITY, loadDraft,
    MAX_DRAFT_ITEMS, MECHANISMS, parseDraft, reviewConfig, saveDraft, scheduleTimestamp, UNUSED_SUPPLY
} from '../features/collections/launch-config.js';
import '../features/collections/collections.css';

const { useEffect, useRef, useState } = React;
const STEPS = ['Collection', 'Phases', 'Review'];

function initialDraft() {
    try {
        const saved = loadDraft(window.localStorage);
        return { draft: saved || createDraft(), message: saved ? 'Saved browser draft restored.' : 'Start with your collection. Save when you are ready.' };
    } catch {
        return { draft: createDraft(), message: 'The saved draft could not be loaded. Existing storage has not been changed; you can import a valid copy or start a new draft.' };
    }
}

function utcInput(value) {
    const timestamp = scheduleTimestamp(value);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 16) : '';
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
            const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = 'artsoul-collection-draft.json';
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 0);
            setMessage('JSON copy exported. It is a draft, not a deployed or approved launch.');
        } catch {
            setMessage('Could not export this draft. Check the imported fields and try again.');
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
            <a href="/upload">← Publish a 1/1 artwork</a>
            <span className="launch-pill">Local draft · Unpublished</span>
        </div>
        <div className="launch-hero">
            <div><p className="launch-eyebrow">Collection Launch</p><h1>Shape your collection.</h1><p>Plan the work, the phases, and how collectors can take part. All settings remain editable in this browser.</p></div>
            <div className="launch-actions"><button type="button" className="launch-primary" onClick={save}>Save draft</button><button type="button" onClick={exportDraft}>Export JSON</button></div>
        </div>
        <LocalDraftNotice />
        <div className="launch-draft-tools">
            <div className="launch-actions">
                <button type="button" onClick={() => importInput.current?.click()}>Import JSON</button>
                <button type="button" onClick={restore}>Load saved</button>
                <button type="button" onClick={() => replaceDraft(createDraft(), 'Blank draft opened.')}>Blank draft</button>
                <button type="button" onClick={() => replaceDraft(createOriginDraft(), 'Origin proposal opened. Supply, allocations, pricing and utility are proposals, not approved launch settings.')}>Origin proposal</button>
                {previousDraft && <button type="button" onClick={() => { setDraft(previousDraft); setPreviousDraft(null); setMessage('Previous working draft restored.'); }}>Undo replacement</button>}
                <input ref={importInput} type="file" accept="application/json,.json" aria-label="Import collection draft" hidden onChange={importDraft} />
            </div>
            <p className="launch-banner-status" role="status" aria-live="polite">{message} {dirty ? 'Unsaved changes.' : ''}</p>
        </div>
        <div className="launch-layout">
            <nav className="launch-steps" aria-label="Collection draft steps">{STEPS.map((name, index) => <button key={name} type="button" aria-current={step === index ? 'step' : undefined} onClick={() => setStep(index)}><span className="launch-step-index">0{index + 1}</span>{name}</button>)}</nav>
            <section className="launch-panel" aria-label={STEPS[step]}>
                {step === 0 && <>
                    <PanelTitle title="The collection">Describe your work and its boundaries. These are draft settings; choosing a network does not switch your wallet.</PanelTitle>
                    <div className="launch-stack">
                        <div className="launch-grid">
                            <Field label="Collection name" maxLength={160} value={draft.name} onChange={event => update('name', event.target.value)} />
                            <Field label="Draft network"><select value={draft.chainId} onChange={event => update('chainId', Number(event.target.value))}>
                                {!COLLECTION_NETWORKS.some(network => network.chainId === Number(draft.chainId)) && <option value={draft.chainId}>Unsupported imported network</option>}
                                {COLLECTION_NETWORKS.map(network => <option key={network.chainId} value={network.chainId}>{network.name} · draft only</option>)}
                            </select></Field>
                        </div>
                        <Field label="Description"><textarea value={draft.description} maxLength={20000} onChange={event => update('description', event.target.value)} /></Field>
                        <div className="launch-grid">
                            <Field label="Maximum supply" inputMode="numeric" value={draft.maxSupply} onChange={event => update('maxSupply', event.target.value)} hint="Choose your own draft supply. This does not lock a contract." />
                            <Field label="Metadata base URI" placeholder="ipfs://… or https://…" value={draft.media.metadataBaseURI} onChange={event => updateGroup('media', 'metadataBaseURI', event.target.value)} hint="A reference only; no metadata is uploaded or fetched here." />
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
                            <Field label="Mechanism"><select value={phase.mechanism} onChange={event => updatePhase(index, 'mechanism', event.target.value)}>{!Object.hasOwn(MECHANISMS, phase.mechanism) && <option value={phase.mechanism}>Unsupported imported mechanism</option>}{Object.entries(MECHANISMS).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></Field>
                            {phaseInput(phase, index, 'allocation', 'Allocation', { inputMode: 'numeric' })}
                            {phaseInput(phase, index, 'walletLimit', 'Per-wallet limit', { inputMode: 'numeric' })}
                            {['startAt', 'endAt'].map(key => <Field key={key} label={key === 'startAt' ? 'Starts (UTC)' : 'Ends (UTC)'} type="datetime-local" value={utcInput(phase[key])} onChange={event => updatePhase(index, key, event.target.value ? new Date(`${event.target.value}Z`).toISOString() : '')} />)}
                            {phaseInput(phase, index, 'priceEth', phase.mechanism === 'uniform-auction' ? 'Auction reserve (ETH)' : 'Price (ETH)', { inputMode: 'decimal', hint: 'Exact decimal ETH, up to 18 places. Use 0 for a free claim.' }, 'pricing')}
                            <Field label="Or reference a previous auction"><select value={phase.pricing.sourcePhaseId} onChange={event => updatePhase(index, 'sourcePhaseId', event.target.value, 'pricing')}>
                                <option value="">No price reference</option>
                                {phase.pricing.sourcePhaseId && !draft.phases.slice(0, index).some(p => p.id === phase.pricing.sourcePhaseId && p.mechanism === 'uniform-auction') && <option value={phase.pricing.sourcePhaseId}>Invalid or missing source — review required</option>}
                                {draft.phases.slice(0, index).filter(p => p.mechanism === 'uniform-auction').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select></Field>
                            <Field label="Eligibility"><select value={phase.eligibility.kind} onChange={event => updatePhase(index, 'kind', event.target.value, 'eligibility')}>{!Object.hasOwn(ELIGIBILITY, phase.eligibility.kind) && <option value={phase.eligibility.kind}>Unsupported imported eligibility</option>}{Object.entries(ELIGIBILITY).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></Field>
                            <Field label="Unused allocation"><select value={phase.unusedSupply} onChange={event => updatePhase(index, 'unusedSupply', event.target.value)}>{!Object.hasOwn(UNUSED_SUPPLY, phase.unusedSupply) && <option value={phase.unusedSupply}>Unsupported imported destination</option>}{Object.entries(UNUSED_SUPPLY).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></Field>
                        </div>
                        {phase.pricing.sourcePhaseId && <p className="launch-help">Leave the price field empty when referencing an auction. This draft requires pausing if no clearing price is established; no fallback price is assumed.</p>}
                        {phase.eligibility.kind !== 'public' && <div className="launch-stack launch-footer">
                            <p className="launch-help">Eligibility is a proposal until its proof path is verified. Selecting Genesis does not grant Genesis eligibility or change its allocation rules.</p>
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
                    <PhaseTable config={draft} />
                    <div className="launch-footer"><h3>{review.findings.length ? `${review.findings.length} configuration items to review` : 'Configuration checks passed'}</h3>
                        {review.findings.map((finding, index) => <p className="launch-finding" key={finding.code + ':' + index}><strong>{finding.category}</strong>{finding.message}</p>)}
                    </div>
                    <details className="launch-details"><summary>Utility and financial declarations</summary><div className="launch-stack">
                        <UtilityList config={draft} />
                        <p className="launch-help">Imported utility, crafting, creator earnings and support fields are preserved in your export. This first draft editor does not activate them or verify their enforcement.</p>
                        <dl className="launch-definition"><div><dt>Creator earnings proposal</dt><dd>{draft.creatorEarnings.bps} bps</dd></div><div><dt>Support proposal</dt><dd>{draft.support.bps} bps · {draft.support.destination}</dd></div><div><dt>Crafting proposal</dt><dd>{draft.crafting.enabled ? `${draft.crafting.inputCount} inputs; ${draft.crafting.outputMaxSupply} outputs maximum` : 'Not enabled'}</dd></div></dl>
                    </div></details>
                    <div className="launch-footer"><h3>Publishing is unavailable</h3>{review.deploymentBlockers.map(item => <p className="launch-finding" key={item}>{item}</p>)}<button type="button" disabled>Publish unavailable</button></div>
                </>}
                <div className="launch-footer launch-row"><button type="button" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</button>{step < STEPS.length - 1 ? <button type="button" className="launch-primary" onClick={() => setStep(step + 1)}>Continue to {STEPS[step + 1].toLowerCase()}</button> : <button type="button" className="launch-primary" onClick={save}>Save reviewed draft</button>}</div>
            </section>
            <aside className="launch-panel launch-summary" aria-label="Draft summary">
                <p className="launch-eyebrow">Your draft</p><h3>{draft.name || 'Untitled collection'}</h3>
                <dl><div><dt>Network</dt><dd><NetworkLabel chainId={draft.chainId} /></dd></div><div><dt>Maximum supply</dt><dd>{draft.maxSupply || 'Not set'}</dd></div><div><dt>Allocated</dt><dd>{review.allocationTotal}</dd></div><div><dt>Unallocated</dt><dd>{review.reserve ?? 'Not set'}</dd></div><div><dt>Phases</dt><dd>{draft.phases.length}</dd></div></dl>
                <div className="launch-progress" aria-hidden="true">{review.factors.map(factor => <span key={factor.category} data-passed={factor.passed} />)}</div>
                <p className="launch-help">{review.passedFactors} of {review.factors.length} configuration categories pass. Publishing remains unavailable.</p>
            </aside>
        </div>
    </main>;
}

createRoot(document.getElementById('app')).render(<Builder />);
