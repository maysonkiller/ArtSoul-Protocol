-- Additive service-only delivery state. REPORT_SUBMITTED remains the durable
-- source; intake and its transaction do not depend on an email provider.
BEGIN;
CREATE TABLE IF NOT EXISTS public.moderation_report_email_delivery (
    report_id UUID PRIMARY KEY REFERENCES public.artwork_reports(id) ON DELETE RESTRICT,
    payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
    state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'accepted', 'needs_review')),
    first_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    attempt_token UUID,
    lease_until TIMESTAMPTZ,
    accepted_at TIMESTAMPTZ,
    last_error_code TEXT CHECK (last_error_code IN ('EMAIL_UNAVAILABLE', 'DELIVERY_UNCONFIRMED', 'CONFIG_CHANGED', 'RETRY_WINDOW_EXPIRED'))
);
ALTER TABLE public.moderation_report_email_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_report_email_delivery FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.moderation_report_email_delivery FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.moderation_report_email_delivery TO service_role;

CREATE OR REPLACE FUNCTION public.claim_moderation_report_email(p_report_id UUID, p_payload_hash TEXT)
RETURNS SETOF public.moderation_report_email_delivery
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE current_delivery public.moderation_report_email_delivery%ROWTYPE;
BEGIN
    IF p_payload_hash IS NULL OR p_payload_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'INVALID_DELIVERY_PAYLOAD'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.artwork_report_events WHERE report_id=p_report_id AND event_type='REPORT_SUBMITTED') THEN
        RAISE EXCEPTION 'REPORT_NOT_RECORDED';
    END IF;
    INSERT INTO public.moderation_report_email_delivery(report_id,payload_hash)
    VALUES(p_report_id,p_payload_hash) ON CONFLICT(report_id) DO NOTHING;
    SELECT * INTO current_delivery FROM public.moderation_report_email_delivery
        WHERE report_id=p_report_id FOR UPDATE;
    IF current_delivery.state <> 'pending' THEN RETURN; END IF;
    IF current_delivery.lease_until > NOW() OR current_delivery.next_attempt_at > NOW() THEN RETURN; END IF;
    -- Resend retains idempotency keys for 24 hours. Never automatically retry
    -- an uncertain delivery outside that window or with different content.
    IF current_delivery.payload_hash <> p_payload_hash OR current_delivery.first_attempt_at <= NOW()-INTERVAL '23 hours' THEN
        UPDATE public.moderation_report_email_delivery SET state='needs_review',
            last_error_code=CASE WHEN payload_hash<>p_payload_hash THEN 'CONFIG_CHANGED' ELSE 'RETRY_WINDOW_EXPIRED' END
            WHERE report_id=p_report_id;
        RETURN;
    END IF;
    RETURN QUERY UPDATE public.moderation_report_email_delivery SET
        attempt_count=attempt_count+1, attempt_token=gen_random_uuid(), lease_until=NOW()+INTERVAL '2 minutes'
        WHERE report_id=p_report_id RETURNING *;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_moderation_report_email(p_report_id UUID,p_attempt_token UUID,p_accepted BOOLEAN,p_error_code TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE changed_count INTEGER;
BEGIN
    IF p_accepted IS NULL OR (NOT p_accepted AND p_error_code NOT IN ('EMAIL_UNAVAILABLE','DELIVERY_UNCONFIRMED')) THEN
        RAISE EXCEPTION 'INVALID_DELIVERY_RESULT';
    END IF;
    UPDATE public.moderation_report_email_delivery SET
        state=CASE WHEN p_accepted THEN 'accepted' ELSE 'pending' END,
        accepted_at=CASE WHEN p_accepted THEN NOW() ELSE NULL END,
        last_error_code=CASE WHEN p_accepted THEN NULL ELSE COALESCE(p_error_code,'DELIVERY_UNCONFIRMED') END,
        next_attempt_at=NOW()+INTERVAL '1 minute', lease_until=NULL, attempt_token=NULL
        WHERE report_id=p_report_id AND attempt_token=p_attempt_token AND state='pending';
    GET DIAGNOSTICS changed_count=ROW_COUNT;
    RETURN changed_count=1;
END;
$$;

CREATE OR REPLACE FUNCTION public.pending_moderation_report_emails()
RETURNS TABLE(report_id UUID) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT e.report_id FROM public.artwork_report_events e
    LEFT JOIN public.moderation_report_email_delivery d ON d.report_id=e.report_id
    WHERE e.event_type='REPORT_SUBMITTED'
      AND (d.report_id IS NULL OR (d.state='pending' AND d.next_attempt_at<=NOW() AND (d.lease_until IS NULL OR d.lease_until<=NOW())))
    GROUP BY e.report_id ORDER BY MIN(e.created_at), e.report_id LIMIT 3;
$$;
REVOKE ALL ON FUNCTION public.claim_moderation_report_email(UUID,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.finish_moderation_report_email(UUID,UUID,BOOLEAN,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.pending_moderation_report_emails() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_moderation_report_email(UUID,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_moderation_report_email(UUID,UUID,BOOLEAN,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.pending_moderation_report_emails() TO service_role;
COMMIT;
