import { MAX_METADATA_BYTES, MAX_ARTWORK_UPLOAD_BYTES, ALLOWED_ARTWORK_MIME_TYPES } from '../../config/upload-policy.js';

const ADDRESS = /^0x[0-9a-f]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TRANSACTION_HASH = /^0x[0-9a-f]{64}$/;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const copy = value => JSON.parse(JSON.stringify(value));
const userDetails = value => {
    const { aiGuidance, ...details } = value;
    return details;
};

// Local records are candidates for a server check, never proof of a send or
// permission to send. Discover no-hash and older drafts without rewriting them.
export function readBrowserPublications({ wallet, coreAddress }, dependencies = {}) {
    wallet = String(wallet || '').toLowerCase();
    coreAddress = String(coreAddress || '').toLowerCase();
    if (!ADDRESS.test(wallet) || /^0x0{40}$/.test(wallet) ||
        !ADDRESS.test(coreAddress) || /^0x0{40}$/.test(coreAddress)) return [];
    let storage;
    try {
        storage = dependencies.storage ?? globalThis.localStorage;
        const count = storage?.length;
        if (!Number.isSafeInteger(count) || count < 0 || count > 2000) fail('PUBLICATION_STORAGE_UNAVAILABLE');
        const prefix = `artsoul_media_publication:84532:${coreAddress}:${wallet}:`;
        const attempts = [];
        for (let index = 0; index < count; index++) {
            const key = storage.key(index);
            if (typeof key !== 'string' || !key.startsWith(prefix)) continue;
            const hash = key.slice(prefix.length);
            const raw = storage.getItem(key);
            if (raw === null) continue; // Another tab may remove an entry during enumeration.
            if (!/^[0-9a-f]{64}$/.test(hash) || raw.length > MAX_METADATA_BYTES * 3) fail('PUBLICATION_DRAFT_INVALID');
            let draft;
            try { draft = JSON.parse(raw); } catch { fail('PUBLICATION_DRAFT_INVALID'); }
            if (!draft || draft.version !== 1 || typeof draft.publication_id !== 'string' || !UUID.test(draft.publication_id) ||
                draft.chain_id !== 84532 || draft.core_address !== coreAddress ||
                draft.creator_wallet !== wallet || draft.file_sha256 !== hash ||
                !Number.isSafeInteger(draft.byte_size) || draft.byte_size <= 0 || draft.byte_size > MAX_ARTWORK_UPLOAD_BYTES ||
                !ALLOWED_ARTWORK_MIME_TYPES.includes(draft.content_type) ||
                (draft.reported_transaction_hash != null && (typeof draft.reported_transaction_hash !== 'string' ||
                    !TRANSACTION_HASH.test(draft.reported_transaction_hash)))) {
                fail('PUBLICATION_DRAFT_INVALID');
            }
            // A record saved before preparation cannot yet have reached begin.
            if (draft.metadata_uri == null) continue;
            if (typeof draft.metadata_uri !== 'string' || !draft.metadata_uri || draft.metadata_uri.length > 2048) {
                fail('PUBLICATION_DRAFT_INVALID');
            }
            if (attempts.some(attempt => attempt.publicationId === draft.publication_id)) fail('PUBLICATION_DRAFT_INVALID');
            attempts.push({ publicationId: draft.publication_id, wallet, coreAddress,
                metadataUri: draft.metadata_uri, reportedTransactionHash: draft.reported_transaction_hash || null,
                title: typeof draft.details?.title === 'string' ? draft.details.title.slice(0, 160) : 'Saved artwork' });
            if (attempts.length > 50) fail('PUBLICATION_STORAGE_UNAVAILABLE');
        }
        return attempts;
    } catch (error) {
        if (error?.code === 'PUBLICATION_DRAFT_INVALID') throw error;
        fail('PUBLICATION_STORAGE_UNAVAILABLE');
    }
}

function publicationRequest(wallet, assertCurrent, dependencies) {
    const request = dependencies.request || ((body, owner) => window.ArtSoulDB.requestPublication(body, owner));
    return async body => {
        assertCurrent();
        const result = await request(body, wallet);
        assertCurrent();
        return result;
    };
}

function validateConfiguration(config) {
    if (config?.success !== true || config.enabled !== true || config.chain_id !== 84532 ||
        !ADDRESS.test(config.core_address || '') || /^0x0{40}$/.test(config.core_address) ||
        config.can_submit !== false || (config.submission_enabled === true && config.recovery_enabled !== true)) {
        fail('MEDIA_PREPARATION_UNAVAILABLE');
    }
}

