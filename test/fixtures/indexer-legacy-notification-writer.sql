-- Test-only adapter for fixtures intentionally exercising an older, minimal
-- notification schema. Keep the former transaction-local INSERT and conflict
-- behavior behind the current writer signature. This does NOT exercise the
-- production recovery-identity migration or promise preserved notification IDs.
-- Full-stack reorg tests install the actual migration instead of this adapter.
CREATE FUNCTION public.write_recoverable_notification(
    p_aggregate_type TEXT,
    p_aggregate_id TEXT,
    p_payload JSONB,
    p_correlation_id TEXT,
    p_idempotency_key TEXT,
    p_processing_status TEXT
) RETURNS BIGINT
LANGUAGE SQL
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
    INSERT INTO public.outbox_events (
        aggregate_type, aggregate_id, event_type, payload,
        correlation_id, idempotency_key, processing_status
    ) VALUES (
        p_aggregate_type, p_aggregate_id, 'notification', p_payload,
        p_correlation_id, p_idempotency_key, p_processing_status
    )
    ON CONFLICT (idempotency_key) DO NOTHING RETURNING id;
$$;

REVOKE ALL ON FUNCTION public.write_recoverable_notification(TEXT,TEXT,JSONB,TEXT,TEXT,TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
