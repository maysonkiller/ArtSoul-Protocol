-- Local-only TOTP persistence, following phase18 staff roles and A8a/A8d.
-- This migration creates no factor, grant, policy setting, role or session.
-- TOTP matching/decryption stays server-side. RPCs accept verified steps only
-- from service_role; they do not independently verify a code or a Safe signature.
-- No grant issuer is provided: integration must first prove the approved current
-- two-wallet authority, then create a bounded grant with durable authorization.
-- Separate typed grants prevent legacy passkey consumers from using TOTP grants.
BEGIN;

-- Never reuse a role authorization after revocation, replacement or deletion.
-- This independent sequence is deliberately not owned by the role table: a
-- row deletion/recreation or TRUNCATE RESTART IDENTITY must not rewind it.
CREATE SEQUENCE public.artsoul_staff_authorization_version_seq AS BIGINT
    MINVALUE 1 MAXVALUE 9007199254740991 NO CYCLE;
ALTER TABLE public.artsoul_staff_roles ADD COLUMN authorization_version BIGINT;
UPDATE public.artsoul_staff_roles
SET authorization_version=nextval('public.artsoul_staff_authorization_version_seq');
ALTER TABLE public.artsoul_staff_roles ALTER COLUMN authorization_version SET NOT NULL;
ALTER TABLE public.artsoul_staff_roles ADD CONSTRAINT staff_authorization_version_valid
    CHECK (authorization_version BETWEEN 1 AND 9007199254740991);
CREATE FUNCTION public.a8e_advance_staff_authorization_version()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    NEW.authorization_version := nextval('public.artsoul_staff_authorization_version_seq');
    RETURN NEW;
END;
$$;
CREATE TRIGGER a8e_staff_authorization_version
    BEFORE INSERT OR UPDATE OF wallet_address, role, active, authorization_version
    ON public.artsoul_staff_roles FOR EACH ROW
    EXECUTE FUNCTION public.a8e_advance_staff_authorization_version();
REVOKE ALL ON SEQUENCE public.artsoul_staff_authorization_version_seq FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.a8e_advance_staff_authorization_version() FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE IF NOT EXISTS public.artsoul_staff_totp_policy (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    max_attempts INTEGER NOT NULL CHECK (max_attempts > 0),
    window_seconds INTEGER NOT NULL CHECK (window_seconds > 0),
    attempt_lifetime_seconds INTEGER NOT NULL CHECK (attempt_lifetime_seconds > 0 AND attempt_lifetime_seconds <= window_seconds)
);
-- Intentionally empty: no production throttle values have been approved.

CREATE TABLE IF NOT EXISTS public.artsoul_staff_totp_grants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    factor_type TEXT NOT NULL DEFAULT 'totp' CHECK (factor_type = 'totp'),
    factor_id UUID NOT NULL UNIQUE CHECK (factor_id::TEXT ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
    target_wallet TEXT NOT NULL CHECK (target_wallet ~ '^0x[0-9a-f]{40}$' AND target_wallet <> '0x0000000000000000000000000000000000000000'),
    role_version BIGINT NOT NULL CHECK (role_version BETWEEN 1 AND 9007199254740991),
    token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    authority_policy TEXT NOT NULL CHECK (authority_policy = 'founder-dual-wallet-2026-10-07'),
    authorization_digest TEXT NOT NULL UNIQUE CHECK (authorization_digest ~ '^[0-9a-f]{64}$'),
    issued_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    -- Reuse the existing maximum lifetime for additional-factor grants.
    CHECK (expires_at > issued_at AND expires_at <= issued_at + INTERVAL '15 minutes'),
    UNIQUE (id, factor_id, target_wallet)
);

