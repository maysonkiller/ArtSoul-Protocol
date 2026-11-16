-- B20: additive profile-content complaints through the existing private queue.
-- Apply after artist_support_moderation.sql. No profile or historical upload is deleted.
BEGIN;
-- Public readers use the atomic masked projection; raw identity is service-only.
REVOKE ALL ON public.profiles FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.profiles TO service_role;
ALTER TABLE public.artwork_reports ADD COLUMN IF NOT EXISTS profile_wallet TEXT;
ALTER TABLE public.artwork_reports ADD COLUMN IF NOT EXISTS profile_content_snapshot JSONB;
ALTER TABLE public.artwork_reports ADD COLUMN IF NOT EXISTS profile_content_hash TEXT;
ALTER TABLE public.artwork_reports ALTER COLUMN chain_id DROP NOT NULL;
ALTER TABLE public.artwork_reports ALTER COLUMN artwork_id DROP NOT NULL;
ALTER TABLE public.artwork_reports DROP CONSTRAINT IF EXISTS artwork_reports_target_check;
ALTER TABLE public.artwork_reports ADD CONSTRAINT artwork_reports_target_check CHECK (
    (target_type IN ('artwork','donation_message') AND chain_id IS NOT NULL AND artwork_id IS NOT NULL
        AND profile_wallet IS NULL AND profile_content_snapshot IS NULL AND profile_content_hash IS NULL
        AND ((target_type='artwork' AND donation_contract_address IS NULL
            AND donation_transaction_hash IS NULL AND donation_log_index IS NULL)
          OR (target_type='donation_message' AND chain_id=84532
            AND donation_contract_address IS NOT NULL AND donation_contract_address ~ '^0x[0-9a-f]{40}$'
            AND donation_transaction_hash IS NOT NULL AND donation_transaction_hash ~ '^0x[0-9a-f]{64}$'
            AND donation_log_index IS NOT NULL AND donation_log_index>=0
            AND target_author_wallet IS NOT NULL AND target_author_wallet ~ '^0x[0-9a-f]{40}$')))
    OR (target_type='profile_content' AND chain_id IS NULL AND artwork_id IS NULL
        AND profile_wallet IS NOT NULL AND profile_wallet ~ '^0x[0-9a-f]{40}$'
        AND profile_wallet<>'0x0000000000000000000000000000000000000000'
        AND profile_content_snapshot IS NOT NULL AND jsonb_typeof(profile_content_snapshot)='object'
        AND profile_content_hash IS NOT NULL AND profile_content_hash ~ '^[0-9a-f]{64}$'
        AND target_author_wallet IS NOT NULL AND target_author_wallet=profile_wallet
        AND donation_contract_address IS NULL AND donation_transaction_hash IS NULL AND donation_log_index IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_reports_one_pending_category
    ON public.artwork_reports(profile_wallet,profile_content_hash,reporter_wallet,category)
    WHERE target_type='profile_content' AND status='pending_review';
CREATE INDEX IF NOT EXISTS idx_profile_reports_active_content
    ON public.artwork_reports(profile_wallet,profile_content_hash)
    WHERE target_type='profile_content' AND status='actioned';

-- Only already-public content enters evidence. Raw OAuth IDs are never captured.
CREATE OR REPLACE FUNCTION public.profile_report_content(p public.profiles)
RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
    SELECT jsonb_build_object('username',p.username,'bio',p.bio,'avatar_url',p.avatar_url,
        'twitter_handle',p.twitter_handle,'twitter_username',p.twitter_username,'discord_username',p.discord_username,
        'twitter_connected',length(trim(coalesce(p.twitter_id::TEXT,'')))>0,
        'discord_connected',length(trim(coalesce(p.discord_id::TEXT,'')))>0,
        'discord_profile_url',CASE WHEN p.discord_id::TEXT ~ '^[0-9]{1,20}$'
            THEN 'https://discord.com/users/'||p.discord_id::TEXT ELSE NULL END);
$$;
CREATE OR REPLACE FUNCTION public.profile_report_content_hash(p public.profiles)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
    SELECT encode(sha256(convert_to(public.profile_report_content(p)::TEXT,'UTF8')),'hex');
$$;
REVOKE ALL ON FUNCTION public.profile_report_content(public.profiles),public.profile_report_content_hash(public.profiles)
    FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.profile_report_content(public.profiles),public.profile_report_content_hash(public.profiles) TO service_role;

-- Resolve the current content and matching decisions in a single MVCC snapshot.
CREATE OR REPLACE VIEW public.profile_content_visibility WITH (security_invoker=true) AS
SELECT p.wallet_address AS profile_wallet,public.profile_report_content_hash(p) AS content_hash,
    EXISTS(SELECT 1 FROM public.artwork_reports r WHERE r.target_type='profile_content'
        AND r.profile_wallet=p.wallet_address AND r.status='actioned'
        AND r.profile_content_hash=public.profile_report_content_hash(p)) AS hidden
FROM public.profiles p;
CREATE OR REPLACE VIEW public.public_profile_content WITH (security_invoker=true) AS
SELECT p.id,p.created_at,p.wallet_address,
    CASE WHEN v.hidden THEN NULL ELSE p.username END AS username,
    CASE WHEN v.hidden THEN NULL ELSE p.bio END AS bio,
    CASE WHEN v.hidden THEN NULL ELSE p.avatar_url END AS avatar_url,
    CASE WHEN v.hidden THEN NULL ELSE p.twitter_handle END AS twitter_handle,
    CASE WHEN v.hidden THEN NULL ELSE p.twitter_username END AS twitter_username,
    CASE WHEN v.hidden THEN NULL ELSE p.discord_username END AS discord_username,
    CASE WHEN v.hidden THEN NULL ELSE p.twitter_id END AS twitter_id,
    CASE WHEN v.hidden THEN NULL ELSE p.discord_id END AS discord_id,
    v.hidden AS profile_content_hidden
FROM public.profiles p JOIN public.profile_content_visibility v ON v.profile_wallet=p.wallet_address;
REVOKE ALL ON public.profile_content_visibility,public.public_profile_content FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.profile_content_visibility,public.public_profile_content TO service_role;

ALTER TABLE public.artwork_report_notifications DROP CONSTRAINT IF EXISTS artwork_report_notifications_notification_type_check;
ALTER TABLE public.artwork_report_notifications ADD CONSTRAINT artwork_report_notifications_notification_type_check CHECK (
    notification_type IN ('REPORT_ACTIONED','REPORT_DISMISSED','REPORT_REOPENED','REPORT_RESOLVED',
        'ARTWORK_HIDDEN','ARTWORK_RESTORED','DONATION_MESSAGE_HIDDEN','DONATION_MESSAGE_RESTORED',
        'PROFILE_CONTENT_HIDDEN','PROFILE_CONTENT_RESTORED')
);

CREATE OR REPLACE FUNCTION public.submit_profile_content_report(
    p_profile_wallet TEXT,p_reporter_wallet TEXT,p_category TEXT,p_details TEXT,p_reference_url TEXT,
    p_good_faith_confirmed BOOLEAN,p_daily_limit INTEGER
) RETURNS TABLE(report_id UUID,report_status TEXT,report_created_at TIMESTAMPTZ,already_submitted BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
    target_wallet TEXT := lower(trim(coalesce(p_profile_wallet,'')));
    reporter TEXT := lower(trim(coalesce(p_reporter_wallet,'')));
    category_value TEXT := lower(trim(coalesce(p_category,'')));
    details_value TEXT := trim(coalesce(p_details,''));
    reference_value TEXT := nullif(trim(coalesce(p_reference_url,'')),'');
    target_profile public.profiles%ROWTYPE;
    snapshot JSONB;
    content_hash TEXT;
    report public.artwork_reports%ROWTYPE;
BEGIN
    IF target_wallet !~ '^0x[0-9a-f]{40}$' OR target_wallet='0x0000000000000000000000000000000000000000'
        THEN RAISE EXCEPTION 'INVALID_REPORT_TARGET'; END IF;
    IF reporter !~ '^0x[0-9a-f]{40}$' THEN RAISE EXCEPTION 'Invalid reporter wallet'; END IF;
    IF category_value NOT IN ('copyright','impersonation','prohibited_content','spam','other')
        THEN RAISE EXCEPTION 'Invalid report category'; END IF;
    IF length(details_value)=0 OR length(details_value)>2000 THEN RAISE EXCEPTION 'Invalid report details'; END IF;
    IF reference_value IS NOT NULL AND (length(reference_value)>500 OR reference_value !~* '^https?://')
        THEN RAISE EXCEPTION 'Invalid reference URL'; END IF;
    IF p_good_faith_confirmed IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Good-faith confirmation is required'; END IF;
    IF p_daily_limit IS NULL OR p_daily_limit<=0 THEN RAISE EXCEPTION 'A positive report intake limit is required'; END IF;
    -- Same wallet lock and rolling quota as artwork and donation complaints.
    PERFORM pg_advisory_xact_lock(hashtextextended('artsoul-report:'||reporter,0));
    SELECT p.* INTO target_profile FROM public.profiles p WHERE p.wallet_address=target_wallet FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PROFILE_NOT_FOUND'; END IF;
    snapshot := public.profile_report_content(target_profile);
    content_hash := public.profile_report_content_hash(target_profile);
    SELECT r.* INTO report FROM public.artwork_reports r WHERE r.target_type='profile_content'
        AND r.profile_wallet=target_wallet AND r.profile_content_hash=content_hash
        AND r.reporter_wallet=reporter AND r.category=category_value AND r.status='pending_review';
    IF FOUND THEN
        RETURN QUERY SELECT report.id,report.status,report.created_at,TRUE; RETURN;
    END IF;
    IF (SELECT count(*) FROM public.artwork_reports r WHERE r.reporter_wallet=reporter
        AND r.created_at>=now()-INTERVAL '24 hours')>=p_daily_limit THEN RAISE EXCEPTION 'REPORT_DAILY_LIMIT_REACHED'; END IF;
    INSERT INTO public.artwork_reports(target_type,profile_wallet,profile_content_snapshot,profile_content_hash,
        target_author_wallet,reporter_wallet,category,details,reference_url,good_faith_confirmed)
    VALUES('profile_content',target_wallet,snapshot,content_hash,target_wallet,reporter,category_value,details_value,reference_value,TRUE)
    RETURNING * INTO report;
    INSERT INTO public.artwork_report_events(report_id,event_type,actor_wallet) VALUES(report.id,'REPORT_SUBMITTED',reporter);
    RETURN QUERY SELECT report.id,report.status,report.created_at,FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_profile_content_report(
    p_report_id UUID,p_expected_updated_at TIMESTAMPTZ,p_action TEXT,p_reason TEXT,p_actor_wallet TEXT
) RETURNS TABLE(report_id UUID,report_status TEXT,report_updated_at TIMESTAMPTZ,profile_hidden BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
    report public.artwork_reports%ROWTYPE;
    target_profile public.profiles%ROWTYPE;
    normalized_action TEXT := lower(trim(coalesce(p_action,'')));
    normalized_reason TEXT := trim(coalesce(p_reason,''));
    actor TEXT := lower(trim(coalesce(p_actor_wallet,'')));
    next_status TEXT;
    event_name TEXT;
    reporter_notice TEXT;
    author_notice TEXT;
    new_version TIMESTAMPTZ;
    was_hidden BOOLEAN := FALSE;
    still_hidden BOOLEAN := FALSE;
BEGIN
    IF actor !~ '^0x[0-9a-f]{40}$' THEN RAISE EXCEPTION 'Invalid moderation actor wallet'; END IF;
    IF normalized_action NOT IN ('hide','dismiss','reopen','restore') THEN RAISE EXCEPTION 'REPORT_ACTION_NOT_ALLOWED'; END IF;
    IF length(normalized_reason)=0 OR length(normalized_reason)>500 THEN RAISE EXCEPTION 'Invalid review reason'; END IF;
    SELECT r.* INTO report FROM public.artwork_reports r WHERE r.id=p_report_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'REPORT_NOT_FOUND'; END IF;
    IF report.target_type<>'profile_content' THEN RAISE EXCEPTION 'REPORT_TARGET_MISMATCH'; END IF;
    IF report.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'REPORT_REVIEW_CONFLICT'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('artsoul-review:profile_content:'||report.profile_wallet,0));
    IF (normalized_action IN ('hide','dismiss') AND report.status<>'pending_review')
        OR (normalized_action='restore' AND report.status<>'actioned')
        OR (normalized_action='reopen' AND report.status NOT IN ('dismissed','resolved')) THEN
        RAISE EXCEPTION 'REPORT_ACTION_NOT_ALLOWED'; END IF;
    -- Lock the mutable profile until the decision commits. A changed profile
    -- requires new evidence; resolving an old complaint remains possible.
    SELECT p.* INTO target_profile FROM public.profiles p WHERE p.wallet_address=report.profile_wallet FOR UPDATE;
    IF normalized_action IN ('hide','reopen') AND (NOT FOUND OR
        public.profile_report_content_hash(target_profile) IS DISTINCT FROM report.profile_content_hash) THEN
        RAISE EXCEPTION 'PROFILE_CONTENT_CHANGED'; END IF;
    IF normalized_action='reopen' AND EXISTS(SELECT 1 FROM public.artwork_reports r
        WHERE r.target_type='profile_content' AND r.profile_wallet=report.profile_wallet
          AND r.profile_content_hash=report.profile_content_hash AND r.reporter_wallet=report.reporter_wallet
          AND r.category=report.category AND r.status='pending_review' AND r.id<>report.id) THEN
        RAISE EXCEPTION 'REPORT_ALREADY_PENDING'; END IF;
    SELECT coalesce((SELECT v.hidden FROM public.profile_content_visibility v WHERE v.profile_wallet=report.profile_wallet),FALSE) INTO was_hidden;
    CASE normalized_action
      WHEN 'hide' THEN next_status:='actioned'; event_name:='REPORT_HIDDEN'; reporter_notice:='REPORT_ACTIONED'; author_notice:='PROFILE_CONTENT_HIDDEN';
      WHEN 'dismiss' THEN next_status:='dismissed'; event_name:='REPORT_DISMISSED'; reporter_notice:='REPORT_DISMISSED';
      WHEN 'reopen' THEN next_status:='pending_review'; event_name:='REPORT_REOPENED'; reporter_notice:='REPORT_REOPENED';
      ELSE next_status:='resolved'; event_name:='REPORT_RESOLVED'; reporter_notice:='REPORT_RESOLVED';
    END CASE;
    UPDATE public.artwork_reports SET status=next_status,reviewed_by=actor,reviewed_at=now(),
        decision_reason=normalized_reason,updated_at=clock_timestamp() WHERE id=report.id RETURNING updated_at INTO new_version;
    SELECT coalesce((SELECT v.hidden FROM public.profile_content_visibility v WHERE v.profile_wallet=report.profile_wallet),FALSE) INTO still_hidden;
    IF normalized_action='restore' AND was_hidden AND NOT still_hidden THEN
        event_name:='REPORT_RESTORED'; author_notice:='PROFILE_CONTENT_RESTORED';
    END IF;
    INSERT INTO public.artwork_report_events(report_id,event_type,actor_wallet,reason) VALUES(report.id,event_name,actor,normalized_reason);
    INSERT INTO public.artwork_report_notifications(report_id,recipient_wallet,notification_type) VALUES(report.id,report.reporter_wallet,reporter_notice);
    INSERT INTO public.artwork_report_events(report_id,event_type,actor_wallet,reason) VALUES(report.id,'NOTIFICATION_QUEUED',actor,NULL);
    IF author_notice IS NOT NULL AND report.profile_wallet<>report.reporter_wallet THEN
        INSERT INTO public.artwork_report_notifications(report_id,recipient_wallet,notification_type) VALUES(report.id,report.profile_wallet,author_notice);
    END IF;
    RETURN QUERY SELECT report.id,next_status,new_version,still_hidden;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_profile_content_report(TEXT,TEXT,TEXT,TEXT,TEXT,BOOLEAN,INTEGER),
    public.review_profile_content_report(UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_profile_content_report(TEXT,TEXT,TEXT,TEXT,TEXT,BOOLEAN,INTEGER),
    public.review_profile_content_report(UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT) TO service_role;
-- Search matching must use the same masked identities as public hydration.
CREATE OR REPLACE FUNCTION public.search_public_artworks(
    p_query TEXT, p_category TEXT, p_core_address TEXT, p_before TEXT DEFAULT NULL, p_limit INTEGER DEFAULT 21
) RETURNS TABLE (result_key TEXT)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
    v_query TEXT := btrim(p_query);
    v_terms TSQUERY;
    v_id NUMERIC;
    v_address TEXT;
    v_confirmed BIGINT;
BEGIN
    IF v_query IS NULL OR char_length(v_query) NOT BETWEEN 1 AND 100
       OR p_category NOT IN ('artworks','auctions','artists') OR p_category IS NULL
       OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 21
       OR p_core_address IS NULL OR p_core_address !~ '^0x[0-9a-f]{40}$' THEN
        RAISE EXCEPTION 'Invalid search request' USING ERRCODE='22023';
    END IF;
    SELECT s.last_confirmed_block INTO v_confirmed FROM public.indexer_state s
        WHERE s.chain_id=84532 AND lower(s.contract_address)=p_core_address;
    IF v_confirmed IS NULL THEN RAISE EXCEPTION 'Search deployment unavailable' USING ERRCODE='55000'; END IF;
    IF v_query ~* '^(#|artwork[: ]+)?[1-9][0-9]{0,77}$' THEN
        v_id := regexp_replace(v_query,'^(#|artwork[: ]+)','','i')::NUMERIC;
        IF v_id >= 115792089237316195423570985008687907853269984665640564039457584007913129639936 THEN
            RAISE EXCEPTION 'Invalid artwork identifier' USING ERRCODE='22023';
        END IF;
    ELSIF v_query ~* '^0x[0-9a-f]{40}$' THEN v_address := lower(v_query);
    ELSE
        IF char_length(v_query)<2 THEN RAISE EXCEPTION 'Enter at least two characters' USING ERRCODE='22023'; END IF;
        SELECT string_agg(quote_literal(t.lexeme) || ':*',' & ')::TSQUERY INTO v_terms
            FROM unnest(to_tsvector('simple',v_query)) t;
        IF v_terms IS NULL THEN RETURN; END IF;
    END IF;
    IF p_before IS NOT NULL AND ((p_category='artists' AND p_before !~ '^0x[0-9a-f]{40}$') OR
       (p_category<>'artists' AND (p_before !~ '^[1-9][0-9]{0,77}$' OR
         p_before::NUMERIC >= 115792089237316195423570985008687907853269984665640564039457584007913129639936))) THEN
        RAISE EXCEPTION 'Invalid search cursor' USING ERRCODE='22023';
    END IF;

    IF p_category='artists' THEN
        IF v_id IS NOT NULL THEN RETURN; END IF;
        RETURN QUERY WITH matching AS (
            SELECT lower(p.wallet_address) AS wallet FROM public.public_profile_content p WHERE v_terms IS NOT NULL AND
                to_tsvector('simple',coalesce(p.username,'') || ' ' ||
                    CASE WHEN nullif(btrim(p.twitter_id),'') IS NOT NULL THEN coalesce(p.twitter_username,'') ELSE '' END || ' ' ||
                    CASE WHEN nullif(btrim(p.discord_id),'') IS NOT NULL THEN coalesce(p.discord_username,'') ELSE '' END) @@ v_terms
            UNION SELECT v_address WHERE v_address IS NOT NULL
        ) SELECT m.wallet FROM matching m WHERE (p_before IS NULL OR m.wallet<p_before) AND EXISTS (
            SELECT 1 FROM public.v41_artworks a WHERE a.chain_id=84532 AND lower(a.creator)=m.wallet
                AND a.block_number<=v_confirmed AND NOT EXISTS (
                    SELECT 1 FROM public.artwork_moderation_visibility h WHERE h.chain_id=a.chain_id AND h.artwork_id=a.artwork_id AND h.hidden
                )
        ) ORDER BY m.wallet DESC LIMIT p_limit;
        RETURN;
    END IF;

    RETURN QUERY WITH matching_creators AS (
        SELECT lower(p.wallet_address) AS wallet FROM public.public_profile_content p WHERE v_terms IS NOT NULL AND
            to_tsvector('simple',coalesce(p.username,'') || ' ' ||
                CASE WHEN nullif(btrim(p.twitter_id),'') IS NOT NULL THEN coalesce(p.twitter_username,'') ELSE '' END || ' ' ||
                CASE WHEN nullif(btrim(p.discord_id),'') IS NOT NULL THEN coalesce(p.discord_username,'') ELSE '' END) @@ v_terms
        UNION SELECT v_address WHERE v_address IS NOT NULL
    ), matches AS (
        SELECT d.artwork_id FROM public.artwork_search_metadata d WHERE d.chain_id=84532 AND v_terms IS NOT NULL AND d.terms @@ v_terms
        UNION SELECT a.artwork_id FROM public.v41_artworks a JOIN matching_creators c ON lower(a.creator)=c.wallet WHERE a.chain_id=84532
        UNION SELECT v_id WHERE v_id IS NOT NULL
    ) SELECT a.artwork_id::TEXT FROM matches m JOIN public.v41_artworks a ON a.chain_id=84532 AND a.artwork_id=m.artwork_id
        WHERE a.block_number<=v_confirmed AND (p_before IS NULL OR a.artwork_id<p_before::NUMERIC)
          AND NOT EXISTS (SELECT 1 FROM public.artwork_moderation_visibility h WHERE h.chain_id=a.chain_id AND h.artwork_id=a.artwork_id AND h.hidden)
          AND (p_category='artworks' OR (
              SELECT u.status='active' AND u.end_time>statement_timestamp()
              FROM public.v41_auctions u WHERE u.chain_id=a.chain_id AND u.artwork_id=a.artwork_id
              ORDER BY u.auction_id DESC LIMIT 1
          ))
        ORDER BY a.artwork_id DESC LIMIT p_limit;
END;
$$;
REVOKE ALL ON FUNCTION public.search_public_artworks(TEXT,TEXT,TEXT,TEXT,INTEGER) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_public_artworks(TEXT,TEXT,TEXT,TEXT,INTEGER) TO service_role;
COMMIT;