function validateStatus(status, id, metadataUri) {
    if (status?.publication_id !== id || status.metadata_uri !== metadataUri || status.can_submit !== false ||
        !['claimed', 'registered', 'conflict'].includes(status.claim_status) ||
        (status.reported_transaction_hash != null && !TRANSACTION_HASH.test(status.reported_transaction_hash)) ||
        (status.submission_started_at != null && (typeof status.submission_started_at !== 'string' || !status.submission_started_at))) {
        fail('MEDIA_PREPARATION_MISMATCH');
    }
    return status;
}

async function reportPublicationHash(ask, id, metadataUri, hash) {
    if (typeof hash !== 'string' || !TRANSACTION_HASH.test(hash)) fail('INVALID_TRANSACTION_HASH');
    const reported = validateStatus(await ask({ action: 'report-transaction', publication_id: id, transaction_hash: hash }), id, metadataUri);
    if (reported.reported_transaction_hash !== hash || !reported.submission_started_at) fail('MEDIA_PREPARATION_MISMATCH');
    return reported;
}

async function recoverPublicationStatus(ask, id, status) {
    const recovery = await ask({ action: 'recover', publication_id: id });
    if (recovery?.success !== true || recovery.publication_id !== id || recovery.can_submit !== false ||
        !['registered', 'conflict', 'unresolved', 'reverted'].includes(recovery.state) ||
        (recovery.state === 'registered' && (typeof recovery.registered_artwork_id !== 'string' ||
            !/^[1-9][0-9]{0,77}$/.test(recovery.registered_artwork_id)))) {
        fail('MEDIA_PREPARATION_MISMATCH');
    }
    return { ...status, recovery, can_submit: false };
}

// Checking an existing attempt never uses the current form, re-prepares metadata,
// or asks for permission to send, including after a lost begin response.
export async function checkBrowserPublication({ publicationId, wallet, coreAddress, metadataUri,
    reportedTransactionHash, assertCurrent }, dependencies = {}) {
    wallet = String(wallet || '').toLowerCase();
    coreAddress = String(coreAddress || '').toLowerCase();
    if (!UUID.test(publicationId || '') || !ADDRESS.test(wallet) || /^0x0{40}$/.test(wallet) ||
        !ADDRESS.test(coreAddress) || /^0x0{40}$/.test(coreAddress) ||
        typeof metadataUri !== 'string' || !metadataUri || typeof assertCurrent !== 'function') fail('INVALID_MEDIA_PREPARATION');
    if (reportedTransactionHash != null && (typeof reportedTransactionHash !== 'string' ||
        !TRANSACTION_HASH.test(reportedTransactionHash))) fail('INVALID_TRANSACTION_HASH');
    const ask = publicationRequest(wallet, assertCurrent, dependencies);
    const config = await ask({ action: 'config' });
    validateConfiguration(config);
    if (config.core_address !== coreAddress || config.recovery_enabled !== true) fail('MEDIA_PREPARATION_UNAVAILABLE');
    let status = validateStatus(await ask({ action: 'status', publication_id: publicationId }), publicationId, metadataUri);
    if (reportedTransactionHash && status.reported_transaction_hash && reportedTransactionHash !== status.reported_transaction_hash) {
        fail('MEDIA_PREPARATION_MISMATCH');
    }
    if (reportedTransactionHash && !status.reported_transaction_hash && status.submission_started_at) {
        status = await reportPublicationHash(ask, publicationId, metadataUri, reportedTransactionHash);
    }
    return recoverPublicationStatus(ask, publicationId, status);
}

