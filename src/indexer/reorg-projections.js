// Rebuild primary lifecycle fields from retained facts in the caller's rewind
// transaction. Never replay event handlers: they enqueue delivery and increment
// trust. Off-chain fields, media, moderation and retained row identities survive.
// Resale observations are restored separately from hash-pinned contract state.
export async function restorePrimaryReorgProjections(client, chainId, boundary) {
    const scope = [String(chainId), boundary];
    await client.query(`WITH restored AS (
        SELECT a.chain_id, a.auction_id,
            COALESCE(b.bid_amount,0) AS current_bid, b.bidder AS current_bidder,
            COALESCE(x.new_end_time,a.original_end_time) AS end_time,
            CASE WHEN s.settlement_status='completed' THEN 'settled'
                 WHEN s.settlement_status='defaulted' THEN 'defaulted'
                 WHEN e.auction_id IS NULL THEN 'active'
                 WHEN e.winner IS NULL OR e.winner='0x0000000000000000000000000000000000000000'
                    THEN 'defaulted_no_bids' ELSE 'settlement_pending' END AS status,
            NULLIF(e.winner,'0x0000000000000000000000000000000000000000') AS winner,
            e.winning_bid, NULLIF(e.settlement_deadline,to_timestamp(0)) AS settlement_deadline,
            s.final_price, s.token_id, s.artist_amount, s.platform_amount,
            last_event.block_number, last_event.indexed_at
        FROM public.v41_auctions a
        LEFT JOIN LATERAL (SELECT * FROM public.v41_bids b
            WHERE b.chain_id=a.chain_id AND b.auction_id=a.auction_id
            ORDER BY b.block_number DESC,b.log_index DESC LIMIT 1) b ON true
        LEFT JOIN LATERAL (SELECT * FROM public.v41_auction_extensions x
            WHERE x.chain_id=a.chain_id AND x.auction_id=a.auction_id
            ORDER BY x.block_number DESC,x.log_index DESC LIMIT 1) x ON true
        LEFT JOIN LATERAL (SELECT * FROM public.v41_auction_endings e
            WHERE e.chain_id=a.chain_id AND e.auction_id=a.auction_id
            ORDER BY e.block_number DESC,e.log_index DESC LIMIT 1) e ON true
        LEFT JOIN public.v41_settlements s ON s.chain_id=a.chain_id AND s.auction_id=a.auction_id
        CROSS JOIN LATERAL (SELECT * FROM (VALUES
            (a.block_number,a.log_index,a.indexed_at), (b.block_number,b.log_index,b.indexed_at),
            (x.block_number,x.log_index,x.indexed_at), (e.block_number,e.log_index,e.indexed_at),
            (s.block_number,s.log_index,s.indexed_at)
        ) v(block_number,log_index,indexed_at) WHERE block_number IS NOT NULL
            ORDER BY block_number DESC,log_index DESC LIMIT 1) last_event
        WHERE a.chain_id=$1 AND a.last_updated_block >= $2
    ) UPDATE public.v41_auctions a SET current_bid=r.current_bid,current_bidder=r.current_bidder,
        end_time=r.end_time,total_extension_seconds=EXTRACT(EPOCH FROM (r.end_time-a.original_end_time))::BIGINT,
        status=r.status,winner=r.winner,winning_bid=r.winning_bid,settlement_deadline=r.settlement_deadline,
        final_price=r.final_price,token_id=r.token_id,default_artist_amount=r.artist_amount,
        default_platform_amount=r.platform_amount,last_updated_block=r.block_number,last_updated_at=r.indexed_at
      FROM restored r WHERE a.chain_id=r.chain_id AND a.auction_id=r.auction_id`, scope);

    await client.query(`WITH restored AS (
        SELECT a.chain_id,a.artwork_id,(s.auction_id IS NOT NULL) AS minted,
            floor_event.token_id,COALESCE(floor_event.floor_price,0) AS canonical_floor,
            CASE WHEN latest.status IN ('active','settlement_pending') THEN latest.auction_id END AS active_auction_id,
            last_event.block_number,last_event.indexed_at
        FROM public.v41_artworks a
        LEFT JOIN LATERAL (SELECT * FROM public.v41_settlements s
            WHERE s.chain_id=a.chain_id AND s.artwork_id=a.artwork_id AND s.settlement_status='completed'
            ORDER BY s.block_number DESC,s.log_index DESC LIMIT 1) s ON true
        LEFT JOIN LATERAL (SELECT * FROM (
            SELECT f.token_id,f.floor_price,f.block_number,f.log_index,f.indexed_at FROM public.v41_floor_history f
              WHERE f.chain_id=a.chain_id AND f.artwork_id=a.artwork_id
            UNION ALL SELECT s.token_id,s.final_price,s.block_number,s.log_index,s.indexed_at
              WHERE s.auction_id IS NOT NULL
        ) v ORDER BY block_number DESC,log_index DESC LIMIT 1) floor_event ON true
        LEFT JOIN LATERAL (SELECT u.auction_id,u.status FROM public.v41_auctions u
            WHERE u.chain_id=a.chain_id AND u.artwork_id=a.artwork_id
            ORDER BY u.block_number DESC,u.log_index DESC LIMIT 1) latest ON true
        CROSS JOIN LATERAL (SELECT * FROM (
            SELECT a.block_number,a.log_index,a.indexed_at
            UNION ALL SELECT u.block_number,u.log_index,u.indexed_at FROM public.v41_auctions u
              WHERE u.chain_id=a.chain_id AND u.artwork_id=a.artwork_id
            UNION ALL SELECT s2.block_number,s2.log_index,s2.indexed_at FROM public.v41_settlements s2
              WHERE s2.chain_id=a.chain_id AND s2.artwork_id=a.artwork_id
            UNION ALL SELECT e.block_number,e.log_index,e.indexed_at FROM public.v41_auction_endings e
              JOIN public.v41_auctions u ON u.chain_id=e.chain_id AND u.auction_id=e.auction_id
              WHERE u.chain_id=a.chain_id AND u.artwork_id=a.artwork_id
                AND (e.winner IS NULL OR e.winner='0x0000000000000000000000000000000000000000')
            UNION ALL SELECT floor_event.block_number,floor_event.log_index,floor_event.indexed_at
              WHERE floor_event.block_number IS NOT NULL
        ) v ORDER BY block_number DESC,log_index DESC LIMIT 1) last_event
        WHERE a.chain_id=$1 AND a.last_updated_block >= $2
    ) UPDATE public.v41_artworks a SET minted=r.minted,token_id=r.token_id,
        canonical_floor=r.canonical_floor,active_auction_id=r.active_auction_id,
        last_updated_block=r.block_number,last_updated_at=r.indexed_at
      FROM restored r WHERE a.chain_id=r.chain_id AND a.artwork_id=r.artwork_id`, scope);

    // Keep the row and suspicious_flags even if every settlement was orphaned.
    // Those are independent moderation inputs, not reversible chain facts.
    await client.query(`WITH restored AS (
        SELECT t.chain_id,t.user_address,
            COUNT(*) FILTER (WHERE s.settlement_status='completed') AS successful,
            COUNT(*) FILTER (WHERE s.settlement_status='defaulted') AS failed,
            MAX(s.block_number) AS block_number,MAX(s.indexed_at) AS indexed_at
        FROM public.v41_trust_signals t LEFT JOIN public.v41_settlements s
          ON s.chain_id=t.chain_id AND s.winner=t.user_address
        WHERE t.chain_id=$1 AND t.last_updated_block >= $2
        GROUP BY t.chain_id,t.user_address
    ) UPDATE public.v41_trust_signals t SET successful_settlements=r.successful,
        failed_settlements=r.failed,last_updated_block=r.block_number,
        last_updated_at=COALESCE(r.indexed_at,t.last_updated_at)
      FROM restored r WHERE t.chain_id=r.chain_id AND t.user_address=r.user_address`, scope);
}

