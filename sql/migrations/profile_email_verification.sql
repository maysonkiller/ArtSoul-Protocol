-- Private wallet-bound email verification. No newsletter consent or login role.
-- Additive preparation only; activation requires reviewed mail configuration.
BEGIN;
CREATE TABLE IF NOT EXISTS public.profile_email_connections (
  wallet_address text PRIMARY KEY CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  revision uuid NOT NULL DEFAULT gen_random_uuid(),
  verified_email text CHECK (length(verified_email) <= 254),
  verified_at timestamptz,
  pending_email text CHECK (length(pending_email) <= 254),
  pending_token_hash text CHECK (pending_token_hash ~ '^[0-9a-f]{64}$'),
  pending_expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((verified_email IS NULL) = (verified_at IS NULL)),
  CHECK (num_nonnulls(pending_email, pending_token_hash, pending_expires_at) IN (0, 3))
);
ALTER TABLE public.profile_email_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_email_connections FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.profile_email_connections FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile_email_connections TO service_role;

CREATE OR REPLACE FUNCTION public.confirm_profile_email(p_wallet_address text, p_token_hash text)
RETURNS TABLE(wallet_address text, verified_email text, verified_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE public.profile_email_connections AS connection
  SET verified_email = connection.pending_email, verified_at = now(),
      pending_email = NULL, pending_token_hash = NULL, pending_expires_at = NULL,
      revision = gen_random_uuid(), updated_at = now()
  WHERE connection.wallet_address = p_wallet_address
    AND connection.pending_token_hash = p_token_hash
    AND connection.pending_expires_at > now()
  RETURNING connection.wallet_address, connection.verified_email, connection.verified_at;
$$;
REVOKE ALL ON FUNCTION public.confirm_profile_email(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_profile_email(text, text) TO service_role;
COMMIT;
