-- TA-10 private upload issuance and immutable metadata preparation only.
-- Trusted callers authenticate the wallet, pin the deployment, verify raw bytes
-- and validate metadata fields before preparing. These RPCs do not claim media,
-- send transactions, alter artwork lifecycle or enable website enforcement.
-- No expiry, cancellation, release or deletion policy is introduced.
BEGIN;

CREATE TABLE IF NOT EXISTS public.artwork_media_preparations (
    publication_id UUID PRIMARY KEY,
    chain_id NUMERIC(78, 0) NOT NULL CHECK (chain_id > 0),
    core_address TEXT NOT NULL CHECK (core_address ~ '^0x[0-9a-f]{40}$' AND core_address <> '0x0000000000000000000000000000000000000000'),
    creator_wallet TEXT NOT NULL CHECK (creator_wallet ~ '^0x[0-9a-f]{40}$' AND creator_wallet <> '0x0000000000000000000000000000000000000000'),
    media_path TEXT NOT NULL UNIQUE CHECK (
        media_path ~ '^uploads/0x[0-9a-f]{40}/[0-9]{13}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9_.-]{1,101}$'
        AND split_part(media_path, '/', 2) = creator_wallet
    ),
    metadata_path TEXT NOT NULL UNIQUE CHECK (
        metadata_path ~ '^metadata/0x[0-9a-f]{40}/[0-9]{13}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9_.-]{1,96}\.json$'
        AND split_part(metadata_path, '/', 2) = creator_wallet
    ),
    -- Matches src/config/upload-policy.js; new MIME types require both changes.
    declared_content_type TEXT NOT NULL CHECK (declared_content_type IN (
        'image/jpeg', 'image/png', 'image/gif', 'image/webp',
        'video/mp4', 'video/webm', 'video/quicktime',
        'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav',
        'audio/ogg', 'audio/aac', 'audio/mp4'
    )),
    declared_size BIGINT NOT NULL CHECK (declared_size BETWEEN 1 AND 52428800),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    media_sha256 TEXT CHECK (media_sha256 ~ '^[0-9a-f]{64}$'),
    byte_size BIGINT CHECK (byte_size = declared_size),
    content_type TEXT CHECK (content_type = declared_content_type),
    metadata_json JSONB CHECK (
        jsonb_typeof(metadata_json) = 'object' AND octet_length(metadata_json::TEXT) <= 262144
    ),
    CHECK (num_nonnulls(media_sha256, byte_size, content_type, metadata_json) IN (0, 4))
);

ALTER TABLE public.artwork_media_preparations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artwork_media_preparations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.artwork_media_preparations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.artwork_media_preparations TO service_role;
DROP POLICY IF EXISTS artwork_media_preparations_service_read ON public.artwork_media_preparations;
CREATE POLICY artwork_media_preparations_service_read ON public.artwork_media_preparations
    FOR SELECT TO service_role USING (true);