// The legacy prototype upserts these rows with the newest event's block number.
// Capture affected users before deletion, then restore only their latest retained
// facts. These tables are historical prototype records, not mainnet Genesis grants.
export async function captureLegacyReorgUsers(client, chainId, boundary) {
    const scope = [String(chainId), boundary];
    const eligibility = await client.query(`SELECT user_address FROM public.v41_project_eligibility
        WHERE chain_id=$1 AND block_number>=$2 ORDER BY user_address FOR UPDATE`, scope);
    const holders = await client.query(`SELECT user_address FROM public.v41_genesis_holders
        WHERE chain_id=$1 AND block_number>=$2 ORDER BY user_address FOR UPDATE`, scope);
    return { eligibility: eligibility.rows.map(row => row.user_address), holders: holders.rows.map(row => row.user_address) };
}

export async function restoreLegacyReorgProjections(client, chainId, boundary, users) {
    if (users.eligibility.length) await client.query(`INSERT INTO public.v41_project_eligibility
        (chain_id,user_address,eligibility_hash,achieved,block_number,transaction_hash,log_index,indexed_at)
        SELECT DISTINCT ON (event_data->>'user') chain_id,event_data->>'user',event_data->>'eligibilityHash',
            TRUE,block_number,transaction_hash,log_index,indexed_at
        FROM public.contract_events WHERE chain_id=$1 AND block_number<$2
            AND event_name='ProjectNFTEligibilityAchieved' AND event_data->>'user'=ANY($3::TEXT[])
        ORDER BY event_data->>'user',block_number DESC,log_index DESC`, [String(chainId), boundary, users.eligibility]);
    if (users.holders.length) await client.query(`INSERT INTO public.v41_genesis_holders
        (chain_id,user_address,token_id,eligibility_hash,block_number,transaction_hash,log_index,indexed_at)
        SELECT DISTINCT ON (event_data->>'user') chain_id,event_data->>'user',(event_data->>'tokenId')::NUMERIC,
            event_data->>'eligibilityHash',block_number,transaction_hash,log_index,indexed_at
        FROM public.contract_events WHERE chain_id=$1 AND block_number<$2
            AND event_name='ProjectNFTMinted' AND event_data->>'user'=ANY($3::TEXT[])
        ORDER BY event_data->>'user',block_number DESC,log_index DESC`, [String(chainId), boundary, users.holders]);
}