// This store is deliberately separate from pending gallery cards: those are
// disposable presentation records and discard attempts without a returned hash.
// No signed upload URL, auth token or file bytes are stored here.
export async function prepareBrowserPublication({ file, fileHash, wallet, details, assertCurrent, register, onAttempt }, dependencies = {}) {
    wallet = String(wallet || '').toLowerCase();
    if (!ADDRESS.test(wallet) || /^0x0{40}$/.test(wallet) || !/^[0-9a-f]{64}$/.test(fileHash || '') ||
        !file || !Number.isSafeInteger(file.size) || file.size <= 0 || typeof assertCurrent !== 'function') {
        fail('INVALID_MEDIA_PREPARATION');
    }
    // Snapshot before config/storage awaits; later form changes cannot alter it.
    const input = copy(details);
    const ask = publicationRequest(wallet, assertCurrent, dependencies);
    const config = await ask({ action: 'config' });
    if (config?.success !== true) fail('MEDIA_PREPARATION_UNAVAILABLE');
    if (config.enabled === false) return null;
    validateConfiguration(config);
    const core = config.core_address;

    let storage, locks;
    try {
        storage = dependencies.storage ?? globalThis.localStorage;
        locks = dependencies.locks ?? globalThis.navigator?.locks;
    } catch { fail('PUBLICATION_STORAGE_UNAVAILABLE'); }
    if (!storage || typeof locks?.request !== 'function') fail('PUBLICATION_STORAGE_UNAVAILABLE');
    const key = `artsoul_media_publication:${config.chain_id}:${core}:${wallet}:${fileHash}`;
    return locks.request(key, { mode: 'exclusive' }, async () => {
        assertCurrent();
        let draft;
        try {
            const raw = storage.getItem(key);
            draft = raw === null ? null : JSON.parse(raw);
            if (raw !== null && (!draft || !UUID.test(draft.publication_id || ''))) fail('PUBLICATION_DRAFT_INVALID');
        } catch { fail('PUBLICATION_DRAFT_INVALID'); }
        const scope = { chain_id: 84532, core_address: core, creator_wallet: wallet,
            file_sha256: fileHash, byte_size: file.size, content_type: file.type };
        if (draft) {
            if (draft.version !== 1 || Object.entries(scope).some(([name, value]) => draft[name] !== value)) {
                fail('PUBLICATION_DRAFT_INVALID');
            }
            // Fresh mandatory guidance can differ after a reload. The original
            // estimate stays pinned in metadata; only changed user inputs block
            // resuming the same file, rather than generating another attempt.
            if (!draft.details || JSON.stringify(userDetails(draft.details)) !== JSON.stringify(userDetails(input))) {
                fail('PUBLICATION_DETAILS_LOCKED');
            }
        } else {
            const publicationId = (dependencies.randomUUID || (() => crypto.randomUUID()))();
            if (!UUID.test(publicationId || '')) fail('PUBLICATION_STORAGE_UNAVAILABLE');
            draft = { version: 1, publication_id: publicationId, ...scope,
                file_name: file.name, details: input, created_at: new Date().toISOString() };
        }
        const persist = (submitted = false) => {
            // The original wallet's returned hash must survive even if the
            // user switches accounts while the native wallet is responding.
            if (!submitted) assertCurrent();
            try {
                const value = JSON.stringify(draft);
                storage.setItem(key, value);
                if (storage.getItem(key) !== value) fail('PUBLICATION_STORAGE_UNAVAILABLE');
            } catch { fail('PUBLICATION_STORAGE_UNAVAILABLE'); }
        };
        // Persist before issue: a lost response must not allocate a new UUID.
        persist();
        const id = draft.publication_id;
        const issued = await ask({ action: 'issue', publication_id: id,
            file_name: draft.file_name, content_type: file.type, size: file.size });
        if (issued?.publication_id !== id || issued.chain_id !== 84532 || issued.core_address !== core ||
            issued.can_submit !== false) fail('MEDIA_PREPARATION_MISMATCH');
        const mediaUrl = issued.upload_complete === true ? issued.media?.url : issued.upload?.public_url;
        const mediaPath = issued.upload_complete === true ? issued.media?.path : issued.upload?.path;
        if (typeof mediaUrl !== 'string' || !mediaUrl || typeof mediaPath !== 'string' || !mediaPath ||
            (draft.media_url && (draft.media_url !== mediaUrl || draft.media_path !== mediaPath)) ||
            (issued.upload_complete === true && issued.media?.sha256 !== fileHash)) fail('MEDIA_PREPARATION_MISMATCH');
        draft.media_url = mediaUrl;
        draft.media_path = mediaPath;
        if (!draft.metadata) {
            const createMetadata = dependencies.createMetadata || (input => window.IPFSClient.createMetadata(input));
            draft.metadata = copy(createMetadata({ ...draft.details, imageUrl: mediaUrl,
                mediaType: file.type, creator: wallet, createdAt: draft.created_at }));
        }
        if (new TextEncoder().encode(JSON.stringify(draft.metadata)).length > MAX_METADATA_BYTES) {
            fail('INVALID_PUBLICATION_METADATA');
        }
        persist();
        if (issued.upload_complete !== true) {
            assertCurrent();
            const upload = dependencies.upload || (input => window.ArtSoulDB.uploadIssuedBlob(input));
            try { await upload({ blob: file, fileName: draft.file_name, signedUpload: issued.upload,
                signal: AbortSignal.timeout(60000) }); }
            catch { /* A lost PUT/duplicate-object response is resolved by server byte verification. */ }
            assertCurrent();
        }
        const prepared = await ask({ action: 'prepare', publication_id: id, metadata: copy(draft.metadata) });
        if (prepared?.publication_id !== id || prepared.media_sha256 !== fileHash || prepared.can_submit !== false ||
            !['CLAIMED', 'RESUME', 'REGISTERED'].includes(prepared.claim_status) ||
            typeof prepared.metadata_uri !== 'string' || !prepared.metadata_uri ||
            (draft.metadata_uri && draft.metadata_uri !== prepared.metadata_uri)) fail('MEDIA_PREPARATION_MISMATCH');
        draft.metadata_uri = prepared.metadata_uri;
        persist();
        let status = validateStatus(await ask({ action: 'status', publication_id: id }), id, draft.metadata_uri);
        const reportHash = hash => reportPublicationHash(ask, id, draft.metadata_uri, hash);
        const notifyAttempt = (hash = draft.reported_transaction_hash || status.reported_transaction_hash || null) => {
            // UI callbacks are not a persistence channel and cannot suppress either
            // durable hash write if rendering or optional local UI state fails.
            try { Promise.resolve(onAttempt?.({ publicationId: id, wallet, coreAddress: core,
                metadataUri: draft.metadata_uri, reportedTransactionHash: hash })).catch(() => {}); }
            catch { /* The server and browser journals remain authoritative. */ }
        };
        if (status.submission_started_at || status.claim_status !== 'claimed') notifyAttempt();
        if (draft.reported_transaction_hash && !status.reported_transaction_hash && status.submission_started_at) {
            status = await reportHash(draft.reported_transaction_hash);
        }
        // A journal entry without a hash is still an attempt. Only the server
        // can recover it from independently verified registration evidence.
        if (config.recovery_enabled === true && (status.submission_started_at || status.claim_status !== 'claimed')) {
            return recoverPublicationStatus(ask, id, status);
        }
        if (config.submission_enabled === true && status.claim_status === 'claimed' && !status.submission_started_at &&
            typeof register === 'function') {
            let beginRequested = false, granted = false;
            const beforeSubmit = async () => {
                if (beginRequested) fail('PUBLICATION_ATTEMPT_PENDING');
                beginRequested = true;
                notifyAttempt();
                const begun = await ask({ action: 'begin', publication_id: id });
                if (begun?.success !== true || begun.publication_id !== id || begun.chain_id !== 84532 ||
                    begun.core_address !== core || begun.metadata_uri !== draft.metadata_uri ||
                    !begun.submission_started_at || typeof begun.submission_created !== 'boolean' ||
                    begun.can_submit !== begun.submission_created) fail('MEDIA_PREPARATION_MISMATCH');
                if (!begun.can_submit || begun.claim_status !== 'claimed' || begun.reported_transaction_hash) {
                    fail('PUBLICATION_ATTEMPT_PENDING');
                }
                granted = true;
            };
            const onSubmitted = async value => {
                const hash = typeof value === 'string' ? value.toLowerCase() : '';
                if (!granted || !/^0x[0-9a-f]{64}$/.test(hash) ||
                    (draft.reported_transaction_hash && draft.reported_transaction_hash !== hash)) fail('INVALID_TRANSACTION_HASH');
                draft.reported_transaction_hash = hash;
                notifyAttempt(hash);
                // Either storage channel may fail independently after broadcast.
                try { persist(true); } finally { await reportHash(hash); }
            };
            try {
                const registration = await register({ metadataUri: draft.metadata_uri, mediaUrl, mediaPath,
                    coreAddress: core, beforeSubmit, onSubmitted });
                assertCurrent();
                if (!granted || typeof registration?.artworkId !== 'string' ||
                    !/^[1-9][0-9]{0,77}$/.test(registration.artworkId) ||
                    typeof registration.txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(registration.txHash)) {
                    fail('MEDIA_PREPARATION_MISMATCH');
                }
                return { ...status, registration, can_submit: false };
            } catch (error) {
                if (!beginRequested) throw error;
                // Even a wallet cancellation cannot prove that no delayed
                // request will be broadcast. Preserve the attempt for recovery.
                throw Object.assign(new Error('PUBLICATION_ATTEMPT_PENDING'), { code: 'PUBLICATION_ATTEMPT_PENDING', cause: error });
            }
        }
        // Preparation, status and a missing hash never authorize a wallet send.
        return { ...status, can_submit: false };
    });
}
