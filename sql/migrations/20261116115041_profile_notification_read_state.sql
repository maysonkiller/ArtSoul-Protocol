-- B20: profile owner notices participate in the existing private inbox operations.
-- Requires profile_content_moderation.sql and the current notification migrations.
-- Preserve function identity, owner and ACL; change only the three type allowlists.
BEGIN;
DO $$ BEGIN
  PERFORM 'public.read_notification_summary(text,text,boolean,boolean,boolean)'::regprocedure;
  PERFORM 'public.mark_personal_moderation_notifications(text,bigint[],boolean)'::regprocedure;
  PERFORM 'public.remove_personal_moderation_notifications(text,bigint[])'::regprocedure;
END $$;

CREATE OR REPLACE FUNCTION public.read_notification_summary(p_wallet TEXT,p_core TEXT,p_auctions BOOLEAN,p_lifecycle BOOLEAN,p_reminders BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE prefs public.auction_notification_preferences%ROWTYPE; chain_revision TEXT;
  task_now TIMESTAMPTZ:=statement_timestamp(); auction_count INTEGER:=0; moderation_count INTEGER:=0; reminder_count INTEGER:=0;
  reminders_available BOOLEAN:=true; next_deadline TEXT;
BEGIN
  IF p_wallet IS NULL OR p_wallet !~ '^0x[0-9a-f]{40}$' OR p_wallet='0x0000000000000000000000000000000000000000'
    OR p_auctions IS NULL OR p_lifecycle IS NULL OR p_reminders IS NULL OR (p_lifecycle AND NOT p_auctions) OR (p_reminders AND NOT p_lifecycle)
    OR (p_auctions AND (p_core IS NULL OR p_core !~ '^0x[0-9a-f]{40}$' OR p_core='0x0000000000000000000000000000000000000000'))
  THEN RAISE EXCEPTION 'Invalid notification summary request' USING ERRCODE='22023'; END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Notification isolation unavailable' USING ERRCODE='55000'; END IF;
  IF p_auctions THEN
    IF NOT EXISTS (SELECT 1 FROM public.indexer_state s WHERE s.chain_id=84532 AND lower(s.contract_address)=p_core) THEN
      RAISE EXCEPTION 'Notification deployment unavailable' USING ERRCODE='55000'; END IF;
    SELECT revision::TEXT INTO chain_revision FROM public.artwork_media_chain_revisions WHERE chain_id=84532 FOR SHARE;
    IF chain_revision IS NULL THEN RAISE EXCEPTION 'Notification revision unavailable' USING ERRCODE='55000'; END IF;
    SELECT * INTO prefs FROM public.auction_notification_preferences WHERE wallet_address=p_wallet AND core_address=p_core;
    -- Apply unread/preferences before any bound. Singleton proof calls preserve
    -- the canonical source/recipient rules without the history page's 21-row cap.
    SELECT count(*)::INTEGER INTO auction_count FROM (
      SELECT o.id FROM public.outbox_events o
      WHERE o.event_type='notification' AND lower(o.payload->>'recipient')=p_wallet
        AND ((o.payload->>'type'='auction_created' AND coalesce(prefs.auction_created,true))
          OR (o.payload->>'type'='outbid' AND coalesce(prefs.outbid,true))
          OR (p_lifecycle AND coalesce(prefs.lifecycle,true) AND o.payload->>'type' IN
            ('bid_received','auction_won','auction_ended','purchase_completed','sale_completed','payment_missed','sale_unpaid','resale_purchased','resale_sold')))
        AND NOT EXISTS (SELECT 1 FROM public.auction_notification_reads r
          WHERE r.wallet_address=p_wallet AND r.core_address=p_core AND r.outbox_id=o.id AND (r.read OR r.dismissed_at IS NOT NULL))
        AND EXISTS (SELECT 1 FROM public.canonical_auction_notifications_v2(p_wallet,p_core,NULL,ARRAY[o.id],
          coalesce(prefs.auction_created,true),coalesce(prefs.outbid,true),p_lifecycle AND coalesce(prefs.lifecycle,true)) n WHERE n.id=o.id)
      LIMIT 100
    ) unread;
    IF p_reminders AND coalesce(prefs.reminders,true) THEN
      reminders_available:=public.auction_reminders_available(p_core,task_now);
      IF reminders_available THEN
        SELECT count(*)::INTEGER,min(deadline::NUMERIC)::TEXT INTO reminder_count,next_deadline FROM (
          SELECT c.deadline FROM public.auction_reminder_candidates(p_wallet,p_core,coalesce(prefs.reminder_minutes,ARRAY[60]),task_now) c
          LEFT JOIN LATERAL (SELECT artsoul_private.notification_source_identity('auction',c.auction_id,
            jsonb_build_object('type',c.notification_type,'recipient',p_wallet,'coreAddress',p_core,
              'artworkId',c.artwork_id,'auctionId',c.auction_id,'offsetMinutes',c.offset_minutes),c.correlation_id,true) AS value) source ON true
          LEFT JOIN artsoul_private.notification_reorg_identities retained
            ON retained.identity_key=encode(sha256(convert_to(source.value::TEXT,'UTF8')),'hex')
              AND retained.source_identity=source.value
          LEFT JOIN public.outbox_events o ON o.idempotency_key=c.idempotency_key
          LEFT JOIN public.auction_notification_reads r ON r.wallet_address=p_wallet AND r.core_address=p_core
            AND r.outbox_id=coalesce(retained.outbox_id,o.id)
          WHERE NOT coalesce(r.read,false) AND r.dismissed_at IS NULL AND (o.id IS NULL OR
            (o.correlation_id=c.correlation_id AND o.event_type='notification' AND o.aggregate_type='auction' AND o.aggregate_id=c.auction_id
              AND o.payload->>'type'=c.notification_type AND o.payload->>'recipient'=p_wallet AND o.payload->>'coreAddress'=p_core
              AND o.payload->>'artworkId'=c.artwork_id AND o.payload->>'auctionId'=c.auction_id AND o.payload->>'offsetMinutes'=c.offset_minutes::TEXT))
          ORDER BY c.deadline::NUMERIC,c.auction_id::NUMERIC,c.notification_type LIMIT 100
        ) unread;
      END IF;
    END IF;
  END IF;
  SELECT count(*)::INTEGER INTO moderation_count FROM (
    SELECT n.id FROM public.artwork_report_notifications n WHERE n.recipient_wallet=p_wallet AND n.read_at IS NULL AND n.dismissed_at IS NULL
      AND n.notification_type IN ('REPORT_ACTIONED','REPORT_DISMISSED','REPORT_RESOLVED','REPORT_REOPENED',
        'ARTWORK_HIDDEN','ARTWORK_RESTORED','DONATION_MESSAGE_HIDDEN','DONATION_MESSAGE_RESTORED',
        'PROFILE_CONTENT_HIDDEN','PROFILE_CONTENT_RESTORED') LIMIT 100
  ) unread;
  RETURN jsonb_build_object('auctionCount',auction_count,'moderationCount',moderation_count,'reminderCount',reminder_count,
    'remindersAvailable',reminders_available,'serverTime',task_now,'nextReminderDeadline',next_deadline,
    'chainRevision',chain_revision,'preferencesRevision',coalesce(prefs.revision,0));
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_personal_moderation_notifications(p_wallet TEXT,p_ids BIGINT[],p_read BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE matched BIGINT[];
BEGIN
  IF p_wallet IS NULL OR p_wallet !~ '^0x[0-9a-f]{40}$' OR p_wallet='0x0000000000000000000000000000000000000000'
    OR p_ids IS NULL OR cardinality(p_ids) NOT BETWEEN 1 AND 20 OR array_ndims(p_ids)<>1 OR array_lower(p_ids,1)<>1 OR p_read IS NULL
    OR EXISTS (SELECT 1 FROM unnest(p_ids) id WHERE id IS NULL OR id<=0)
    OR (SELECT count(DISTINCT id) FROM unnest(p_ids) id)<>cardinality(p_ids)
  THEN RAISE EXCEPTION 'Invalid personal notification update' USING ERRCODE='22023'; END IF;
  SELECT array_agg(id ORDER BY id) INTO matched FROM (
    SELECT n.id FROM public.artwork_report_notifications n WHERE n.id=ANY(p_ids) AND n.recipient_wallet=p_wallet
      AND n.notification_type IN ('REPORT_ACTIONED','REPORT_DISMISSED','REPORT_RESOLVED','REPORT_REOPENED',
        'ARTWORK_HIDDEN','ARTWORK_RESTORED','DONATION_MESSAGE_HIDDEN','DONATION_MESSAGE_RESTORED',
        'PROFILE_CONTENT_HIDDEN','PROFILE_CONTENT_RESTORED') ORDER BY n.id FOR UPDATE
  ) owned;
  IF coalesce(cardinality(matched),0)<>cardinality(p_ids) THEN RETURN jsonb_build_object('updated',false); END IF;
  UPDATE public.artwork_report_notifications SET read_at=CASE WHEN p_read THEN coalesce(read_at,statement_timestamp()) ELSE NULL END
    WHERE id=ANY(matched) AND recipient_wallet=p_wallet;
  RETURN jsonb_build_object('updated',true,'ids',to_jsonb(ARRAY(SELECT id::TEXT FROM unnest(matched) id)),'read',p_read);
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_personal_moderation_notifications(p_wallet TEXT,p_ids BIGINT[])
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE matched BIGINT[];
BEGIN
  IF p_wallet IS NULL OR p_wallet !~ '^0x[0-9a-f]{40}$' OR p_wallet='0x0000000000000000000000000000000000000000'
    OR p_ids IS NULL OR cardinality(p_ids) NOT BETWEEN 1 AND 20 OR array_ndims(p_ids)<>1 OR array_lower(p_ids,1)<>1
    OR EXISTS (SELECT 1 FROM unnest(p_ids) id WHERE id IS NULL OR id<=0)
    OR (SELECT count(DISTINCT id) FROM unnest(p_ids) id)<>cardinality(p_ids)
  THEN RAISE EXCEPTION 'Invalid personal notification removal' USING ERRCODE='22023'; END IF;
  SELECT array_agg(id ORDER BY id) INTO matched FROM (
    SELECT n.id FROM public.artwork_report_notifications n WHERE n.id=ANY(p_ids) AND n.recipient_wallet=p_wallet
      AND n.notification_type IN ('REPORT_ACTIONED','REPORT_DISMISSED','REPORT_RESOLVED','REPORT_REOPENED',
        'ARTWORK_HIDDEN','ARTWORK_RESTORED','DONATION_MESSAGE_HIDDEN','DONATION_MESSAGE_RESTORED',
        'PROFILE_CONTENT_HIDDEN','PROFILE_CONTENT_RESTORED') ORDER BY n.id FOR UPDATE
  ) owned;
  IF coalesce(cardinality(matched),0)<>cardinality(p_ids) THEN RETURN jsonb_build_object('removed',false); END IF;
  UPDATE public.artwork_report_notifications SET dismissed_at=statement_timestamp()
    WHERE id=ANY(matched) AND recipient_wallet=p_wallet AND dismissed_at IS NULL;
  RETURN jsonb_build_object('removed',true,'ids',to_jsonb(matched::TEXT[]));
END;
$$;
COMMIT;
