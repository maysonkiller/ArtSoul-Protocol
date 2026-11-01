-- Ordered after the ownership proof migration; dormant until explicit activation.
BEGIN;

CREATE INDEX IF NOT EXISTS contract_events_core_auction_artwork
    ON public.contract_events(chain_id,contract_address,(event_data->>'artworkId'),block_number,log_index)
    WHERE event_name='AuctionCreated';
CREATE INDEX IF NOT EXISTS contract_events_core_auction_history
    ON public.contract_events(chain_id,contract_address,(event_data->>'auctionId'),block_number,log_index)
    WHERE event_name IN ('AuctionEnded','SettlementCompleted','SettlementDefaulted');
CREATE INDEX IF NOT EXISTS contract_events_core_resale_token
    ON public.contract_events(chain_id,contract_address,(event_data->>'tokenId'),event_name,block_number,log_index)
    WHERE event_name IN ('ResaleListed','ResaleCompleted');

-- Keep the existing owner RPC's row type stable. This additive reader gives
-- cards a listing only when its immutable source and current ownership agree.
CREATE OR REPLACE FUNCTION public.read_verified_nft_cards(
    p_core_address TEXT,p_nft_address TEXT,p_core_code_hash TEXT,p_nft_code_hash TEXT,p_artwork_ids TEXT[]
) RETURNS JSONB LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
    SELECT coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('active_listing',listing.value)
        ORDER BY array_position(p_artwork_ids,p.artwork_id)),'[]'::JSONB)
    FROM public.read_verified_nft_owners(p_core_address,p_nft_address,p_core_code_hash,p_nft_code_hash,p_artwork_ids) p
    LEFT JOIN LATERAL (
        SELECT jsonb_build_object('token_id',p.token_id,'seller',lower(l.seller),
            'price',l.price::TEXT,'last_updated_block',l.last_updated_block) AS value
        FROM (
            SELECT e.* FROM public.contract_events e
            WHERE p.verified AND e.chain_id=84532 AND e.contract_address=p_core_address
                AND e.event_name='ResaleListed' AND e.event_data->>'tokenId'=p.token_id
                AND e.block_number<=p.indexed_through
            ORDER BY e.block_number DESC,e.log_index DESC LIMIT 1
        ) e JOIN public.v41_resale_listings l ON l.chain_id=84532 AND l.token_id=p.token_id::NUMERIC
        WHERE l.active AND lower(l.seller)=p.current_owner_address
            AND lower(e.event_data->>'seller')=p.current_owner_address
            AND e.event_data->>'price'=l.price::TEXT AND l.price>0
            AND l.price<115792089237316195423570985008687907853269984665640564039457584007913129639936
            AND l.last_updated_block=e.block_number AND l.last_updated_block<=p.indexed_through
            AND ((p.latest_transfer->>'block_number')::BIGINT,(p.latest_transfer->>'log_index')::INTEGER)
                <(e.block_number,e.log_index)
    ) listing ON true;
