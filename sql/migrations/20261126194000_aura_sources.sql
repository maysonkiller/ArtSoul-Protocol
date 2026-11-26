BEGIN;
CREATE TABLE artsoul_private.aura_sources (
    kind text NOT NULL CHECK (kind IN ('platform','partner')),
    chain_id integer NOT NULL CHECK (chain_id IN (8453,84532)),
    scope text NOT NULL,
    address text NOT NULL CHECK (address ~ '^0x[0-9a-f]{40}$' AND address <> '0x0000000000000000000000000000000000000000'),
    revision integer NOT NULL CHECK (revision > 0),
    enabled boolean NOT NULL,
    actor text NOT NULL,
    role_version bigint NOT NULL,
    policy_version bigint,
    reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 5 AND 500),
    recorded_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((kind='partner' AND scope='') OR (kind='platform' AND scope ~ '^0x[0-9a-f]{40}$' AND scope <> '0x0000000000000000000000000000000000000000')),
    PRIMARY KEY(kind,chain_id,scope,address,revision)
);
ALTER TABLE artsoul_private.aura_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE artsoul_private.aura_sources FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE artsoul_private.aura_sources FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.aura_source_states(p_kind text,p_chain integer,p_scope text,p_addresses text[])
RETURNS TABLE(address text,enabled boolean,revision integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
    SELECT DISTINCT ON(s.address) s.address,s.enabled,s.revision FROM artsoul_private.aura_sources s
    WHERE cardinality(p_addresses) BETWEEN 1 AND 200 AND s.kind=p_kind AND s.chain_id=p_chain AND s.scope=p_scope
        AND s.address=ANY(p_addresses) ORDER BY s.address,s.revision DESC;
$$;

CREATE FUNCTION public.manage_aura_sources(p_actor text,p_version bigint,p_origin text,p_policy_version bigint,
    p_kind text,p_chain integer,p_scope text,p_address text,p_after text,p_revision integer,p_enabled boolean,p_reason text)
RETURNS TABLE(address text,enabled boolean,revision integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_revision integer;
BEGIN
    -- Acquire the same current policy and role locks as the appearance control.
    PERFORM 1 FROM public.manage_aura_border_setting(p_actor,p_version,p_origin,p_policy_version,NULL,NULL);
    IF p_kind IS NULL OR p_kind NOT IN ('platform','partner') OR p_chain IS NULL OR p_chain NOT IN (8453,84532)
        OR p_scope IS NULL OR (p_kind='platform' AND (p_scope !~ '^0x[0-9a-f]{40}$' OR p_scope='0x'||repeat('0',40)))
        OR (p_kind='partner' AND p_scope<>'') OR (p_address IS NOT NULL AND (p_address !~ '^0x[0-9a-f]{40}$' OR p_address='0x'||repeat('0',40)))
        OR p_after IS NULL OR (p_after<>'' AND p_after !~ '^0x[0-9a-f]{40}$') THEN RAISE EXCEPTION 'INVALID_SOURCE'; END IF;
    IF p_enabled IS NOT NULL THEN
        IF p_address IS NULL OR p_revision IS NULL OR p_revision<0 OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 5 AND 500
            THEN RAISE EXCEPTION 'INVALID_SOURCE'; END IF;
        PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('frame:'||p_kind||p_chain||p_scope||p_address,0));
        SELECT coalesce(max(s.revision),0) INTO current_revision FROM artsoul_private.aura_sources s
            WHERE s.kind=p_kind AND s.chain_id=p_chain AND s.scope=p_scope AND s.address=p_address;
        IF current_revision <> p_revision THEN RAISE EXCEPTION 'SOURCE_CHANGED'; END IF;
        INSERT INTO artsoul_private.aura_sources(kind,chain_id,scope,address,revision,enabled,actor,role_version,policy_version,reason)
            VALUES(p_kind,p_chain,p_scope,p_address,current_revision+1,p_enabled,p_actor,p_version,p_policy_version,btrim(p_reason));
    END IF;
    RETURN QUERY SELECT DISTINCT ON(s.address) s.address,s.enabled,s.revision FROM artsoul_private.aura_sources s
        WHERE s.kind=p_kind AND s.chain_id=p_chain AND s.scope=p_scope AND (p_address IS NULL OR s.address=p_address) AND s.address>p_after
        ORDER BY s.address,s.revision DESC LIMIT 26;
END;
$$;
REVOKE ALL ON FUNCTION public.aura_source_states(text,integer,text,text[]),
  public.manage_aura_sources(text,bigint,text,bigint,text,integer,text,text,text,integer,boolean,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.aura_source_states(text,integer,text,text[]),
  public.manage_aura_sources(text,bigint,text,bigint,text,integer,text,text,text,integer,boolean,text) TO service_role;
COMMIT;
