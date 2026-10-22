-- TA-10 private persistence foundation only. No website or contract enforcement
-- is enabled by this migration. Trusted callers must verify original media
-- bytes, registration evidence and the configured deployment before calling.
-- These are internal coordination states, not artwork/auction lifecycle states.
-- No expiry, release, deletion or reorg policy is introduced here.
BEGIN;

CREATE TABLE IF NOT EXISTS public.artwork_media_catalog (
    chain_id NUMERIC(78, 0) NOT NULL CHECK (chain_id > 0),
    core_address TEXT NOT NULL CHECK (core_address ~ '^0x[0-9a-f]{40}$' AND core_address <> '0x0000000000000000000000000000000000000000'),
    artwork_id NUMERIC(78, 0) NOT NULL CHECK (artwork_id > 0),
    creator_wallet TEXT NOT NULL CHECK (creator_wallet ~ '^0x[0-9a-f]{40}$' AND creator_wallet <> '0x0000000000000000000000000000000000000000'),
    media_sha256 TEXT NOT NULL CHECK (media_sha256 ~ '^[0-9a-f]{64}$'),
    media_uri TEXT NOT NULL CHECK (length(btrim(media_uri)) > 0),
    byte_size BIGINT NOT NULL CHECK (byte_size > 0),
    metadata_uri TEXT NOT NULL CHECK (length(btrim(metadata_uri)) > 0),
    transaction_hash TEXT NOT NULL CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$'),
    block_number NUMERIC(78, 0) NOT NULL CHECK (block_number >= 0),
    log_index INTEGER NOT NULL CHECK (log_index >= 0),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (chain_id, core_address, artwork_id)
);

-- Intentionally non-unique: previously registered duplicate works remain facts.
CREATE INDEX IF NOT EXISTS artwork_media_catalog_hash
    ON public.artwork_media_catalog (chain_id, core_address, media_sha256);

