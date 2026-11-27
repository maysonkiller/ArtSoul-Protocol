BEGIN;
ALTER TABLE artsoul_private.aura_sources
    DROP CONSTRAINT aura_sources_kind_check,
    DROP CONSTRAINT aura_sources_check,
    ADD COLUMN runtime_hash text,
    ADD CHECK (kind IN ('partner','platform','founder','genesis','official_collection')),
    ADD CHECK ((kind IN ('partner','genesis') AND scope='') OR
        (kind IN ('platform','founder','official_collection') AND scope ~ '^0x[0-9a-f]{40}$' AND scope <> '0x'||repeat('0',40))),
    ADD CHECK (kind <> 'genesis' OR chain_id=8453),
    ADD CHECK (CASE WHEN kind='official_collection' AND enabled THEN
        runtime_hash IS NOT NULL AND runtime_hash ~ '^0x[0-9a-f]{64}$' AND runtime_hash <> '0x'||repeat('0',64)
        ELSE runtime_hash IS NULL END);
CREATE INDEX aura_collection_source_lookup ON artsoul_private.aura_sources
    (chain_id,address,kind,scope,revision DESC) WHERE kind IN ('official_collection','partner');

CREATE FUNCTION public.manage_aura_sources(p_actor text,p_version bigint,p_origin text,p_policy_version bigint,
    p_kind text,p_chain integer,p_scope text,p_address text,p_after text,p_revision integer,p_enabled boolean,p_reason text,p_runtime_hash text)
RETURNS TABLE(address text,enabled boolean,revision integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_revision integer; other_kind text; other_revision integer;
BEGIN
    IF p_enabled IS NOT NULL AND (p_origin IS NULL OR p_policy_version IS NULL) THEN
        RAISE EXCEPTION 'FRAME_TEAM_REQUIRED';
    END IF;
    -- With an origin and policy revision, this locks the current governing
    -- pair and active Team role. The Administrator path can only read here.
    PERFORM 1 FROM public.manage_aura_border_setting(p_actor,p_version,p_origin,p_policy_version,NULL,NULL);
    IF p_kind IS NULL OR p_kind NOT IN ('platform','founder','partner','genesis','official_collection')
        OR p_chain IS NULL OR p_chain NOT IN (8453,84532) OR (p_kind='genesis' AND p_chain<>8453)
        OR p_scope IS NULL OR (p_kind IN ('platform','founder','official_collection') AND
            (p_scope !~ '^0x[0-9a-f]{40}$' OR p_scope='0x'||repeat('0',40)))
        OR (p_kind IN ('partner','genesis') AND p_scope<>'')
        OR (p_address IS NOT NULL AND (p_address !~ '^0x[0-9a-f]{40}$' OR p_address='0x'||repeat('0',40)))
        OR p_after IS NULL OR (p_after<>'' AND p_after !~ '^0x[0-9a-f]{40}$') THEN RAISE EXCEPTION 'INVALID_SOURCE'; END IF;
    IF p_enabled IS NOT NULL THEN
        IF p_address IS NULL OR p_revision IS NULL OR p_revision<0 OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 5 AND 500
            THEN RAISE EXCEPTION 'INVALID_SOURCE'; END IF;
        PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('frame:'||
            CASE WHEN p_kind IN ('platform','founder') THEN 'publisher' ELSE p_kind END ||p_chain||
            CASE WHEN p_kind='official_collection' THEN '' ELSE p_scope END ||p_address,0));
        SELECT coalesce(max(s.revision),0) INTO current_revision FROM artsoul_private.aura_sources s
            WHERE s.kind=p_kind AND s.chain_id=p_chain AND s.scope=p_scope AND s.address=p_address;
        IF current_revision <> p_revision THEN RAISE EXCEPTION 'SOURCE_CHANGED'; END IF;
        IF p_enabled AND p_kind='genesis' THEN
            IF to_regclass('artsoul_private.genesis_issuers') IS NULL THEN RAISE EXCEPTION 'GENESIS_UNAVAILABLE'; END IF;
            PERFORM 1 FROM artsoul_private.genesis_issuers g WHERE g.chain_id=8453 AND g.genesis_address=p_address;
            IF NOT FOUND THEN RAISE EXCEPTION 'GENESIS_UNAVAILABLE'; END IF;
        END IF;
        IF p_enabled AND p_kind='official_collection' AND EXISTS (
            SELECT 1 FROM (SELECT DISTINCT ON (s.scope) s.enabled FROM artsoul_private.aura_sources s
                WHERE s.kind=p_kind AND s.chain_id=p_chain AND s.address=p_address AND s.scope<>p_scope
                ORDER BY s.scope,s.revision DESC) other WHERE other.enabled
        ) THEN RAISE EXCEPTION 'SOURCE_CHANGED'; END IF;
        IF p_enabled AND p_kind IN ('platform','founder') THEN
            other_kind := CASE WHEN p_kind='founder' THEN 'platform' ELSE 'founder' END;
            SELECT coalesce(max(s.revision),0) INTO other_revision FROM artsoul_private.aura_sources s
                WHERE s.kind=other_kind AND s.chain_id=p_chain AND s.scope=p_scope AND s.address=p_address;
            INSERT INTO artsoul_private.aura_sources(kind,chain_id,scope,address,revision,enabled,actor,role_version,policy_version,reason)
                VALUES(other_kind,p_chain,p_scope,p_address,other_revision+1,false,p_actor,p_version,p_policy_version,
                    'Reclassified as '||p_kind||' publisher');
        END IF;
        INSERT INTO artsoul_private.aura_sources(kind,chain_id,scope,address,revision,enabled,actor,role_version,policy_version,reason,runtime_hash)
            VALUES(p_kind,p_chain,p_scope,p_address,current_revision+1,p_enabled,p_actor,p_version,p_policy_version,btrim(p_reason),p_runtime_hash);
    END IF;
    RETURN QUERY SELECT DISTINCT ON(s.address) s.address,s.enabled,s.revision FROM artsoul_private.aura_sources s
        WHERE s.kind=p_kind AND s.chain_id=p_chain AND s.scope=p_scope AND (p_address IS NULL OR s.address=p_address) AND s.address>p_after
        ORDER BY s.address,s.revision DESC LIMIT 26;
