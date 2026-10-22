-- TA-10 private submission journal. Apply after media identity and preparation.
-- This records an attempt before the wallet request, not proof of broadcast.
-- A reported hash is untrusted until a separate chain verifier confirms it.
-- No timeout, client rejection, retry or empty indexer result releases a claim.
BEGIN;

ALTER TABLE public.artwork_media_publications
    ADD COLUMN IF NOT EXISTS submission_started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reported_transaction_hash TEXT;
ALTER TABLE public.artwork_media_publications
    DROP CONSTRAINT IF EXISTS artwork_media_submission_hash_check;
ALTER TABLE public.artwork_media_publications
    ADD CONSTRAINT artwork_media_submission_hash_check CHECK (
        reported_transaction_hash IS NULL OR
        (submission_started_at IS NOT NULL AND reported_transaction_hash ~ '^0x[0-9a-f]{64}$')
    );

CREATE OR REPLACE FUNCTION public.begin_artwork_media_submission(
    p_publication_id UUID, p_chain_id NUMERIC, p_core_address TEXT,
    p_creator_wallet TEXT, p_metadata_uri TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_claim public.artwork_media_publications%ROWTYPE;
    v_created BOOLEAN := false;
BEGIN
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'MEDIA_IDENTITY_REQUIRES_READ_COMMITTED';
    END IF;
    -- Same lock order as claim_artwork_media_publication. The indexer takes
    -- only the hash lock, so registration/conflict cannot race this decision.
    PERFORM pg_advisory_xact_lock(hashtextextended('artsoul-media-publication:' || p_publication_id::TEXT, 0));
    SELECT * INTO v_claim FROM public.artwork_media_publications
        WHERE publication_id = p_publication_id AND creator_wallet = lower(p_creator_wallet)
          AND chain_id = p_chain_id AND core_address = lower(p_core_address)
          AND metadata_uri = p_metadata_uri;
    IF NOT FOUND THEN RAISE EXCEPTION 'MEDIA_PUBLICATION_NOT_FOUND'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('artsoul-media-hash:' || v_claim.chain_id::TEXT || ':' ||
        v_claim.core_address || ':' || v_claim.media_sha256, 0));
    SELECT * INTO v_claim FROM public.artwork_media_publications WHERE publication_id = p_publication_id FOR UPDATE;

    IF NOT EXISTS (
        SELECT 1 FROM public.artwork_media_preparations p
        WHERE p.publication_id = v_claim.publication_id AND p.chain_id = v_claim.chain_id
          AND p.core_address = v_claim.core_address AND p.creator_wallet = v_claim.creator_wallet
          AND p.media_sha256 = v_claim.media_sha256 AND p.media_path = v_claim.media_path
          AND p.byte_size = v_claim.byte_size AND p.metadata_json IS NOT NULL
          AND right(v_claim.metadata_uri, length(p.metadata_path) + 1) = '/' || p.metadata_path
    ) THEN RAISE EXCEPTION 'MEDIA_PREPARATION_MISMATCH'; END IF;

    IF v_claim.submission_started_at IS NULL THEN
        IF v_claim.claim_status <> 'claimed' THEN RAISE EXCEPTION 'PUBLICATION_BLOCKED'; END IF;
        UPDATE public.artwork_media_publications SET submission_started_at = clock_timestamp()
            WHERE publication_id = p_publication_id RETURNING * INTO v_claim;
        v_created := true;
    END IF;
    -- A repeated begin always returns created=false, including a lost response.
    -- No browser submission authorization is enabled by this RPC.
    RETURN to_jsonb(v_claim) || jsonb_build_object('submission_created', v_created);
END;
$$;

CREATE OR REPLACE FUNCTION public.report_artwork_media_transaction(
    p_publication_id UUID, p_chain_id NUMERIC, p_core_address TEXT,
    p_creator_wallet TEXT, p_transaction_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_claim public.artwork_media_publications%ROWTYPE;
    v_tx TEXT := lower(p_transaction_hash);
BEGIN
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'MEDIA_IDENTITY_REQUIRES_READ_COMMITTED';
    END IF;
    IF v_tx IS NULL OR v_tx !~ '^0x[0-9a-f]{64}$' THEN RAISE EXCEPTION 'INVALID_TRANSACTION_HASH'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('artsoul-media-publication:' || p_publication_id::TEXT, 0));
    SELECT * INTO v_claim FROM public.artwork_media_publications
        WHERE publication_id = p_publication_id AND creator_wallet = lower(p_creator_wallet)
          AND chain_id = p_chain_id AND core_address = lower(p_core_address) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'MEDIA_PUBLICATION_NOT_FOUND'; END IF;
    IF v_claim.submission_started_at IS NULL THEN RAISE EXCEPTION 'MEDIA_SUBMISSION_NOT_STARTED'; END IF;
    IF v_claim.reported_transaction_hash IS NOT NULL AND v_claim.reported_transaction_hash <> v_tx THEN
        -- Replacements need verified chain evidence, not a second client claim.
        RAISE EXCEPTION 'MEDIA_SUBMISSION_HASH_CONFLICT';
    END IF;
    IF v_claim.reported_transaction_hash IS NULL THEN
        UPDATE public.artwork_media_publications SET reported_transaction_hash = v_tx
            WHERE publication_id = p_publication_id RETURNING * INTO v_claim;
    END IF;
    -- Do not set claim_status, artwork ID, catalog or confirmation timestamps.
    RETURN to_jsonb(v_claim);
END;
$$;

-- Existing forced RLS and SELECT-only service table privileges are retained.
REVOKE ALL ON FUNCTION public.begin_artwork_media_submission(UUID, NUMERIC, TEXT, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.report_artwork_media_transaction(UUID, NUMERIC, TEXT, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_artwork_media_submission(UUID, NUMERIC, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.report_artwork_media_transaction(UUID, NUMERIC, TEXT, TEXT, TEXT) TO service_role;

COMMIT;