CREATE TABLE IF NOT EXISTS public.artwork_media_publications (
    publication_id UUID PRIMARY KEY,
    chain_id NUMERIC(78, 0) NOT NULL CHECK (chain_id > 0),
    core_address TEXT NOT NULL CHECK (core_address ~ '^0x[0-9a-f]{40}$' AND core_address <> '0x0000000000000000000000000000000000000000'),
    creator_wallet TEXT NOT NULL CHECK (creator_wallet ~ '^0x[0-9a-f]{40}$' AND creator_wallet <> '0x0000000000000000000000000000000000000000'),
    media_sha256 TEXT NOT NULL CHECK (media_sha256 ~ '^[0-9a-f]{64}$'),
    media_path TEXT NOT NULL CHECK (
        media_path ~ '^uploads/0x[0-9a-f]{40}/[A-Za-z0-9][A-Za-z0-9._-]*$'
        AND split_part(media_path, '/', 2) = creator_wallet
    ),
    byte_size BIGINT NOT NULL CHECK (byte_size > 0),
    metadata_uri TEXT NOT NULL CHECK (length(btrim(metadata_uri)) > 0),
    claim_status TEXT NOT NULL DEFAULT 'claimed' CHECK (claim_status IN ('claimed', 'registered', 'conflict')),
    registered_artwork_id NUMERIC(78, 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (chain_id, core_address, media_sha256),
    FOREIGN KEY (chain_id, core_address, registered_artwork_id)
        REFERENCES public.artwork_media_catalog (chain_id, core_address, artwork_id),
    CHECK ((claim_status <> 'claimed' OR registered_artwork_id IS NULL)
       AND (claim_status <> 'registered' OR registered_artwork_id IS NOT NULL))
);

ALTER TABLE public.artwork_media_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artwork_media_catalog FORCE ROW LEVEL SECURITY;
ALTER TABLE public.artwork_media_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artwork_media_publications FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.artwork_media_catalog, public.artwork_media_publications
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.artwork_media_catalog, public.artwork_media_publications TO service_role;
DROP POLICY IF EXISTS artwork_media_catalog_service_read ON public.artwork_media_catalog;
CREATE POLICY artwork_media_catalog_service_read ON public.artwork_media_catalog
    FOR SELECT TO service_role USING (true);
DROP POLICY IF EXISTS artwork_media_publications_service_read ON public.artwork_media_publications;
CREATE POLICY artwork_media_publications_service_read ON public.artwork_media_publications
    FOR SELECT TO service_role USING (true);

CREATE OR REPLACE FUNCTION public.claim_artwork_media_publication(
    p_publication_id UUID,
    p_chain_id NUMERIC,
    p_core_address TEXT,
    p_creator_wallet TEXT,
    p_media_sha256 TEXT,
    p_media_path TEXT,
    p_byte_size BIGINT,
    p_metadata_uri TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_chain NUMERIC(78, 0);
    v_core TEXT := lower(p_core_address);
    v_creator TEXT := lower(p_creator_wallet);
    v_hash TEXT := lower(p_media_sha256);
    v_existing public.artwork_media_publications%ROWTYPE;
BEGIN
    -- A transaction with an older fixed snapshot could miss catalog rows that
    -- committed while it waited for the shared hash lock.
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'MEDIA_IDENTITY_REQUIRES_READ_COMMITTED';
    END IF;
    IF p_publication_id IS NULL OR p_chain_id IS NULL OR p_chain_id <= 0
       OR p_chain_id >= 1e78 OR p_chain_id <> trunc(p_chain_id)
       OR v_core IS NULL OR v_core !~ '^0x[0-9a-f]{40}$'
       OR v_core = '0x0000000000000000000000000000000000000000'
       OR v_creator IS NULL OR v_creator !~ '^0x[0-9a-f]{40}$'
       OR v_creator = '0x0000000000000000000000000000000000000000'
       OR v_hash IS NULL OR v_hash !~ '^[0-9a-f]{64}$'
       OR p_media_path IS NULL OR p_media_path !~ '^uploads/0x[0-9a-f]{40}/[A-Za-z0-9][A-Za-z0-9._-]*$'
       OR split_part(p_media_path, '/', 2) <> v_creator
       OR p_byte_size IS NULL OR p_byte_size <= 0
       OR p_metadata_uri IS NULL OR length(btrim(p_metadata_uri)) = 0 THEN
        RAISE EXCEPTION 'INVALID_MEDIA_PUBLICATION';
    END IF;
    v_chain := p_chain_id;

    -- Lock UUID first to serialize mutated concurrent retries across hashes.
    -- The other RPC never takes this lock, so lock order cannot form a cycle.
    PERFORM pg_advisory_xact_lock(hashtextextended('artsoul-media-publication:' || p_publication_id::TEXT, 0));
    PERFORM pg_advisory_xact_lock(hashtextextended('artsoul-media-hash:' || v_chain::TEXT || ':' || v_core || ':' || v_hash, 0));

    SELECT * INTO v_existing FROM public.artwork_media_publications
        WHERE publication_id = p_publication_id;
    IF FOUND THEN
        IF ROW(v_existing.chain_id, v_existing.core_address, v_existing.creator_wallet,
               v_existing.media_sha256, v_existing.media_path, v_existing.byte_size, v_existing.metadata_uri)
           IS DISTINCT FROM ROW(v_chain, v_core, v_creator, v_hash, p_media_path, p_byte_size, p_metadata_uri) THEN
            RETURN 'PUBLICATION_MISMATCH';
        END IF;
        IF v_existing.claim_status = 'conflict' THEN RETURN 'PUBLICATION_BLOCKED'; END IF;
        IF v_existing.claim_status = 'registered' THEN RETURN 'REGISTERED'; END IF;
        RETURN 'RESUME';
    END IF;

    IF EXISTS (SELECT 1 FROM public.artwork_media_catalog
               WHERE chain_id = v_chain AND core_address = v_core AND media_sha256 = v_hash)
       OR EXISTS (SELECT 1 FROM public.artwork_media_publications
                  WHERE chain_id = v_chain AND core_address = v_core AND media_sha256 = v_hash) THEN
        -- Deliberately no competing wallet, publication ID or artwork details.
        RETURN 'DUPLICATE_MEDIA';
    END IF;
    INSERT INTO public.artwork_media_publications (
        publication_id, chain_id, core_address, creator_wallet, media_sha256, media_path, byte_size, metadata_uri
    ) VALUES (p_publication_id, v_chain, v_core, v_creator, v_hash, p_media_path, p_byte_size, p_metadata_uri);
    RETURN 'CLAIMED';
END;
$$;

CREATE OR REPLACE FUNCTION public.record_artwork_media_identity(
    p_chain_id NUMERIC,
    p_core_address TEXT,
    p_artwork_id NUMERIC,
    p_creator_wallet TEXT,
    p_media_sha256 TEXT,
    p_media_uri TEXT,
    p_byte_size BIGINT,
    p_metadata_uri TEXT,
    p_transaction_hash TEXT,
    p_block_number NUMERIC,
    p_log_index INTEGER
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_chain NUMERIC(78, 0);
    v_artwork NUMERIC(78, 0);
    v_core TEXT := lower(p_core_address);
    v_creator TEXT := lower(p_creator_wallet);
    v_hash TEXT := lower(p_media_sha256);
    v_tx TEXT := lower(p_transaction_hash);
    v_existing public.artwork_media_catalog%ROWTYPE;
    v_claim public.artwork_media_publications%ROWTYPE;
    v_conflict BOOLEAN;
BEGIN
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'MEDIA_IDENTITY_REQUIRES_READ_COMMITTED';
    END IF;
    IF p_chain_id IS NULL OR p_chain_id <= 0 OR p_chain_id >= 1e78 OR p_chain_id <> trunc(p_chain_id)
       OR p_artwork_id IS NULL OR p_artwork_id <= 0 OR p_artwork_id >= 1e78 OR p_artwork_id <> trunc(p_artwork_id)
       OR v_core IS NULL OR v_core !~ '^0x[0-9a-f]{40}$'
       OR v_core = '0x0000000000000000000000000000000000000000'
       OR v_creator IS NULL OR v_creator !~ '^0x[0-9a-f]{40}$'
       OR v_creator = '0x0000000000000000000000000000000000000000'
       OR v_hash IS NULL OR v_hash !~ '^[0-9a-f]{64}$'
       OR p_media_uri IS NULL OR length(btrim(p_media_uri)) = 0
       OR p_byte_size IS NULL OR p_byte_size <= 0
       OR p_metadata_uri IS NULL OR length(btrim(p_metadata_uri)) = 0
       OR v_tx IS NULL OR v_tx !~ '^0x[0-9a-f]{64}$'
       OR p_block_number IS NULL OR p_block_number < 0 OR p_block_number >= 1e78 OR p_block_number <> trunc(p_block_number)
       OR p_log_index IS NULL OR p_log_index < 0 THEN
        RAISE EXCEPTION 'INVALID_MEDIA_IDENTITY';
    END IF;
    v_chain := p_chain_id;
    v_artwork := p_artwork_id;
    PERFORM pg_advisory_xact_lock(hashtextextended('artsoul-media-artwork:' || v_chain::TEXT || ':' || v_core || ':' || v_artwork::TEXT, 0));
    PERFORM pg_advisory_xact_lock(hashtextextended('artsoul-media-hash:' || v_chain::TEXT || ':' || v_core || ':' || v_hash, 0));

    SELECT * INTO v_existing FROM public.artwork_media_catalog
        WHERE chain_id = v_chain AND core_address = v_core AND artwork_id = v_artwork;
    IF FOUND THEN
        IF ROW(v_existing.creator_wallet, v_existing.media_sha256, v_existing.media_uri, v_existing.byte_size,
               v_existing.metadata_uri, v_existing.transaction_hash, v_existing.block_number, v_existing.log_index)
           IS DISTINCT FROM ROW(v_creator, v_hash, p_media_uri, p_byte_size, p_metadata_uri, v_tx, p_block_number, p_log_index) THEN
            RAISE EXCEPTION 'MEDIA_IDENTITY_CONFLICT';
        END IF;
        RETURN 'ALREADY_RECORDED';
    END IF;

    -- A digest describes one byte string, including its measured length.
    IF EXISTS (SELECT 1 FROM public.artwork_media_catalog
               WHERE chain_id = v_chain AND core_address = v_core AND media_sha256 = v_hash AND byte_size <> p_byte_size)
       OR EXISTS (SELECT 1 FROM public.artwork_media_publications
                  WHERE chain_id = v_chain AND core_address = v_core AND media_sha256 = v_hash AND byte_size <> p_byte_size) THEN
        RAISE EXCEPTION 'MEDIA_IDENTITY_CONFLICT';
    END IF;
    INSERT INTO public.artwork_media_catalog (
        chain_id, core_address, artwork_id, creator_wallet, media_sha256, media_uri, byte_size,
        metadata_uri, transaction_hash, block_number, log_index
    ) VALUES (v_chain, v_core, v_artwork, v_creator, v_hash, p_media_uri, p_byte_size,
              p_metadata_uri, v_tx, p_block_number, p_log_index);

    SELECT * INTO v_claim FROM public.artwork_media_publications
        WHERE chain_id = v_chain AND core_address = v_core AND media_sha256 = v_hash;
    IF FOUND THEN
        v_conflict := v_claim.claim_status = 'conflict'
            OR v_claim.creator_wallet <> v_creator OR v_claim.metadata_uri <> p_metadata_uri
            OR (v_claim.registered_artwork_id IS NOT NULL AND v_claim.registered_artwork_id <> v_artwork)
            OR EXISTS (SELECT 1 FROM public.artwork_media_catalog
                       WHERE chain_id = v_chain AND core_address = v_core AND media_sha256 = v_hash AND artwork_id <> v_artwork);
        UPDATE public.artwork_media_publications
            SET claim_status = CASE WHEN v_conflict THEN 'conflict' ELSE 'registered' END,
                registered_artwork_id = CASE WHEN v_conflict THEN registered_artwork_id ELSE v_artwork END,
                updated_at = clock_timestamp()
            WHERE publication_id = v_claim.publication_id;
    END IF;
    RETURN 'RECORDED';
END;
$$;

REVOKE ALL ON FUNCTION public.claim_artwork_media_publication(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_artwork_media_identity(NUMERIC, TEXT, NUMERIC, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, NUMERIC, INTEGER)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_artwork_media_publication(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_artwork_media_identity(NUMERIC, TEXT, NUMERIC, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, NUMERIC, INTEGER) TO service_role;

COMMIT;
