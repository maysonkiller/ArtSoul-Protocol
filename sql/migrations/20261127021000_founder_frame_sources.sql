BEGIN;
ALTER TABLE artsoul_private.aura_sources
    DROP CONSTRAINT aura_sources_kind_check,
    DROP CONSTRAINT aura_sources_check,
    ADD CHECK (kind IN ('partner','platform','founder')),
    ADD CHECK ((kind='partner' AND scope='') OR (kind IN ('platform','founder') AND scope ~ '^0x[0-9a-f]{40}$' AND scope <> '0x'||repeat('0',40)));

CREATE OR REPLACE FUNCTION public.manage_aura_sources(p_actor text,p_version bigint,p_origin text,p_policy_version bigint,
    p_kind text,p_chain integer,p_scope text,p_address text,p_after text,p_revision integer,p_enabled boolean,p_reason text)
RETURNS TABLE(address text,enabled boolean,revision integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_revision integer;
    other_kind text;
    other_revision integer;
BEGIN
    -- Acquire the same current policy and role locks as the appearance control.
    PERFORM 1 FROM public.manage_aura_border_setting(p_actor,p_version,p_origin,p_policy_version,NULL,NULL);
    IF p_kind IS NULL OR p_kind NOT IN ('platform','founder','partner') OR p_chain IS NULL OR p_chain NOT IN (8453,84532)
        OR p_scope IS NULL OR (p_kind IN ('platform','founder') AND (p_scope !~ '^0x[0-9a-f]{40}$' OR p_scope='0x'||repeat('0',40)))
        OR (p_kind='partner' AND p_scope<>'') OR (p_address IS NOT NULL AND (p_address !~ '^0x[0-9a-f]{40}$' OR p_address='0x'||repeat('0',40)))
        OR p_after IS NULL OR (p_after<>'' AND p_after !~ '^0x[0-9a-f]{40}$') THEN RAISE EXCEPTION 'INVALID_SOURCE'; END IF;
    IF p_enabled IS NOT NULL THEN
        IF p_address IS NULL OR p_revision IS NULL OR p_revision<0 OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 5 AND 500
            THEN RAISE EXCEPTION 'INVALID_SOURCE'; END IF;
        PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('frame:'||(CASE WHEN p_kind='partner' THEN 'partner' ELSE 'publisher' END)||p_chain||p_scope||p_address,0));
        SELECT coalesce(max(s.revision),0) INTO current_revision FROM artsoul_private.aura_sources s
            WHERE s.kind=p_kind AND s.chain_id=p_chain AND s.scope=p_scope AND s.address=p_address;
        IF current_revision <> p_revision THEN RAISE EXCEPTION 'SOURCE_CHANGED'; END IF;
        IF p_enabled AND p_kind IN ('platform','founder') THEN
            other_kind := CASE WHEN p_kind='founder' THEN 'platform' ELSE 'founder' END;
            SELECT coalesce(max(s.revision),0) INTO other_revision FROM artsoul_private.aura_sources s
                WHERE s.kind=other_kind AND s.chain_id=p_chain AND s.scope=p_scope AND s.address=p_address;
            -- Invalidate stale reviews of the other classification, including a
            -- configured Platform publisher which has no database revision yet.
            INSERT INTO artsoul_private.aura_sources(kind,chain_id,scope,address,revision,enabled,actor,role_version,policy_version,reason)
                VALUES(other_kind,p_chain,p_scope,p_address,other_revision+1,false,p_actor,p_version,p_policy_version,
                    'Reclassified as '||p_kind||' publisher');
        END IF;
        INSERT INTO artsoul_private.aura_sources(kind,chain_id,scope,address,revision,enabled,actor,role_version,policy_version,reason)
            VALUES(p_kind,p_chain,p_scope,p_address,current_revision+1,p_enabled,p_actor,p_version,p_policy_version,btrim(p_reason));
    END IF;
    RETURN QUERY SELECT DISTINCT ON(s.address) s.address,s.enabled,s.revision FROM artsoul_private.aura_sources s
        WHERE s.kind=p_kind AND s.chain_id=p_chain AND s.scope=p_scope AND (p_address IS NULL OR s.address=p_address) AND s.address>p_after
        ORDER BY s.address,s.revision DESC LIMIT 26;
END;
$$;
CREATE FUNCTION public.publisher_frame_states(p_chain integer,p_scope text,p_addresses text[])
RETURNS TABLE(address text,enabled boolean,kind text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
    WITH latest AS (
        SELECT DISTINCT ON (s.address,s.kind) s.address,s.enabled,s.kind
        FROM artsoul_private.aura_sources s
        WHERE s.kind IN ('founder','platform') AND s.chain_id=p_chain AND s.scope=p_scope
            AND cardinality(p_addresses) BETWEEN 1 AND 200 AND s.address=ANY(p_addresses)
        ORDER BY s.address,s.kind,s.revision DESC
    )
    SELECT DISTINCT ON (l.address) l.address,l.enabled,l.kind FROM latest l
    ORDER BY l.address,l.enabled DESC,l.kind;
$$;
REVOKE ALL ON FUNCTION public.publisher_frame_states(integer,text,text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.publisher_frame_states(integer,text,text[]) TO service_role;
COMMIT;
