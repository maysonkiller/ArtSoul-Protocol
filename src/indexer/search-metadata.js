import { readArtworkMetadata } from '../api/safe-artwork-fetch.js';
import { MAX_METADATA_BYTES } from '../config/upload-policy.js';

function metadataForStorage(metadata) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || !Object.keys(metadata).length) return null;
    try {
        // JSON.parse accepts escaped NUL and unpaired UTF-16 surrogates, but
        // PostgreSQL TEXT/JSONB cannot store them. Validate keys and nested values
        // rather than silently changing public metadata or repeatedly poisoning
        // the pending queue. With /u, a valid surrogate pair remains valid.
        const invalidText = /[\u0000\uD800-\uDFFF]/u;
        const json = JSON.stringify(metadata, (key, value) => {
            if (invalidText.test(key) || (typeof value === 'string' && invalidText.test(value)) ||
                (typeof value === 'number' && !Number.isFinite(value))) throw new Error('Unsupported metadata');
            return value;
        });
        return Buffer.byteLength(json, 'utf8') <= MAX_METADATA_BYTES ? json : null;
    } catch { return null; }
}

// Run outside the chain transaction. Four bounded public metadata reads at most;
// failed originals retry hourly and never hold up registration or confirmation.
export async function refreshSearchMetadata(db, { chainId, coreAddress }, readMetadata = readArtworkMetadata) {
    const core = String(coreAddress || '').toLowerCase();
    if (Number(chainId) !== 84532 || !/^0x[0-9a-f]{40}$/.test(core) || /^0x0{40}$/.test(core)) return { checked: 0, updated: 0 };
    const pending = await db.query(`SELECT d.artwork_id::TEXT,d.metadata_uri,d.revision::TEXT
        FROM public.artwork_search_metadata d
        JOIN public.v41_artworks a ON a.chain_id=d.chain_id AND a.artwork_id=d.artwork_id
            AND a.metadata_uri=d.metadata_uri AND a.transaction_hash=d.source_transaction_hash
        JOIN public.indexer_state s ON s.chain_id=a.chain_id AND lower(s.contract_address)=$1
        WHERE d.chain_id=84532 AND d.metadata_status<>'ready' AND d.next_attempt_at<=clock_timestamp()
            AND a.block_number<=s.last_confirmed_block
        ORDER BY d.next_attempt_at,d.artwork_id LIMIT 4`, [core]);
    const results = await Promise.allSettled(pending.map(async row => {
        let metadata;
        try { metadata = await readMetadata(row.metadata_uri); } catch { metadata = {}; }
        const serialized = metadataForStorage(metadata);
        const rawTitle = serialized ? (typeof metadata.name === 'string' ? metadata.name : typeof metadata.title === 'string' ? metadata.title : '') : '';
        const title = [...rawTitle.trim()].slice(0, 512).join('') || `Artwork #${row.artwork_id}`;
        // Revision changes even after a same-ID/same-URI delete and reinsert.
        // No stale enrichment can recreate a reorg-deleted projection row.
        const updated = await db.query(`UPDATE public.artwork_search_metadata d SET title=$1,
            metadata_status=$2,metadata=$7::JSONB,checked_at=clock_timestamp(),next_attempt_at=clock_timestamp()+INTERVAL '1 hour'
            FROM public.v41_artworks a,public.indexer_state s
            WHERE d.chain_id=84532 AND d.artwork_id=$3 AND d.revision=$4 AND d.metadata_uri=$5
                AND a.chain_id=d.chain_id AND a.artwork_id=d.artwork_id
                AND a.metadata_uri=d.metadata_uri AND a.transaction_hash=d.source_transaction_hash
                AND s.chain_id=a.chain_id AND lower(s.contract_address)=$6 AND a.block_number<=s.last_confirmed_block
            RETURNING d.artwork_id::TEXT`, [title, serialized ? 'ready' : 'unavailable', row.artwork_id, row.revision, row.metadata_uri, core, serialized]);
        return updated.length;
    }));
    // Keep the runner's in-flight and shutdown guards until ALL reads/writes
    // finish, including when one database write fails before a slower sibling.
    if (results.some(result => result.status === 'rejected')) throw new Error('Search metadata batch write failed');
    return { checked: pending.length, updated: results.reduce((sum, result) => sum + result.value, 0) };
}