CREATE OR REPLACE FUNCTION public.issue_artwork_media_upload(
    p_publication_id UUID,
    p_chain_id NUMERIC,
    p_core_address TEXT,
    p_creator_wallet TEXT,
    p_media_path TEXT,
    p_metadata_path TEXT,
    p_content_type TEXT,
    p_declared_size NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_chain NUMERIC(78, 0);
    v_core TEXT := lower(p_core_address);
    v_creator TEXT := lower(p_creator_wallet);
    v_type TEXT := lower(p_content_type);
    v_existing public.artwork_media_preparations%ROWTYPE;
BEGIN
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'MEDIA_IDENTITY_REQUIRES_READ_COMMITTED';
    END IF;
    IF p_publication_id IS NULL OR p_chain_id IS NULL OR p_chain_id <= 0
       OR p_chain_id >= 1e78 OR p_chain_id <> trunc(p_chain_id)
       OR v_core IS NULL OR v_core !~ '^0x[0-9a-f]{40}$'
       OR v_core = '0x0000000000000000000000000000000000000000'
       OR v_creator IS NULL OR v_creator !~ '^0x[0-9a-f]{40}$'
       OR v_creator = '0x0000000000000000000000000000000000000000'
       OR v_type IS NULL OR p_declared_size IS NULL
       OR p_declared_size < 1 OR p_declared_size > 52428800 OR p_declared_size <> trunc(p_declared_size) THEN
        RAISE EXCEPTION 'INVALID_MEDIA_UPLOAD';
    END IF;
    v_chain := p_chain_id;
    PERFORM pg_advisory_xact_lock(hashtextextended('artsoul-media-preparation:' || p_publication_id::TEXT, 0));
    SELECT * INTO v_existing FROM public.artwork_media_preparations WHERE publication_id = p_publication_id;
    IF FOUND THEN
        IF ROW(v_existing.chain_id, v_existing.core_address, v_existing.creator_wallet,
               v_existing.declared_content_type, v_existing.declared_size)
           IS DISTINCT FROM ROW(v_chain, v_core, v_creator, v_type, p_declared_size) THEN
            RAISE EXCEPTION 'MEDIA_UPLOAD_MISMATCH';
        END IF;
        -- Retrying authorization cannot replace or regenerate its fixed paths.
        RETURN to_jsonb(v_existing);
    END IF;

    IF p_media_path IS NULL
       OR p_media_path !~ '^uploads/0x[0-9a-f]{40}/[0-9]{13}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9_.-]{1,101}$'
       OR split_part(p_media_path, '/', 2) <> v_creator
       OR p_metadata_path IS NULL
       OR p_metadata_path !~ '^metadata/0x[0-9a-f]{40}/[0-9]{13}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9_.-]{1,96}\.json$'
       OR split_part(p_metadata_path, '/', 2) <> v_creator
       OR v_type NOT IN (
           'image/jpeg', 'image/png', 'image/gif', 'image/webp',
           'video/mp4', 'video/webm', 'video/quicktime',
           'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav',
           'audio/ogg', 'audio/aac', 'audio/mp4'
       ) THEN
        RAISE EXCEPTION 'INVALID_MEDIA_UPLOAD';
    END IF;
    BEGIN
        INSERT INTO public.artwork_media_preparations (
            publication_id, chain_id, core_address, creator_wallet, media_path, metadata_path,
            declared_content_type, declared_size
        ) VALUES (p_publication_id, v_chain, v_core, v_creator, p_media_path, p_metadata_path, v_type, p_declared_size)
        RETURNING * INTO v_existing;
    EXCEPTION WHEN unique_violation THEN
        -- Never reveal another publication's ID, wallet or stored paths.
        RAISE EXCEPTION 'MEDIA_UPLOAD_PATH_CONFLICT';
    END;
    RETURN to_jsonb(v_existing);
END;
$$;

CREATE OR REPLACE FUNCTION public.prepare_artwork_media_upload(
    p_publication_id UUID,
    p_creator_wallet TEXT,
    p_media_sha256 TEXT,
    p_byte_size NUMERIC,
    p_content_type TEXT,
    p_metadata_json JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_creator TEXT := lower(p_creator_wallet);
    v_hash TEXT := lower(p_media_sha256);
    v_type TEXT := lower(p_content_type);
    v_existing public.artwork_media_preparations%ROWTYPE;
BEGIN
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'MEDIA_IDENTITY_REQUIRES_READ_COMMITTED';
    END IF;
    IF p_publication_id IS NULL OR v_creator IS NULL OR v_creator !~ '^0x[0-9a-f]{40}$'
       OR v_creator = '0x0000000000000000000000000000000000000000'
       OR v_hash IS NULL OR v_hash !~ '^[0-9a-f]{64}$'
       OR p_byte_size IS NULL OR p_byte_size < 1 OR p_byte_size > 52428800 OR p_byte_size <> trunc(p_byte_size)
       OR v_type IS NULL OR p_metadata_json IS NULL OR jsonb_typeof(p_metadata_json) <> 'object'
       OR octet_length(p_metadata_json::TEXT) > 262144 THEN
        RAISE EXCEPTION 'INVALID_MEDIA_PREPARATION';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('artsoul-media-preparation:' || p_publication_id::TEXT, 0));
    SELECT * INTO v_existing FROM public.artwork_media_preparations WHERE publication_id = p_publication_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'MEDIA_UPLOAD_NOT_FOUND'; END IF;
    IF v_existing.creator_wallet <> v_creator THEN RAISE EXCEPTION 'MEDIA_UPLOAD_MISMATCH'; END IF;
    IF v_existing.declared_size <> p_byte_size OR v_existing.declared_content_type <> v_type THEN
        RAISE EXCEPTION 'MEDIA_PREPARATION_MISMATCH';
    END IF;
    IF v_existing.media_sha256 IS NOT NULL THEN
        IF ROW(v_existing.media_sha256, v_existing.byte_size, v_existing.content_type, v_existing.metadata_json)
           IS DISTINCT FROM ROW(v_hash, p_byte_size, v_type, p_metadata_json) THEN
            RAISE EXCEPTION 'MEDIA_PREPARATION_MISMATCH';
        END IF;
        RETURN to_jsonb(v_existing);
    END IF;
    UPDATE public.artwork_media_preparations
        SET media_sha256 = v_hash, byte_size = p_byte_size, content_type = v_type, metadata_json = p_metadata_json
        WHERE publication_id = p_publication_id RETURNING * INTO v_existing;
    RETURN to_jsonb(v_existing);
END;
$$;

REVOKE ALL ON FUNCTION public.issue_artwork_media_upload(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prepare_artwork_media_upload(UUID, TEXT, TEXT, NUMERIC, TEXT, JSONB)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_artwork_media_upload(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.prepare_artwork_media_upload(UUID, TEXT, TEXT, NUMERIC, TEXT, JSONB) TO service_role;

COMMIT;
