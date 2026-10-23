-- TA-10 manual legacy intake. Apply after artwork_media_reorg.sql only as part
-- of the reviewed rollout. The database owner must first verify original bytes,
-- metadata and this exact registration with the pinned two-RPC verifier, using
-- a revision captured BEFORE verification. SQL cannot independently verify a
-- chain or a digest. This function is never available to the website service.
BEGIN;

CREATE OR REPLACE FUNCTION public.intake_legacy_artwork_media_registration(
    p_chain_id NUMERIC, p_core_address TEXT, p_artwork_id TEXT, p_creator_wallet TEXT,
    p_media_sha256 TEXT, p_media_uri TEXT, p_byte_size BIGINT, p_metadata_uri TEXT,
    p_evidence JSONB, p_expected_revision TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_core TEXT := lower(p_core_address);
    v_creator TEXT := lower(p_creator_wallet);
    v_entry JSONB;
    v_artwork NUMERIC(78, 0);
    v_block NUMERIC(78, 0);
    v_anchor NUMERIC(78, 0);
    v_revision NUMERIC(78, 0);
    v_prior public.artwork_media_registration_evidence%ROWTYPE;
    v_status TEXT;
BEGIN
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'MEDIA_IDENTITY_REQUIRES_READ_COMMITTED';
    END IF;
    IF p_chain_id IS DISTINCT FROM 84532::NUMERIC OR p_expected_revision IS NULL
       OR p_expected_revision !~ '^(0|[1-9][0-9]{0,77})$' THEN
        RAISE EXCEPTION 'INVALID_MEDIA_REGISTRATION_REVISION';
    END IF;
    IF v_core IS NULL OR v_core !~ '^0x[0-9a-f]{40}$' OR v_core = '0x0000000000000000000000000000000000000000'
       OR v_creator IS NULL OR v_creator !~ '^0x[0-9a-f]{40}$' OR v_creator = '0x0000000000000000000000000000000000000000'
       OR p_artwork_id IS NULL OR p_artwork_id !~ '^[1-9][0-9]{0,77}$'
       OR p_media_sha256 IS NULL OR p_media_sha256 !~ '^[0-9a-f]{64}$'
       OR p_media_uri IS NULL OR length(btrim(p_media_uri)) = 0
       OR p_metadata_uri IS NULL OR length(btrim(p_metadata_uri)) = 0
       OR p_byte_size IS NULL OR p_byte_size <= 0
       OR p_evidence IS NULL OR jsonb_typeof(p_evidence) IS DISTINCT FROM 'object'
       OR p_evidence->>'state' IS DISTINCT FROM 'verified'
       OR p_evidence->'can_submit' IS DISTINCT FROM 'false'::JSONB
       OR p_evidence->>'chain_id' IS DISTINCT FROM '84532'
       OR p_evidence->>'core_address' IS DISTINCT FROM v_core
       OR coalesce(p_evidence->>'core_code_hash', '') !~ '^0x[0-9a-f]{64}$'
       OR p_evidence->>'core_code_hash' = '0x' || repeat('0', 64)
       OR jsonb_typeof(p_evidence#>'{finalized_anchor,number}') IS DISTINCT FROM 'string'
       OR coalesce(p_evidence#>>'{finalized_anchor,number}', '') !~ '^(0|[1-9][0-9]{0,77})$'
       OR coalesce(p_evidence#>>'{finalized_anchor,hash}', '') !~ '^0x[0-9a-f]{64}$'
       OR p_evidence#>>'{finalized_anchor,hash}' = '0x' || repeat('0', 64)
       OR jsonb_typeof(p_evidence->'registrations') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'INVALID_REGISTRATION_EVIDENCE';
    END IF;
    IF jsonb_array_length(p_evidence->'registrations') <> 1 THEN
        RAISE EXCEPTION 'INVALID_REGISTRATION_EVIDENCE';
    END IF;
    v_entry := p_evidence->'registrations'->0;
    IF jsonb_typeof(v_entry) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_entry->'artwork_id') IS DISTINCT FROM 'string'
       OR v_entry->>'artwork_id' IS DISTINCT FROM p_artwork_id
       OR jsonb_typeof(v_entry->'block_number') IS DISTINCT FROM 'string'
       OR coalesce(v_entry->>'block_number', '') !~ '^(0|[1-9][0-9]{0,77})$'
       OR jsonb_typeof(v_entry->'log_index') IS DISTINCT FROM 'string'
       OR coalesce(v_entry->>'log_index', '') !~ '^(0|[1-9][0-9]{0,9})$'
       OR coalesce(v_entry->>'transaction_hash', '') !~ '^0x[0-9a-f]{64}$'
       OR v_entry->>'transaction_hash' = '0x' || repeat('0', 64)
       OR coalesce(v_entry->>'block_hash', '') !~ '^0x[0-9a-f]{64}$'
       OR v_entry->>'block_hash' = '0x' || repeat('0', 64)
       OR v_entry->>'creator_wallet' IS DISTINCT FROM v_creator
       OR v_entry->>'metadata_uri' IS DISTINCT FROM p_metadata_uri THEN
        RAISE EXCEPTION 'INVALID_REGISTRATION_EVIDENCE';
    END IF;
    v_artwork := p_artwork_id::NUMERIC;
    v_block := (v_entry->>'block_number')::NUMERIC;
    v_anchor := (p_evidence#>>'{finalized_anchor,number}')::NUMERIC;
    IF v_artwork > 115792089237316195423570985008687907853269984665640564039457584007913129639935
       OR v_anchor > 115792089237316195423570985008687907853269984665640564039457584007913129639935
       OR v_block > v_anchor OR (v_entry->>'log_index')::NUMERIC > 2147483647
       OR (v_block = v_anchor AND v_entry->>'block_hash' <> p_evidence#>>'{finalized_anchor,hash}') THEN
        RAISE EXCEPTION 'INVALID_REGISTRATION_EVIDENCE';
    END IF;

    -- Same outer mutex as reconciliation and rollback. No UUID or synthetic
    -- preparation is needed for a historical registration. The existing writer
    -- takes the artwork/hash locks and reconciles any actual claim atomically.
    SELECT revision INTO v_revision FROM public.artwork_media_chain_revisions
        WHERE chain_id = p_chain_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'MEDIA_REGISTRATION_REVISION_UNAVAILABLE'; END IF;
    IF v_revision::TEXT <> p_expected_revision THEN
        RAISE EXCEPTION 'MEDIA_REGISTRATION_STALE_REVISION';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('artsoul-media-artwork:84532:' ||
        v_core || ':' || v_artwork::TEXT, 0));
    SELECT * INTO v_prior FROM public.artwork_media_registration_evidence
        WHERE chain_id = p_chain_id AND core_address = v_core AND artwork_id = v_artwork;
    IF FOUND AND (v_prior.block_hash <> v_entry->>'block_hash'
        OR v_prior.core_code_hash <> p_evidence->>'core_code_hash'
        OR (v_prior.finalized_block_number = v_anchor AND
            v_prior.finalized_block_hash <> p_evidence#>>'{finalized_anchor,hash}')) THEN
        RAISE EXCEPTION 'MEDIA_REGISTRATION_EVIDENCE_CONFLICT';
    END IF;
    v_status := public.record_artwork_media_identity(p_chain_id, v_core, v_artwork, v_creator,
        p_media_sha256, p_media_uri, p_byte_size, p_metadata_uri, v_entry->>'transaction_hash',
        v_block, (v_entry->>'log_index')::INTEGER);
    INSERT INTO public.artwork_media_registration_evidence (
        chain_id, core_address, artwork_id, block_hash, core_code_hash, finalized_block_number, finalized_block_hash
    ) VALUES (p_chain_id, v_core, v_artwork, v_entry->>'block_hash', p_evidence->>'core_code_hash',
        v_anchor, p_evidence#>>'{finalized_anchor,hash}')
    ON CONFLICT (chain_id, core_address, artwork_id) DO NOTHING;
    -- Preserve the first finality anchor, original catalog rows and all claims.
    -- A contradiction or evidence write failure rolls back the entire intake.
    RETURN jsonb_build_object('artwork_id', v_artwork::TEXT, 'catalog_status', v_status, 'can_submit', false);
END;
$$;
REVOKE ALL ON FUNCTION public.intake_legacy_artwork_media_registration(NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, JSONB, TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
