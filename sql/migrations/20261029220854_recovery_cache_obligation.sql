-- Apply after 20261029212603_notification_reorg_identity.sql, before the
-- matching indexer worker. This records recovery intent; it does not start it.
BEGIN;

-- A one-time obligation for existing rows and every newly initialized chain.
-- Reapplication preserves acknowledged NULLs instead of rearming the cache.
ALTER TABLE public.indexer_state
    ADD COLUMN IF NOT EXISTS recovery_cache_token UUID DEFAULT gen_random_uuid();
COMMENT ON COLUMN public.indexer_state.recovery_cache_token IS
    'Pending post-rewind cache purge token; NULL only after fenced acknowledgement';

-- Cache keys currently omit core_address. A replacement deployment must also
-- purge, even when initialized without a rewind. Case-only changes are identical.
CREATE OR REPLACE FUNCTION artsoul_private.mark_deployment_cache_obligation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
    IF lower(NEW.contract_address) IS DISTINCT FROM lower(OLD.contract_address) THEN
        NEW.recovery_cache_token := gen_random_uuid();
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION artsoul_private.mark_deployment_cache_obligation()
    FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS indexer_deployment_cache_obligation ON public.indexer_state;
CREATE TRIGGER indexer_deployment_cache_obligation
    BEFORE UPDATE OF contract_address ON public.indexer_state
    FOR EACH ROW EXECUTE FUNCTION artsoul_private.mark_deployment_cache_obligation();

CREATE OR REPLACE FUNCTION public.rollback_events_from_block(
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
    v_revision NUMERIC(78, 0);
BEGIN
    IF reorg_block IS NULL OR reorg_block < 0 OR target_chain_id IS NULL OR target_chain_id <= 0
       OR target_chain_id <> trunc(target_chain_id) THEN RAISE EXCEPTION 'INVALID_REORG_SCOPE'; END IF;
    -- Direct owner calls must use the same state -> media ordering as the
    -- engine's recovery transaction. Even a primitive rewind must invalidate
    -- buffered writer contexts (xmin); the full engine still owns cursor,
    -- digest, header and predecessor reconstruction in the same transaction.
    UPDATE public.indexer_state
        SET last_indexed_block=last_indexed_block, recovery_cache_token=gen_random_uuid()
        WHERE chain_id=target_chain_id;
    IF target_chain_id = 84532 THEN
        IF current_setting('transaction_isolation') <> 'read committed' THEN
            RAISE EXCEPTION 'MEDIA_IDENTITY_REQUIRES_READ_COMMITTED';
        END IF;
        SELECT revision INTO v_revision FROM public.artwork_media_chain_revisions
            WHERE chain_id = target_chain_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'MEDIA_REGISTRATION_REVISION_UNAVAILABLE'; END IF;
        UPDATE public.artwork_media_chain_revisions SET revision = revision + 1
            WHERE chain_id = target_chain_id RETURNING revision INTO v_revision;
        INSERT INTO public.artwork_media_rewinds(chain_id, revision, from_block)
            VALUES (target_chain_id, v_revision, reorg_block);
        -- A projection rewind is not proof of a chain reorg. Conservatively
        -- quarantine only evidence whose event OR first anchor crosses it.
        UPDATE public.artwork_media_publications p SET claim_status = 'conflict', updated_at = clock_timestamp()
            WHERE p.chain_id = target_chain_id AND p.claim_status <> 'conflict' AND EXISTS (
                SELECT 1 FROM public.artwork_media_catalog c
                LEFT JOIN public.artwork_media_registration_evidence e
                    USING (chain_id, core_address, artwork_id)
                WHERE c.chain_id = p.chain_id AND c.core_address = p.core_address AND c.media_sha256 = p.media_sha256
                  AND (c.block_number >= reorg_block OR e.finalized_block_number >= reorg_block)
            );
    END IF;

    PERFORM artsoul_private.detach_reorg_notifications(reorg_block,target_chain_id);

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
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public;

COMMENT ON FUNCTION rollback_events_from_block(BIGINT, NUMERIC)
IS 'Chain-scoped reorg rollback for V4.1 projections with optional cleanup of legacy auction and bid tables';

-- Neither Data API clients nor service-role HTTP calls operate the indexer.
-- This invoker function requires the indexer database owner, as in deployment.
CREATE OR REPLACE FUNCTION public.rollback_events_from_block(reorg_block BIGINT)
RETURNS TABLE(events_deleted BIGINT, auctions_deleted BIGINT, bids_deleted BIGINT, outbox_deleted BIGINT)
LANGUAGE sql SECURITY INVOKER SET search_path = pg_catalog, public
AS $$ SELECT * FROM public.rollback_events_from_block(reorg_block, 84532) $$;
REVOKE ALL ON FUNCTION public.rollback_events_from_block(BIGINT, NUMERIC) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.rollback_events_from_block(BIGINT) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
