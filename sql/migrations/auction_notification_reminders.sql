-- Current private reminders, materialized only when their recipient opens the inbox.
-- Requires auction_notification_lifecycle. Existing v1/v2 functions stay unchanged.
BEGIN;
ALTER TABLE public.auction_notification_preferences ADD COLUMN IF NOT EXISTS reminders BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.auction_notification_preferences ADD COLUMN IF NOT EXISTS reminder_minutes INTEGER[] NOT NULL DEFAULT ARRAY[60];

CREATE OR REPLACE FUNCTION public.valid_auction_reminder_minutes(p_minutes INTEGER[])
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
  SELECT p_minutes IS NOT NULL AND cardinality(p_minutes) BETWEEN 1 AND 3 AND array_ndims(p_minutes)=1
    AND array_lower(p_minutes,1)=1 AND NOT EXISTS (SELECT 1 FROM unnest(p_minutes) m WHERE m IS NULL OR m NOT BETWEEN 1 AND 1440)
    AND (SELECT count(DISTINCT m) FROM unnest(p_minutes) m)=cardinality(p_minutes)
    AND p_minutes=ARRAY(SELECT m FROM unnest(p_minutes) m ORDER BY m);
$$;
REVOKE ALL ON FUNCTION public.valid_auction_reminder_minutes(INTEGER[]) FROM PUBLIC,anon,authenticated,service_role;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.auction_notification_preferences'::regclass AND conname='auction_notification_reminder_minutes_valid') THEN
    ALTER TABLE public.auction_notification_preferences ADD CONSTRAINT auction_notification_reminder_minutes_valid CHECK(public.valid_auction_reminder_minutes(reminder_minutes));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS contract_events_reminder_artwork ON public.contract_events(chain_id,(event_data->>'artworkId'),block_number DESC,log_index DESC)
  WHERE event_name='AuctionCreated';
CREATE INDEX IF NOT EXISTS contract_events_reminder_state ON public.contract_events(chain_id,(event_data->>'auctionId'),block_number DESC,log_index DESC)
  WHERE event_name IN ('AuctionCreated','AuctionExtended','AuctionEnded','SettlementCompleted','SettlementDefaulted','BidPlaced');
CREATE INDEX IF NOT EXISTS contract_events_reminder_wallet ON public.contract_events(chain_id,
  lower(CASE event_name WHEN 'AuctionCreated' THEN event_data->>'creator' WHEN 'BidPlaced' THEN event_data->>'bidder' WHEN 'AuctionEnded' THEN event_data->>'winner' END))
  WHERE event_name IN ('AuctionCreated','BidPlaced','AuctionEnded');

CREATE OR REPLACE FUNCTION public.auction_reminders_available(p_core TEXT,p_now TIMESTAMPTZ)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  -- Reuse the public indexer-status healthy limit (120 seconds), including the
  -- actual confirmed/indexed boundary block so a fresh heartbeat cannot mask lag.
  SELECT EXISTS (SELECT 1 FROM public.indexer_state s JOIN public.block_hashes b
    ON b.chain_id=s.chain_id AND b.block_number=LEAST(s.last_confirmed_block,s.last_indexed_block)
    WHERE s.chain_id=84532 AND lower(s.contract_address)=p_core AND s.status='running'
      AND s.last_indexed_at>=p_now-INTERVAL '120 seconds'
      AND b.timestamp BETWEEN extract(epoch FROM p_now)-120 AND extract(epoch FROM p_now));
