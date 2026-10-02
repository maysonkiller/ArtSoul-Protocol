-- Additive extension of A8: complaints can target donation messages separately
-- from artworks. Apply after artist_support.sql and the ordered A8 migrations.
-- Historical migrations remain unchanged. No value or chain state is modified.
BEGIN;
ALTER TABLE public.artwork_reports ADD COLUMN IF NOT EXISTS target_type TEXT NOT NULL DEFAULT 'artwork';
ALTER TABLE public.artwork_reports ADD COLUMN IF NOT EXISTS donation_contract_address TEXT;
ALTER TABLE public.artwork_reports ADD COLUMN IF NOT EXISTS donation_transaction_hash TEXT;
ALTER TABLE public.artwork_reports ADD COLUMN IF NOT EXISTS donation_log_index INTEGER;
ALTER TABLE public.artwork_reports ADD COLUMN IF NOT EXISTS target_author_wallet TEXT;
ALTER TABLE public.artwork_reports DROP CONSTRAINT IF EXISTS artwork_reports_target_check;
ALTER TABLE public.artwork_reports ADD CONSTRAINT artwork_reports_target_check CHECK (
    (target_type = 'artwork' AND donation_contract_address IS NULL
        AND donation_transaction_hash IS NULL AND donation_log_index IS NULL)
    OR (target_type = 'donation_message' AND chain_id = 84532
        AND donation_contract_address ~ '^0x[0-9a-f]{40}$'
        AND donation_transaction_hash ~ '^0x[0-9a-f]{64}$' AND donation_log_index >= 0
        AND target_author_wallet ~ '^0x[0-9a-f]{40}$'
        AND donation_contract_address IS NOT NULL AND donation_transaction_hash IS NOT NULL
        AND donation_log_index IS NOT NULL AND target_author_wallet IS NOT NULL)
);
DROP INDEX IF EXISTS public.idx_artwork_reports_one_pending_category;
CREATE UNIQUE INDEX idx_artwork_reports_one_pending_category
    ON public.artwork_reports(chain_id, artwork_id, reporter_wallet, category)
    WHERE status = 'pending_review' AND target_type = 'artwork';
CREATE UNIQUE INDEX IF NOT EXISTS idx_donation_reports_one_pending_category
    ON public.artwork_reports(chain_id, donation_transaction_hash, donation_log_index, reporter_wallet, category)
    WHERE status = 'pending_review' AND target_type = 'donation_message';

ALTER TABLE public.artwork_report_notifications DROP CONSTRAINT IF EXISTS artwork_report_notifications_notification_type_check;
ALTER TABLE public.artwork_report_notifications ADD CONSTRAINT artwork_report_notifications_notification_type_check CHECK (
    notification_type IN ('REPORT_ACTIONED','REPORT_DISMISSED','REPORT_REOPENED','REPORT_RESOLVED',
        'ARTWORK_HIDDEN','ARTWORK_RESTORED','DONATION_MESSAGE_HIDDEN','DONATION_MESSAGE_RESTORED')
);

