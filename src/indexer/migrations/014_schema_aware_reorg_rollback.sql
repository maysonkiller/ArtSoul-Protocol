-- Migration 014: make chain-scoped reorg rollback compatible with deployments
-- that never created the superseded indexed_auctions/indexed_bids tables.
-- The V4.1 projections remain authoritative. Legacy rows are removed only
-- when the corresponding legacy relation actually exists.

CREATE OR REPLACE FUNCTION rollback_events_from_block(
    reorg_block BIGINT,
    target_chain_id NUMERIC
)
RETURNS TABLE(
    events_deleted BIGINT,
    auctions_deleted BIGINT,
    bids_deleted BIGINT,
    outbox_deleted BIGINT
) AS $$
DECLARE
    v_events_deleted BIGINT := 0;
    v_auctions_deleted BIGINT := 0;
    v_bids_deleted BIGINT := 0;
    v_outbox_deleted BIGINT := 0;
    v_rows BIGINT := 0;
BEGIN
    DELETE FROM public.event_processing_registry
    WHERE chain_id = target_chain_id AND block_number >= reorg_block;
    GET DIAGNOSTICS v_events_deleted = ROW_COUNT;

    DELETE FROM public.v41_genesis_holders WHERE chain_id = target_chain_id AND block_number >= reorg_block;
    DELETE FROM public.v41_project_eligibility WHERE chain_id = target_chain_id AND block_number >= reorg_block;
    DELETE FROM public.v41_resale_history WHERE chain_id = target_chain_id AND block_number >= reorg_block;
    DELETE FROM public.v41_resale_listings WHERE chain_id = target_chain_id AND block_number >= reorg_block;
    DELETE FROM public.v41_floor_history WHERE chain_id = target_chain_id AND block_number >= reorg_block;
    DELETE FROM public.v41_settlements WHERE chain_id = target_chain_id AND block_number >= reorg_block;
    DELETE FROM public.v41_auction_endings WHERE chain_id = target_chain_id AND block_number >= reorg_block;
    DELETE FROM public.v41_auction_extensions WHERE chain_id = target_chain_id AND block_number >= reorg_block;
    DELETE FROM public.v41_bid_withdrawals WHERE chain_id = target_chain_id AND block_number >= reorg_block;

    DELETE FROM public.v41_bids
    WHERE chain_id = target_chain_id AND block_number >= reorg_block;
    GET DIAGNOSTICS v_bids_deleted = ROW_COUNT;

    DELETE FROM public.v41_auctions
    WHERE chain_id = target_chain_id AND block_number >= reorg_block;
    GET DIAGNOSTICS v_auctions_deleted = ROW_COUNT;

    DELETE FROM public.v41_artworks
    WHERE chain_id = target_chain_id AND block_number >= reorg_block;

    IF to_regclass('public.indexed_auctions') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.indexed_auctions WHERE block_number >= $1'
        USING reorg_block;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_auctions_deleted := v_auctions_deleted + v_rows;
    END IF;

    IF to_regclass('public.indexed_bids') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.indexed_bids WHERE block_number >= $1'
        USING reorg_block;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_bids_deleted := v_bids_deleted + v_rows;
    END IF;

    DELETE FROM public.outbox_events
    WHERE correlation_id IN (
        SELECT target_chain_id::TEXT || '-' || transaction_hash || '-' || log_index
        FROM public.contract_events
        WHERE chain_id = target_chain_id AND block_number >= reorg_block
    )
    OR (
        target_chain_id = 84532
        AND correlation_id IN (
            SELECT transaction_hash || '-' || log_index
            FROM public.contract_events
            WHERE chain_id = target_chain_id AND block_number >= reorg_block
        )
    );
    GET DIAGNOSTICS v_outbox_deleted = ROW_COUNT;

    DELETE FROM public.outbox_events
    WHERE idempotency_key IN (
        SELECT target_chain_id::TEXT || '-' || transaction_hash || '-' || log_index || '-webhook'
        FROM public.contract_events
        WHERE chain_id = target_chain_id AND block_number >= reorg_block
        UNION
        SELECT target_chain_id::TEXT || '-' || transaction_hash || '-' || log_index || '-notification'
        FROM public.contract_events
        WHERE chain_id = target_chain_id AND block_number >= reorg_block
    );
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_outbox_deleted := v_outbox_deleted + v_rows;

    DELETE FROM public.contract_events
    WHERE chain_id = target_chain_id AND block_number >= reorg_block;

    RETURN QUERY SELECT
        v_events_deleted,
        v_auctions_deleted,
        v_bids_deleted,
        v_outbox_deleted;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION rollback_events_from_block(BIGINT, NUMERIC)
IS 'Chain-scoped reorg rollback for V4.1 projections with optional cleanup of legacy auction and bid tables';