$$;
REVOKE ALL ON FUNCTION public.auction_reminders_available(TEXT,TIMESTAMPTZ) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.proven_auction_reminder_event(p_id BIGINT,p_core TEXT,p_block BIGINT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT EXISTS (SELECT 1 FROM public.contract_events e
    JOIN public.event_processing_registry r ON r.chain_id=e.chain_id AND r.transaction_hash=e.transaction_hash
      AND r.log_index=e.log_index AND r.block_number=e.block_number AND r.event_name=e.event_name AND r.processing_status='completed'
    JOIN public.block_hashes b ON b.chain_id=e.chain_id AND b.block_number=e.block_number
    WHERE e.id=p_id AND e.chain_id=84532 AND e.contract_address=p_core AND e.block_number<=p_block);
$$;
REVOKE ALL ON FUNCTION public.proven_auction_reminder_event(BIGINT,TEXT,BIGINT) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.auction_reminder_candidates(p_wallet TEXT,p_core TEXT,p_minutes INTEGER[],p_now TIMESTAMPTZ)
RETURNS TABLE(notification_type TEXT,artwork_id TEXT,auction_id TEXT,transaction_hash TEXT,artwork_available BOOLEAN,
  deadline TEXT,offset_minutes INTEGER,correlation_id TEXT,idempotency_key TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  WITH watermark AS (
    SELECT LEAST(s.last_confirmed_block,s.last_indexed_block) AS height FROM public.indexer_state s
    WHERE s.chain_id=84532 AND lower(s.contract_address)=p_core AND public.auction_reminders_available(p_core,p_now)
      AND p_wallet ~ '^0x[0-9a-f]{40}$' AND p_wallet<>'0x0000000000000000000000000000000000000000'
      AND public.valid_auction_reminder_minutes(p_minutes)
  ), related_artworks AS (
    SELECT DISTINCT c.event_data->>'artworkId' AS artwork_id FROM public.contract_events e
    JOIN LATERAL (SELECT ce.event_data FROM public.contract_events ce WHERE ce.chain_id=e.chain_id AND ce.event_name='AuctionCreated'
      AND ce.event_data->>'auctionId'=e.event_data->>'auctionId' AND (ce.block_number,ce.log_index)<=(e.block_number,e.log_index)
      ORDER BY ce.block_number DESC,ce.log_index DESC LIMIT 1) c ON true
    WHERE e.chain_id=84532 AND e.event_name IN ('AuctionCreated','BidPlaced','AuctionEnded')
      AND lower(CASE e.event_name WHEN 'AuctionCreated' THEN e.event_data->>'creator' WHEN 'BidPlaced' THEN e.event_data->>'bidder' WHEN 'AuctionEnded' THEN e.event_data->>'winner' END)=p_wallet
  ), current_rounds AS (
    -- Select the latest row before validating it. An unknown/newer round must
    -- suppress the older round rather than silently reviving its deadline.
    SELECT c.*,w.height FROM related_artworks a CROSS JOIN watermark w
    JOIN LATERAL (SELECT ce.* FROM public.contract_events ce WHERE ce.chain_id=84532 AND ce.event_name='AuctionCreated'
      AND ce.event_data->>'artworkId'=a.artwork_id ORDER BY ce.block_number DESC,ce.log_index DESC LIMIT 1) c ON true
    WHERE public.proven_auction_reminder_event(c.id,p_core,w.height)
      AND c.event_data->>'artworkId' ~ '^[1-9][0-9]{0,77}$' AND c.event_data->>'auctionId' ~ '^[1-9][0-9]{0,77}$'
  ), state AS (
    SELECT c.*,x.id AS extension_id,x.event_data AS extension_data,x.transaction_hash AS extension_tx,
      ending.id AS ending_id,ending.event_data AS ending_data,ending.transaction_hash AS ending_tx
    FROM current_rounds c
    LEFT JOIN LATERAL (SELECT e.* FROM public.contract_events e WHERE e.chain_id=84532 AND e.event_name='AuctionExtended'
      AND e.event_data->>'auctionId'=c.event_data->>'auctionId' AND (e.block_number,e.log_index)>(c.block_number,c.log_index)
      ORDER BY e.block_number DESC,e.log_index DESC LIMIT 1) x ON true
    LEFT JOIN LATERAL (SELECT e.* FROM public.contract_events e WHERE e.chain_id=84532 AND e.event_name='AuctionEnded'
      AND e.event_data->>'auctionId'=c.event_data->>'auctionId' AND (e.block_number,e.log_index)>(c.block_number,c.log_index)
      ORDER BY e.block_number DESC,e.log_index DESC LIMIT 1) ending ON true
    WHERE (x.id IS NULL OR public.proven_auction_reminder_event(x.id,p_core,c.height))
      AND (ending.id IS NULL OR public.proven_auction_reminder_event(ending.id,p_core,c.height))
      AND NOT EXISTS (SELECT 1 FROM public.contract_events terminal WHERE terminal.chain_id=84532
        AND terminal.event_name IN ('SettlementCompleted','SettlementDefaulted') AND terminal.event_data->>'auctionId'=c.event_data->>'auctionId'
        AND (terminal.block_number,terminal.log_index)>(c.block_number,c.log_index))
  ), eligible AS (
    SELECT CASE WHEN s.ending_id IS NULL THEN 'auction_ending' ELSE 'payment_due' END AS kind,
      s.event_data->>'artworkId' AS artwork,s.event_data->>'auctionId' AS auction,
      CASE WHEN s.ending_id IS NOT NULL THEN s.ending_tx ELSE coalesce(s.extension_tx,s.transaction_hash) END::TEXT AS source_tx,
      CASE WHEN s.ending_id IS NOT NULL THEN s.ending_data->>'settlementDeadline'
        WHEN s.extension_id IS NOT NULL THEN s.extension_data->>'newEndTime' ELSE s.event_data->>'endTime' END AS due,
      '84532-'||s.transaction_hash||'-'||s.log_index::TEXT AS correlation,
      EXISTS (SELECT 1 FROM public.v41_artworks a WHERE a.chain_id=84532 AND a.artwork_id::TEXT=s.event_data->>'artworkId'
        AND a.block_number<=s.height AND NOT EXISTS (SELECT 1 FROM public.artwork_moderation_visibility h
          WHERE h.chain_id=a.chain_id AND h.artwork_id=a.artwork_id AND h.hidden)) AS available
    FROM state s WHERE
      (s.ending_id IS NULL AND (lower(s.event_data->>'creator')=p_wallet OR EXISTS (
        SELECT 1 FROM public.contract_events bid WHERE bid.chain_id=84532 AND bid.event_name='BidPlaced'
          AND bid.event_data->>'auctionId'=s.event_data->>'auctionId' AND lower(bid.event_data->>'bidder')=p_wallet
          AND (bid.block_number,bid.log_index)>(s.block_number,s.log_index)
          AND public.proven_auction_reminder_event(bid.id,p_core,s.height))))
      OR (s.ending_id IS NOT NULL AND lower(s.ending_data->>'winner')=p_wallet)
  ), deadlines AS (
    SELECT e.*,CASE WHEN due ~ '^[1-9][0-9]{0,77}$' THEN due::NUMERIC END AS due_epoch FROM eligible e
  )
  SELECT d.kind,d.artwork,d.auction,d.source_tx,d.available,d.due,offsets.minutes,d.correlation,
    'reminder-v3-'||encode(sha256(convert_to('84532|'||p_core||'|'||d.auction||'|'||d.kind||'|'||p_wallet||'|'||offsets.minutes::TEXT,'UTF8')),'hex')
  FROM deadlines d CROSS JOIN LATERAL (SELECT min(m) AS minutes FROM unnest(p_minutes) m
    WHERE d.due_epoch-extract(epoch FROM p_now)<=m*60) offsets
  WHERE d.due_epoch>extract(epoch FROM p_now) AND offsets.minutes IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.auction_reminder_candidates(TEXT,TEXT,INTEGER[],TIMESTAMPTZ) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.canonical_auction_reminders(p_wallet TEXT,p_core TEXT,p_minutes INTEGER[],p_now TIMESTAMPTZ,p_ids BIGINT[] DEFAULT NULL)
RETURNS TABLE(id BIGINT,notification_type TEXT,created_at TIMESTAMPTZ,artwork_id TEXT,auction_id TEXT,transaction_hash TEXT,
  artwork_available BOOLEAN,deadline TEXT,offset_minutes INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT o.id,c.notification_type,o.created_at,c.artwork_id,c.auction_id,c.transaction_hash,c.artwork_available,c.deadline,c.offset_minutes
  FROM public.auction_reminder_candidates(p_wallet,p_core,p_minutes,p_now) c JOIN public.outbox_events o
    ON o.idempotency_key=c.idempotency_key AND o.correlation_id=c.correlation_id AND o.event_type='notification'
      AND o.aggregate_type='auction' AND o.aggregate_id=c.auction_id
      AND o.payload->>'type'=c.notification_type AND o.payload->>'recipient'=p_wallet AND o.payload->>'coreAddress'=p_core
      AND o.payload->>'artworkId'=c.artwork_id AND o.payload->>'auctionId'=c.auction_id
      AND o.payload->>'offsetMinutes'=c.offset_minutes::TEXT
  WHERE p_ids IS NULL OR o.id=ANY(p_ids);
$$;
REVOKE ALL ON FUNCTION public.canonical_auction_reminders(TEXT,TEXT,INTEGER[],TIMESTAMPTZ,BIGINT[]) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.read_auction_notifications_v3(p_wallet TEXT,p_core TEXT,p_before BIGINT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE prefs public.auction_notification_preferences%ROWTYPE; history JSONB; reminders JSONB; chain_revision TEXT;
  task_now TIMESTAMPTZ:=statement_timestamp(); available BOOLEAN; capped BOOLEAN; minutes INTEGER[];
BEGIN
  IF p_wallet IS NULL OR p_wallet !~ '^0x[0-9a-f]{40}$' OR p_wallet='0x0000000000000000000000000000000000000000'
    OR p_core IS NULL OR p_core !~ '^0x[0-9a-f]{40}$' OR p_core='0x0000000000000000000000000000000000000000' OR p_before<=0
  THEN RAISE EXCEPTION 'Invalid notification request' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.indexer_state s WHERE s.chain_id=84532 AND lower(s.contract_address)=p_core) THEN
    RAISE EXCEPTION 'Notification deployment unavailable' USING ERRCODE='55000'; END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Notification isolation unavailable' USING ERRCODE='55000'; END IF;
  SELECT revision::TEXT INTO chain_revision FROM public.artwork_media_chain_revisions WHERE chain_id=84532 FOR SHARE;
  IF chain_revision IS NULL THEN RAISE EXCEPTION 'Notification revision unavailable' USING ERRCODE='55000'; END IF;
  SELECT * INTO prefs FROM public.auction_notification_preferences WHERE wallet_address=p_wallet AND core_address=p_core;
  minutes:=coalesce(prefs.reminder_minutes,ARRAY[60]);
  available:=public.auction_reminders_available(p_core,task_now);
  IF p_before IS NULL AND available AND coalesce(prefs.reminders,true) THEN
    INSERT INTO public.outbox_events(aggregate_type,aggregate_id,event_type,payload,correlation_id,idempotency_key,processing_status)
      SELECT 'auction',c.auction_id,'notification',jsonb_build_object('type',c.notification_type,'recipient',p_wallet,'coreAddress',p_core,
        'artworkId',c.artwork_id,'auctionId',c.auction_id,'offsetMinutes',c.offset_minutes),c.correlation_id,c.idempotency_key,'completed'
      FROM public.auction_reminder_candidates(p_wallet,p_core,minutes,task_now) c
      ORDER BY c.deadline::NUMERIC,c.auction_id::NUMERIC,c.notification_type LIMIT 21
      ON CONFLICT(idempotency_key) DO NOTHING;
  END IF;
  -- Read preferences once for the entire response: a concurrent CAS must not
  -- mix newer history preferences/revision with older reminder settings.
  SELECT jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(page)-'sort_id' ORDER BY page.sort_id DESC),'[]'::JSONB),
    'preferencesRevision',coalesce(prefs.revision,0),'preferences',jsonb_build_object('auction_created',coalesce(prefs.auction_created,true),
      'outbid',coalesce(prefs.outbid,true),'lifecycle',coalesce(prefs.lifecycle,true))) INTO history FROM (
    SELECT n.id AS sort_id,n.id::TEXT AS id,n.notification_type AS type,n.created_at,n.artwork_id,n.auction_id,n.transaction_hash,
      n.artwork_available AS "artworkAvailable",coalesce(r.read,false) AS read,n.token_id,n.amount_wei,n.settlement_deadline
    FROM public.canonical_auction_notifications_v2(p_wallet,p_core,p_before,NULL,coalesce(prefs.auction_created,true),coalesce(prefs.outbid,true),coalesce(prefs.lifecycle,true)) n
    LEFT JOIN public.auction_notification_reads r ON r.wallet_address=p_wallet AND r.core_address=p_core AND r.outbox_id=n.id
    ORDER BY n.id DESC LIMIT 21
  ) page;
  SELECT coalesce(jsonb_agg(to_jsonb(page)-'position' ORDER BY page.position) FILTER(WHERE position<=20),'[]'::JSONB),coalesce(max(position)>20,false)
    INTO reminders,capped FROM (
      SELECT row_number() OVER(ORDER BY n.deadline::NUMERIC,n.auction_id::NUMERIC,n.notification_type) AS position,
        n.id::TEXT AS id,n.notification_type AS type,n.created_at,n.artwork_id,n.auction_id,n.transaction_hash,
        coalesce(r.read,false) AS read,n.artwork_available AS "artworkAvailable",n.deadline,n.offset_minutes
      FROM public.canonical_auction_reminders(p_wallet,p_core,minutes,task_now) n
      LEFT JOIN public.auction_notification_reads r ON r.wallet_address=p_wallet AND r.core_address=p_core AND r.outbox_id=n.id
      WHERE available AND coalesce(prefs.reminders,true)
      ORDER BY n.deadline::NUMERIC,n.auction_id::NUMERIC,n.notification_type LIMIT 21
    ) page;
  RETURN history||jsonb_build_object('reminders',reminders,'remindersCapped',capped,'remindersAvailable',available,'serverTime',task_now,
    'reminderMinutes',to_jsonb(minutes),'chainRevision',chain_revision,
    'preferences',(history->'preferences')||jsonb_build_object('reminders',coalesce(prefs.reminders,true)));