CREATE OR REPLACE FUNCTION public.submit_moderation_report(
    p_chain_id NUMERIC, p_artwork_id NUMERIC, p_reporter_wallet TEXT, p_category TEXT,
    p_details TEXT, p_reference_url TEXT, p_good_faith_confirmed BOOLEAN, p_daily_limit INTEGER,
    p_target_type TEXT, p_donation_contract_address TEXT, p_donation_transaction_hash TEXT,
    p_donation_log_index INTEGER
) RETURNS TABLE(report_id UUID, report_status TEXT, report_created_at TIMESTAMPTZ, already_submitted BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    normalized_wallet TEXT := LOWER(TRIM(COALESCE(p_reporter_wallet,'')));
    normalized_category TEXT := LOWER(TRIM(COALESCE(p_category,'')));
    normalized_details TEXT := TRIM(COALESCE(p_details,''));
    normalized_reference TEXT := NULLIF(TRIM(COALESCE(p_reference_url,'')),'');
    author_wallet TEXT;
    existing_report public.artwork_reports%ROWTYPE;
    inserted_report public.artwork_reports%ROWTYPE;
BEGIN
    IF p_chain_id IS NULL OR p_chain_id NOT IN (84532,11155111) THEN RAISE EXCEPTION 'Unsupported artwork chain'; END IF;
    IF p_artwork_id IS NULL OR p_artwork_id <= 0 THEN RAISE EXCEPTION 'Invalid artwork id'; END IF;
    IF normalized_wallet !~ '^0x[0-9a-f]{40}$' THEN RAISE EXCEPTION 'Invalid reporter wallet'; END IF;
    IF normalized_category NOT IN ('copyright','impersonation','prohibited_content','spam','other') THEN
        RAISE EXCEPTION 'Invalid report category'; END IF;
    IF LENGTH(normalized_details) = 0 OR LENGTH(normalized_details) > 2000 THEN
        RAISE EXCEPTION 'Report details are required and must not exceed 2000 characters'; END IF;
    IF normalized_reference IS NOT NULL AND (LENGTH(normalized_reference)>500 OR normalized_reference !~* '^https?://') THEN
        RAISE EXCEPTION 'Reference URL must be an HTTP or HTTPS URL'; END IF;
    IF p_good_faith_confirmed IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Good-faith confirmation is required'; END IF;
    IF p_daily_limit IS NULL OR p_daily_limit <= 0 THEN RAISE EXCEPTION 'A positive report intake limit is required'; END IF;
    IF p_target_type IS NULL OR p_target_type NOT IN ('artwork','donation_message') THEN RAISE EXCEPTION 'INVALID_REPORT_TARGET'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.v41_artworks a WHERE a.chain_id=p_chain_id AND a.artwork_id=p_artwork_id) THEN
        RAISE EXCEPTION 'Artwork not found'; END IF;
    IF p_target_type = 'donation_message' THEN
        IF p_chain_id <> 84532 OR p_donation_contract_address IS NULL OR p_donation_transaction_hash IS NULL
            OR p_donation_log_index IS NULL OR p_donation_log_index < 0 THEN RAISE EXCEPTION 'INVALID_REPORT_TARGET'; END IF;
        SELECT d.donor INTO author_wallet FROM public.artwork_donations d
        WHERE d.chain_id=p_chain_id AND d.artwork_id=p_artwork_id
          AND d.contract_address=p_donation_contract_address AND d.transaction_hash=p_donation_transaction_hash
          AND d.log_index=p_donation_log_index AND d.message IS NOT NULL AND d.message<>'';
        IF author_wallet IS NULL THEN RAISE EXCEPTION 'DONATION_MESSAGE_NOT_FOUND'; END IF;
    ELSIF p_donation_contract_address IS NOT NULL OR p_donation_transaction_hash IS NOT NULL OR p_donation_log_index IS NOT NULL THEN
        RAISE EXCEPTION 'INVALID_REPORT_TARGET';
    END IF;
    -- One shared wallet lock and rolling cap cover both kinds of complaint.
    PERFORM pg_advisory_xact_lock(hashtextextended('artsoul-report:'||normalized_wallet,0));
    SELECT r.* INTO existing_report FROM public.artwork_reports r
    WHERE r.chain_id=p_chain_id AND r.artwork_id=p_artwork_id AND r.reporter_wallet=normalized_wallet
      AND r.category=normalized_category AND r.status='pending_review' AND r.target_type=p_target_type
      AND r.donation_transaction_hash IS NOT DISTINCT FROM p_donation_transaction_hash
      AND r.donation_log_index IS NOT DISTINCT FROM p_donation_log_index;
    IF existing_report.id IS NOT NULL THEN
        RETURN QUERY SELECT existing_report.id,existing_report.status,existing_report.created_at,TRUE; RETURN;
    END IF;
    IF (SELECT count(*) FROM public.artwork_reports r WHERE r.reporter_wallet=normalized_wallet
        AND r.created_at>=NOW()-INTERVAL '24 hours') >= p_daily_limit THEN RAISE EXCEPTION 'REPORT_DAILY_LIMIT_REACHED'; END IF;
    INSERT INTO public.artwork_reports(chain_id,artwork_id,reporter_wallet,category,details,reference_url,
        good_faith_confirmed,target_type,donation_contract_address,donation_transaction_hash,donation_log_index,target_author_wallet)
    VALUES(p_chain_id,p_artwork_id,normalized_wallet,normalized_category,normalized_details,normalized_reference,
        TRUE,p_target_type,p_donation_contract_address,p_donation_transaction_hash,p_donation_log_index,author_wallet)
    RETURNING * INTO inserted_report;
    INSERT INTO public.artwork_report_events(report_id,event_type,actor_wallet)
    VALUES(inserted_report.id,'REPORT_SUBMITTED',normalized_wallet);
    RETURN QUERY SELECT inserted_report.id,inserted_report.status,inserted_report.created_at,FALSE;