CREATE TABLE IF NOT EXISTS public.artsoul_staff_totp_factors (
    id UUID PRIMARY KEY,
    factor_type TEXT NOT NULL DEFAULT 'totp' CHECK (factor_type = 'totp'),
    wallet_address TEXT NOT NULL,
    grant_id UUID NOT NULL UNIQUE,
    key_version BIGINT NOT NULL CHECK (key_version BETWEEN 1 AND 9007199254740991),
    encrypted_secret JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    activated_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    last_consumed_step BIGINT CHECK (last_consumed_step >= 0),
    last_used_at TIMESTAMPTZ,
    FOREIGN KEY (grant_id, id, wallet_address) REFERENCES public.artsoul_staff_totp_grants(id, factor_id, target_wallet),
    CHECK ((activated_at IS NULL AND last_consumed_step IS NULL) OR (activated_at IS NOT NULL AND last_consumed_step IS NOT NULL)),
    CHECK (jsonb_typeof(encrypted_secret) = 'object'
        AND encrypted_secret ?& ARRAY['version','keyVersion','iv','ciphertext','tag']
        AND encrypted_secret - ARRAY['version','keyVersion','iv','ciphertext','tag'] = '{}'::JSONB
        AND jsonb_typeof(encrypted_secret->'version') = 'number' AND encrypted_secret->>'version' = '1'
        AND jsonb_typeof(encrypted_secret->'keyVersion') = 'number' AND encrypted_secret->>'keyVersion' = key_version::TEXT
        AND jsonb_typeof(encrypted_secret->'iv') = 'string' AND encrypted_secret->>'iv' ~ '^[A-Za-z0-9_-]{16}$'
        AND jsonb_typeof(encrypted_secret->'ciphertext') = 'string' AND encrypted_secret->>'ciphertext' ~ '^[A-Za-z0-9_-]{27}$'
        AND jsonb_typeof(encrypted_secret->'tag') = 'string' AND encrypted_secret->>'tag' ~ '^[A-Za-z0-9_-]{22}$')
);
CREATE INDEX IF NOT EXISTS idx_staff_totp_factors_wallet ON public.artsoul_staff_totp_factors(wallet_address) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.artsoul_staff_totp_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    factor_type TEXT NOT NULL DEFAULT 'totp' CHECK (factor_type = 'totp'),
    factor_id UUID NOT NULL REFERENCES public.artsoul_staff_totp_factors(id),
    wallet_address TEXT NOT NULL CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
    role_version BIGINT NOT NULL CHECK (role_version BETWEEN 1 AND 9007199254740991),
    purpose TEXT NOT NULL CHECK (purpose IN ('enrollment','authentication')),
    key_version BIGINT NOT NULL,
    envelope_digest TEXT NOT NULL CHECK (envelope_digest ~ '^[0-9a-f]{64}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS idx_staff_totp_attempts_wallet_time ON public.artsoul_staff_totp_attempts(wallet_address, created_at DESC);

ALTER TABLE public.artsoul_staff_totp_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artsoul_staff_totp_policy FORCE ROW LEVEL SECURITY;
ALTER TABLE public.artsoul_staff_totp_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artsoul_staff_totp_grants FORCE ROW LEVEL SECURITY;
ALTER TABLE public.artsoul_staff_totp_factors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artsoul_staff_totp_factors FORCE ROW LEVEL SECURITY;
ALTER TABLE public.artsoul_staff_totp_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artsoul_staff_totp_attempts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.artsoul_staff_totp_policy, public.artsoul_staff_totp_grants,
    public.artsoul_staff_totp_factors, public.artsoul_staff_totp_attempts FROM PUBLIC, anon, authenticated, service_role;
-- No direct INSERT/UPDATE/DELETE for service_role, especially no grant issuance.
GRANT SELECT ON public.artsoul_staff_totp_policy, public.artsoul_staff_totp_grants,
    public.artsoul_staff_totp_factors, public.artsoul_staff_totp_attempts TO service_role;

ALTER TABLE public.artsoul_staff_auth_events DROP CONSTRAINT IF EXISTS artsoul_staff_auth_events_event_type_check;
ALTER TABLE public.artsoul_staff_auth_events ADD CONSTRAINT artsoul_staff_auth_events_event_type_check CHECK (event_type IN (
    'passkey_enrolled','passkey_auth_success','passkey_auth_failure','passkey_revoked','passkey_revoke_denied',
    'grant_issued','grant_consumed','grant_superseded','recovery_authorized','recovery_denied',
    'totp_enrolled','totp_auth_success','totp_auth_failure'
));

CREATE OR REPLACE FUNCTION public.a8e_begin_totp_enrollment(p_wallet TEXT, p_grant_id UUID, p_token_hash TEXT, p_envelope JSONB)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_wallet TEXT := lower(p_wallet); v_grant public.artsoul_staff_totp_grants%ROWTYPE;
    v_role_version BIGINT;
BEGIN
    IF v_wallet IS NULL OR v_wallet !~ '^0x[0-9a-f]{40}$' OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN RETURN 'INVALID_INPUT'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('artsoul-totp:' || v_wallet, 0));
    SELECT authorization_version INTO v_role_version FROM public.artsoul_staff_roles WHERE wallet_address=v_wallet AND active AND role IN ('admin','moderator','team') FOR SHARE;
    IF NOT FOUND THEN RETURN 'STAFF_INACTIVE'; END IF;
    PERFORM 1 FROM public.artsoul_staff_totp_policy WHERE singleton FOR SHARE;
    IF NOT FOUND THEN RETURN 'TOTP_POLICY_REQUIRED'; END IF;
    SELECT * INTO v_grant FROM public.artsoul_staff_totp_grants WHERE id=p_grant_id FOR UPDATE;
    IF NOT FOUND OR v_grant.target_wallet IS DISTINCT FROM v_wallet OR v_grant.token_hash IS DISTINCT FROM p_token_hash
        OR v_grant.role_version IS DISTINCT FROM v_role_version
        OR v_grant.consumed_at IS NOT NULL OR v_grant.revoked_at IS NOT NULL OR v_grant.issued_at > clock_timestamp()
        OR v_grant.expires_at <= clock_timestamp() THEN RETURN 'GRANT_INVALID'; END IF;
    IF EXISTS (SELECT 1 FROM public.artsoul_staff_totp_factors WHERE id=v_grant.factor_id) THEN RETURN 'FACTOR_EXISTS'; END IF;
    INSERT INTO public.artsoul_staff_totp_factors(id,wallet_address,grant_id,key_version,encrypted_secret)
    VALUES(v_grant.factor_id,v_wallet,v_grant.id,(p_envelope->>'keyVersion')::BIGINT,p_envelope);
    RETURN 'OK';