END;
$$;

-- Existing clients use the same authorization and revision checks.
CREATE OR REPLACE FUNCTION public.manage_aura_sources(p_actor text,p_version bigint,p_origin text,p_policy_version bigint,
    p_kind text,p_chain integer,p_scope text,p_address text,p_after text,p_revision integer,p_enabled boolean,p_reason text)
RETURNS TABLE(address text,enabled boolean,revision integer)
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
    SELECT * FROM public.manage_aura_sources(p_actor,p_version,p_origin,p_policy_version,p_kind,p_chain,p_scope,p_address,
        p_after,p_revision,p_enabled,p_reason,NULL::text);
$$;

CREATE FUNCTION public.collection_frame_sources(p_chain integer,p_addresses text[])
RETURNS TABLE(address text,kind text,issuer text,runtime_hash text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
    WITH latest AS (
        SELECT DISTINCT ON(s.address,s.kind,s.scope) s.address,s.kind,s.scope,s.runtime_hash,s.enabled
        FROM artsoul_private.aura_sources s WHERE s.kind IN ('partner','official_collection') AND s.chain_id=p_chain
            AND cardinality(p_addresses) BETWEEN 1 AND 200 AND s.address=ANY(p_addresses)
        ORDER BY s.address,s.kind,s.scope,s.revision DESC
    ), active AS (
        SELECT l.*,count(*) FILTER (WHERE l.kind='official_collection') OVER (PARTITION BY l.address) AS issuers
        FROM latest l WHERE l.enabled
    )
    SELECT DISTINCT ON(a.address) a.address,a.kind,nullif(a.scope,''),a.runtime_hash FROM active a WHERE a.issuers<=1
    ORDER BY a.address,(a.kind='official_collection') DESC;
$$;
CREATE FUNCTION public.read_designated_wallet_genesis_frames(
    p_genesis text,p_code_hash text,p_authority text,p_founder text,p_wallet text,p_serials smallint[]
) RETURNS TABLE(token_id smallint,border_text boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.aura_source_states('genesis',8453,'',ARRAY[p_genesis]) s WHERE s.enabled)
        OR to_regprocedure('public.read_wallet_genesis_frames(text,text,text,text,text,smallint[])') IS NULL THEN RETURN; END IF;
    RETURN QUERY SELECT g.token_id,g.border_text FROM public.read_wallet_genesis_frames(
        p_genesis,p_code_hash,p_authority,p_founder,p_wallet,p_serials) g;
END;
$$;
REVOKE ALL ON FUNCTION public.manage_aura_sources(text,bigint,text,bigint,text,integer,text,text,text,integer,boolean,text,text),
    public.collection_frame_sources(integer,text[]),public.read_designated_wallet_genesis_frames(text,text,text,text,text,smallint[])
    FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.manage_aura_sources(text,bigint,text,bigint,text,integer,text,text,text,integer,boolean,text,text),
    public.collection_frame_sources(integer,text[]),public.read_designated_wallet_genesis_frames(text,text,text,text,text,smallint[])
    TO service_role;

-- The two reviewed test classifications used the personal wallet as a
-- publisher and as a collection. Keep the original decision and actor.
-- Skip absent histories on fresh installs and preserve later staff reviews.
WITH target(kind,scope) AS (VALUES ('platform','0x43368f7e2d5f11f4b7e11928d66d3f4a5a4e4cef'),('partner','')),
latest AS (
    SELECT DISTINCT ON (s.kind) s.* FROM artsoul_private.aura_sources s JOIN target t USING(kind,scope)
    WHERE s.chain_id=84532 AND s.address='0x6ec8c121043357ac231e36d403edabf90ae6989b'
    ORDER BY s.kind,s.revision DESC
)
INSERT INTO artsoul_private.aura_sources(kind,chain_id,scope,address,revision,enabled,actor,role_version,policy_version,reason)
SELECT kind,chain_id,scope,address,2,false,'migration:20261127130000',0,NULL,'Retired the founder personal wallet test designation'
FROM latest WHERE revision=1 AND enabled;
COMMIT;