$$;
REVOKE ALL ON FUNCTION public.read_verified_nft_cards(TEXT,TEXT,TEXT,TEXT,TEXT[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_verified_nft_cards(TEXT,TEXT,TEXT,TEXT,TEXT[]) TO service_role;

CREATE OR REPLACE FUNCTION public.read_verified_nft_boundary(
    p_core_address TEXT,p_nft_address TEXT,p_core_code_hash TEXT,p_nft_code_hash TEXT
) RETURNS TABLE(indexed_through BIGINT,confirmed_through BIGINT,covered_hash TEXT,state_revision TEXT)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
    IF p_core_address IS NULL OR p_nft_address IS NULL OR p_core_code_hash IS NULL OR p_nft_code_hash IS NULL
       OR p_core_address !~ '^0x[0-9a-f]{40}$' OR p_nft_address !~ '^0x[0-9a-f]{40}$'
       OR p_core_address='0x'||repeat('0',40) OR p_nft_address='0x'||repeat('0',40) OR p_core_address=p_nft_address
       OR p_core_code_hash !~ '^0x[0-9a-f]{64}$' OR p_nft_code_hash !~ '^0x[0-9a-f]{64}$'
       OR p_core_code_hash='0x'||repeat('0',64) OR p_nft_code_hash='0x'||repeat('0',64) THEN
        RAISE EXCEPTION 'Invalid NFT deployment lookup' USING ERRCODE='22023';
    END IF;
    RETURN QUERY
    SELECT c.covered_through,s.last_confirmed_block,c.covered_hash,s.xmin::TEXT
    FROM public.nft_transfer_coverage c JOIN public.indexer_state s ON s.chain_id=c.chain_id
    WHERE c.chain_id=84532 AND c.core_address=p_core_address AND c.nft_address=p_nft_address
        AND c.core_code_hash=p_core_code_hash AND c.nft_code_hash=p_nft_code_hash
        AND lower(s.contract_address)=c.core_address AND s.recovery_cache_token IS NULL
        AND c.covered_through=s.last_indexed_block AND s.last_confirmed_block<=s.last_indexed_block;
END;
$$;
REVOKE ALL ON FUNCTION public.read_verified_nft_boundary(TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_verified_nft_boundary(TEXT,TEXT,TEXT,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.read_verified_nft_history(
    p_core_address TEXT,p_nft_address TEXT,p_core_code_hash TEXT,p_nft_code_hash TEXT,p_artwork_id TEXT
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE v_proof RECORD; v_events JSONB; v_registration public.contract_events%ROWTYPE; v_lifecycle JSONB;
BEGIN
    SELECT * INTO STRICT v_proof FROM public.read_verified_nft_owners(
        p_core_address,p_nft_address,p_core_code_hash,p_nft_code_hash,ARRAY[p_artwork_id]);
    -- One statement snapshot for the association, current owner and transfer
    -- history. Unknown membership never licenses a token-number-only lookup.
    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'block_number',e.block_number,'log_index',e.log_index,
        'transaction_hash',e.transaction_hash,'recorded_at',e.indexed_at,
        'from_address',e.event_data->>'from','to_address',e.event_data->>'to'
    ) ORDER BY e.block_number,e.log_index),'[]'::JSONB) INTO v_events
    FROM (
        SELECT e.* FROM public.contract_events e
        JOIN public.nft_transfer_coverage c ON c.chain_id=e.chain_id
            AND c.core_address=p_core_address AND c.nft_address=p_nft_address
            AND c.core_code_hash=p_core_code_hash AND c.nft_code_hash=p_nft_code_hash
            AND c.covered_through=v_proof.indexed_through AND c.covered_hash=v_proof.covered_hash
        WHERE v_proof.verified AND e.chain_id=84532 AND e.contract_address=p_nft_address
            AND e.event_name='Transfer' AND e.event_data->>'tokenId'=v_proof.token_id
            AND e.block_number BETWEEN c.from_block AND v_proof.indexed_through
            AND e.event_data->>'from'<>'0x'||repeat('0',40)
        ORDER BY e.block_number,e.log_index LIMIT 201
    ) e;
    -- Registration predates mint and can predate the NFT coverage origin. Its
    -- exact original Core identity is required even for an unminted artwork.
    SELECT e.* INTO v_registration
    FROM public.v41_artworks a JOIN public.contract_events e ON e.chain_id=a.chain_id
        AND e.transaction_hash=a.transaction_hash AND e.log_index=a.log_index AND e.block_number=a.block_number
        AND e.event_name='ArtworkRegistered' AND e.contract_address=p_core_address
        AND e.event_data->>'artworkId'=a.artwork_id::TEXT
        AND lower(e.event_data->>'creator')=lower(a.creator) AND e.event_data->>'metadataURI'=a.metadata_uri
    WHERE a.chain_id=84532 AND a.artwork_id=p_artwork_id::NUMERIC AND e.block_number<=v_proof.indexed_through;

    WITH auctions AS MATERIALIZED (
        SELECT e.* FROM public.contract_events e
        WHERE v_registration.id IS NOT NULL AND e.chain_id=84532 AND e.contract_address=p_core_address
            AND e.event_name='AuctionCreated' AND e.event_data->>'artworkId'=p_artwork_id
            AND e.block_number<=v_proof.indexed_through
            AND (e.block_number,e.log_index)>(v_registration.block_number,v_registration.log_index)
        ORDER BY e.block_number,e.log_index LIMIT 201
    ), events AS (
        SELECT v_registration.* WHERE v_registration.id IS NOT NULL
        UNION ALL SELECT * FROM auctions
        UNION ALL
        SELECT e.* FROM auctions a CROSS JOIN LATERAL (
            SELECT e.* FROM public.contract_events e
            WHERE e.chain_id=84532 AND e.contract_address=p_core_address
                AND e.event_name IN ('AuctionEnded','SettlementCompleted','SettlementDefaulted')
                AND e.event_data->>'auctionId'=a.event_data->>'auctionId'
                AND (e.event_name<>'SettlementCompleted' OR e.event_data->>'artworkId'=p_artwork_id)
                AND e.block_number<=v_proof.indexed_through
                -- Keep chronology as a residual predicate. A parameterized
                -- lower block bound can otherwise lure the planner into a
                -- broad block index scan instead of the exact auction index.
                AND CASE WHEN e.block_number=a.block_number THEN e.log_index>a.log_index
                    ELSE e.block_number>a.block_number END
            ORDER BY e.block_number,e.log_index LIMIT 201
        ) e
        UNION ALL
        SELECT e.* FROM (VALUES ('ResaleListed'),('ResaleCompleted')) kind(name) CROSS JOIN LATERAL (
            SELECT e.* FROM public.contract_events e
            WHERE v_registration.id IS NOT NULL AND v_proof.verified
                AND e.chain_id=84532 AND e.contract_address=p_core_address AND e.event_name=kind.name
                AND e.event_name IN ('ResaleListed','ResaleCompleted') AND e.event_data->>'tokenId'=v_proof.token_id
                AND e.block_number<=v_proof.indexed_through
            ORDER BY e.block_number,e.log_index LIMIT 201
        ) e
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object('chain_id',e.chain_id,'contract_address',e.contract_address,
        'event_name',e.event_name,'event_data',e.event_data,'block_number',e.block_number,'log_index',e.log_index,
        'transaction_hash',e.transaction_hash,'indexed_at',e.indexed_at)
        ORDER BY e.block_number,e.log_index),'[]'::JSONB) INTO v_lifecycle
    FROM (SELECT * FROM events ORDER BY block_number,log_index LIMIT 201) e;
    RETURN jsonb_build_object('ownership',to_jsonb(v_proof),'transfers',v_events,
        'complete',v_proof.verified AND jsonb_array_length(v_events)<=200,
        'lifecycle',v_lifecycle,'lifecycle_available',v_registration.id IS NOT NULL,
        'lifecycle_complete',v_registration.id IS NOT NULL AND jsonb_array_length(v_lifecycle)<=200);
END;
$$;
REVOKE ALL ON FUNCTION public.read_verified_nft_history(TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_verified_nft_history(TEXT,TEXT,TEXT,TEXT,TEXT) TO service_role;
COMMIT;
