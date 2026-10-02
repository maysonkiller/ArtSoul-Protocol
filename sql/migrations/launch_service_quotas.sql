-- Shared durable service quotas, independently deployable without launch tables.
-- Matches collection_launch_services.sql exactly; applying either order is safe.
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
ALTER TABLE public.launch_service_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.launch_service_quotas FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.launch_service_quotas FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.launch_service_quotas TO service_role;
COMMIT;
