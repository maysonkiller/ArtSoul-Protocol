-- Staff-only artwork catalog and revision-bound manual visibility decisions.
-- Complaint decisions retain their independent review and restoration workflow.
BEGIN;

CREATE INDEX IF NOT EXISTS artwork_reports_catalog_target
    ON public.artwork_reports(chain_id, artwork_id, target_type, status);

CREATE OR REPLACE FUNCTION public.read_admin_artwork_catalog(
    p_before TEXT DEFAULT NULL, p_limit INTEGER DEFAULT 26, p_ids TEXT[] DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE result JSONB;
BEGIN
    IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 201
       OR (p_ids IS NULL AND p_limit > 26)
       OR (p_before IS NOT NULL AND (p_before !~ '^[1-9][0-9]{0,77}$'
           OR p_before::NUMERIC >= 2::NUMERIC^256))
       OR (p_ids IS NOT NULL AND (cardinality(p_ids) NOT BETWEEN 1 AND 200 OR p_before IS NOT NULL
           OR EXISTS(SELECT 1 FROM unnest(p_ids) value WHERE value IS NULL
               OR value !~ '^[1-9][0-9]{0,77}$' OR value::NUMERIC >= 2::NUMERIC^256))) THEN
        RAISE EXCEPTION 'INVALID_CATALOG_REQUEST' USING ERRCODE='22023';
    END IF;
    SELECT COALESCE(jsonb_agg(to_jsonb(item) ORDER BY item.artwork_id::NUMERIC DESC), '[]'::JSONB)
    INTO result FROM (
        SELECT a.chain_id::INTEGER AS chain_id, a.artwork_id::TEXT AS artwork_id,
            lower(a.creator) AS creator, a.metadata_uri, a.transaction_hash,
            m.title, CASE WHEN m.metadata IS NULL THEN NULL ELSE jsonb_strip_nulls(jsonb_build_object(
                'name',left(m.metadata->>'name',512),'title',left(m.metadata->>'title',512),
                'media_type',left(m.metadata->>'media_type',128),'file_type',left(m.metadata->>'file_type',128),
                'mime_type',left(m.metadata->>'mime_type',128),'image',left(m.metadata->>'image',2048),
                'image_url',left(m.metadata->>'image_url',2048),'animation_url',left(m.metadata->>'animation_url',2048),
                'media_url',left(m.metadata->>'media_url',2048),'file_url',left(m.metadata->>'file_url',2048),
                'poster_url',left(m.metadata->>'poster_url',2048),'thumbnail_url',left(m.metadata->>'thumbnail_url',2048),
                'properties',jsonb_build_object('media_type',left(m.metadata#>>'{properties,media_type}',128),
                    'mime_type',left(m.metadata#>>'{properties,mime_type}',128),'image',left(m.metadata#>>'{properties,image}',2048),
                    'poster_url',left(m.metadata#>>'{properties,poster_url}',2048),
                    'animation_url',left(m.metadata#>>'{properties,animation_url}',2048),
                    'media_url',left(m.metadata#>>'{properties,media_url}',2048)))) END AS metadata,
            COALESCE(v.hidden,FALSE) AS hidden, v.hidden_reason, v.updated_at AS visibility_updated_at,
            (SELECT count(*) FROM public.artwork_reports r WHERE r.chain_id=a.chain_id
                AND r.artwork_id=a.artwork_id AND r.target_type='artwork') AS report_count,
            (SELECT count(*) FROM public.artwork_reports r WHERE r.chain_id=a.chain_id
                AND r.artwork_id=a.artwork_id AND r.target_type='artwork' AND r.status='pending_review') AS pending_count,
            (SELECT count(*) FROM public.artwork_reports r WHERE r.chain_id=a.chain_id
                AND r.artwork_id=a.artwork_id AND r.target_type='artwork' AND r.status='actioned') AS actioned_count,
            (SELECT count(*) FROM public.artwork_reports r WHERE r.chain_id=a.chain_id
                AND r.artwork_id=a.artwork_id AND r.target_type='donation_message') AS donation_report_count
        FROM (SELECT * FROM public.v41_artworks source WHERE source.chain_id=84532
            AND (p_before IS NULL OR source.artwork_id < p_before::NUMERIC)
            AND (p_ids IS NULL OR source.artwork_id=ANY(p_ids::NUMERIC[]))
            ORDER BY source.artwork_id DESC LIMIT p_limit) a
        LEFT JOIN public.artwork_search_metadata m ON m.chain_id=a.chain_id AND m.artwork_id=a.artwork_id
            AND m.metadata_uri=a.metadata_uri AND m.source_transaction_hash=a.transaction_hash
        LEFT JOIN public.artwork_moderation_visibility v ON v.chain_id=a.chain_id AND v.artwork_id=a.artwork_id
    ) item;
    RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.read_admin_artwork_catalog(TEXT, INTEGER, TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_admin_artwork_catalog(TEXT, INTEGER, TEXT[]) TO service_role;

CREATE OR REPLACE FUNCTION public.review_artwork_visibility(
    p_chain_id NUMERIC, p_artwork_id NUMERIC, p_hidden BOOLEAN, p_reason TEXT,
    p_actor_wallet TEXT, p_expected_updated_at TIMESTAMPTZ
) RETURNS SETOF public.artwork_moderation_visibility
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    previous public.artwork_moderation_visibility%ROWTYPE;
    normalized_reason TEXT := btrim(COALESCE(p_reason,''));
    revision TIMESTAMPTZ;
BEGIN
    IF p_chain_id IS DISTINCT FROM 84532 OR p_artwork_id IS NULL OR p_artwork_id < 1
       OR p_artwork_id <> trunc(p_artwork_id) OR p_artwork_id >= 2::NUMERIC^256 OR p_hidden IS NULL
       OR p_actor_wallet IS NULL OR p_actor_wallet !~ '^0x[0-9a-f]{40}$'
       OR char_length(normalized_reason) NOT BETWEEN 1 AND 500 THEN
        RAISE EXCEPTION 'INVALID_VISIBILITY_REQUEST' USING ERRCODE='22023';
    END IF;
    -- Same exact-content lock as review_moderation_report; manual restores
    -- cannot race an independent complaint's hide decision.
    PERFORM pg_advisory_xact_lock(hashtextextended(
        'artsoul-review:'||p_chain_id::TEXT||':artwork:'||p_artwork_id::TEXT,0));
    IF NOT EXISTS(SELECT 1 FROM public.artsoul_staff_roles r WHERE r.wallet_address=p_actor_wallet
        AND r.active AND r.role IN ('admin','moderator','team')) THEN
        RAISE EXCEPTION 'ADMIN_REQUIRED';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.v41_artworks a WHERE a.chain_id=p_chain_id AND a.artwork_id=p_artwork_id) THEN
        RAISE EXCEPTION 'ARTWORK_NOT_FOUND';
    END IF;
    SELECT v.* INTO previous FROM public.artwork_moderation_visibility v
        WHERE v.chain_id=p_chain_id AND v.artwork_id=p_artwork_id FOR UPDATE;
    IF previous.updated_at IS DISTINCT FROM p_expected_updated_at THEN
        RAISE EXCEPTION 'VISIBILITY_REVIEW_CONFLICT';
    END IF;
    IF NOT p_hidden AND EXISTS(SELECT 1 FROM public.artwork_reports r
        WHERE r.chain_id=p_chain_id AND r.artwork_id=p_artwork_id
          AND r.target_type='artwork' AND r.status='actioned') THEN
        RAISE EXCEPTION 'ARTWORK_ACTIVE_REPORTS';
    END IF;
    IF COALESCE(previous.hidden,FALSE)=p_hidden THEN RAISE EXCEPTION 'VISIBILITY_ALREADY_SET'; END IF;
    revision := GREATEST(clock_timestamp(), previous.updated_at + INTERVAL '1 microsecond');
    INSERT INTO public.artwork_moderation_visibility(chain_id,artwork_id,hidden,hidden_reason,hidden_by,hidden_at,updated_at)
    VALUES(p_chain_id,p_artwork_id,p_hidden,CASE WHEN p_hidden THEN normalized_reason END,
        CASE WHEN p_hidden THEN p_actor_wallet END,CASE WHEN p_hidden THEN revision END,revision)
    ON CONFLICT(chain_id,artwork_id) DO UPDATE SET hidden=EXCLUDED.hidden,hidden_reason=EXCLUDED.hidden_reason,
        hidden_by=EXCLUDED.hidden_by,hidden_at=EXCLUDED.hidden_at,updated_at=EXCLUDED.updated_at;
    INSERT INTO public.artwork_moderation_log(chain_id,artwork_id,action,reason,actor_wallet)
        VALUES(p_chain_id,p_artwork_id,CASE WHEN p_hidden THEN 'HIDE' ELSE 'UNHIDE' END,normalized_reason,p_actor_wallet);
    RETURN QUERY SELECT v.* FROM public.artwork_moderation_visibility v
        WHERE v.chain_id=p_chain_id AND v.artwork_id=p_artwork_id;
END;
$$;
REVOKE ALL ON FUNCTION public.review_artwork_visibility(NUMERIC, NUMERIC, BOOLEAN, TEXT, TEXT, TIMESTAMPTZ)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_artwork_visibility(NUMERIC, NUMERIC, BOOLEAN, TEXT, TEXT, TIMESTAMPTZ)
    TO service_role;
COMMIT;
