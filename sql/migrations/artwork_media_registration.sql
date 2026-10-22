-- TA-10 private finalized registration persistence. Apply only with the complete
-- reviewed rollout, after identity, preparation and submission migrations.
-- The trusted server must verify original bytes, immutable metadata and both
-- RPCs before calling. SQL is not a chain verifier. No route is enabled here.
BEGIN;

CREATE TABLE IF NOT EXISTS public.artwork_media_registration_evidence (
    chain_id NUMERIC(78, 0) NOT NULL,
    core_address TEXT NOT NULL,
    artwork_id NUMERIC(78, 0) NOT NULL,
    block_hash TEXT NOT NULL CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
    core_code_hash TEXT NOT NULL CHECK (core_code_hash ~ '^0x[0-9a-f]{64}$'),
    finalized_block_number NUMERIC(78, 0) NOT NULL CHECK (finalized_block_number >= 0),
    finalized_block_hash TEXT NOT NULL CHECK (finalized_block_hash ~ '^0x[0-9a-f]{64}$'),
    verified_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (chain_id, core_address, artwork_id),
    FOREIGN KEY (chain_id, core_address, artwork_id)
        REFERENCES public.artwork_media_catalog (chain_id, core_address, artwork_id)
);
ALTER TABLE public.artwork_media_registration_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artwork_media_registration_evidence FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.artwork_media_registration_evidence FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.artwork_media_registration_evidence TO service_role;
DROP POLICY IF EXISTS artwork_media_registration_service_read ON public.artwork_media_registration_evidence;
CREATE POLICY artwork_media_registration_service_read ON public.artwork_media_registration_evidence
    FOR SELECT TO service_role USING (true);

