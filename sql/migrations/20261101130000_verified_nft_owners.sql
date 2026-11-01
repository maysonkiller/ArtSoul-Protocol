-- Dormant source-qualified ownership reader. No runtime/API activation.
BEGIN;

CREATE INDEX IF NOT EXISTS contract_events_core_settlement_token
    ON public.contract_events(chain_id,contract_address,(event_data->>'tokenId'),block_number,log_index)
    WHERE event_name='SettlementCompleted';
CREATE INDEX IF NOT EXISTS contract_events_core_settlement_artwork
    ON public.contract_events(chain_id,contract_address,(event_data->>'artworkId'),block_number,log_index)
    WHERE event_name='SettlementCompleted';
-- Reuse the search projection's index even when that optional feature has not
-- been installed. LIMIT bounds the result, not an otherwise unindexed scan.
CREATE INDEX IF NOT EXISTS artwork_search_settlements_latest
    ON public.v41_settlements(chain_id,artwork_id,block_number DESC,log_index DESC)
    WHERE settlement_status='completed';

CREATE OR REPLACE FUNCTION public.read_verified_nft_owners(
    p_core_address TEXT, p_nft_address TEXT, p_core_code_hash TEXT, p_nft_code_hash TEXT,
    p_artwork_ids TEXT[]
) RETURNS TABLE (
    artwork_id TEXT, token_id TEXT, verified BOOLEAN, first_collector_address TEXT,
    current_owner_address TEXT, latest_transfer JSONB, indexed_through BIGINT,
    confirmed_through BIGINT, covered_hash TEXT, state_revision TEXT
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
    IF p_core_address IS NULL OR p_nft_address IS NULL OR p_core_code_hash IS NULL OR p_nft_code_hash IS NULL
       OR p_core_address !~ '^0x[0-9a-f]{40}$' OR p_nft_address !~ '^0x[0-9a-f]{40}$'
       OR p_core_address='0x'||repeat('0',40) OR p_nft_address='0x'||repeat('0',40)
       OR p_core_address=p_nft_address
       OR p_core_code_hash !~ '^0x[0-9a-f]{64}$' OR p_nft_code_hash !~ '^0x[0-9a-f]{64}$'
       OR p_core_code_hash='0x'||repeat('0',64) OR p_nft_code_hash='0x'||repeat('0',64)
       OR p_artwork_ids IS NULL OR cardinality(p_artwork_ids) NOT BETWEEN 1 AND 20
       OR array_ndims(p_artwork_ids)<>1 THEN
        RAISE EXCEPTION 'Invalid NFT ownership lookup' USING ERRCODE='22023';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(p_artwork_ids) i WHERE i IS NULL OR i !~ '^[1-9][0-9]{0,77}$') THEN
        RAISE EXCEPTION 'Invalid artwork identifier' USING ERRCODE='22023';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(p_artwork_ids) i
        WHERE i::NUMERIC >= 115792089237316195423570985008687907853269984665640564039457584007913129639936)
       OR (SELECT count(DISTINCT i) FROM unnest(p_artwork_ids) i)<>cardinality(p_artwork_ids) THEN
        RAISE EXCEPTION 'Invalid artwork identifiers' USING ERRCODE='22023';
    END IF;

    -- STABLE keeps coverage, mutable projections and journal facts in the same
    -- statement snapshot, including when a concurrent rewind commits. Pending
    -- cache recovery and partial catch-up cannot produce an ownership claim.
    RETURN QUERY
    WITH scope AS MATERIALIZED (
        SELECT c.*, s.last_confirmed_block, s.xmin::TEXT AS revision
        FROM public.nft_transfer_coverage c JOIN public.indexer_state s ON s.chain_id=c.chain_id
        WHERE c.chain_id=84532 AND c.core_address=p_core_address AND c.nft_address=p_nft_address
            AND c.core_code_hash=p_core_code_hash AND c.nft_code_hash=p_nft_code_hash
            AND lower(s.contract_address)=c.core_address AND s.recovery_cache_token IS NULL
            AND c.covered_through=s.last_indexed_block AND s.last_confirmed_block<=s.last_indexed_block
    )
    SELECT requested.id, proof.token_id::TEXT, movement.id IS NOT NULL,
        CASE WHEN movement.id IS NOT NULL THEN lower(proof.winner) END,
        CASE WHEN movement.id IS NOT NULL THEN movement.event_data->>'to' END,
        CASE WHEN movement.id IS NOT NULL THEN jsonb_build_object(
            'block_number',movement.block_number,'log_index',movement.log_index,
            'transaction_hash',movement.transaction_hash,'recorded_at',movement.indexed_at,
            'from_address',movement.event_data->>'from','to_address',movement.event_data->>'to') END,
        scope.covered_through, scope.last_confirmed_block, scope.covered_hash, scope.revision
    FROM unnest(p_artwork_ids) WITH ORDINALITY requested(id,position)
    LEFT JOIN scope ON true
    LEFT JOIN LATERAL (
        SELECT candidates.* FROM (
            SELECT bounded.*,count(*) OVER () AS matches FROM (
                SELECT s.token_id,s.winner,s.transaction_hash,s.block_number,s.log_index
                FROM public.v41_artworks a
                JOIN public.contract_events registration ON registration.chain_id=a.chain_id
                    AND registration.transaction_hash=a.transaction_hash AND registration.log_index=a.log_index
                    AND registration.block_number=a.block_number AND registration.event_name='ArtworkRegistered'
                    AND registration.contract_address=scope.core_address
                    AND registration.event_data->>'artworkId'=a.artwork_id::TEXT
                    AND lower(registration.event_data->>'creator')=lower(a.creator)
                    AND registration.event_data->>'metadataURI'=a.metadata_uri
                JOIN public.v41_settlements s ON s.chain_id=a.chain_id AND s.artwork_id=a.artwork_id
                    AND s.token_id=a.token_id AND s.settlement_status='completed'
                JOIN public.contract_events settlement ON settlement.chain_id=s.chain_id
                    AND settlement.transaction_hash=s.transaction_hash AND settlement.log_index=s.log_index
                    AND settlement.block_number=s.block_number AND settlement.event_name='SettlementCompleted'
                    AND settlement.contract_address=scope.core_address
                    AND settlement.event_data->>'artworkId'=a.artwork_id::TEXT
                    AND settlement.event_data->>'tokenId'=s.token_id::TEXT
                    AND settlement.event_data->>'auctionId'=s.auction_id::TEXT
                    AND lower(settlement.event_data->>'winner')=lower(s.winner)
                    AND settlement.event_data->>'finalPrice'=s.final_price::TEXT
                WHERE a.chain_id=scope.chain_id AND a.artwork_id=requested.id::NUMERIC AND a.minted=true
                    AND s.token_id>0 AND s.token_id<115792089237316195423570985008687907853269984665640564039457584007913129639936
                    AND s.winner ~* '^0x[0-9a-f]{40}$' AND lower(s.winner)<>'0x'||repeat('0',40)
                    AND s.block_number BETWEEN scope.from_block AND scope.covered_through
                    AND (registration.block_number,registration.log_index)<(s.block_number,s.log_index)
                    AND NOT EXISTS (
                        SELECT 1 FROM public.contract_events conflict
                        WHERE conflict.chain_id=scope.chain_id AND conflict.contract_address=scope.core_address
                            AND conflict.event_name='SettlementCompleted' AND conflict.event_data->>'tokenId'=s.token_id::TEXT
                            AND conflict.block_number<=scope.covered_through AND conflict.id<>settlement.id
                    )
                    AND NOT EXISTS (
                        SELECT 1 FROM public.contract_events conflict
                        WHERE conflict.chain_id=scope.chain_id AND conflict.contract_address=scope.core_address
                            AND conflict.event_name='SettlementCompleted' AND conflict.event_data->>'artworkId'=a.artwork_id::TEXT
                            AND conflict.block_number<=scope.covered_through AND conflict.id<>settlement.id
                    )
                LIMIT 2
            ) bounded
        ) candidates WHERE candidates.matches=1
    ) proof ON true
    LEFT JOIN LATERAL (
        -- The first transfer for this token must be its mint in the proven
        -- original Core settlement. Later NFT.core changes grant no association.
        SELECT e.* FROM public.contract_events e
        WHERE e.chain_id=scope.chain_id AND e.contract_address=scope.nft_address AND e.event_name='Transfer'
            AND e.event_data->>'tokenId'=proof.token_id::TEXT
            AND e.block_number BETWEEN scope.from_block AND scope.covered_through
        ORDER BY e.block_number,e.log_index LIMIT 1
    ) mint ON mint.transaction_hash=proof.transaction_hash AND mint.block_number=proof.block_number
        AND mint.log_index<proof.log_index AND mint.artwork_id IS NULL
        AND mint.event_data->>'from'='0x'||repeat('0',40) AND mint.event_data->>'to'=lower(proof.winner)
    LEFT JOIN LATERAL (
        SELECT e.* FROM public.contract_events e
        WHERE mint.id IS NOT NULL AND e.chain_id=scope.chain_id AND e.contract_address=scope.nft_address
            AND e.event_name='Transfer' AND e.event_data->>'tokenId'=proof.token_id::TEXT
            AND e.block_number BETWEEN scope.from_block AND scope.covered_through
        ORDER BY e.block_number DESC,e.log_index DESC LIMIT 1
    ) movement ON movement.artwork_id IS NULL
        AND movement.event_data->>'to' ~ '^0x[0-9a-f]{40}$' AND movement.event_data->>'to'<>'0x'||repeat('0',40)
        AND movement.event_data->>'from' ~ '^0x[0-9a-f]{40}$'
        AND (movement.id=mint.id OR movement.event_data->>'from'<>'0x'||repeat('0',40))
    ORDER BY requested.position;
END;
$$;
REVOKE ALL ON FUNCTION public.read_verified_nft_owners(TEXT,TEXT,TEXT,TEXT,TEXT[])
    FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_verified_nft_owners(TEXT,TEXT,TEXT,TEXT,TEXT[]) TO service_role;
COMMENT ON FUNCTION public.read_verified_nft_owners(TEXT,TEXT,TEXT,TEXT,TEXT[]) IS
    'Bounded Base Sepolia ownership evidence; missing/unverified results never authorize a fallback owner or a sale';
COMMIT;
