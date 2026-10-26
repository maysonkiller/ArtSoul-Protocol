import { Interface } from 'ethers';

const resaleInterface = new Interface([
    'function resaleListings(uint256) view returns (address seller, uint256 price, bool active)'
]);
const addressPattern = /^0x[0-9a-f]{40}$/i;
const hashPattern = /^0x[0-9a-f]{64}$/i;
const uintPattern = /^(0|[1-9][0-9]*)$/;
export const RESALE_RECONCILIATION_BATCH_SIZE = 8;

// Cancellation has no event in the deployed prototype. Read a bounded set of
// current listing states at the indexed canonical boundary, never at "latest".
export async function readResaleStateAtBlock(eventListener, snapshot) {
    return eventListener._readRpcCall(async provider => {
        const { chainId, coreAddress, blockNumber, blockHash, tokenIds } = snapshot;
        if (BigInt(await provider.send('eth_chainId', [])) !== BigInt(chainId)) {
            throw new Error('Resale reconciliation RPC chain mismatch');
        }
        const blockTag = `0x${BigInt(blockNumber).toString(16)}`;
        const verifyHeader = async () => {
            const header = await provider.send('eth_getBlockByNumber', [blockTag, false]);
            if (header?.hash?.toLowerCase() !== blockHash.toLowerCase()) {
                throw new Error('Resale reconciliation canonical block changed');
            }
        };
        await verifyHeader();
        const results = await Promise.all(tokenIds.map(async tokenId => {
            const data = await provider.send('eth_call', [{
                to: coreAddress, data: resaleInterface.encodeFunctionData('resaleListings', [tokenId])
            }, { blockHash, requireCanonical: true }]);
            const listing = resaleInterface.decodeFunctionResult('resaleListings', data);
            return { tokenId, seller: listing.seller.toLowerCase(), price: listing.price.toString(), active: listing.active };
        }));
        await verifyHeader();
        return results;
    }, 'confirmed resale state');
}

export async function reconcileResaleState(db, options, readSnapshot) {
    const { chainId, coreAddress, blockNumber, leader, isCurrent } = options;
    const cursor = options.cursor || '0';
    const sweepEnd = options.sweepEnd || null;
    const empty = { checked: 0, updated: 0, cursor, sweepEnd };
    if (Number(chainId) !== 84532 || !addressPattern.test(coreAddress || '') ||
        !Number.isSafeInteger(blockNumber) || blockNumber < 1 ||
        !uintPattern.test(cursor) || (sweepEnd !== null && !uintPattern.test(sweepEnd)) ||
        !leader?.lockName || !leader.instanceId || !uintPattern.test(String(leader.fencingToken)) ||
        typeof isCurrent !== 'function' || !isCurrent()) return empty;

    const boundary = await db.query(`SELECT h.block_hash
        FROM public.indexer_state s JOIN public.block_hashes h
            ON h.chain_id=s.chain_id AND h.block_number=s.last_confirmed_block
        WHERE s.chain_id=$1 AND lower(s.contract_address)=$2
            AND s.last_indexed_block=$3 AND s.last_confirmed_block=$3`,
    [String(chainId), coreAddress.toLowerCase(), blockNumber]);
    const blockHash = boundary[0]?.block_hash;
    if (!isCurrent()) return empty;
    if (!hashPattern.test(blockHash || '')) throw new Error('Confirmed resale boundary unavailable');

    const rows = await db.query(`SELECT r.token_id::TEXT, r.xmin::TEXT AS revision,
            r.seller, r.price::TEXT, r.active,
            COALESCE($4::NUMERIC, (SELECT MAX(token_id) FROM public.v41_resale_listings WHERE chain_id=$1))::TEXT AS sweep_end
        FROM public.v41_resale_listings r
        WHERE r.chain_id=$1 AND r.token_id>$2::NUMERIC
            AND ($4::NUMERIC IS NULL OR r.token_id<=$4::NUMERIC)
            AND r.block_number<=$3 AND r.last_updated_block<=$3
        ORDER BY r.token_id LIMIT ${RESALE_RECONCILIATION_BATCH_SIZE}`,
    [String(chainId), cursor, blockNumber, sweepEnd]);
    if (!rows.length) return { ...empty, cursor: '0', sweepEnd: null };
    if (!isCurrent()) return empty;

    const listings = await readSnapshot({ chainId, coreAddress, blockNumber, blockHash, tokenIds: rows.map(row => row.token_id) });
    // Reject partial/malformed batches before any write, including an RPC which
    // returns the default mapping for an already-indexed listing.
    if (!Array.isArray(listings) || listings.length !== rows.length || listings.some((listing, index) =>
        listing.tokenId !== rows[index].token_id || !addressPattern.test(listing.seller || '') ||
        /^0x0{40}$/i.test(listing.seller) || !uintPattern.test(listing.price || '') ||
        typeof listing.active !== 'boolean')) throw new Error('Invalid confirmed resale snapshot');
    if (!isCurrent()) return empty;

    let updated = 0;
    for (let index = 0; index < rows.length; index++) {
        if (!isCurrent()) return { ...empty, checked: index, updated };
        const row = rows[index];
        const listing = listings[index];
        if (row.seller.toLowerCase() === listing.seller.toLowerCase() && row.price === listing.price && row.active === listing.active) continue;
        // xmin also rejects delete/reinsert with identical event fields. Keep
        // original event provenance intact; this is a state observation, not a
        // fabricated ResaleCancelled event or new transaction history entry.
        const changed = await db.query(`UPDATE public.v41_resale_listings r
            SET seller=$1, price=$2::NUMERIC, active=$3, last_updated_block=$4, last_updated_at=clock_timestamp()
            WHERE r.chain_id=$5 AND r.token_id=$6::NUMERIC AND r.xmin::TEXT=$7
                AND r.block_number<=$4 AND r.last_updated_block<=$4
                AND EXISTS (SELECT 1 FROM public.indexer_state s JOIN public.block_hashes h
                    ON h.chain_id=s.chain_id AND h.block_number=s.last_confirmed_block
                    WHERE s.chain_id=r.chain_id AND lower(s.contract_address)=$8
                        AND s.last_indexed_block=$4 AND s.last_confirmed_block=$4 AND h.block_hash=$9
                    FOR SHARE OF s,h)
                AND EXISTS (SELECT 1 FROM public.distributed_locks l
                    WHERE l.lock_name=$10 AND l.instance_id=$11 AND l.fencing_token=$12
                        AND l.expires_at>clock_timestamp() FOR SHARE OF l)
            RETURNING r.token_id::TEXT`,
        [listing.seller.toLowerCase(), listing.price, listing.active, blockNumber, String(chainId), row.token_id,
            row.revision, coreAddress.toLowerCase(), blockHash, leader.lockName, leader.instanceId, String(leader.fencingToken)]);
        updated += changed.length;
    }
    const end = rows[0].sweep_end;
    const last = rows.at(-1).token_id;
    const complete = !end || BigInt(last) >= BigInt(end) || rows.length < RESALE_RECONCILIATION_BATCH_SIZE;
    return { checked: rows.length, updated, cursor: complete ? '0' : last, sweepEnd: complete ? null : end };
}