END;
$$;

-- Call this in its own committed request BEFORE decrypting or matching a code.
-- Every reservation, including abandoned ones and failed matches, consumes the
-- rolling wallet-wide budget. A caller cannot reset it by changing factor ID.
CREATE OR REPLACE FUNCTION public.a8e_begin_totp_attempt(p_wallet TEXT, p_factor_id UUID, p_purpose TEXT)
RETURNS TABLE(result TEXT, attempt_id UUID) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_wallet TEXT := lower(p_wallet); v_factor public.artsoul_staff_totp_factors%ROWTYPE;
    v_policy public.artsoul_staff_totp_policy%ROWTYPE; v_grant public.artsoul_staff_totp_grants%ROWTYPE;
    v_now TIMESTAMPTZ; v_id UUID; v_role_version BIGINT;
BEGIN
    IF v_wallet IS NULL OR v_wallet !~ '^0x[0-9a-f]{40}$' OR p_factor_id IS NULL OR p_purpose IS NULL OR p_purpose NOT IN ('enrollment','authentication') THEN
        RETURN QUERY SELECT 'INVALID_INPUT'::TEXT,NULL::UUID; RETURN;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('artsoul-totp:' || v_wallet, 0));
    SELECT authorization_version INTO v_role_version FROM public.artsoul_staff_roles WHERE wallet_address=v_wallet AND active AND role IN ('admin','moderator','team') FOR SHARE;
    IF NOT FOUND THEN RETURN QUERY SELECT 'STAFF_INACTIVE'::TEXT,NULL::UUID; RETURN; END IF;
    SELECT * INTO v_policy FROM public.artsoul_staff_totp_policy WHERE singleton FOR SHARE;
    IF NOT FOUND THEN RETURN QUERY SELECT 'TOTP_POLICY_REQUIRED'::TEXT,NULL::UUID; RETURN; END IF;
    SELECT * INTO v_factor FROM public.artsoul_staff_totp_factors WHERE id=p_factor_id AND wallet_address=v_wallet FOR UPDATE;
    IF NOT FOUND OR v_factor.revoked_at IS NOT NULL OR (p_purpose='enrollment') IS DISTINCT FROM (v_factor.activated_at IS NULL) THEN
        RETURN QUERY SELECT 'FACTOR_INELIGIBLE'::TEXT,NULL::UUID; RETURN;
    END IF;
    SELECT * INTO v_grant FROM public.artsoul_staff_totp_grants WHERE id=v_factor.grant_id FOR SHARE;
    IF v_grant.role_version IS DISTINCT FROM v_role_version THEN
        RETURN QUERY SELECT 'ROLE_CHANGED'::TEXT,NULL::UUID; RETURN;
    END IF;
    v_now := clock_timestamp();
    IF p_purpose='enrollment' AND (v_grant.consumed_at IS NOT NULL OR v_grant.revoked_at IS NOT NULL
        OR v_grant.issued_at>v_now OR v_grant.expires_at<=v_now) THEN
        RETURN QUERY SELECT 'GRANT_INVALID'::TEXT,NULL::UUID; RETURN;
    END IF;
    IF (SELECT COUNT(*) FROM public.artsoul_staff_totp_attempts WHERE wallet_address=v_wallet
        AND created_at > v_now-make_interval(secs=>v_policy.window_seconds)) >= v_policy.max_attempts THEN
        RETURN QUERY SELECT 'TOTP_THROTTLED'::TEXT,NULL::UUID; RETURN;
    END IF;
    INSERT INTO public.artsoul_staff_totp_attempts(factor_id,wallet_address,role_version,purpose,key_version,envelope_digest,created_at,expires_at)
    VALUES(v_factor.id,v_wallet,v_role_version,p_purpose,v_factor.key_version,encode(digest(v_factor.encrypted_secret::TEXT,'sha256'),'hex'),
        v_now,v_now+make_interval(secs=>v_policy.attempt_lifetime_seconds)) RETURNING id INTO v_id;
    RETURN QUERY SELECT 'OK'::TEXT,v_id;
