-- A8d Safe-only moderation passkey recovery (additive follow-up to A8a).
--
-- This migration does not create a wallet-only recovery path. A successful
-- recovery consumes one short-lived request authorized by the configured
-- Safe through EIP-1271 and creates one hashed, single-use ADDITIONAL
-- enrollment grant. No Safe signature or raw enrollment token is stored.

CREATE TABLE IF NOT EXISTS public.artsoul_staff_recovery_requests (
    request_id UUID PRIMARY KEY,
    target_wallet TEXT NOT NULL,
    safe_address TEXT NOT NULL,
    chain_id BIGINT NOT NULL CHECK (chain_id > 0),
    rp_id TEXT NOT NULL,
    origin TEXT NOT NULL,
    message TEXT NOT NULL,
    message_hash TEXT NOT NULL CHECK (message_hash ~ '^0x[0-9a-f]{64}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    CHECK (expires_at > created_at),
    CHECK (expires_at <= created_at + INTERVAL '5 minutes'),
    CHECK (target_wallet = LOWER(target_wallet)),
    CHECK (target_wallet ~ '^0x[0-9a-f]{40}$'),
    CHECK (safe_address = LOWER(safe_address)),
    CHECK (safe_address ~ '^0x[0-9a-f]{40}$')
);

CREATE INDEX IF NOT EXISTS idx_artsoul_staff_recovery_requests_target
    ON public.artsoul_staff_recovery_requests (target_wallet, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_artsoul_staff_recovery_requests_expiry
    ON public.artsoul_staff_recovery_requests (expires_at)
    WHERE consumed_at IS NULL;

ALTER TABLE public.artsoul_staff_recovery_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artsoul_staff_recovery_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.artsoul_staff_recovery_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.artsoul_staff_recovery_requests TO service_role;

-- Extend the closed audit vocabulary without modifying the unapplied A8a
-- migration. Ordered rollout applies A8a first, then this additive migration.
ALTER TABLE public.artsoul_staff_auth_events
    DROP CONSTRAINT IF EXISTS artsoul_staff_auth_events_event_type_check;
ALTER TABLE public.artsoul_staff_auth_events
    ADD CONSTRAINT artsoul_staff_auth_events_event_type_check CHECK (event_type IN (
        'passkey_enrolled',
        'passkey_auth_success',
        'passkey_auth_failure',
        'passkey_revoked',
        'passkey_revoke_denied',
        'grant_issued',
        'grant_consumed',
        'grant_superseded',
        'recovery_authorized',
        'recovery_denied'
    ));

CREATE OR REPLACE FUNCTION public.a8d_complete_safe_recovery(
    p_request_id UUID,
    p_target_wallet TEXT,
    p_safe_address TEXT,
    p_chain_id BIGINT,
    p_message_hash TEXT,
    p_signature_hash TEXT,
    p_token_hash TEXT,
    p_grant_expires_at TIMESTAMPTZ
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_request RECORD;
    v_wallet TEXT := LOWER(p_target_wallet);
    v_safe TEXT := LOWER(p_safe_address);
    v_grant_id BIGINT;
BEGIN
    SELECT * INTO v_request
    FROM public.artsoul_staff_recovery_requests
    WHERE request_id = p_request_id
    FOR UPDATE;

    IF NOT FOUND
        OR v_request.target_wallet <> v_wallet
        OR v_request.safe_address <> v_safe
        OR v_request.chain_id <> p_chain_id
        OR v_request.message_hash <> LOWER(p_message_hash)
        OR v_request.consumed_at IS NOT NULL
        OR v_request.expires_at <= NOW() THEN
        RETURN 'RECOVERY_REQUEST_INVALID';
    END IF;

    IF p_signature_hash !~ '^[0-9a-f]{64}$'
        OR p_token_hash !~ '^[0-9a-f]{64}$'
        OR p_grant_expires_at <= NOW()
        OR p_grant_expires_at > NOW() + INTERVAL '15 minutes' THEN
        RETURN 'RECOVERY_COMMIT_INVALID';
    END IF;

    UPDATE public.artsoul_staff_recovery_requests
    SET consumed_at = NOW()
    WHERE request_id = p_request_id;

    INSERT INTO public.artsoul_staff_enrollment_grants (
        target_wallet, purpose, token_hash, issued_by, expires_at
    ) VALUES (
        v_wallet, 'additional', LOWER(p_token_hash), v_safe, p_grant_expires_at
    )
    RETURNING id INTO v_grant_id;

    INSERT INTO public.artsoul_staff_auth_events (wallet_address, event_type, details)
    VALUES (v_wallet, 'recovery_authorized', JSONB_BUILD_OBJECT(
        'request_id', p_request_id,
        'safe_address', v_safe,
        'chain_id', p_chain_id,
        'message_hash', LOWER(p_message_hash),
        'signature_hash', LOWER(p_signature_hash),
        'grant_id', v_grant_id
    ));

    INSERT INTO public.artsoul_staff_auth_events (wallet_address, event_type, details)
    VALUES (v_wallet, 'grant_issued', JSONB_BUILD_OBJECT(
        'grant_id', v_grant_id,
        'purpose', 'additional',
        'issued_by', v_safe,
        'source', 'safe_recovery'
    ));

    RETURN 'OK';
END;
$$;

REVOKE ALL ON FUNCTION public.a8d_complete_safe_recovery(UUID, TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, TIMESTAMPTZ)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.a8d_complete_safe_recovery(UUID, TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, TIMESTAMPTZ)
    TO service_role;
