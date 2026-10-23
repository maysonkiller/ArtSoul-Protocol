-- TA-10 rollback fencing. LOCAL PREPARATION ONLY: apply with the complete
-- reviewed rollout, after registration persistence and indexer migration 014.
-- Immutable media/evidence survive a projection rewind. This is bookkeeping,
-- not a new protocol state, a release of claims, or permission to resend.
BEGIN;

CREATE TABLE IF NOT EXISTS public.artwork_media_chain_revisions (
    chain_id NUMERIC(78, 0) PRIMARY KEY CHECK (chain_id = 84532),
    revision NUMERIC(78, 0) NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
CREATE TABLE IF NOT EXISTS public.artwork_media_rewinds (
    chain_id NUMERIC(78, 0) NOT NULL REFERENCES public.artwork_media_chain_revisions(chain_id),
    revision NUMERIC(78, 0) NOT NULL CHECK (revision > 0),
    from_block BIGINT NOT NULL CHECK (from_block >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (chain_id, revision)
);
ALTER TABLE public.artwork_media_chain_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artwork_media_chain_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.artwork_media_rewinds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artwork_media_rewinds FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.artwork_media_chain_revisions, public.artwork_media_rewinds
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.artwork_media_chain_revisions, public.artwork_media_rewinds TO service_role;
DROP POLICY IF EXISTS artwork_media_revision_read ON public.artwork_media_chain_revisions;
CREATE POLICY artwork_media_revision_read ON public.artwork_media_chain_revisions
    FOR SELECT TO service_role USING (true);
DROP POLICY IF EXISTS artwork_media_rewinds_read ON public.artwork_media_rewinds;
CREATE POLICY artwork_media_rewinds_read ON public.artwork_media_rewinds
    FOR SELECT TO service_role USING (true);
INSERT INTO public.artwork_media_chain_revisions(chain_id) VALUES (84532) ON CONFLICT DO NOTHING;

-- TEXT prevents precision loss at the PostgREST/JavaScript boundary. Capture
-- this revision BEFORE chain verification, never after it or from a browser.
CREATE OR REPLACE FUNCTION public.read_artwork_media_revision(p_chain_id NUMERIC)
RETURNS TEXT LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public
AS $$ SELECT revision::TEXT FROM public.artwork_media_chain_revisions WHERE chain_id = p_chain_id $$;
REVOKE ALL ON FUNCTION public.read_artwork_media_revision(NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_artwork_media_revision(NUMERIC) TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_artwork_media_registration(
    p_publication_id UUID, p_chain_id NUMERIC, p_core_address TEXT, p_creator_wallet TEXT,
    p_media_sha256 TEXT, p_media_uri TEXT, p_byte_size BIGINT, p_metadata_uri TEXT, p_evidence JSONB,
    p_expected_revision TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
    v_revision NUMERIC(78, 0);
    v_claim public.artwork_media_publications%ROWTYPE;
BEGIN
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'MEDIA_IDENTITY_REQUIRES_READ_COMMITTED';
    END IF;
    IF p_chain_id IS DISTINCT FROM 84532::NUMERIC
       OR p_expected_revision IS NULL OR p_expected_revision !~ '^(0|[1-9][0-9]{0,77})$' THEN
        RAISE EXCEPTION 'INVALID_MEDIA_REGISTRATION_REVISION';
    END IF;
    -- The chain mutex must precede every UUID/artwork/hash/claim lock. It is
    -- held until commit, including while the nested reconciliation executes.
    SELECT revision INTO v_revision FROM public.artwork_media_chain_revisions
        WHERE chain_id = p_chain_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'MEDIA_REGISTRATION_REVISION_UNAVAILABLE'; END IF;
    IF v_revision::TEXT <> p_expected_revision THEN
        RAISE EXCEPTION 'MEDIA_REGISTRATION_STALE_REVISION';
    END IF;
    BEGIN
        RETURN public.reconcile_artwork_media_registration(p_publication_id, p_chain_id,
            p_core_address, p_creator_wallet, p_media_sha256, p_media_uri, p_byte_size, p_metadata_uri, p_evidence);
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM NOT IN ('MEDIA_IDENTITY_CONFLICT', 'MEDIA_REGISTRATION_EVIDENCE_CONFLICT') THEN RAISE; END IF;
        -- The inner subtransaction rolls back every partial catalog/evidence
        -- write. Quarantine only its pinned, owned claim; preserve all history.
        UPDATE public.artwork_media_publications SET claim_status = 'conflict', updated_at = clock_timestamp()
            WHERE publication_id = p_publication_id AND chain_id = p_chain_id
              AND core_address = lower(p_core_address) AND creator_wallet = lower(p_creator_wallet)
              AND media_sha256 = p_media_sha256 AND byte_size = p_byte_size AND metadata_uri = p_metadata_uri
            RETURNING * INTO v_claim;
        IF NOT FOUND THEN RAISE; END IF;
        RETURN jsonb_build_object('publication_id', p_publication_id, 'claim_status', 'conflict',
            'registered_artwork_id', v_claim.registered_artwork_id::TEXT, 'can_submit', false);
    END;
END;
$$;
REVOKE ALL ON FUNCTION public.reconcile_artwork_media_registration(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, JSONB)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_artwork_media_identity(NUMERIC, TEXT, NUMERIC, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, NUMERIC, INTEGER)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reconcile_artwork_media_registration(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, JSONB, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_artwork_media_registration(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, JSONB, TEXT)
    TO service_role;

-- The schema-aware 014 rollback body follows, with a fence before its first
-- projection write. Keep the same function identity so existing callers and
-- the one-argument compatibility wrapper cannot bypass the fence.

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