END;
$$;

-- Preserve the original PostgREST signature and artwork-only semantics.
CREATE OR REPLACE FUNCTION public.submit_artwork_report(
    p_chain_id NUMERIC,p_artwork_id NUMERIC,p_reporter_wallet TEXT,p_category TEXT,
    p_details TEXT,p_reference_url TEXT,p_good_faith_confirmed BOOLEAN,p_daily_limit INTEGER
) RETURNS TABLE(report_id UUID,report_status TEXT,report_created_at TIMESTAMPTZ,already_submitted BOOLEAN)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT * FROM public.submit_moderation_report(p_chain_id,p_artwork_id,p_reporter_wallet,p_category,p_details,
        p_reference_url,p_good_faith_confirmed,p_daily_limit,'artwork',NULL,NULL,NULL);
$$;

CREATE OR REPLACE FUNCTION public.review_moderation_report(
    p_report_id UUID,p_expected_updated_at TIMESTAMPTZ,p_action TEXT,p_reason TEXT,p_actor_wallet TEXT,p_expected_target_type TEXT
) RETURNS TABLE(report_id UUID,report_status TEXT,report_updated_at TIMESTAMPTZ,target_type TEXT,target_hidden BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    current_report public.artwork_reports%ROWTYPE;
    normalized_action TEXT := LOWER(TRIM(COALESCE(p_action,'')));
    normalized_reason TEXT := TRIM(COALESCE(p_reason,''));
    normalized_actor TEXT := LOWER(TRIM(COALESCE(p_actor_wallet,'')));
    author_wallet TEXT;
    next_status TEXT;
    event_name TEXT;
    reporter_notification TEXT;
    author_notification TEXT;
    new_updated_at TIMESTAMPTZ;
    was_hidden BOOLEAN := FALSE;
    still_hidden BOOLEAN := FALSE;
    other_actioned BIGINT;
BEGIN
    IF normalized_actor !~ '^0x[0-9a-f]{40}$' THEN RAISE EXCEPTION 'Invalid moderation actor wallet'; END IF;
    IF normalized_action NOT IN ('hide','dismiss','reopen','restore') THEN RAISE EXCEPTION 'REPORT_ACTION_NOT_ALLOWED'; END IF;
    IF LENGTH(normalized_reason)=0 OR LENGTH(normalized_reason)>500 THEN RAISE EXCEPTION 'A review reason is required and must not exceed 500 characters'; END IF;
    SELECT r.* INTO current_report FROM public.artwork_reports r WHERE r.id=p_report_id FOR UPDATE;
    IF current_report.id IS NULL THEN RAISE EXCEPTION 'REPORT_NOT_FOUND'; END IF;
    IF p_expected_target_type IS DISTINCT FROM current_report.target_type THEN RAISE EXCEPTION 'REPORT_TARGET_MISMATCH'; END IF;
    IF current_report.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'REPORT_REVIEW_CONFLICT'; END IF;
    -- Serialize by exact content target, not by the caller's proposed action.
    PERFORM pg_advisory_xact_lock(hashtextextended('artsoul-review:'||current_report.chain_id::TEXT||':'||
        current_report.target_type||':'||CASE WHEN current_report.target_type='artwork' THEN current_report.artwork_id::TEXT
          ELSE current_report.donation_transaction_hash||':'||current_report.donation_log_index::TEXT END,0));
    IF normalized_action IN ('hide','dismiss') AND current_report.status<>'pending_review'
        OR normalized_action='restore' AND current_report.status<>'actioned'
        OR normalized_action='reopen' AND current_report.status NOT IN ('dismissed','resolved') THEN
        RAISE EXCEPTION 'REPORT_ACTION_NOT_ALLOWED'; END IF;
    IF normalized_action='reopen' AND EXISTS(SELECT 1 FROM public.artwork_reports r
        WHERE r.chain_id=current_report.chain_id AND r.artwork_id=current_report.artwork_id
          AND r.target_type=current_report.target_type AND r.reporter_wallet=current_report.reporter_wallet
          AND r.category=current_report.category AND r.id<>current_report.id AND r.status='pending_review'
          AND r.donation_transaction_hash IS NOT DISTINCT FROM current_report.donation_transaction_hash
          AND r.donation_log_index IS NOT DISTINCT FROM current_report.donation_log_index) THEN
        RAISE EXCEPTION 'REPORT_ALREADY_PENDING'; END IF;
    IF current_report.target_type='donation_message' THEN
        SELECT COALESCE((SELECT v.hidden FROM public.donation_message_visibility v
          WHERE v.chain_id=current_report.chain_id AND v.transaction_hash=current_report.donation_transaction_hash
            AND v.log_index=current_report.donation_log_index),FALSE) INTO was_hidden;
        author_wallet := current_report.target_author_wallet;
    ELSE
        SELECT COALESCE((SELECT v.hidden FROM public.artwork_moderation_visibility v
          WHERE v.chain_id=current_report.chain_id AND v.artwork_id=current_report.artwork_id),FALSE) INTO was_hidden;
        SELECT LOWER(a.creator) INTO author_wallet FROM public.v41_artworks a
          WHERE a.chain_id=current_report.chain_id AND a.artwork_id=current_report.artwork_id LIMIT 1;
    END IF;
    still_hidden := was_hidden;
    IF normalized_action='hide' THEN
        next_status := 'actioned'; event_name := 'REPORT_HIDDEN'; reporter_notification := 'REPORT_ACTIONED';
        author_notification := CASE WHEN current_report.target_type='donation_message' THEN 'DONATION_MESSAGE_HIDDEN' ELSE 'ARTWORK_HIDDEN' END;
        still_hidden := TRUE;
        IF current_report.target_type='artwork' THEN
            PERFORM public.set_artwork_moderation_visibility(current_report.chain_id,current_report.artwork_id,TRUE,normalized_reason,normalized_actor);
        ELSE
            INSERT INTO public.donation_message_visibility(chain_id,transaction_hash,log_index,hidden)
            VALUES(current_report.chain_id,current_report.donation_transaction_hash,current_report.donation_log_index,TRUE)
            ON CONFLICT(chain_id,transaction_hash,log_index) DO UPDATE SET hidden=TRUE,updated_at=clock_timestamp();
        END IF;
    ELSIF normalized_action='dismiss' THEN
        next_status := 'dismissed'; event_name := 'REPORT_DISMISSED'; reporter_notification := 'REPORT_DISMISSED';
    ELSIF normalized_action='reopen' THEN
        next_status := 'pending_review'; event_name := 'REPORT_REOPENED'; reporter_notification := 'REPORT_REOPENED';
    ELSE
        next_status := 'resolved'; event_name := 'REPORT_RESOLVED'; reporter_notification := 'REPORT_RESOLVED';
        SELECT count(*) INTO other_actioned FROM public.artwork_reports r
          WHERE r.chain_id=current_report.chain_id AND r.artwork_id=current_report.artwork_id
            AND r.target_type=current_report.target_type AND r.id<>current_report.id AND r.status='actioned'
            AND r.donation_transaction_hash IS NOT DISTINCT FROM current_report.donation_transaction_hash
            AND r.donation_log_index IS NOT DISTINCT FROM current_report.donation_log_index;
        IF other_actioned=0 AND was_hidden THEN
            event_name := 'REPORT_RESTORED'; still_hidden := FALSE;
            author_notification := CASE WHEN current_report.target_type='donation_message' THEN 'DONATION_MESSAGE_RESTORED' ELSE 'ARTWORK_RESTORED' END;
            IF current_report.target_type='artwork' THEN
                PERFORM public.set_artwork_moderation_visibility(current_report.chain_id,current_report.artwork_id,FALSE,NULL,normalized_actor);
            ELSE
                UPDATE public.donation_message_visibility SET hidden=FALSE,updated_at=clock_timestamp()
                WHERE chain_id=current_report.chain_id AND transaction_hash=current_report.donation_transaction_hash
                  AND log_index=current_report.donation_log_index;
            END IF;
        END IF;
    END IF;
    UPDATE public.artwork_reports SET status=next_status,reviewed_by=normalized_actor,reviewed_at=NOW(),
        decision_reason=normalized_reason,updated_at=clock_timestamp() WHERE id=current_report.id RETURNING updated_at INTO new_updated_at;
    INSERT INTO public.artwork_report_events(report_id,event_type,actor_wallet,reason)
        VALUES(current_report.id,event_name,normalized_actor,normalized_reason);
    INSERT INTO public.artwork_report_notifications(report_id,recipient_wallet,notification_type)
        VALUES(current_report.id,current_report.reporter_wallet,reporter_notification);
    INSERT INTO public.artwork_report_events(report_id,event_type,actor_wallet,reason)
        VALUES(current_report.id,'NOTIFICATION_QUEUED',normalized_actor,NULL);
    IF author_notification IS NOT NULL AND author_wallet ~ '^0x[0-9a-f]{40}$' AND author_wallet<>current_report.reporter_wallet THEN
        INSERT INTO public.artwork_report_notifications(report_id,recipient_wallet,notification_type)
            VALUES(current_report.id,author_wallet,author_notification);
    END IF;
    RETURN QUERY SELECT current_report.id,next_status,new_updated_at,current_report.target_type,still_hidden;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_artwork_report(
    p_report_id UUID,p_expected_updated_at TIMESTAMPTZ,p_action TEXT,p_reason TEXT,p_actor_wallet TEXT
) RETURNS TABLE(report_id UUID,report_status TEXT,report_updated_at TIMESTAMPTZ,artwork_hidden BOOLEAN)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT r.report_id,r.report_status,r.report_updated_at,r.target_hidden FROM public.review_moderation_report(
        p_report_id,p_expected_updated_at,p_action,p_reason,p_actor_wallet,'artwork') r;
$$;
-- One bounded staff-only read resolves exact stored targets, including hidden
-- text. A missing chain projection is explicit; reporter allegations are never
-- substituted for the message being reviewed.
CREATE OR REPLACE FUNCTION public.read_donation_report_messages(p_report_ids UUID[])
RETURNS TABLE(report_id UUID,message TEXT,available BOOLEAN,hidden BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF p_report_ids IS NULL OR cardinality(p_report_ids)>200 THEN RAISE EXCEPTION 'INVALID_REPORT_BATCH'; END IF;
    RETURN QUERY SELECT r.id,d.message,d.transaction_hash IS NOT NULL,COALESCE(v.hidden,FALSE)
    FROM public.artwork_reports r
    LEFT JOIN public.artwork_donations d ON d.chain_id=r.chain_id AND d.artwork_id=r.artwork_id
      AND d.contract_address=r.donation_contract_address AND d.transaction_hash=r.donation_transaction_hash
      AND d.log_index=r.donation_log_index
    LEFT JOIN public.donation_message_visibility v ON v.chain_id=r.chain_id
      AND v.transaction_hash=r.donation_transaction_hash AND v.log_index=r.donation_log_index
    WHERE r.id=ANY(p_report_ids) AND r.target_type='donation_message';
END;
$$;
REVOKE ALL ON FUNCTION public.read_donation_report_messages(UUID[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_donation_report_messages(UUID[]) TO service_role;
REVOKE ALL ON FUNCTION public.submit_moderation_report(NUMERIC,NUMERIC,TEXT,TEXT,TEXT,TEXT,BOOLEAN,INTEGER,TEXT,TEXT,TEXT,INTEGER)
    FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_moderation_report(NUMERIC,NUMERIC,TEXT,TEXT,TEXT,TEXT,BOOLEAN,INTEGER,TEXT,TEXT,TEXT,INTEGER) TO service_role;
REVOKE ALL ON FUNCTION public.review_moderation_report(UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.review_moderation_report(UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.submit_artwork_report(NUMERIC,NUMERIC,TEXT,TEXT,TEXT,TEXT,BOOLEAN,INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_artwork_report(NUMERIC,NUMERIC,TEXT,TEXT,TEXT,TEXT,BOOLEAN,INTEGER) TO service_role;
REVOKE ALL ON FUNCTION public.review_artwork_report(UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.review_artwork_report(UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT) TO service_role;
COMMIT;
