-- Additive, manually applied only after local PostgreSQL verification and backup.
-- None of these records establish ownership, fees, onchain eligibility or NFT supply.
BEGIN;
CREATE TABLE IF NOT EXISTS public.launch_service_quotas (
  quota_key text PRIMARY KEY CHECK (quota_key ~ '^[0-9a-f]{64}$'),
  window_started timestamptz NOT NULL DEFAULT now(),
  used integer NOT NULL CHECK (used > 0)
);
CREATE OR REPLACE FUNCTION public.consume_launch_service_quota(p_key text, p_max integer, p_seconds integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_used integer;
BEGIN
  IF p_max < 1 OR p_max > 100 OR p_seconds < 1 OR p_seconds > 86400 THEN RAISE EXCEPTION 'Invalid quota'; END IF;
  INSERT INTO public.launch_service_quotas AS q (quota_key, used) VALUES (p_key, 1)
  ON CONFLICT (quota_key) DO UPDATE SET
    used = CASE WHEN q.window_started + make_interval(secs => p_seconds) <= now() THEN 1 ELSE q.used + 1 END,
    window_started = CASE WHEN q.window_started + make_interval(secs => p_seconds) <= now() THEN now() ELSE q.window_started END
  WHERE q.window_started + make_interval(secs => p_seconds) <= now() OR q.used < p_max
  RETURNING used INTO v_used;
  RETURN v_used IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_launch_service_quota(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_launch_service_quota(text, integer, integer) TO service_role;

CREATE TABLE IF NOT EXISTS public.collection_ai_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address text NOT NULL CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  config_hash text NOT NULL CHECK (config_hash ~ '^[0-9a-f]{64}$'),
  configuration jsonb NOT NULL, review jsonb NOT NULL, model text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.email_subscriptions (
  email text PRIMARY KEY CHECK (length(email) <= 254),
  status text NOT NULL CHECK (status IN ('subscribed', 'unsubscribed')),
  unsubscribe_hash text NOT NULL UNIQUE CHECK (unsubscribe_hash ~ '^[0-9a-f]{64}$'),
  consent_version text NOT NULL, consent_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['launch_service_quotas', 'collection_ai_reviews', 'email_subscriptions'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;
COMMIT;
