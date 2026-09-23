// Draft authoring only. This configuration is not a deployed contract capability.
import { collectionAssetKey, getCollectionNetwork } from '../../config/collection-networks.js';

export const DRAFT_KEY = 'artsoul_collection_draft_v1';
export const SCHEMA_VERSION = 1;
export const MAX_DRAFT_ITEMS = 64;
export const MECHANISMS = Object.freeze({
    free: 'Free mint', fixed: 'Fixed price', claim: 'Claim', fcfs: 'First come, first served',
    gtd: 'Guaranteed allocation', 'uniform-auction': 'Uniform-price auction',
    burn: 'Burn to mint', craft: 'Craft to mint'
});
export const ELIGIBILITY = Object.freeze({
    public: { label: 'Public', enforcement: 'onchain' },
    'wallet-allowlist': { label: 'Wallet allowlist', enforcement: 'onchain' },
    merkle: { label: 'Merkle allowlist', enforcement: 'onchain' },
    genesis: { label: 'Genesis holder', enforcement: 'onchain' },
    nft: { label: 'Specific NFT holder', enforcement: 'onchain' },
    trait: { label: 'Specific NFT trait', enforcement: 'offchain' },
    collection: { label: 'ArtSoul collection holder', enforcement: 'onchain' },
    profile: { label: 'ArtSoul profile status', enforcement: 'offchain' },
    discord: { label: 'Discord role', enforcement: 'offchain' },
    'auction-participant': { label: 'Auction participant', enforcement: 'onchain' },
    'auction-loser': { label: 'Previous auction loser', enforcement: 'onchain' },
    'previous-holder': { label: 'Previous collection holder', enforcement: 'offchain' },
    'previous-phase': { label: 'Previous phase participant', enforcement: 'onchain' },
    partner: { label: 'Partner community', enforcement: 'offchain' },
    forged: { label: 'Forged Origin holder', enforcement: 'onchain' }
});
export const UNUSED_SUPPLY = Object.freeze({ unminted: 'Remain unminted', next: 'Next phase', public: 'Later public phase', reserve: 'Return to reserve' });
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const ZERO_ADDRESS = /^0x0{40}$/i;
const integer = value => (typeof value === 'number' || (typeof value === 'string' && /^[+-]?\d+$/.test(value.trim()))) && Number.isSafeInteger(Number(value));
const positive = value => integer(value) && Number(value) > 0;
const address = value => ADDRESS.test(String(value || '')) && !ZERO_ADDRESS.test(value);
const hasText = value => typeof value === 'string' && value.trim().length > 0;

export function safeUrl(value, allowIpfs = false) {
    try {
        const url = new URL(value);
        if (url.username || url.password) return '';
        return url.protocol === 'https:' || (allowIpfs && url.protocol === 'ipfs:') ? url.href : '';
    } catch { return ''; }
}

export const assetIdentity = collectionAssetKey;

export function parseEth(value) {
    if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)(\.[0-9]{1,18})?$/.test(value)) return null;
    const [whole, fraction = ''] = value.split('.');
    const wei = BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'));
    return wei < (1n << 256n) ? wei : null;
}

