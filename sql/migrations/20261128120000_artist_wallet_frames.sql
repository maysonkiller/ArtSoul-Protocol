BEGIN;
-- Cosmetic author designations share the existing private, append-only review log.
ALTER TABLE artsoul_private.aura_sources
    DROP CONSTRAINT aura_sources_kind_check,
    DROP CONSTRAINT aura_sources_check,
    ADD COLUMN artist_frame text,
    ADD CHECK (kind IN ('partner','platform','founder','genesis','official_collection','artist_wallet')),
    ADD CHECK ((kind IN ('partner','genesis','artist_wallet') AND scope='') OR
        (kind IN ('platform','founder','official_collection') AND scope ~ '^0x[0-9a-f]{40}$' AND scope <> '0x'||repeat('0',40))),
    ADD CHECK (CASE WHEN kind='artist_wallet' THEN artist_frame IS NOT NULL AND artist_frame IN ('founder','partner','genesis')
               ELSE artist_frame IS NULL END);

CREATE FUNCTION public.manage_artist_frames(p_actor text,p_version bigint,p_origin text,p_policy_version bigint,
    p_frame text,p_chain integer,p_address text,p_after text,p_revision integer,p_enabled boolean,p_reason text)
RETURNS TABLE(address text,enabled boolean,revision integer,active_frame text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous artsoul_private.aura_sources%ROWTYPE;
BEGIN
    IF p_enabled IS NOT NULL AND (p_origin IS NULL OR p_policy_version IS NULL) THEN RAISE EXCEPTION 'FRAME_TEAM_REQUIRED'; END IF;
    PERFORM 1 FROM public.manage_aura_border_setting(p_actor,p_version,p_origin,p_policy_version,NULL,NULL);
    IF p_frame IS NULL OR p_frame NOT IN ('founder','partner','genesis') OR p_chain IS NULL OR p_chain NOT IN (8453,84532)
        OR (p_address IS NOT NULL AND (p_address !~ '^0x[0-9a-f]{40}$' OR p_address='0x'||repeat('0',40)))
        OR p_after IS NULL OR (p_after<>'' AND (p_after !~ '^0x[0-9a-f]{40}$' OR p_address IS NOT NULL))
        THEN RAISE EXCEPTION 'INVALID_SOURCE'; END IF;
    IF p_enabled IS NOT NULL THEN
        IF p_address IS NULL OR p_revision IS NULL OR p_revision<0 OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 5 AND 500
            THEN RAISE EXCEPTION 'INVALID_SOURCE'; END IF;
        PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('artist-frame:'||p_chain||p_address,0));
        SELECT s.* INTO previous FROM artsoul_private.aura_sources s
            WHERE s.kind='artist_wallet' AND s.chain_id=p_chain AND s.scope='' AND s.address=p_address
            ORDER BY s.revision DESC LIMIT 1;
        IF p_revision<>coalesce(previous.revision,0) OR
            p_enabled=(coalesce(previous.enabled,false) AND previous.artist_frame IS NOT DISTINCT FROM p_frame)
            THEN RAISE EXCEPTION 'SOURCE_CHANGED'; END IF;
        INSERT INTO artsoul_private.aura_sources(kind,chain_id,scope,address,revision,enabled,actor,role_version,policy_version,reason,artist_frame)
            VALUES('artist_wallet',p_chain,'',p_address,p_revision+1,p_enabled,p_actor,p_version,p_policy_version,btrim(p_reason),p_frame);
    END IF;
    RETURN QUERY SELECT l.address,l.enabled AND l.artist_frame=p_frame,l.revision,CASE WHEN l.enabled THEN l.artist_frame END
        FROM (SELECT DISTINCT ON(s.address) s.address,s.enabled,s.revision,s.artist_frame FROM artsoul_private.aura_sources s
              WHERE s.kind='artist_wallet' AND s.chain_id=p_chain AND s.scope='' AND (p_address IS NULL OR s.address=p_address)
                AND s.address>p_after ORDER BY s.address,s.revision DESC) l
        WHERE p_address IS NOT NULL OR l.artist_frame=p_frame ORDER BY l.address LIMIT 26;
END;
$$;
REVOKE ALL ON FUNCTION public.manage_artist_frames(text,bigint,text,bigint,text,integer,text,text,integer,boolean,text)
    FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.manage_artist_frames(text,bigint,text,bigint,text,integer,text,text,integer,boolean,text)
    TO service_role;

-- An active designation must remain revocable even when its RPC provider is offline.
CREATE FUNCTION public.review_official_frame_sources(p_actor text,p_version bigint,p_origin text,p_policy_version bigint,
    p_chain integer,p_address text,p_after text)
RETURNS TABLE(address text,enabled boolean,revision integer,issuer text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
    PERFORM 1 FROM public.manage_aura_border_setting(p_actor,p_version,p_origin,p_policy_version,NULL,NULL);
    RETURN QUERY WITH latest AS (
        SELECT DISTINCT ON(s.address,s.scope) s.address,s.enabled,s.revision,s.scope,s.recorded_at
        FROM artsoul_private.aura_sources s WHERE s.kind='official_collection' AND s.chain_id=p_chain
            AND (p_address IS NULL OR s.address=p_address) AND s.address>p_after
        ORDER BY s.address,s.scope,s.revision DESC
    )
    SELECT DISTINCT ON(l.address) l.address,l.enabled,l.revision,l.scope FROM latest l
    ORDER BY l.address,l.enabled DESC,l.recorded_at DESC,l.scope LIMIT 26;
END;
$$;
REVOKE ALL ON FUNCTION public.review_official_frame_sources(text,bigint,text,bigint,integer,text,text)
    FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.review_official_frame_sources(text,bigint,text,bigint,integer,text,text)
    TO service_role;

CREATE OR REPLACE FUNCTION public.publisher_frame_states(p_chain integer,p_scope text,p_addresses text[])
RETURNS TABLE(address text,enabled boolean,kind text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
    WITH latest AS (
        SELECT DISTINCT ON (s.address,s.kind) s.address,s.enabled,s.kind,s.artist_frame
        FROM artsoul_private.aura_sources s
        WHERE ((s.kind IN ('founder','platform') AND s.scope=p_scope) OR (s.kind='artist_wallet' AND s.scope=''))
            AND p_scope ~ '^0x[0-9a-f]{40}$' AND p_scope<>'0x'||repeat('0',40)
            AND s.chain_id=p_chain AND cardinality(p_addresses) BETWEEN 1 AND 200 AND s.address=ANY(p_addresses)
        ORDER BY s.address,s.kind,s.revision DESC
    )
    SELECT DISTINCT ON (l.address) l.address,l.enabled,
        CASE WHEN l.kind='artist_wallet' THEN 'artist_'||l.artist_frame ELSE l.kind END FROM latest l
    ORDER BY l.address,l.enabled DESC,(l.kind='platform') DESC,(l.kind='artist_wallet') DESC,l.kind;
$$;
COMMIT;
