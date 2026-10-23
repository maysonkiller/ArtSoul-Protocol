import { MAX_METADATA_BYTES } from '../../config/upload-policy.js';

const ADDRESS = /^0x[0-9a-f]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const copy = value => JSON.parse(JSON.stringify(value));
const userDetails = value => {
    const { aiGuidance, ...details } = value;
    return details;
};

// This store is deliberately separate from pending gallery cards: those are
// disposable presentation records and discard attempts without a returned hash.
// No signed upload URL, auth token or file bytes are stored here.
export async function prepareBrowserPublication({ file, fileHash, wallet, details, assertCurrent, register }, dependencies = {}) {
    wallet = String(wallet || '').toLowerCase();
    if (!ADDRESS.test(wallet) || /^0x0{40}$/.test(wallet) || !/^[0-9a-f]{64}$/.test(fileHash || '') ||
        !file || !Number.isSafeInteger(file.size) || file.size <= 0 || typeof assertCurrent !== 'function') {
        fail('INVALID_MEDIA_PREPARATION');
    }
    // Snapshot before config/storage awaits; later form changes cannot alter it.
    const input = copy(details);
    const request = dependencies.request || ((body, owner) => window.ArtSoulDB.requestPublication(body, owner));
    const ask = async body => {
        assertCurrent();
        const result = await request(body, wallet);
        assertCurrent();
        return result;
    };
    const config = await ask({ action: 'config' });
    if (config?.success !== true) fail('MEDIA_PREPARATION_UNAVAILABLE');
    if (config.enabled === false) return null;
    const core = config.core_address;
    if (config.enabled !== true || config.chain_id !== 84532 || !ADDRESS.test(core || '') ||
        /^0x0{40}$/.test(core) || config.can_submit !== false ||
        (config.submission_enabled === true && config.recovery_enabled !== true)) fail('MEDIA_PREPARATION_UNAVAILABLE');

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
        let status = await ask({ action: 'status', publication_id: id });
        if (status?.publication_id !== id || status.metadata_uri !== draft.metadata_uri || status.can_submit !== false ||
            !['claimed', 'registered', 'conflict'].includes(status.claim_status)) fail('MEDIA_PREPARATION_MISMATCH');
        const reportHash = async hash => {
            if (typeof hash !== 'string' || !/^0x[0-9a-f]{64}$/.test(hash)) fail('INVALID_TRANSACTION_HASH');
            const reported = await ask({ action: 'report-transaction', publication_id: id, transaction_hash: hash });
            if (reported?.publication_id !== id || reported.metadata_uri !== draft.metadata_uri ||
                reported.can_submit !== false || reported.reported_transaction_hash !== hash || !reported.submission_started_at) {
                fail('MEDIA_PREPARATION_MISMATCH');
            }
            return reported;
        };
        if (draft.reported_transaction_hash && !status.reported_transaction_hash && status.submission_started_at) {
            status = await reportHash(draft.reported_transaction_hash);
        }
        // A journal entry without a hash is still an attempt. Only the server
        // can recover it from independently verified registration evidence.
        if (config.recovery_enabled === true && (status.submission_started_at || status.claim_status !== 'claimed')) {
            const recovery = await ask({ action: 'recover', publication_id: id });
            if (recovery?.success !== true || recovery.publication_id !== id || recovery.can_submit !== false ||
                !['registered', 'conflict', 'unresolved', 'reverted'].includes(recovery.state) ||
                (recovery.state === 'registered' && (typeof recovery.registered_artwork_id !== 'string' ||
                    !/^[1-9][0-9]{0,77}$/.test(recovery.registered_artwork_id)))) {
                fail('MEDIA_PREPARATION_MISMATCH');
            }
            return { ...status, recovery, can_submit: false };
        }
        if (config.submission_enabled === true && status.claim_status === 'claimed' && !status.submission_started_at &&
            typeof register === 'function') {
            let beginRequested = false, granted = false;
            const beforeSubmit = async () => {
                if (beginRequested) fail('PUBLICATION_ATTEMPT_PENDING');
                beginRequested = true;
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