CREATE OR REPLACE FUNCTION public.reconcile_artwork_media_registration(
    p_publication_id UUID, p_chain_id NUMERIC, p_core_address TEXT, p_creator_wallet TEXT,
    p_media_sha256 TEXT, p_media_uri TEXT, p_byte_size BIGINT, p_metadata_uri TEXT, p_evidence JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_claim public.artwork_media_publications%ROWTYPE;
    v_pin public.artwork_media_preparations%ROWTYPE;
    v_prior public.artwork_media_registration_evidence%ROWTYPE;
    v_entry JSONB;
    v_anchor NUMERIC(78, 0);
    v_artwork NUMERIC(78, 0);
    v_block NUMERIC(78, 0);
BEGIN
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'MEDIA_IDENTITY_REQUIRES_READ_COMMITTED';
    END IF;
    IF p_chain_id IS DISTINCT FROM 84532::NUMERIC OR p_evidence IS NULL
       OR jsonb_typeof(p_evidence) IS DISTINCT FROM 'object'
       OR p_evidence->>'state' IS DISTINCT FROM 'verified'
       OR p_evidence->'can_submit' IS DISTINCT FROM 'false'::JSONB
       OR p_evidence->>'chain_id' IS DISTINCT FROM '84532'
       OR p_evidence->>'core_address' IS DISTINCT FROM lower(p_core_address)
       OR coalesce(p_evidence->>'core_code_hash', '') !~ '^0x[0-9a-f]{64}$'
       OR jsonb_typeof(p_evidence#>'{finalized_anchor,number}') IS DISTINCT FROM 'string'
       OR coalesce(p_evidence#>>'{finalized_anchor,number}', '') !~ '^(0|[1-9][0-9]{0,77})$'
       OR coalesce(p_evidence#>>'{finalized_anchor,hash}', '') !~ '^0x[0-9a-f]{64}$'
       OR jsonb_typeof(p_evidence->'registrations') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'INVALID_REGISTRATION_EVIDENCE';
    END IF;
    IF jsonb_array_length(p_evidence->'registrations') NOT BETWEEN 1 AND 8 THEN
        RAISE EXCEPTION 'INVALID_REGISTRATION_EVIDENCE';
    END IF;
    v_anchor := (p_evidence#>>'{finalized_anchor,number}')::NUMERIC;
    FOR v_entry IN SELECT value FROM jsonb_array_elements(p_evidence->'registrations') LOOP
        IF jsonb_typeof(v_entry) IS DISTINCT FROM 'object'
           OR jsonb_typeof(v_entry->'artwork_id') IS DISTINCT FROM 'string'
           OR jsonb_typeof(v_entry->'block_number') IS DISTINCT FROM 'string'
           OR jsonb_typeof(v_entry->'log_index') IS DISTINCT FROM 'string'
           OR coalesce(v_entry->>'artwork_id', '') !~ '^[1-9][0-9]{0,77}$'
           OR coalesce(v_entry->>'block_number', '') !~ '^(0|[1-9][0-9]{0,77})$'
           OR coalesce(v_entry->>'log_index', '') !~ '^(0|[1-9][0-9]{0,9})$'
           OR coalesce(v_entry->>'transaction_hash', '') !~ '^0x[0-9a-f]{64}$'
           OR coalesce(v_entry->>'block_hash', '') !~ '^0x[0-9a-f]{64}$'
           OR v_entry->>'creator_wallet' IS DISTINCT FROM lower(p_creator_wallet)
           OR v_entry->>'metadata_uri' IS DISTINCT FROM p_metadata_uri THEN
            RAISE EXCEPTION 'INVALID_REGISTRATION_EVIDENCE';
        END IF;
        IF (v_entry->>'block_number')::NUMERIC > v_anchor
           OR (v_entry->>'artwork_id')::NUMERIC > 115792089237316195423570985008687907853269984665640564039457584007913129639935
           OR (v_entry->>'log_index')::NUMERIC > 2147483647
           OR ((v_entry->>'block_number')::NUMERIC = v_anchor AND
               v_entry->>'block_hash' <> p_evidence#>>'{finalized_anchor,hash}') THEN
            RAISE EXCEPTION 'INVALID_REGISTRATION_EVIDENCE';
        END IF;
    END LOOP;
    IF (SELECT count(DISTINCT value->>'artwork_id') FROM jsonb_array_elements(p_evidence->'registrations'))
       <> jsonb_array_length(p_evidence->'registrations')
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_evidence->'registrations')
           GROUP BY value->>'block_number', value->>'log_index' HAVING count(*) > 1)
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_evidence->'registrations')
           GROUP BY value->>'transaction_hash', value->>'log_index' HAVING count(*) > 1)
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_evidence->'registrations')
           GROUP BY value->>'transaction_hash' HAVING count(DISTINCT value->>'block_number') > 1)
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_evidence->'registrations')
           GROUP BY value->>'block_number' HAVING count(DISTINCT value->>'block_hash') > 1) THEN
        RAISE EXCEPTION 'INVALID_REGISTRATION_EVIDENCE';
    END IF;

    -- UUID, then ALL artwork locks in numeric order, then the hash, then rows.
    -- Taking the hash between artwork locks can deadlock with the catalog RPC.
    PERFORM pg_advisory_xact_lock(hashtextextended('artsoul-media-publication:' || p_publication_id::TEXT, 0));
    SELECT * INTO v_claim FROM public.artwork_media_publications
        WHERE publication_id = p_publication_id AND creator_wallet = lower(p_creator_wallet)
          AND chain_id = p_chain_id AND core_address = lower(p_core_address);
    IF NOT FOUND THEN RAISE EXCEPTION 'MEDIA_PUBLICATION_NOT_FOUND'; END IF;
    FOR v_artwork IN SELECT (value->>'artwork_id')::NUMERIC
        FROM jsonb_array_elements(p_evidence->'registrations') ORDER BY 1 LOOP
        PERFORM pg_advisory_xact_lock(hashtextextended('artsoul-media-artwork:' || v_claim.chain_id::TEXT || ':' ||
            v_claim.core_address || ':' || v_artwork::TEXT, 0));
    END LOOP;
    PERFORM pg_advisory_xact_lock(hashtextextended('artsoul-media-hash:' || v_claim.chain_id::TEXT || ':' ||
        v_claim.core_address || ':' || v_claim.media_sha256, 0));
    SELECT * INTO v_claim FROM public.artwork_media_publications WHERE publication_id = p_publication_id FOR UPDATE;
    SELECT * INTO v_pin FROM public.artwork_media_preparations WHERE publication_id = p_publication_id;
    IF NOT FOUND OR v_pin.metadata_json IS NULL OR p_media_uri IS NULL
       OR ROW(v_claim.chain_id, v_claim.core_address, v_claim.creator_wallet, v_claim.media_sha256, v_claim.media_path, v_claim.byte_size)
          IS DISTINCT FROM ROW(v_pin.chain_id, v_pin.core_address, v_pin.creator_wallet, v_pin.media_sha256, v_pin.media_path, v_pin.byte_size)
       OR ROW(v_claim.media_sha256, v_claim.byte_size, v_claim.metadata_uri)
          IS DISTINCT FROM ROW(p_media_sha256, p_byte_size, p_metadata_uri)
       OR v_pin.metadata_json->>'media_url' IS DISTINCT FROM p_media_uri
       OR right(p_metadata_uri, length(v_pin.metadata_path) + 1) <> '/' || v_pin.metadata_path THEN
        RAISE EXCEPTION 'MEDIA_PREPARATION_MISMATCH';
    END IF;

    FOR v_entry IN SELECT value FROM jsonb_array_elements(p_evidence->'registrations')
        ORDER BY (value->>'artwork_id')::NUMERIC LOOP
        v_artwork := (v_entry->>'artwork_id')::NUMERIC;
        v_block := (v_entry->>'block_number')::NUMERIC;
        SELECT * INTO v_prior FROM public.artwork_media_registration_evidence
            WHERE chain_id = v_claim.chain_id AND core_address = v_claim.core_address AND artwork_id = v_artwork;
        IF FOUND AND (v_prior.block_hash <> v_entry->>'block_hash'
            OR v_prior.core_code_hash <> p_evidence->>'core_code_hash'
            OR (v_prior.finalized_block_number = v_anchor AND
                v_prior.finalized_block_hash <> p_evidence#>>'{finalized_anchor,hash}')) THEN
            RAISE EXCEPTION 'MEDIA_REGISTRATION_EVIDENCE_CONFLICT';
        END IF;
        PERFORM public.record_artwork_media_identity(v_claim.chain_id, v_claim.core_address, v_artwork,
            v_claim.creator_wallet, v_claim.media_sha256, p_media_uri, v_claim.byte_size, v_claim.metadata_uri,
            v_entry->>'transaction_hash', v_block, (v_entry->>'log_index')::INTEGER);
        INSERT INTO public.artwork_media_registration_evidence (
            chain_id, core_address, artwork_id, block_hash, core_code_hash, finalized_block_number, finalized_block_hash
        ) VALUES (v_claim.chain_id, v_claim.core_address, v_artwork, v_entry->>'block_hash',
            p_evidence->>'core_code_hash', v_anchor, p_evidence#>>'{finalized_anchor,hash}')
        ON CONFLICT (chain_id, core_address, artwork_id) DO NOTHING;
    END LOOP;
    -- Preserve the first verification anchor and the original UNVERIFIED report.
    -- Contradictions roll back the whole batch; no expiry, release or overwrite.
    SELECT * INTO v_claim FROM public.artwork_media_publications WHERE publication_id = p_publication_id;
    RETURN jsonb_build_object('publication_id', p_publication_id, 'claim_status', v_claim.claim_status,
        'registered_artwork_id', v_claim.registered_artwork_id::TEXT, 'can_submit', false);
END;
$$;
REVOKE ALL ON FUNCTION public.reconcile_artwork_media_registration(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, JSONB)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_artwork_media_registration(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, JSONB)
    TO service_role;
COMMIT;