END;
$$;

-- p_matched_step is the trusted server matcher's output, not user input. NULL
-- means an invalid code and still consumes the reservation. Server-side matching
-- is not authorization until this commit returns OK; protected routes must keep
-- checking the active wallet role and typed factor after issuing any session.
CREATE OR REPLACE FUNCTION public.a8e_complete_totp_attempt(p_wallet TEXT, p_attempt_id UUID, p_matched_step BIGINT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_wallet TEXT := lower(p_wallet); v_factor public.artsoul_staff_totp_factors%ROWTYPE;
    v_attempt public.artsoul_staff_totp_attempts%ROWTYPE; v_grant public.artsoul_staff_totp_grants%ROWTYPE;
    v_now TIMESTAMPTZ; v_step BIGINT; v_result TEXT := 'OK'; v_role_version BIGINT;
BEGIN
    IF v_wallet IS NULL OR v_wallet !~ '^0x[0-9a-f]{40}$' OR p_attempt_id IS NULL THEN RETURN 'INVALID_INPUT'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('artsoul-totp:' || v_wallet, 0));
    SELECT authorization_version INTO v_role_version FROM public.artsoul_staff_roles WHERE wallet_address=v_wallet AND active AND role IN ('admin','moderator','team') FOR SHARE;
    IF NOT FOUND THEN RETURN 'STAFF_INACTIVE'; END IF;
    PERFORM 1 FROM public.artsoul_staff_totp_policy WHERE singleton FOR SHARE;
    IF NOT FOUND THEN RETURN 'TOTP_POLICY_REQUIRED'; END IF;
    SELECT * INTO v_attempt FROM public.artsoul_staff_totp_attempts WHERE id=p_attempt_id AND wallet_address=v_wallet FOR UPDATE;
    IF NOT FOUND OR v_attempt.consumed_at IS NOT NULL THEN RETURN 'ATTEMPT_INVALID'; END IF;
    SELECT * INTO v_factor FROM public.artsoul_staff_totp_factors WHERE id=v_attempt.factor_id AND wallet_address=v_wallet FOR UPDATE;
    IF NOT FOUND THEN RETURN 'FACTOR_INELIGIBLE'; END IF;
    IF v_attempt.purpose='enrollment' THEN
        SELECT * INTO v_grant FROM public.artsoul_staff_totp_grants WHERE id=v_factor.grant_id FOR UPDATE;
    ELSE
        SELECT * INTO v_grant FROM public.artsoul_staff_totp_grants WHERE id=v_factor.grant_id FOR SHARE;
    END IF;
    -- Use the time AFTER every potentially blocking lock, including the grant.
    v_now := clock_timestamp();
    v_step := floor(extract(epoch FROM v_now)/30)::BIGINT;
    IF v_attempt.expires_at<=v_now THEN v_result:='ATTEMPT_EXPIRED';
    ELSIF v_attempt.role_version IS DISTINCT FROM v_role_version OR v_grant.role_version IS DISTINCT FROM v_role_version THEN v_result:='ROLE_CHANGED';
    ELSIF v_factor.revoked_at IS NOT NULL OR (v_attempt.purpose='enrollment') IS DISTINCT FROM (v_factor.activated_at IS NULL) THEN v_result:='FACTOR_INELIGIBLE';
    ELSIF v_attempt.key_version<>v_factor.key_version OR v_attempt.envelope_digest<>encode(digest(v_factor.encrypted_secret::TEXT,'sha256'),'hex') THEN v_result:='FACTOR_CHANGED';
    ELSIF p_matched_step IS NULL OR p_matched_step<0 OR p_matched_step NOT BETWEEN v_step-1 AND v_step+1 THEN v_result:='CODE_NOT_VERIFIED';
    ELSIF v_factor.last_consumed_step IS NOT NULL AND p_matched_step<=v_factor.last_consumed_step THEN v_result:='STEP_REPLAYED';
    END IF;
    IF v_result='OK' AND v_attempt.purpose='enrollment' THEN
        IF v_grant.id IS NULL OR v_grant.target_wallet IS DISTINCT FROM v_wallet OR v_grant.factor_id IS DISTINCT FROM v_factor.id
            OR v_grant.consumed_at IS NOT NULL OR v_grant.revoked_at IS NOT NULL OR v_grant.issued_at>v_now OR v_grant.expires_at<=v_now THEN
            v_result:='GRANT_INVALID';
        END IF;
    END IF;
    UPDATE public.artsoul_staff_totp_attempts SET consumed_at=v_now WHERE id=v_attempt.id;
    IF v_result<>'OK' THEN
        INSERT INTO public.artsoul_staff_auth_events(wallet_address,event_type,details)
        VALUES(v_wallet,'totp_auth_failure',jsonb_build_object('factor_type','totp','factor_id',v_factor.id,'purpose',v_attempt.purpose,'result',v_result));
        RETURN v_result;
    END IF;
    IF v_attempt.purpose='enrollment' THEN
        UPDATE public.artsoul_staff_totp_grants SET consumed_at=v_now WHERE id=v_grant.id;
        INSERT INTO public.artsoul_staff_auth_events(wallet_address,event_type,details)
        VALUES(v_wallet,'grant_consumed',jsonb_build_object('factor_type','totp','factor_id',v_factor.id,'grant_id',v_grant.id,'authorization_digest',v_grant.authorization_digest));
    END IF;
    UPDATE public.artsoul_staff_totp_factors SET activated_at=COALESCE(activated_at,v_now),last_consumed_step=p_matched_step,last_used_at=v_now WHERE id=v_factor.id;
    INSERT INTO public.artsoul_staff_auth_events(wallet_address,event_type,details)
    VALUES(v_wallet,CASE WHEN v_attempt.purpose='enrollment' THEN 'totp_enrolled' ELSE 'totp_auth_success' END,
        jsonb_build_object('factor_type','totp','factor_id',v_factor.id));
    RETURN 'OK';
END;
$$;

REVOKE ALL ON FUNCTION public.a8e_begin_totp_enrollment(TEXT,UUID,TEXT,JSONB) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.a8e_begin_totp_attempt(TEXT,UUID,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.a8e_complete_totp_attempt(TEXT,UUID,BIGINT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.a8e_begin_totp_enrollment(TEXT,UUID,TEXT,JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.a8e_begin_totp_attempt(TEXT,UUID,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.a8e_complete_totp_attempt(TEXT,UUID,BIGINT) TO service_role;
COMMIT;
