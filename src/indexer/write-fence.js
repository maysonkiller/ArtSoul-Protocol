export class IndexerWriteFenceLostError extends Error {
    constructor(reason) {
        super(`Indexer write fence lost: ${reason}`);
        this.name = 'IndexerWriteFenceLostError';
        this.code = 'INDEXER_WRITE_FENCE_LOST';
    }
}

const fail = reason => { throw new IndexerWriteFenceLostError(reason); };

export function requireWriteAuthority(authority) {
    if (!authority?.lockName || !authority.instanceId ||
        !/^[0-9]+$/.test(String(authority.fencingToken)) ||
        typeof authority.isCurrent !== 'function' || !authority.isCurrent()) {
        fail('leadership changed or unavailable');
    }
}

export function requireRecoveryCacheReady(state, allowRecoveryCache = false) {
    if (process.env.REDIS_URL && state.recovery_cache_token != null && !allowRecoveryCache) {
        fail('recovery cache purge pending');
    }
}

// A context belongs to one in-memory range, never a persisted/retryable job.
// xmin is a short-lived row-version check, not a long-term transaction identity.
// Capture BEFORE fetching logs/headers; retries must discard the old payload.
export async function captureWriteContext(engine, authority = engine.getRecoveryAuthority?.(), { allowRecoveryCache = false } = {}) {
    requireWriteAuthority(authority);
    authority = Object.freeze({ ...authority });
    const state = await engine.getIndexerState();
    requireWriteAuthority(authority);
    if (!state || String(state.chain_id) !== engine._chainIdString() ||
        !/^[0-9]+$/.test(String(state.revision)) ||
        !Number.isSafeInteger(Number(state.last_indexed_block)) || Number(state.last_indexed_block) < 0 ||
        !state.contract_address || state.contract_address.toLowerCase() !==
            engine.eventListener.contractAddress?.toLowerCase()) fail('deployment or state unavailable');
    requireRecoveryCacheReady(state, allowRecoveryCache);
    return Object.freeze({ authority, chainId: engine._chainIdString(),
        contractAddress: state.contract_address, revision: state.revision,
        recoveryCacheToken: state.recovery_cache_token, allowRecoveryCache,
        lastIndexedBlock: Number(state.last_indexed_block) });
}

export async function verifyWriteAuthority(client, context) {
    requireWriteAuthority(context?.authority);
    const { lockName, instanceId, fencingToken } = context.authority;
    const result = await client.query(`SELECT 1 FROM public.distributed_locks
        WHERE lock_name=$1 AND instance_id=$2 AND fencing_token=$3 AND expires_at>clock_timestamp()`,
    [lockName, instanceId, String(fencingToken)]);
    if (result.rows.length !== 1) fail('leadership expired');
}

export async function lockWriteContext(client, context) {
    requireWriteAuthority(context?.authority);
    const { lockName, instanceId, fencingToken } = context.authority;
    // Same order as rewind: leadership, state, then projection/lease rows.
    const locked = await client.query(`SELECT lock_name FROM public.distributed_locks
        WHERE lock_name=$1 AND instance_id=$2 AND fencing_token=$3 FOR SHARE`,
    [lockName, instanceId, String(fencingToken)]);
    if (locked.rows.length !== 1) fail('leadership changed');
    await verifyWriteAuthority(client, context);
    const result = await client.query(`SELECT *, xmin::TEXT AS revision FROM indexer_state
        WHERE chain_id = $1 FOR UPDATE`, [context.chainId]);
    const state = result.rows[0];
    if (result.rows.length !== 1 || state.revision !== context.revision ||
        state.contract_address !== context.contractAddress) fail('state changed after read');
    requireRecoveryCacheReady(state, context.allowRecoveryCache);
    // The state lock can have waited behind a recovery or another writer.
    await verifyWriteAuthority(client, context);
    return state;
}

export async function withWriteContext(database, context, operation) {
    requireWriteAuthority(context?.authority);
    const client = await database.pool.connect();
    try {
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        const state = await lockWriteContext(client, context);
        const result = await operation(client, state);
        await verifyWriteAuthority(client, context);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* Keep the original failure. */ }
        throw error;
    } finally {
        client.release();
    }
}
