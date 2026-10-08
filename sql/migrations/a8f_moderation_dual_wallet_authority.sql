-- Local-only application authority; requires the A8e role version fence.
-- No initial policy or roles are installed. Existing contract/Safe control is
-- unaffected. Activate only with role-version-aware factor/session consumers.
-- The service verifies BOTH EOA signatures using moderation-dual-wallet.js.
-- SQL then rechecks current authority, target version, expiry and one-time use
-- under locks. Like the existing Safe recovery RPC, signature cryptography is
-- a trusted server boundary, never a boolean supplied by a browser.
BEGIN;

CREATE TABLE public.artsoul_staff_authority_policy (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    version BIGINT NOT NULL CHECK (version BETWEEN 1 AND 9007199254740991),
    origin TEXT NOT NULL CHECK (origin ~ '^https://[a-z0-9.-]+(:[0-9]+)?$'),
    chain_id INTEGER NOT NULL CHECK (chain_id=84532),
    wallet_a TEXT NOT NULL CHECK (wallet_a ~ '^0x[0-9a-f]{40}$' AND wallet_a<>'0x0000000000000000000000000000000000000000'),
    wallet_b TEXT NOT NULL CHECK (wallet_b ~ '^0x[0-9a-f]{40}$' AND wallet_b<>'0x0000000000000000000000000000000000000000'),
    CHECK (wallet_a<wallet_b)
);

CREATE TABLE public.artsoul_staff_authority_requests (
    id UUID PRIMARY KEY,
    requested_by TEXT NOT NULL CHECK (requested_by ~ '^0x[0-9a-f]{40}$'),
    proposal JSONB NOT NULL CHECK (jsonb_typeof(proposal)='object'),
    issued_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    -- Reuse the existing SIWE/WebAuthn five-minute challenge lifetime.
    CHECK (expires_at>issued_at AND expires_at<=issued_at+INTERVAL '5 minutes')
);

