BEGIN;
ALTER TABLE artsoul_private.aura_border_history
    ADD COLUMN IF NOT EXISTS authority_policy_version bigint CHECK (authority_policy_version > 0);

-- Both NULL values request the current setting. A write always supplies both.
CREATE OR REPLACE FUNCTION public.manage_aura_border_setting(p_wallet text, p_authorization_version bigint,
    p_origin text, p_policy_version bigint, p_enabled boolean, p_expected_revision integer)
RETURNS TABLE (enabled boolean, revision integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE previous record; required_role text := 'admin';
BEGIN
    IF (p_enabled IS NULL) <> (p_expected_revision IS NULL) OR p_expected_revision < 0 THEN
        RAISE EXCEPTION 'INVALID_AURA_SETTING';
    END IF;
    IF p_policy_version IS NOT NULL OR p_origin IS NOT NULL THEN
        -- Staff rotation locks policy before role. Keep that order and hold
        -- both locks until commit so an old authority cannot save after rotation.
        PERFORM 1 FROM public.artsoul_staff_authority_policy p WHERE p.singleton
            AND p.origin = p_origin AND p.chain_id = 84532 AND p.version = p_policy_version
            AND p_wallet IN (p.wallet_a, p.wallet_b) FOR SHARE;
        IF NOT FOUND THEN RAISE EXCEPTION 'AURA_ADMIN_REQUIRED'; END IF;
        required_role := 'team';
    END IF;
    PERFORM 1 FROM public.artsoul_staff_roles s WHERE s.wallet_address = p_wallet
        AND s.active AND s.role = required_role AND s.authorization_version = p_authorization_version FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'AURA_ADMIN_REQUIRED'; END IF;
    IF p_enabled IS NOT NULL THEN
        PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('artsoul:aura-border-setting', 0));
        SELECT * INTO previous FROM public.read_aura_border_setting();
        IF previous.revision <> p_expected_revision THEN RAISE EXCEPTION 'AURA_REVISION_CONFLICT'; END IF;
        IF previous.enabled <> p_enabled THEN
            INSERT INTO artsoul_private.aura_border_history(revision, enabled, actor_wallet, authorization_version, authority_policy_version)
            VALUES (previous.revision + 1, p_enabled, p_wallet, p_authorization_version, p_policy_version);
        END IF;
    END IF;
    RETURN QUERY SELECT s.enabled, s.revision FROM public.read_aura_border_setting() s;
END;
$$;

-- Older server deployments retain their administrator-only write signature.
CREATE OR REPLACE FUNCTION public.set_aura_border_setting(p_wallet text, p_authorization_version bigint,
    p_enabled boolean, p_expected_revision integer)
RETURNS TABLE (enabled boolean, revision integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF p_enabled IS NULL OR p_expected_revision IS NULL THEN RAISE EXCEPTION 'INVALID_AURA_SETTING'; END IF;
    RETURN QUERY SELECT * FROM public.manage_aura_border_setting(p_wallet, p_authorization_version,
        NULL, NULL, p_enabled, p_expected_revision);
END;
$$;
REVOKE ALL ON FUNCTION public.manage_aura_border_setting(text,bigint,text,bigint,boolean,integer),
    public.set_aura_border_setting(text,bigint,boolean,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.manage_aura_border_setting(text,bigint,text,bigint,boolean,integer),
    public.set_aura_border_setting(text,bigint,boolean,integer) TO service_role;
COMMIT;
