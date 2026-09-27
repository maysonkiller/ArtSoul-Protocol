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

// This matches the isolated local source, not a deployed address or approved sale.
// It deliberately returns findings, never transaction arguments or inferred terms.
export function reviewLocalContractCapabilities(config) {
    const findings = [];
    const add = (code, message) => findings.push({ code, message });
    const uint32 = value => positive(value) && BigInt(value) <= 0xffffffffn;
    const allowlists = ['merkle', 'wallet-allowlist'];
    if (!uint32(config.maxSupply)) add('CONTRACT_SUPPLY_WIDTH', 'CollectionLaunch maximum supply must fit a positive uint32 (at most 4,294,967,295).');
    if (config.phases.length > 32) add('CONTRACT_PHASE_LIMIT', 'CollectionLaunch supports at most 32 phases; this draft may be saved but cannot be represented by that contract.');
    config.phases.forEach((phase, index) => {
        const label = phase.name || `Phase ${index + 1}`;
        if (!uint32(phase.allocation) || !uint32(phase.walletLimit)) add('CONTRACT_PHASE_WIDTH', `${label}: allocation and wallet limit must fit positive uint32 values.`);
        for (const field of ['startAt', 'endAt']) {
            const timestamp = scheduleTimestamp(phase[field]);
            if (!Number.isFinite(timestamp) || timestamp < 0 || timestamp % 1000 !== 0) add('CONTRACT_TIMESTAMP', `${label}: ${field === 'startAt' ? 'start' : 'end'} must be an exact non-negative whole Unix second; the contract cannot preserve fractional seconds.`);
        }
        if (!['free', 'fixed', 'claim', 'fcfs', 'uniform-auction'].includes(phase.mechanism)) {
            add('CONTRACT_MECHANISM', `${label}: ${Object.hasOwn(MECHANISMS, phase.mechanism) ? MECHANISMS[phase.mechanism] : 'this mechanism'} is not a CollectionLaunch phase. Guaranteed reservation is not implemented; burning and crafting belong to a separate Forge contract.`);
        }
        const eligibility = phase.eligibility.kind;
        if (eligibility !== 'public' && !allowlists.includes(eligibility)) add('CONTRACT_ELIGIBILITY', `${label}: the local contract enforces public access or a Merkle allowlist only. Holder, activity, role and other eligibility require a separately reviewed proof path; they cannot be treated as public access.`);
        if (allowlists.includes(eligibility) && (!/^0x[a-fA-F0-9]{64}$/.test(phase.eligibility.merkleRoot) || /^0x0{64}$/i.test(phase.eligibility.merkleRoot))) add('CONTRACT_MERKLE_ROOT', `${label}: Merkle phases require a non-zero bytes32 root; a wallet list must use the same reviewed proof format.`);
        if (eligibility === 'public' && phase.eligibility.merkleRoot) add('CONTRACT_PUBLIC_ROOT', `${label}: public phases require a zero root. Remove the saved allowlist root explicitly before selecting public access.`);
        if (['public', ...allowlists].includes(eligibility) && phase.eligibility.contractAddress) add('CONTRACT_HOLDER_RULE', `${label}: the saved holder contract has no enforcing field in this phase. Remove it explicitly or keep this draft blocked.`);
        if (phase.mechanism === 'uniform-auction') {
            if (!integer(phase.walletLimit) || Number(phase.walletLimit) !== 1) add('CONTRACT_AUCTION_LIMIT', `${label}: uniform auctions accept exactly one funded bid for one NFT per wallet; multi-unit bids are not implemented.`);
            if (eligibility !== 'public') add('CONTRACT_AUCTION_ELIGIBILITY', `${label}: uniform auctions are public in the local contract; it has no allowlist or holder-proof bid entry.`);
            if (phase.pricing.sourcePhaseId) add('CONTRACT_AUCTION_PRICE_SOURCE', `${label}: an auction requires its own positive reserve and cannot reference another auction's price.`);
        }
        if (['free', 'claim'].includes(phase.mechanism) && phase.pricing.sourcePhaseId) add('CONTRACT_FREE_PRICE_SOURCE', `${label}: a free phase cannot reference an auction price that could charge collectors.`);
        if (phase.pricing.fallback !== 'pause') add('CONTRACT_FALLBACK_POLICY', `${label}: this draft supports stopping minting when a price source is unavailable. The contract's optional fixed fallback needs explicit reviewed economics and is not inferred here.`);
        if (!['unminted', 'next'].includes(phase.unusedSupply)) add('CONTRACT_UNUSED_SUPPLY', `${label}: the contract can leave unused supply unminted or roll it into the immediate next phase only; it cannot jump to a later public phase or return it to an administrable reserve.`);
        if (phase.unusedSupply === 'next' && index === config.phases.length - 1) add('CONTRACT_FINAL_ROLLOVER', `${label}: the final phase cannot roll allocation into a missing next phase.`);
    });
    if (config.creatorEarnings.recipients.length > 1) add('CONTRACT_ROYALTY_SPLIT', 'The local ERC-2981 implementation stores one royalty receiver. Multiple recipients require a reviewed splitter; the builder does not deploy or invent one.');
    if (!integer(config.support.bps) || Number(config.support.bps) !== 0) add('CONTRACT_SUPPORT', 'Voluntary support routing is not implemented in CollectionLaunch or CollectionForge. A non-zero support proposal cannot be activated by this contract.');
    if (config.crafting.enabled && (!integer(config.crafting.inputCount) || Number(config.crafting.inputCount) < 2 || Number(config.crafting.inputCount) > 32)) add('CONTRACT_FORGE_INPUTS', 'CollectionForge accepts 2 to 32 ingredients from one configured collection per output. Crafting is separate from launch phases.');
    return findings;
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
    const contractFindings = reviewLocalContractCapabilities(config);
    return {
        findings, factors, allocationTotal: total.toString(),
        reserve: positive(config.maxSupply) ? (BigInt(config.maxSupply) - total).toString() : null,
        // The factor count is transparent deterministic validation, never an AI score.
        passedFactors: factors.filter(f => f.passed).length,
        contractCompatibility: {
            compatible: findings.length === 0 && contractFindings.length === 0,
            findings: contractFindings,
            notes: [
                'Free, claim, fixed-price and first-come phases map to Fixed for public access or Merkle for reviewed allowlists. A Merkle allowance limits claims; it does not reserve a guaranteed allocation.',
                'Uniform auctions escrow the full bid, accept one bid per wallet with no replacement or cancellation, and prefer earlier equal bids. A linked phase remains unavailable until its source closes and sells out; a partially subscribed source does not qualify, even when it has winners.',
                'Unused supply can move only to the immediate next phase. Unallocated or retained supply has no later admin mint path after configuration lock. Burns never replenish lifetime issuance.',
                'The local contract credits 97.5% of primary proceeds to its creator and 2.5% to its protocol receiver. ERC-2981 royalties are advisory and use one receiver; voluntary support and a collection resale settlement adapter are not implemented. These observations do not approve final launch economics.',
                'A separate Forge can atomically burn 2–32 owned and approved inputs from this collection and mint one output. Its recipe, output metadata and receiver configuration must be reviewed and wired before launch lock. No Genesis right is created.'
            ]
        },
        deploymentBlockers: [
            'No verified Collection Launch deployment is configured for this page.',
            'Compatibility is checked against local source only. Deployment arguments, immutable phase locking and wallet transaction review are not connected.',
            'A symbol, creator, protocol receiver and royalty receiver must be reviewed separately; no missing constructor address is inferred, even for zero royalties. The first phase must still be in the future when locking.',
            'Merkle roots need a durable reviewed claimant/allowance manifest bound to the actual chain, collection address and phase; a root string alone is not proof of eligibility.',
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