export function createPhase(index = 1) {
    return {
        id: `phase-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${index}`}`,
        name: `Phase ${index}`, mechanism: 'fixed', allocation: '', walletLimit: 1,
        startAt: '', endAt: '', eligibility: { kind: 'public', chainId: '', contractAddress: '', merkleRoot: '', note: '' },
        pricing: { priceEth: '', sourcePhaseId: '', fallback: 'pause' }, unusedSupply: 'unminted'
    };
}

export function createDraft() {
    return {
        schemaVersion: SCHEMA_VERSION, status: 'draft', name: '', description: '', chainId: 46630,
        maxSupply: '', media: { bannerUrl: '', avatarUrl: '', metadataBaseURI: '' },
        links: { website: '', x: '', discord: '' }, story: '', holderRights: '',
        phases: [createPhase()], utilities: [],
        creatorEarnings: { bps: 0, recipients: [] }, support: { bps: 0, destination: 'protocol' },
        crafting: { enabled: false, inputCount: '', outputMaxSupply: '' }
    };
}

export function createOriginDraft() {
    const draft = createDraft();
    const phases = [
        ['community', 'Free Community Allowlist', 'claim', 500, 'merkle'],
        ['auction-a', 'Auction A', 'uniform-auction', 500, 'public'],
        ['auction-b', 'Auction B', 'uniform-auction', 500, 'public'],
        ['public', 'Public Mint', 'fixed', 1500, 'public']
    ].map(([id, name, mechanism, allocation, kind], index) => ({
        ...createPhase(index + 1), id, name, mechanism, allocation,
        eligibility: { kind, chainId: 46630, contractAddress: '', merkleRoot: '', note: '' },
        pricing: { priceEth: mechanism === 'claim' ? '0' : '', sourcePhaseId: id === 'public' ? 'auction-b' : '', fallback: 'pause' }
    }));
    return {
        ...draft, name: 'ArtSoul Origin — Season 01', maxSupply: 3000, phases,
        description: 'A proposed collection exploring participation, auction price discovery and onchain crafting. Configuration is a testnet draft; minting and campaign eligibility are not open.',
        holderRights: 'No investment return, partner benefit or Genesis allocation is guaranteed. Final rights and licensing require publication before launch.',
        crafting: { enabled: true, inputCount: 10, outputMaxSupply: 300 },
        utilities: [{ id: 'origin-craft', label: 'Craft Forged Origin', enforcement: 'onchain', description: 'Proposed recipe: burn 10 Origin NFTs to mint 1 distinct Forged Origin NFT atomically. Requires deployed and verified contracts.', contractAddress: '' }]
    };
}

// Refuse malformed stored data instead of upgrading arbitrary input into a launch.
export function parseDraft(raw) {
    if (typeof raw !== 'string' || raw.length > 250000) throw new Error('Draft is missing or too large.');
    const data = JSON.parse(raw);
    const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const items = value => Array.isArray(value) && value.length <= MAX_DRAFT_ITEMS;
    if (!record(data) || data.schemaVersion !== SCHEMA_VERSION || data.status !== 'draft' ||
        !items(data.phases) || !items(data.utilities) ||
        !record(data.media) || !record(data.links) || !record(data.creatorEarnings) || !items(data.creatorEarnings.recipients) ||
        !record(data.support) || !record(data.crafting) || typeof data.crafting.enabled !== 'boolean' ||
        data.phases.some(p => !record(p) || !record(p.eligibility) || !record(p.pricing)) ||
        data.utilities.some(u => !record(u)) || data.creatorEarnings.recipients.some(r => !record(r))) {
        throw new Error('Unsupported collection draft. Export a new draft from the builder.');
    }
    const strings = [data.name, data.description, data.story, data.holderRights,
        data.media.bannerUrl, data.media.avatarUrl, data.media.metadataBaseURI,
        data.links.website, data.links.x, data.links.discord, data.support.destination,
        ...data.phases.flatMap(p => [p.id, p.name, p.mechanism, p.startAt, p.endAt, p.unusedSupply, p.eligibility.kind, p.eligibility.note, p.eligibility.contractAddress, p.eligibility.merkleRoot, p.pricing.priceEth, p.pricing.sourcePhaseId, p.pricing.fallback]),
        ...data.utilities.flatMap(u => [u.id, u.label, u.enforcement, u.description, u.contractAddress]),
        ...data.creatorEarnings.recipients.map(r => r.address)];
    if (strings.some(value => typeof value !== 'string' || value.length > 20000)) throw new Error('Malformed draft fields.');
    // Incomplete numeric inputs may remain editable strings. Objects, booleans
    // and null cannot be used as implicit quantities or React input values.
    const quantities = [data.chainId, data.maxSupply, data.creatorEarnings.bps, data.support.bps,
        data.crafting.inputCount, data.crafting.outputMaxSupply,
        ...data.phases.flatMap(p => [p.allocation, p.walletLimit, p.eligibility.chainId]),
        ...data.creatorEarnings.recipients.map(r => r.bps)];
    if (quantities.some(value => !((typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= 80)))) throw new Error('Malformed draft quantities.');
    return data;
}

export function scheduleTimestamp(value) {
    // Exported drafts must mean the same instant in every browser timezone.
    if (typeof value !== 'string') return NaN;
    const match = value.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/);
    if (!match) return NaN;
    const local = `${match[1]}:${match[2] || '00'}`;
    const calendar = new Date(`${local}Z`);
    if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 19) !== local) return NaN;
    return Date.parse(value);
}

export function saveDraft(storage, draft) {
    const serialized = JSON.stringify(draft);
    parseDraft(serialized);
    storage.setItem(DRAFT_KEY, serialized);
}

export function loadDraft(storage) {
    const raw = storage.getItem(DRAFT_KEY);
    return raw ? parseDraft(raw) : null;
}

export function reviewConfig(config) {
    const findings = [];
    const add = (category, code, message) => findings.push({ category, code, message });
    if (!hasText(config.name)) add('content', 'NAME_REQUIRED', 'Give the collection a name.');
    if (!hasText(config.description)) add('content', 'DESCRIPTION_REQUIRED', 'Explain what the collection is and why it exists.');
    if (!hasText(config.holderRights)) add('content', 'RIGHTS_REQUIRED', 'Publish holder rights and licensing terms before launch.');
    if (!getCollectionNetwork(config.chainId)?.testnet) add('network', 'TESTNET_REQUIRED', 'Only Base Sepolia and Robinhood Chain testnet drafts are supported. Mainnet writes are disabled.');
    if (!positive(config.maxSupply)) add('supply', 'SUPPLY_INVALID', 'Maximum supply must be a positive safe integer.');
    if (!config.phases.length) add('supply', 'PHASE_REQUIRED', 'Add at least one launch phase.');
    const total = config.phases.reduce((sum, phase) => sum + (integer(phase.allocation) ? BigInt(phase.allocation) : 0n), 0n);
    if (positive(config.maxSupply) && total > BigInt(config.maxSupply)) add('supply', 'OVERALLOCATED', `Phase allocations total ${total}, above the maximum supply of ${config.maxSupply}.`);
    const seen = new Set();
    config.phases.forEach((phase, index) => {
        const label = phase.name || `Phase ${index + 1}`;
        if (!hasText(phase.id) || seen.has(phase.id)) add('phases', 'DUPLICATE_PHASE', `${label}: phase IDs must be unique.`);
        seen.add(phase.id);
        if (!hasText(phase.name)) add('phases', 'PHASE_NAME', `Phase ${index + 1} needs a name.`);
        if (!Object.hasOwn(MECHANISMS, phase.mechanism)) add('phases', 'MECHANISM_INVALID', `${label}: choose a supported draft mechanism.`);
        if (!positive(phase.allocation)) add('supply', 'ALLOCATION_INVALID', `${label}: allocation must be a positive safe integer.`);
        if (!positive(phase.walletLimit) || Number(phase.walletLimit) > Number(phase.allocation)) add('supply', 'WALLET_LIMIT_INVALID', `${label}: wallet limit must be at least 1 and no greater than its allocation.`);
        const start = scheduleTimestamp(phase.startAt), end = scheduleTimestamp(phase.endAt);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) add('schedule', 'SCHEDULE_INVALID', `${label}: configure a valid start and a later end, with an explicit timezone.`);
        const previous = config.phases[index - 1];
        if (previous && Number.isFinite(start) && start < scheduleTimestamp(previous.endAt)) add('schedule', 'PHASE_OVERLAP', `${label} starts before ${previous.name} ends. This sequential launch cannot overlap allocations.`);
        if (!Object.hasOwn(UNUSED_SUPPLY, phase.unusedSupply)) add('supply', 'UNUSED_REQUIRED', `${label}: choose an unused allocation destination.`);
        if (phase.unusedSupply === 'next' && index === config.phases.length - 1) add('supply', 'NEXT_MISSING', `${label}: there is no next phase to receive unused supply.`);
        if (phase.unusedSupply === 'public' && !config.phases.slice(index + 1).some(p => p.eligibility.kind === 'public')) add('supply', 'PUBLIC_MISSING', `${label}: there is no later public phase to receive unused supply.`);
        const source = config.phases.findIndex(p => p.id === phase.pricing.sourcePhaseId);
        if (phase.pricing.sourcePhaseId) {
            if (source < 0 || source >= index || config.phases[source].mechanism !== 'uniform-auction') add('pricing', 'PRICE_SOURCE_INVALID', `${label}: clearing-price source must be an earlier uniform-price auction.`);
            if (phase.pricing.priceEth !== '') add('pricing', 'AMBIGUOUS_PRICE', `${label}: choose a fixed price or a clearing-price source, not both.`);
            if (phase.pricing.fallback !== 'pause') add('pricing', 'FALLBACK_REQUIRED', `${label}: stop minting if the source auction cannot establish a price. Alternative economics require review.`);
        } else if (['free', 'claim'].includes(phase.mechanism)) {
            if (phase.pricing.priceEth && parseEth(phase.pricing.priceEth) !== 0n) add('pricing', 'FREE_PRICE', `${label}: free claims cannot charge a price.`);
        } else if (!['burn', 'craft'].includes(phase.mechanism) && (parseEth(phase.pricing.priceEth) === null || parseEth(phase.pricing.priceEth) === 0n)) {
            add('pricing', 'PRICE_REQUIRED', `${label}: set a positive exact ETH price or auction reserve, up to 18 decimal places.`);
        }
        const eligibility = Object.hasOwn(ELIGIBILITY, phase.eligibility.kind) ? ELIGIBILITY[phase.eligibility.kind] : null;
        if (!eligibility) add('eligibility', 'ELIGIBILITY_INVALID', `${label}: choose an eligibility rule.`);
        else if (eligibility.enforcement === 'offchain') add('eligibility', 'OFFCHAIN_PROOF', `${label}: ${eligibility.label} needs a verified attestation or review process; the frontend cannot prove eligibility.`);
        if (phase.eligibility.chainId && Number(phase.eligibility.chainId) !== Number(config.chainId)) add('eligibility', 'CROSS_CHAIN', `${label}: cross-chain eligibility requires a reviewed proof bridge; it cannot be checked as a local holder rule.`);
        if (['nft', 'genesis', 'collection', 'forged'].includes(phase.eligibility.kind) && !address(phase.eligibility.contractAddress)) add('eligibility', 'HOLDER_CONTRACT_REQUIRED', `${label}: provide a non-zero holder contract address.`);
        if (['merkle', 'wallet-allowlist'].includes(phase.eligibility.kind) && !/^0x[a-fA-F0-9]{64}$/.test(phase.eligibility.merkleRoot)) add('eligibility', 'ALLOWLIST_REQUIRED', `${label}: commit a reviewed allowlist Merkle root before launch.`);
        if (phase.eligibility.kind !== 'public' && !hasText(phase.eligibility.note)) add('eligibility', 'ELIGIBILITY_DETAIL', `${label}: describe the eligibility snapshot, proof source and holder instructions.`);
    });
    if (!safeUrl(config.media.metadataBaseURI, true)) add('content', 'METADATA_REQUIRED', 'Provide an HTTPS or IPFS metadata base URI and verify its contents before deployment.');
    for (const [key, value] of Object.entries({ ...config.links, banner: config.media.bannerUrl, avatar: config.media.avatarUrl })) {
        if (value && !safeUrl(value)) add('content', 'LINK_INVALID', `${key}: use a valid HTTPS URL without embedded credentials.`);
    }
    config.utilities.forEach(utility => {
        if (!hasText(utility.label) || !hasText(utility.description)) add('utility', 'UTILITY_DETAIL', 'Each utility needs a label and precise holder instructions.');
        if (!['onchain', 'offchain'].includes(utility.enforcement)) add('utility', 'UTILITY_CLASSIFICATION', 'Classify each utility as onchain or offchain / creator provided.');
        if (utility.enforcement === 'onchain') {
            if (!address(utility.contractAddress)) add('utility', 'UTILITY_CONTRACT_REQUIRED', `${utility.label || 'Utility'}: no enforcing contract is configured. This is a proposal, not a contract guarantee.`);
            else add('utility', 'UTILITY_UNVERIFIED', `${utility.label}: an address alone does not prove enforceability. Verify deployed bytecode and the enforcing method.`);
        }
    });
    const earnings = config.creatorEarnings;
    if (!integer(earnings.bps) || Number(earnings.bps) < 0 || Number(earnings.bps) > 10000) add('fees', 'EARNINGS_INVALID', 'Creator earnings must be between 0 and 10,000 basis points.');
    const splitTotal = earnings.recipients.reduce((sum, recipient) => sum + (integer(recipient.bps) ? Number(recipient.bps) : 0), 0);
    if (splitTotal !== Number(earnings.bps)) add('fees', 'SPLIT_MISMATCH', `Recipient shares total ${splitTotal} bps; configured creator earnings are ${earnings.bps} bps.`);
    const recipients = new Set();
    for (const recipient of earnings.recipients) {
        if (!address(recipient.address) || !positive(recipient.bps)) add('fees', 'RECIPIENT_INVALID', 'Each earnings recipient needs a non-zero wallet and a positive integer share in basis points.');
        const key = String(recipient.address).toLowerCase();
        if (recipients.has(key)) add('fees', 'RECIPIENT_DUPLICATE', 'Combine duplicate recipient wallets into one share.');
        recipients.add(key);
    }
    if (!integer(config.support.bps) || Number(config.support.bps) < 0 || Number(config.support.bps) > 10000 || Number(config.support.bps) + Number(earnings.bps) > 10000) add('fees', 'SUPPORT_INVALID', 'Creator earnings plus voluntary support cannot exceed 100% of the sale.');
    if (!['protocol', 'community', 'split'].includes(config.support.destination)) add('fees', 'SUPPORT_DESTINATION', 'Choose a voluntary support destination.');
    if (config.crafting.enabled && (!positive(config.crafting.inputCount) || !positive(config.crafting.outputMaxSupply) || BigInt(config.crafting.inputCount) * BigInt(config.crafting.outputMaxSupply) > BigInt(positive(config.maxSupply) ? config.maxSupply : 0))) add('utility', 'CRAFT_SUPPLY', 'Craft output supply times the ingredient count must not exceed base maximum supply.');
    const categories = ['content', 'network', 'supply', 'phases', 'schedule', 'pricing', 'eligibility', 'utility', 'fees'];
    const factors = categories.map(category => ({ category, passed: !findings.some(f => f.category === category) }));
    return {
        findings, factors, allocationTotal: total.toString(),
        reserve: positive(config.maxSupply) ? (BigInt(config.maxSupply) - total).toString() : null,
        // The factor count is transparent deterministic validation, never an AI score.
        passedFactors: factors.filter(f => f.passed).length,
        deploymentBlockers: [
            'No verified Collection Launch deployment is configured for this page.',
            'Contract capability matching, immutable phase locking and wallet transaction review are not connected.',
            'Collection marketplace fees and royalty/support receiver policy require reviewed configuration.',
            'Metadata persistence, indexed collection state and a testnet rehearsal are required before publishing.'
        ],
        canPublish: false
    };
}

export function feePreview(saleWei, creatorBps, supportBps) {
    if (typeof saleWei !== 'bigint' || saleWei < 0n || !integer(creatorBps) || !integer(supportBps) || Number(creatorBps) < 0 || Number(supportBps) < 0 || Number(creatorBps) + Number(supportBps) > 10000) return null;
    const creator = saleWei * BigInt(creatorBps) / 10000n;
    const support = saleWei * BigInt(supportBps) / 10000n;
    // Marketplace fee is deliberately unknown until a collection settlement adapter is reviewed.
    return { creator, support, remainingBeforeMarketplaceFee: saleWei - creator - support, marketplaceFee: null };
}
