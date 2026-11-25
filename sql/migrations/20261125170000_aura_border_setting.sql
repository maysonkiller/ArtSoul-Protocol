-- An empty history means border text is disabled. Only an actual change creates a revision.
BEGIN;
CREATE SCHEMA IF NOT EXISTS artsoul_private;
CREATE TABLE IF NOT EXISTS artsoul_private.aura_border_history (
    revision integer PRIMARY KEY CHECK (revision > 0),
    enabled boolean NOT NULL,
    actor_wallet text NOT NULL CHECK (actor_wallet ~ '^0x[0-9a-f]{40}$'),
    authorization_version bigint NOT NULL CHECK (authorization_version > 0),
    changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE artsoul_private.aura_border_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON artsoul_private.aura_border_history FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.read_aura_border_setting()
RETURNS TABLE (enabled boolean, revision integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT h.enabled, h.revision FROM artsoul_private.aura_border_history h
    UNION ALL SELECT false, 0 ORDER BY revision DESC LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.set_aura_border_setting(p_wallet text, p_authorization_version bigint,
    p_enabled boolean, p_expected_revision integer)
RETURNS TABLE (enabled boolean, revision integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE previous record;
BEGIN
    IF p_enabled IS NULL OR p_expected_revision IS NULL OR p_expected_revision < 0 THEN
        RAISE EXCEPTION 'INVALID_AURA_SETTING';
    END IF;
    PERFORM 1 FROM public.artsoul_staff_roles s WHERE s.wallet_address = p_wallet
        AND s.active AND s.role = 'admin' AND s.authorization_version = p_authorization_version FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'AURA_ADMIN_REQUIRED'; END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('artsoul:aura-border-setting', 0));
    SELECT * INTO previous FROM public.read_aura_border_setting();
    IF previous.revision <> p_expected_revision THEN RAISE EXCEPTION 'AURA_REVISION_CONFLICT'; END IF;
    IF previous.enabled <> p_enabled THEN
        INSERT INTO artsoul_private.aura_border_history(revision, enabled, actor_wallet, authorization_version)
        VALUES (previous.revision + 1, p_enabled, p_wallet, p_authorization_version);
    END IF;
    RETURN QUERY SELECT s.enabled, s.revision FROM public.read_aura_border_setting() s;
END;
$$;
REVOKE ALL ON FUNCTION public.read_aura_border_setting(), public.set_aura_border_setting(text,bigint,boolean,integer)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_aura_border_setting(), public.set_aura_border_setting(text,bigint,boolean,integer)
    TO service_role;
COMMIT;