CREATE TABLE public.artsoul_staff_authority_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    request_id UUID NOT NULL UNIQUE REFERENCES public.artsoul_staff_authority_requests(id),
    message_digest TEXT NOT NULL CHECK (message_digest ~ '^0x[0-9a-f]{64}$'),
    signers TEXT[] NOT NULL CHECK (array_ndims(signers)=1 AND array_lower(signers,1)=1 AND array_length(signers,1)=2),
    signatures TEXT[] NOT NULL CHECK (array_ndims(signatures)=1 AND array_lower(signatures,1)=1 AND array_length(signatures,1)=2),
    before_state JSONB NOT NULL,
    after_state JSONB NOT NULL,
    applied_by TEXT NOT NULL CHECK (applied_by ~ '^0x[0-9a-f]{40}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.artsoul_staff_setup_permissions ADD CONSTRAINT staff_setup_authority_request
    FOREIGN KEY (authority_request_id) REFERENCES public.artsoul_staff_authority_requests(id);

ALTER TABLE public.artsoul_staff_authority_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artsoul_staff_authority_policy FORCE ROW LEVEL SECURITY;
ALTER TABLE public.artsoul_staff_authority_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artsoul_staff_authority_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE public.artsoul_staff_authority_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artsoul_staff_authority_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.artsoul_staff_authority_policy,public.artsoul_staff_authority_requests,public.artsoul_staff_authority_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.artsoul_staff_authority_policy,public.artsoul_staff_authority_requests,public.artsoul_staff_authority_events TO service_role;
REVOKE ALL ON SEQUENCE public.artsoul_staff_authority_events_id_seq FROM PUBLIC,anon,authenticated,service_role;
-- Runtime role mutation must go through the verified-pair consumer below.
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.artsoul_staff_roles FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.a8f_create_authority_request(p_wallet TEXT,p_action TEXT,p_target TEXT,p_role TEXT,p_next_wallet_a TEXT,p_next_wallet_b TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_policy public.artsoul_staff_authority_policy%ROWTYPE;
    v_role public.artsoul_staff_roles%ROWTYPE; v_now TIMESTAMPTZ; v_expiry TIMESTAMPTZ;
    v_id UUID; v_proposal JSONB;
BEGIN
    SELECT * INTO v_policy FROM public.artsoul_staff_authority_policy WHERE singleton FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'AUTHORITY_POLICY_REQUIRED'; END IF;
    IF p_wallet IS NULL OR p_wallet NOT IN (v_policy.wallet_a,v_policy.wallet_b) THEN RAISE EXCEPTION 'AUTHORITY_REQUIRED'; END IF;
    IF p_action IS NULL OR p_action NOT IN ('grant_role','revoke_role','rotate_authority','renew_setup') THEN RAISE EXCEPTION 'INVALID_AUTHORITY_ACTION'; END IF;
    IF p_action='rotate_authority' THEN
        IF p_target IS DISTINCT FROM '' OR p_role IS DISTINCT FROM ''
            OR p_next_wallet_a IS NULL OR p_next_wallet_b IS NULL
            OR p_next_wallet_a !~ '^0x[0-9a-f]{40}$' OR p_next_wallet_b !~ '^0x[0-9a-f]{40}$'
            OR p_next_wallet_a='0x0000000000000000000000000000000000000000'
            OR p_next_wallet_a>=p_next_wallet_b
            OR (p_next_wallet_a=v_policy.wallet_a AND p_next_wallet_b=v_policy.wallet_b) THEN RAISE EXCEPTION 'INVALID_AUTHORITY_ROTATION'; END IF;
    ELSE
        IF p_target IS NULL OR p_target !~ '^0x[0-9a-f]{40}$' OR p_target='0x0000000000000000000000000000000000000000'
            OR p_role IS NULL OR p_role NOT IN ('admin','moderator','team')
            OR p_next_wallet_a IS DISTINCT FROM '' OR p_next_wallet_b IS DISTINCT FROM '' THEN RAISE EXCEPTION 'INVALID_ROLE_TARGET'; END IF;
        SELECT * INTO v_role FROM public.artsoul_staff_roles WHERE wallet_address=p_target FOR SHARE;
        IF p_action IN ('revoke_role','renew_setup') AND (v_role.wallet_address IS NULL OR NOT v_role.active OR v_role.role<>p_role) THEN RAISE EXCEPTION 'ROLE_CHANGED'; END IF;
        IF p_action='grant_role' AND v_role.active AND v_role.role=p_role THEN RAISE EXCEPTION 'ROLE_UNCHANGED'; END IF;
    END IF;
    v_now:=date_trunc('milliseconds',clock_timestamp());v_expiry:=v_now+INTERVAL '5 minutes';v_id:=gen_random_uuid();
    v_proposal:=jsonb_build_object(
        'requestId',v_id::TEXT,'origin',v_policy.origin,'chainId',v_policy.chain_id,'policyVersion',v_policy.version::TEXT,
        'authorities',jsonb_build_array(v_policy.wallet_a,v_policy.wallet_b),'action',p_action,'targetWallet',p_target,'role',p_role,
        'roleVersion',COALESCE(v_role.authorization_version,0)::TEXT,
        'nextAuthorities',CASE WHEN p_action='rotate_authority' THEN jsonb_build_array(p_next_wallet_a,p_next_wallet_b) ELSE '[]'::JSONB END,
        'issuedAt',to_char(v_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'expiresAt',to_char(v_expiry AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
    INSERT INTO public.artsoul_staff_authority_requests(id,requested_by,proposal,issued_at,expires_at) VALUES(v_id,p_wallet,v_proposal,v_now,v_expiry);
    RETURN v_proposal;
END;
$$;

CREATE FUNCTION public.a8f_complete_authority_request(p_wallet TEXT,p_request_id UUID,p_verified_signers TEXT[],p_signatures TEXT[],p_message_digest TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_policy public.artsoul_staff_authority_policy%ROWTYPE;
    v_request public.artsoul_staff_authority_requests%ROWTYPE;
    v_role public.artsoul_staff_roles%ROWTYPE; v_before JSONB; v_after JSONB;
    v_action TEXT; v_target TEXT; v_expected_version BIGINT; v_now TIMESTAMPTZ;
BEGIN
    SELECT * INTO v_policy FROM public.artsoul_staff_authority_policy WHERE singleton FOR UPDATE;
    IF NOT FOUND THEN RETURN 'AUTHORITY_POLICY_REQUIRED'; END IF;
    IF p_wallet IS NULL OR p_wallet NOT IN (v_policy.wallet_a,v_policy.wallet_b) THEN RETURN 'AUTHORITY_REQUIRED'; END IF;
    SELECT * INTO v_request FROM public.artsoul_staff_authority_requests WHERE id=p_request_id FOR UPDATE;
    IF NOT FOUND OR v_request.consumed_at IS NOT NULL THEN RETURN 'REQUEST_INVALID'; END IF;
    IF v_request.proposal->>'policyVersion'<>v_policy.version::TEXT
        OR v_request.proposal->>'origin'<>v_policy.origin OR (v_request.proposal->>'chainId')::INTEGER<>v_policy.chain_id
        OR v_request.proposal->'authorities'<>jsonb_build_array(v_policy.wallet_a,v_policy.wallet_b) THEN RETURN 'POLICY_CHANGED'; END IF;
    IF p_verified_signers IS DISTINCT FROM ARRAY[v_policy.wallet_a,v_policy.wallet_b]
        OR p_signatures IS NULL OR array_ndims(p_signatures) IS DISTINCT FROM 1 OR array_lower(p_signatures,1) IS DISTINCT FROM 1 OR array_length(p_signatures,1) IS DISTINCT FROM 2
        OR p_signatures[1] IS NULL OR p_signatures[2] IS NULL OR p_signatures[1] !~ '^0x[0-9a-fA-F]{130}$' OR p_signatures[2] !~ '^0x[0-9a-fA-F]{130}$'
        OR p_message_digest IS NULL OR p_message_digest !~ '^0x[0-9a-f]{64}$' THEN RETURN 'BOTH_APPROVALS_REQUIRED'; END IF;
    v_action:=v_request.proposal->>'action';v_target:=v_request.proposal->>'targetWallet';
    v_expected_version:=(v_request.proposal->>'roleVersion')::BIGINT;
    IF v_action<>'rotate_authority' THEN
        SELECT * INTO v_role FROM public.artsoul_staff_roles WHERE wallet_address=v_target FOR UPDATE;
        IF COALESCE(v_role.authorization_version,0)<>v_expected_version THEN RETURN 'ROLE_CHANGED'; END IF;
        IF v_action IN ('revoke_role','renew_setup') AND (v_role.wallet_address IS NULL OR NOT v_role.active OR v_role.role<>v_request.proposal->>'role') THEN RETURN 'ROLE_CHANGED'; END IF;
    END IF;
    -- Read time after all blocking locks; a signature cannot outlive its request.
    v_now:=clock_timestamp();
    IF v_request.issued_at>v_now OR v_request.expires_at<=v_now THEN RETURN 'REQUEST_EXPIRED'; END IF;
    IF v_action='rotate_authority' THEN
        v_before:=to_jsonb(v_policy);
        UPDATE public.artsoul_staff_authority_policy SET version=version+1,
            wallet_a=v_request.proposal->'nextAuthorities'->>0,wallet_b=v_request.proposal->'nextAuthorities'->>1
            WHERE singleton RETURNING to_jsonb(artsoul_staff_authority_policy.*) INTO v_after;
    ELSE
        v_before:=CASE WHEN v_role.wallet_address IS NULL THEN 'null'::JSONB ELSE to_jsonb(v_role) END;
        IF v_role.wallet_address IS NULL THEN
            INSERT INTO public.artsoul_staff_roles(wallet_address,role,active,granted_by,granted_at,updated_at)
            VALUES(v_target,v_request.proposal->>'role',TRUE,p_wallet,v_now,v_now)
            ON CONFLICT (wallet_address) DO NOTHING RETURNING to_jsonb(artsoul_staff_roles.*) INTO v_after;
            IF NOT FOUND THEN RETURN 'ROLE_CHANGED'; END IF;
        ELSE
            UPDATE public.artsoul_staff_roles SET role=v_request.proposal->>'role',active=v_action IN ('grant_role','renew_setup'),
                granted_by=CASE WHEN v_action='grant_role' THEN p_wallet ELSE granted_by END,
                granted_at=CASE WHEN v_action='grant_role' THEN v_now ELSE granted_at END,updated_at=v_now
                WHERE wallet_address=v_target AND authorization_version=v_expected_version
                RETURNING to_jsonb(artsoul_staff_roles.*) INTO v_after;
            IF NOT FOUND THEN RETURN 'ROLE_CHANGED'; END IF;
        END IF;
    END IF;
    UPDATE public.artsoul_staff_authority_requests SET consumed_at=v_now WHERE id=v_request.id;
    INSERT INTO public.artsoul_staff_authority_events(request_id,message_digest,signers,signatures,before_state,after_state,applied_by,created_at)
    VALUES(v_request.id,p_message_digest,p_verified_signers,p_signatures,v_before,v_after,p_wallet,v_now);
    IF v_action IN ('grant_role','renew_setup') THEN
        INSERT INTO public.artsoul_staff_setup_permissions(target_wallet,role_version,authority_request_id,issued_at,expires_at)
        VALUES(v_target,(v_after->>'authorization_version')::BIGINT,v_request.id,v_now,v_now+INTERVAL '15 minutes');
        INSERT INTO public.artsoul_staff_auth_events(wallet_address,event_type,details)
        VALUES(v_target,'grant_issued',jsonb_build_object('authority_request_id',v_request.id,'role_version',v_after->'authorization_version','purpose','factor_setup'));
    END IF;
    RETURN 'OK';
END;
$$;

REVOKE ALL ON FUNCTION public.a8f_create_authority_request(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.a8f_complete_authority_request(TEXT,UUID,TEXT[],TEXT[],TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.a8f_create_authority_request(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.a8f_complete_authority_request(TEXT,UUID,TEXT[],TEXT[],TEXT) TO service_role;
COMMIT;
