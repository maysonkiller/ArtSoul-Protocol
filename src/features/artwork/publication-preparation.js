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
export async function prepareBrowserPublication({ file, fileHash, wallet, details, assertCurrent }, dependencies = {}) {
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
        /^0x0{40}$/.test(core) || config.can_submit !== false) fail('MEDIA_PREPARATION_UNAVAILABLE');

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
        const persist = () => {
            assertCurrent();
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
        const status = await ask({ action: 'status', publication_id: id });
        if (status?.publication_id !== id || status.metadata_uri !== draft.metadata_uri || status.can_submit !== false ||
            !['claimed', 'registered', 'conflict'].includes(status.claim_status)) fail('MEDIA_PREPARATION_MISMATCH');
        // Preparation is not registration authorization. In particular, do not
        // call begin or infer that a missing reported hash permits another send.
        return { ...status, can_submit: false };
    });
}
