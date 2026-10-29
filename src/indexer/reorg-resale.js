import { readResaleStateAtBlock, RESALE_RECONCILIATION_BATCH_SIZE } from './resale-state-reconciliation.js';

const addressPattern = /^0x[0-9a-f]{40}$/i;
const hashPattern = /^0x[0-9a-f]{64}$/i;
const uintPattern = /^(0|[1-9][0-9]*)$/;
const stateSql = `SELECT last_indexed_block, last_confirmed_block, contract_address,
    xmin::TEXT AS revision FROM public.indexer_state WHERE chain_id=$1`;
const rowsSql = `SELECT token_id::TEXT, xmin::TEXT AS revision FROM public.v41_resale_listings
    WHERE chain_id=$1 AND block_number<$2 AND last_updated_block>=$2 ORDER BY token_id`;

function requireCurrent(plan) {
    if (!plan.authority?.isCurrent()) throw new Error('Reorg resale leadership changed');
}

// All archive RPC reads finish before the rewind transaction takes locks. A
// prepared snapshot is disposable: cursor/row/leadership changes require a new
// preparation, never partial application or a fallback to latest state.
export async function prepareResaleRewind(client, chainId, requestedBoundary, listener, getAuthority, expectedState = null) {
    const authority = getAuthority?.();
    if (!authority?.lockName || !authority.instanceId ||
        !uintPattern.test(String(authority.fencingToken)) || typeof authority.isCurrent !== 'function') {
        throw new Error('Reorg authority or deployment unavailable');
    }
    requireCurrent({ authority });
    const { rows } = await client.query(stateSql, [String(chainId)]);
    if (rows.length !== 1) throw new Error('Missing indexer state for reorg');
    const state = rows[0];
    if (expectedState && (String(expectedState.chain_id) !== String(chainId) ||
        ['last_indexed_block','last_confirmed_block','contract_address','revision']
            .some(key => String(state[key]) !== String(expectedState[key])))) {
        throw new Error('Startup recovery snapshot is stale');
    }
    const indexed = Number(state.last_indexed_block), confirmed = Number(state.last_confirmed_block);
    if (![indexed, confirmed].every(value => Number.isSafeInteger(value) && value >= 0)) {
        throw new Error('Invalid indexer cursor for reorg');
    }
    const rewindTo = Math.min(indexed, requestedBoundary - 1);
    // Never retain facts after the state snapshot boundary.
    const boundary = rewindTo + 1;
    const plan = { chainId: String(chainId), state, rewindTo, boundary, authority,
        confirmedTo: Math.min(confirmed, rewindTo), rows: [], listings: [] };
    plan.rows = (await client.query(rowsSql, [plan.chainId, boundary])).rows;
    if (!plan.rows.length) return plan;
    if (Number(chainId) !== 84532 || !addressPattern.test(listener?.contractAddress || '') ||
        listener.contractAddress.toLowerCase() !== state.contract_address?.toLowerCase() ||
        Number(listener.chainId) !== Number(chainId)) {
        throw new Error('Reorg resale authority or deployment unavailable');
    }
    requireCurrent(plan);
    const hashes = (await client.query(`SELECT block_hash FROM public.block_hashes
        WHERE chain_id=$1 AND block_number=$2`, [plan.chainId, rewindTo])).rows;
    plan.blockHash = hashes[0]?.block_hash;
    // Sparse historical indexing may not have this exact header. Do not use a
    // nearby header or overwrite a conflicting one to force recovery through.
    if (!hashPattern.test(plan.blockHash || '')) throw new Error('Reorg resale boundary unavailable');
    for (let offset = 0; offset < plan.rows.length; offset += RESALE_RECONCILIATION_BATCH_SIZE) {
        requireCurrent(plan);
        const batch = plan.rows.slice(offset, offset + RESALE_RECONCILIATION_BATCH_SIZE);
        const listings = await readResaleStateAtBlock(listener, {
            chainId, coreAddress: listener.contractAddress, blockNumber: rewindTo,
            blockHash: plan.blockHash, tokenIds: batch.map(row => row.token_id)
        });
        if (!Array.isArray(listings) || listings.length !== batch.length || listings.some((listing, index) =>
            listing.tokenId !== batch[index].token_id || !addressPattern.test(listing.seller || '') ||
            /^0x0{40}$/i.test(listing.seller) || !uintPattern.test(listing.price || '') ||
            typeof listing.active !== 'boolean')) throw new Error('Invalid reorg resale snapshot');
        plan.listings.push(...listings);
    }
    requireCurrent(plan);
    return plan;
}

export async function verifyResaleRewindAuthority(client, plan) {
    requireCurrent(plan);
    const { lockName, instanceId, fencingToken } = plan.authority;
    // Run after acquiring the row lock and again immediately before commit.
    // clock_timestamp() is deliberately evaluated after any lock wait.
    const result = await client.query(`SELECT 1 FROM public.distributed_locks
        WHERE lock_name=$1 AND instance_id=$2 AND fencing_token=$3 AND expires_at>clock_timestamp()`,
    [lockName, instanceId, String(fencingToken)]);
    if (result.rows.length !== 1) throw new Error('Reorg resale leadership expired');
}

export async function lockResaleRewind(client, plan) {
    const { lockName, instanceId, fencingToken } = plan.authority;
    const locked = await client.query(`SELECT lock_name FROM public.distributed_locks
        WHERE lock_name=$1 AND instance_id=$2 AND fencing_token=$3 FOR SHARE`,
    [lockName, instanceId, String(fencingToken)]);
    if (locked.rows.length !== 1) throw new Error('Reorg resale leadership changed');
    await verifyResaleRewindAuthority(client, plan);
    const { rows } = await client.query(`${stateSql} FOR UPDATE`, [plan.chainId]);
    const state = rows[0];
    if (rows.length !== 1 || ['last_indexed_block','last_confirmed_block','contract_address','revision']
        .some(key => state[key] !== plan.state[key])) throw new Error('Reorg preparation is stale');
    const current = (await client.query(`${rowsSql} FOR UPDATE`, [plan.chainId, plan.boundary])).rows;
    if (current.length !== plan.rows.length || current.some((row, index) =>
        row.token_id !== plan.rows[index].token_id || row.revision !== plan.rows[index].revision)) {
        throw new Error('Reorg resale rows changed');
    }
    if (plan.blockHash) {
        const hashes = (await client.query(`SELECT block_hash FROM public.block_hashes
            WHERE chain_id=$1 AND block_number=$2 FOR SHARE`, [plan.chainId, plan.rewindTo])).rows;
        if (hashes.length !== 1 || hashes[0].block_hash !== plan.blockHash) {
            throw new Error('Reorg resale boundary changed');
        }
    }
    await verifyResaleRewindAuthority(client, plan);
}

export async function applyResaleRewind(client, plan) {
    for (let index = 0; index < plan.rows.length; index++) {
        const row = plan.rows[index], listing = plan.listings[index];
        const result = await client.query(`UPDATE public.v41_resale_listings
            SET seller=$1,price=$2::NUMERIC,active=$3,last_updated_block=$4,last_updated_at=clock_timestamp()
            WHERE chain_id=$5 AND token_id=$6::NUMERIC AND xmin::TEXT=$7 RETURNING token_id`,
        [listing.seller.toLowerCase(), listing.price, listing.active, plan.rewindTo,
            plan.chainId, row.token_id, row.revision]);
        if (result.rows.length !== 1) throw new Error('Reorg resale application lost its row');
    }
}