END;
$$;
REVOKE ALL ON FUNCTION public.read_auction_notifications_v3(TEXT,TEXT,BIGINT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_auction_notifications_v3(TEXT,TEXT,BIGINT) TO service_role;

CREATE OR REPLACE FUNCTION public.mark_auction_notifications_v3(p_wallet TEXT,p_core TEXT,p_ids BIGINT[],p_read BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE matched BIGINT[]; prefs public.auction_notification_preferences%ROWTYPE; revision TEXT;
BEGIN
  IF p_wallet IS NULL OR p_wallet !~ '^0x[0-9a-f]{40}$' OR p_wallet='0x0000000000000000000000000000000000000000'
    OR p_core IS NULL OR p_core !~ '^0x[0-9a-f]{40}$' OR p_core='0x0000000000000000000000000000000000000000'
    OR p_ids IS NULL OR cardinality(p_ids) NOT BETWEEN 1 AND 20 OR p_read IS NULL
    OR EXISTS (SELECT 1 FROM unnest(p_ids) x WHERE x IS NULL OR x<=0)
    OR (SELECT count(DISTINCT x) FROM unnest(p_ids) x)<>cardinality(p_ids)
  THEN RAISE EXCEPTION 'Invalid notification update' USING ERRCODE='22023'; END IF;
  SELECT r.revision::TEXT INTO revision FROM public.artwork_media_chain_revisions r WHERE chain_id=84532 FOR SHARE;
  IF revision IS NULL THEN RAISE EXCEPTION 'Notification revision unavailable' USING ERRCODE='55000'; END IF;
  SELECT * INTO prefs FROM public.auction_notification_preferences WHERE wallet_address=p_wallet AND core_address=p_core;
  SELECT array_agg(n.id ORDER BY n.id) INTO matched FROM (
    SELECT id FROM public.canonical_auction_notifications_v2(p_wallet,p_core,NULL,p_ids)
    UNION ALL SELECT id FROM public.canonical_auction_reminders(p_wallet,p_core,coalesce(prefs.reminder_minutes,ARRAY[60]),statement_timestamp(),p_ids)
      WHERE coalesce(prefs.reminders,true)
  ) n;
  IF coalesce(cardinality(matched),0)<>cardinality(p_ids) THEN RETURN jsonb_build_object('updated',false); END IF;
  INSERT INTO public.auction_notification_reads(wallet_address,core_address,outbox_id,read)
    SELECT p_wallet,p_core,x,p_read FROM unnest(matched) x
    ON CONFLICT(wallet_address,core_address,outbox_id) DO UPDATE SET read=EXCLUDED.read,updated_at=now();
  RETURN jsonb_build_object('updated',true,'ids',to_jsonb(matched::TEXT[]),'read',p_read);
END;
$$;
REVOKE ALL ON FUNCTION public.mark_auction_notifications_v3(TEXT,TEXT,BIGINT[],BOOLEAN) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.mark_auction_notifications_v3(TEXT,TEXT,BIGINT[],BOOLEAN) TO service_role;

CREATE OR REPLACE FUNCTION public.save_auction_notification_preferences_v3(p_wallet TEXT,p_core TEXT,p_revision INTEGER,p_created BOOLEAN,p_outbid BOOLEAN,p_lifecycle BOOLEAN,p_reminders BOOLEAN,p_minutes INTEGER[])
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE saved public.auction_notification_preferences%ROWTYPE; minutes INTEGER[];
BEGIN
  minutes:=ARRAY(SELECT m FROM unnest(p_minutes) m ORDER BY m);
  IF p_wallet IS NULL OR p_wallet !~ '^0x[0-9a-f]{40}$' OR p_wallet='0x0000000000000000000000000000000000000000'
    OR p_core IS NULL OR p_core !~ '^0x[0-9a-f]{40}$' OR p_core='0x0000000000000000000000000000000000000000'
    OR p_revision IS NULL OR p_revision<0 OR p_revision>=2147483647 OR p_created IS NULL OR p_outbid IS NULL OR p_lifecycle IS NULL OR p_reminders IS NULL
    OR p_minutes IS NULL OR array_ndims(p_minutes)<>1 OR NOT public.valid_auction_reminder_minutes(minutes)
  THEN RAISE EXCEPTION 'Invalid notification preferences' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.indexer_state s WHERE s.chain_id=84532 AND lower(s.contract_address)=p_core) THEN
    RAISE EXCEPTION 'Notification deployment unavailable' USING ERRCODE='55000'; END IF;
  IF p_revision=0 THEN
    INSERT INTO public.auction_notification_preferences(wallet_address,core_address,auction_created,outbid,lifecycle,reminders,reminder_minutes,revision)
      VALUES(p_wallet,p_core,p_created,p_outbid,p_lifecycle,p_reminders,minutes,1) ON CONFLICT(wallet_address,core_address) DO NOTHING RETURNING * INTO saved;
  ELSE
    UPDATE public.auction_notification_preferences SET auction_created=p_created,outbid=p_outbid,lifecycle=p_lifecycle,reminders=p_reminders,
      reminder_minutes=minutes,revision=auction_notification_preferences.revision+1,updated_at=now()
      WHERE wallet_address=p_wallet AND core_address=p_core AND auction_notification_preferences.revision=p_revision RETURNING * INTO saved;
  END IF;
  IF saved.wallet_address IS NULL THEN RETURN jsonb_build_object('saved',false); END IF;
  RETURN jsonb_build_object('saved',true,'preferences',jsonb_build_object('auction_created',saved.auction_created,'outbid',saved.outbid,
    'lifecycle',saved.lifecycle,'reminders',saved.reminders),'reminderMinutes',to_jsonb(saved.reminder_minutes),'preferencesRevision',saved.revision);
END;
$$;
REVOKE ALL ON FUNCTION public.save_auction_notification_preferences_v3(TEXT,TEXT,INTEGER,BOOLEAN,BOOLEAN,BOOLEAN,BOOLEAN,INTEGER[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_auction_notification_preferences_v3(TEXT,TEXT,INTEGER,BOOLEAN,BOOLEAN,BOOLEAN,BOOLEAN,INTEGER[]) TO service_role;
COMMIT;
