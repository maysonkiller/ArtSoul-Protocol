-- Unapplied integration of the approved shared 15-minute setup permission.
-- Requires A8e/A8f. Creates no policy, role, permission, factor or session.
BEGIN;

CREATE FUNCTION public.a8g_complete_passkey_setup(p_wallet TEXT,p_permission_id UUID,p_challenge TEXT,
    p_credential_id TEXT,p_public_key TEXT,p_sign_count BIGINT,p_transports TEXT,p_aaguid TEXT,p_label TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_version BIGINT; v_permission public.artsoul_staff_setup_permissions%ROWTYPE;
    v_challenge public.artsoul_webauthn_challenges%ROWTYPE; v_now TIMESTAMPTZ;
BEGIN
    IF p_wallet IS NULL OR p_wallet !~ '^0x[0-9a-f]{40}$' OR p_permission_id IS NULL
        OR COALESCE(p_credential_id,'')='' OR COALESCE(p_public_key,'')='' OR p_sign_count IS NULL OR p_sign_count<0 THEN RETURN 'INVALID_INPUT'; END IF;
    -- Same wallet lock as TOTP: competing method choices cannot both consume.
    PERFORM pg_advisory_xact_lock(hashtextextended('artsoul-totp:' || p_wallet,0));
    SELECT authorization_version INTO v_version FROM public.artsoul_staff_roles
        WHERE wallet_address=p_wallet AND active AND role IN ('admin','moderator','team') FOR SHARE;
    IF NOT FOUND THEN RETURN 'STAFF_INACTIVE'; END IF;
    SELECT * INTO v_permission FROM public.artsoul_staff_setup_permissions WHERE id=p_permission_id FOR UPDATE;
    SELECT * INTO v_challenge FROM public.artsoul_webauthn_challenges WHERE challenge=p_challenge FOR UPDATE;
    v_now:=clock_timestamp();
    IF v_permission.id IS NULL OR v_permission.target_wallet IS DISTINCT FROM p_wallet
        OR v_permission.role_version IS DISTINCT FROM v_version OR v_permission.consumed_at IS NOT NULL
        OR v_permission.issued_at>v_now OR v_permission.expires_at<=v_now THEN RETURN 'SETUP_PERMISSION_INVALID'; END IF;
    IF v_challenge.challenge IS NULL OR v_challenge.wallet_address IS DISTINCT FROM p_wallet
        OR v_challenge.purpose<>'registration' OR v_challenge.setup_permission_id IS DISTINCT FROM p_permission_id
        OR v_challenge.authorization_version IS DISTINCT FROM v_version
        OR v_challenge.consumed_at IS NOT NULL OR v_challenge.expires_at<=v_now THEN RETURN 'CHALLENGE_INVALID'; END IF;
    INSERT INTO public.artsoul_staff_passkeys(wallet_address,credential_id,public_key,sign_count,transports,aaguid,label,
        enrolled_via,authorization_version,setup_permission_id)
    VALUES(p_wallet,p_credential_id,p_public_key,p_sign_count,p_transports,p_aaguid,left(p_label,80),'additional',v_version,p_permission_id);
    UPDATE public.artsoul_webauthn_challenges SET consumed_at=v_now WHERE challenge=p_challenge;
    UPDATE public.artsoul_staff_setup_permissions SET consumed_at=v_now,factor_type='passkey',factor_reference=p_credential_id WHERE id=p_permission_id;
    INSERT INTO public.artsoul_staff_auth_events(wallet_address,event_type,credential_id,details) VALUES
        (p_wallet,'grant_consumed',p_credential_id,jsonb_build_object('setup_permission_id',p_permission_id,'role_version',v_version)),
        (p_wallet,'passkey_enrolled',p_credential_id,jsonb_build_object('setup_permission_id',p_permission_id,'role_version',v_version));
    RETURN 'OK';
END;
$$;

CREATE FUNCTION public.a8g_begin_totp_setup(p_wallet TEXT,p_permission_id UUID,p_factor_id UUID,p_envelope JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_version BIGINT; v_permission public.artsoul_staff_setup_permissions%ROWTYPE;
    v_grant public.artsoul_staff_totp_grants%ROWTYPE; v_factor public.artsoul_staff_totp_factors%ROWTYPE;
    v_result TEXT; v_digest TEXT; v_now TIMESTAMPTZ;
BEGIN
    IF p_wallet IS NULL OR p_wallet !~ '^0x[0-9a-f]{40}$' OR p_permission_id IS NULL OR p_factor_id IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('artsoul-totp:' || p_wallet,0));
    SELECT authorization_version INTO v_version FROM public.artsoul_staff_roles
        WHERE wallet_address=p_wallet AND active AND role IN ('admin','moderator','team') FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'STAFF_INACTIVE'; END IF;
    SELECT * INTO v_permission FROM public.artsoul_staff_setup_permissions WHERE id=p_permission_id FOR UPDATE;
    v_now:=clock_timestamp();
    IF NOT FOUND OR v_permission.target_wallet IS DISTINCT FROM p_wallet OR v_permission.role_version IS DISTINCT FROM v_version
        OR v_permission.consumed_at IS NOT NULL OR v_permission.issued_at>v_now OR v_permission.expires_at<=v_now THEN RAISE EXCEPTION 'SETUP_PERMISSION_INVALID'; END IF;
    -- Retry/resume reveals only the previously prepared factor to its approved
    -- wallet while setup remains open, never after successful enrollment.
    SELECT * INTO v_grant FROM public.artsoul_staff_totp_grants WHERE setup_permission_id=p_permission_id;
    IF FOUND THEN
        SELECT * INTO v_factor FROM public.artsoul_staff_totp_factors WHERE id=v_grant.factor_id AND activated_at IS NULL AND revoked_at IS NULL;
        IF NOT FOUND THEN RAISE EXCEPTION 'FACTOR_INELIGIBLE'; END IF;
        RETURN to_jsonb(v_factor);
    END IF;
    SELECT substring(message_digest FROM 3) INTO v_digest FROM public.artsoul_staff_authority_events WHERE request_id=v_permission.authority_request_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'SETUP_AUTHORIZATION_REQUIRED'; END IF;
    INSERT INTO public.artsoul_staff_totp_grants(setup_permission_id,factor_id,target_wallet,role_version,token_hash,
        authority_policy,authorization_digest,issued_at,expires_at)
    VALUES(p_permission_id,p_factor_id,p_wallet,v_version,encode(gen_random_bytes(32),'hex'),
        'founder-dual-wallet-2026-10-07',v_digest,v_permission.issued_at,v_permission.expires_at) RETURNING * INTO v_grant;
    v_result:=public.a8e_begin_totp_enrollment(p_wallet,v_grant.id,v_grant.token_hash,p_envelope);
    IF v_result<>'OK' THEN RAISE EXCEPTION '%',v_result; END IF;
    SELECT * INTO v_factor FROM public.artsoul_staff_totp_factors WHERE id=p_factor_id;
    RETURN to_jsonb(v_factor);
END;
$$;

REVOKE ALL ON FUNCTION public.a8g_complete_passkey_setup(TEXT,UUID,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.a8g_begin_totp_setup(TEXT,UUID,UUID,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.a8g_complete_passkey_setup(TEXT,UUID,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.a8g_begin_totp_setup(TEXT,UUID,UUID,JSONB) TO service_role;
COMMIT;
