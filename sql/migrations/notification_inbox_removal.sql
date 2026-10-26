-- Recipient-owned inbox removal only. Never delete source events, complaints or audit rows.
-- Apply after notification_summary.sql and before deploying the removal API.
-- Existing v1/v2/v3 signatures remain compatible; dismissal precedes every page/count bound.
BEGIN;
ALTER TABLE public.auction_notification_reads ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;
ALTER TABLE public.artwork_report_notifications ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS artwork_report_notifications_visible_recipient
  ON public.artwork_report_notifications(recipient_wallet,id DESC) WHERE dismissed_at IS NULL;
CREATE INDEX IF NOT EXISTS artwork_report_notifications_visible_unread_recipient
  ON public.artwork_report_notifications(recipient_wallet,id) WHERE dismissed_at IS NULL AND read_at IS NULL;
REVOKE ALL ON public.auction_notification_reads FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.auction_notification_reads TO service_role;
REVOKE ALL ON public.artwork_report_notifications FROM PUBLIC,anon,authenticated;

-- Explicit-ID proof calls still verify the original recipient for mutation/replay.
-- Feed reads omit dismissed IDs before their internal 21-row bound.

CREATE OR REPLACE FUNCTION public.canonical_auction_notifications(p_wallet TEXT,p_core TEXT,p_before BIGINT DEFAULT NULL,p_ids BIGINT[] DEFAULT NULL,p_created BOOLEAN DEFAULT true,p_outbid BOOLEAN DEFAULT true)
RETURNS TABLE(id BIGINT,notification_type TEXT,created_at TIMESTAMPTZ,artwork_id TEXT,auction_id TEXT,transaction_hash TEXT,artwork_available BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
    SELECT o.id,o.payload->>'type',to_timestamp(b.timestamp),c.event_data->>'artworkId',e.event_data->>'auctionId',e.transaction_hash::TEXT,
        EXISTS (SELECT 1 FROM public.v41_artworks a WHERE a.chain_id=84532 AND a.artwork_id::TEXT=c.event_data->>'artworkId'
          AND a.block_number<=s.last_confirmed_block AND NOT EXISTS (SELECT 1 FROM public.artwork_moderation_visibility h
            WHERE h.chain_id=a.chain_id AND h.artwork_id=a.artwork_id AND h.hidden))
    FROM public.outbox_events o
    JOIN public.contract_events e ON e.chain_id=84532 AND e.contract_address=p_core
      AND o.correlation_id='84532-'||e.transaction_hash||'-'||e.log_index::TEXT
      AND o.idempotency_key=o.correlation_id||'-notification'
    JOIN public.indexer_state s ON s.chain_id=e.chain_id AND lower(s.contract_address)=p_core
      AND e.block_number<=LEAST(s.last_confirmed_block,s.last_indexed_block)
    JOIN public.event_processing_registry r ON r.chain_id=e.chain_id AND r.transaction_hash=e.transaction_hash
      AND r.log_index=e.log_index AND r.block_number=e.block_number AND r.event_name=e.event_name AND r.processing_status='completed'
    JOIN public.block_hashes b ON b.chain_id=e.chain_id AND b.block_number=e.block_number
    JOIN LATERAL (
      SELECT ce.* FROM public.contract_events ce WHERE ce.chain_id=e.chain_id
        AND ce.event_name='AuctionCreated' AND ce.event_data->>'auctionId'=e.event_data->>'auctionId'
        AND (ce.block_number,ce.log_index)<=(e.block_number,e.log_index)
      ORDER BY ce.block_number DESC,ce.log_index DESC LIMIT 1
    ) c ON c.contract_address=p_core
    LEFT JOIN LATERAL (
      SELECT pe.event_data->>'bidder' AS bidder,pe.contract_address FROM public.contract_events pe
      WHERE e.event_name='BidPlaced' AND pe.chain_id=e.chain_id
        AND pe.event_name='BidPlaced' AND pe.event_data->>'auctionId'=e.event_data->>'auctionId'
        AND (pe.block_number,pe.log_index)<(e.block_number,e.log_index)
      ORDER BY pe.block_number DESC,pe.log_index DESC LIMIT 1
    ) previous ON true
    WHERE o.event_type='notification' AND o.payload->>'type' IN ('auction_created','outbid')
      AND ((o.payload->>'type'='auction_created' AND p_created) OR (o.payload->>'type'='outbid' AND p_outbid))
      AND lower(o.payload->>'recipient')=p_wallet AND p_wallet ~ '^0x[0-9a-f]{40}$'
      AND p_wallet<>'0x0000000000000000000000000000000000000000'
      AND o.aggregate_id=e.event_data->>'auctionId' AND o.payload->>'auctionId'=e.event_data->>'auctionId'
      AND o.payload->>'artworkId'=c.event_data->>'artworkId'
      AND e.event_data->>'auctionId' ~ '^[1-9][0-9]{0,77}$' AND c.event_data->>'artworkId' ~ '^[1-9][0-9]{0,77}$'
      AND (p_ids IS NOT NULL OR NOT EXISTS (SELECT 1 FROM public.auction_notification_reads d
        WHERE d.wallet_address=p_wallet AND d.core_address=p_core AND d.outbox_id=o.id AND d.dismissed_at IS NOT NULL))
      AND (p_before IS NULL OR o.id<p_before) AND (p_ids IS NULL OR o.id=ANY(p_ids))
      AND ((o.payload->>'type'='auction_created' AND o.aggregate_type='auction' AND e.event_name='AuctionCreated'
          AND lower(e.event_data->>'creator')=p_wallet)
        OR (o.payload->>'type'='outbid' AND o.aggregate_type='bid' AND e.event_name='BidPlaced'
          AND previous.contract_address=p_core AND lower(previous.bidder)=p_wallet AND lower(e.event_data->>'bidder')<>p_wallet
          AND lower(o.payload->>'newBidder')=lower(e.event_data->>'bidder')))
    ORDER BY o.id DESC LIMIT 21;
$$;
REVOKE ALL ON FUNCTION public.canonical_auction_notifications(TEXT,TEXT,BIGINT,BIGINT[],BOOLEAN,BOOLEAN) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.canonical_auction_notifications_v2(p_wallet TEXT,p_core TEXT,p_before BIGINT DEFAULT NULL,p_ids BIGINT[] DEFAULT NULL,
  p_created BOOLEAN DEFAULT true,p_outbid BOOLEAN DEFAULT true,p_lifecycle BOOLEAN DEFAULT true)
RETURNS TABLE(id BIGINT,notification_type TEXT,created_at TIMESTAMPTZ,artwork_id TEXT,auction_id TEXT,transaction_hash TEXT,
  artwork_available BOOLEAN,token_id TEXT,amount_wei TEXT,settlement_deadline TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  WITH lifecycle AS (
    SELECT o.id,o.payload->>'type' AS notification_type,to_timestamp(b.timestamp) AS created_at,c.event_data->>'artworkId' AS artwork_id,
      CASE WHEN e.event_name<>'ResaleCompleted' THEN e.event_data->>'auctionId' END AS auction_id,e.transaction_hash::TEXT AS transaction_hash,
      EXISTS (SELECT 1 FROM public.v41_artworks a WHERE a.chain_id=e.chain_id AND a.artwork_id::TEXT=c.event_data->>'artworkId'
        AND a.block_number<=s.last_confirmed_block AND NOT EXISTS (SELECT 1 FROM public.artwork_moderation_visibility h
          WHERE h.chain_id=a.chain_id AND h.artwork_id=a.artwork_id AND h.hidden)) AS artwork_available,
      CASE WHEN e.event_name IN ('SettlementCompleted','ResaleCompleted') THEN e.event_data->>'tokenId' END AS token_id,
      CASE e.event_name WHEN 'BidPlaced' THEN e.event_data->>'bidAmount' WHEN 'AuctionEnded' THEN e.event_data->>'winningBid'
        WHEN 'SettlementCompleted' THEN e.event_data->>'finalPrice' WHEN 'ResaleCompleted' THEN e.event_data->>'price' END AS amount_wei,
      CASE WHEN o.payload->>'type'='auction_won' THEN e.event_data->>'settlementDeadline' END AS settlement_deadline
    FROM public.outbox_events o
    JOIN public.contract_events e ON e.chain_id=84532 AND e.contract_address=p_core
      AND o.correlation_id='84532-'||e.transaction_hash||'-'||e.log_index::TEXT
      AND o.idempotency_key='notification-v2-'||encode(sha256(convert_to(o.correlation_id||'-notification-'||(o.payload->>'type')||'-'||p_wallet,'UTF8')),'hex')
    JOIN public.indexer_state s ON s.chain_id=e.chain_id AND lower(s.contract_address)=p_core
      AND e.block_number<=LEAST(s.last_confirmed_block,s.last_indexed_block)
    JOIN public.event_processing_registry r ON r.chain_id=e.chain_id AND r.transaction_hash=e.transaction_hash
      AND r.log_index=e.log_index AND r.block_number=e.block_number AND r.event_name=e.event_name AND r.processing_status='completed'
    JOIN public.block_hashes b ON b.chain_id=e.chain_id AND b.block_number=e.block_number
    LEFT JOIN LATERAL (
      -- Do not skip an unknown/foreign original mint to infer identity from a later row.
      SELECT se.* FROM public.contract_events se WHERE e.event_name='ResaleCompleted' AND se.chain_id=e.chain_id
        AND se.event_name='SettlementCompleted' AND se.event_data->>'tokenId'=e.event_data->>'tokenId'
        AND (se.block_number,se.log_index)<(e.block_number,e.log_index)
      ORDER BY se.block_number,se.log_index LIMIT 1
    ) mint ON true
    JOIN LATERAL (
      SELECT ce.* FROM public.contract_events ce WHERE ce.chain_id=e.chain_id AND ce.event_name='AuctionCreated'
        AND ce.event_data->>'auctionId'=CASE WHEN e.event_name='ResaleCompleted' THEN mint.event_data->>'auctionId' ELSE e.event_data->>'auctionId' END
        AND (ce.block_number,ce.log_index)<CASE WHEN e.event_name='ResaleCompleted' THEN ROW(mint.block_number,mint.log_index) ELSE ROW(e.block_number,e.log_index) END
      ORDER BY ce.block_number DESC,ce.log_index DESC LIMIT 1
    ) c ON c.contract_address=p_core
    JOIN public.event_processing_registry cr ON cr.chain_id=c.chain_id AND cr.transaction_hash=c.transaction_hash
      AND cr.log_index=c.log_index AND cr.block_number=c.block_number AND cr.event_name=c.event_name AND cr.processing_status='completed'
    JOIN public.block_hashes cb ON cb.chain_id=c.chain_id AND cb.block_number=c.block_number
    WHERE p_lifecycle AND o.event_type='notification' AND o.payload->>'type' IN ('bid_received','auction_won','auction_ended',
      'purchase_completed','sale_completed','payment_missed','sale_unpaid','resale_purchased','resale_sold')
      AND lower(o.payload->>'recipient')=p_wallet AND p_wallet ~ '^0x[0-9a-f]{40}$'
      AND p_wallet<>'0x0000000000000000000000000000000000000000'
      AND (p_ids IS NOT NULL OR NOT EXISTS (SELECT 1 FROM public.auction_notification_reads d
        WHERE d.wallet_address=p_wallet AND d.core_address=p_core AND d.outbox_id=o.id AND d.dismissed_at IS NOT NULL))
      AND (p_before IS NULL OR o.id<p_before) AND (p_ids IS NULL OR o.id=ANY(p_ids))
      AND o.payload->>'artworkId'=c.event_data->>'artworkId' AND c.event_data->>'artworkId' ~ '^[1-9][0-9]{0,77}$'
      AND c.event_data->>'auctionId' ~ '^[1-9][0-9]{0,77}$'
      AND ((e.event_name<>'ResaleCompleted' AND o.aggregate_type='auction' AND o.aggregate_id=e.event_data->>'auctionId'
          AND o.payload->>'auctionId'=e.event_data->>'auctionId')
        OR (e.event_name='ResaleCompleted' AND o.aggregate_type='resale' AND o.aggregate_id=e.event_data->>'tokenId'
          AND o.payload->>'auctionId' IS NULL AND mint.contract_address=p_core
          AND mint.event_data->>'artworkId'=c.event_data->>'artworkId'
          AND mint.block_number<=LEAST(s.last_confirmed_block,s.last_indexed_block)
          AND EXISTS (SELECT 1 FROM public.event_processing_registry mr WHERE mr.chain_id=mint.chain_id
            AND mr.transaction_hash=mint.transaction_hash AND mr.log_index=mint.log_index AND mr.block_number=mint.block_number
            AND mr.event_name=mint.event_name AND mr.processing_status='completed')
          AND EXISTS (SELECT 1 FROM public.block_hashes mb WHERE mb.chain_id=mint.chain_id AND mb.block_number=mint.block_number)))
      AND (e.event_name NOT IN ('SettlementCompleted','ResaleCompleted') OR
        (e.event_data->>'tokenId' ~ '^(0|[1-9][0-9]{0,77})$' AND o.payload->>'tokenId'=e.event_data->>'tokenId'))
      AND (e.event_name<>'SettlementCompleted' OR e.event_data->>'artworkId'=c.event_data->>'artworkId')
      AND ((o.payload->>'type'='bid_received' AND e.event_name='BidPlaced' AND lower(c.event_data->>'creator')=p_wallet)
        OR (o.payload->>'type'='auction_won' AND e.event_name='AuctionEnded' AND lower(e.event_data->>'winner')=p_wallet
          AND e.event_data->>'settlementDeadline' ~ '^[1-9][0-9]{0,77}$')
        OR (o.payload->>'type'='auction_ended' AND e.event_name='AuctionEnded' AND lower(c.event_data->>'creator')=p_wallet
          AND e.event_data->>'winner'='0x0000000000000000000000000000000000000000'
          AND e.event_data->>'winningBid'='0' AND e.event_data->>'settlementDeadline'='0')
        OR (o.payload->>'type' IN ('purchase_completed','sale_completed') AND e.event_name='SettlementCompleted'
          AND lower(e.event_data->>'winner') ~ '^0x[0-9a-f]{40}$' AND lower(e.event_data->>'winner')<>'0x0000000000000000000000000000000000000000'
          AND CASE WHEN o.payload->>'type'='purchase_completed' THEN lower(e.event_data->>'winner') ELSE lower(c.event_data->>'creator') END=p_wallet)
        OR (o.payload->>'type' IN ('payment_missed','sale_unpaid') AND e.event_name='SettlementDefaulted'
          AND lower(e.event_data->>'winner') ~ '^0x[0-9a-f]{40}$' AND lower(e.event_data->>'winner')<>'0x0000000000000000000000000000000000000000'
          AND CASE WHEN o.payload->>'type'='payment_missed' THEN lower(e.event_data->>'winner') ELSE lower(c.event_data->>'creator') END=p_wallet)
        OR (o.payload->>'type' IN ('resale_purchased','resale_sold') AND e.event_name='ResaleCompleted'
          AND CASE WHEN o.payload->>'type'='resale_purchased' THEN lower(e.event_data->>'buyer') ELSE lower(e.event_data->>'seller') END=p_wallet))
  ), bounded_lifecycle AS (
    SELECT * FROM lifecycle WHERE (amount_wei IS NULL OR amount_wei ~ '^(0|[1-9][0-9]{0,77})$') ORDER BY id DESC LIMIT 21
  )
  SELECT * FROM (
    SELECT n.*,NULL::TEXT AS token_id,NULL::TEXT AS amount_wei,NULL::TEXT AS settlement_deadline
      FROM public.canonical_auction_notifications(p_wallet,p_core,p_before,p_ids,p_created,p_outbid) n
    UNION ALL SELECT * FROM bounded_lifecycle
  ) combined ORDER BY id DESC LIMIT 21;
$$;
REVOKE ALL ON FUNCTION public.canonical_auction_notifications_v2(TEXT,TEXT,BIGINT,BIGINT[],BOOLEAN,BOOLEAN,BOOLEAN) FROM PUBLIC,anon,authenticated,service_role;

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
  WHERE (p_ids IS NULL OR o.id=ANY(p_ids))
      AND (p_ids IS NOT NULL OR NOT EXISTS (SELECT 1 FROM public.auction_notification_reads d
        WHERE d.wallet_address=p_wallet AND d.core_address=p_core AND d.outbox_id=o.id AND d.dismissed_at IS NOT NULL));
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
      WHERE NOT EXISTS (SELECT 1 FROM public.outbox_events o JOIN public.auction_notification_reads d ON d.outbox_id=o.id
        WHERE o.idempotency_key=c.idempotency_key AND d.wallet_address=p_wallet AND d.core_address=p_core AND d.dismissed_at IS NOT NULL)
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
          LEFT JOIN public.outbox_events o ON o.idempotency_key=c.idempotency_key
          LEFT JOIN public.auction_notification_reads r ON r.wallet_address=p_wallet AND r.core_address=p_core AND r.outbox_id=o.id
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
        'ARTWORK_HIDDEN','ARTWORK_RESTORED','DONATION_MESSAGE_HIDDEN','DONATION_MESSAGE_RESTORED') LIMIT 100
  ) unread;
  RETURN jsonb_build_object('auctionCount',auction_count,'moderationCount',moderation_count,'reminderCount',reminder_count,
    'remindersAvailable',reminders_available,'serverTime',task_now,'nextReminderDeadline',next_deadline,
    'chainRevision',chain_revision,'preferencesRevision',coalesce(prefs.revision,0));
END;
$$;
REVOKE ALL ON FUNCTION public.read_notification_summary(TEXT,TEXT,BOOLEAN,BOOLEAN,BOOLEAN) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_notification_summary(TEXT,TEXT,BOOLEAN,BOOLEAN,BOOLEAN) TO service_role;

CREATE OR REPLACE FUNCTION public.remove_auction_notifications(p_wallet TEXT,p_core TEXT,p_ids BIGINT[])
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE matched BIGINT[]; prefs public.auction_notification_preferences%ROWTYPE; revision TEXT;
BEGIN
  IF p_wallet IS NULL OR p_wallet !~ '^0x[0-9a-f]{40}$' OR p_wallet='0x0000000000000000000000000000000000000000'
    OR p_core IS NULL OR p_core !~ '^0x[0-9a-f]{40}$' OR p_core='0x0000000000000000000000000000000000000000'
    OR p_ids IS NULL OR cardinality(p_ids) NOT BETWEEN 1 AND 20 OR array_ndims(p_ids)<>1 OR array_lower(p_ids,1)<>1
    OR EXISTS (SELECT 1 FROM unnest(p_ids) id WHERE id IS NULL OR id<=0)
    OR (SELECT count(DISTINCT id) FROM unnest(p_ids) id)<>cardinality(p_ids)
  THEN RAISE EXCEPTION 'Invalid notification removal' USING ERRCODE='22023'; END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Notification isolation unavailable' USING ERRCODE='55000'; END IF;
  SELECT r.revision::TEXT INTO revision FROM public.artwork_media_chain_revisions r WHERE chain_id=84532 FOR SHARE;
  IF revision IS NULL THEN RAISE EXCEPTION 'Notification revision unavailable' USING ERRCODE='55000'; END IF;
  SELECT * INTO prefs FROM public.auction_notification_preferences WHERE wallet_address=p_wallet AND core_address=p_core;
  SELECT array_agg(n.id ORDER BY n.id) INTO matched FROM (
    SELECT id FROM public.canonical_auction_notifications_v2(p_wallet,p_core,NULL,p_ids)
    UNION SELECT id FROM public.canonical_auction_reminders(p_wallet,p_core,coalesce(prefs.reminder_minutes,ARRAY[60]),statement_timestamp(),p_ids)
    -- A replay remains valid after a reminder expires; its prior recipient-owned
    -- dismissal was already source-proven and still references the retained outbox row.
    UNION SELECT outbox_id FROM public.auction_notification_reads
      WHERE wallet_address=p_wallet AND core_address=p_core AND outbox_id=ANY(p_ids) AND dismissed_at IS NOT NULL
  ) n;
  IF coalesce(cardinality(matched),0)<>cardinality(p_ids) THEN RETURN jsonb_build_object('removed',false); END IF;
  INSERT INTO public.auction_notification_reads(wallet_address,core_address,outbox_id,read,dismissed_at)
    SELECT p_wallet,p_core,id,true,statement_timestamp() FROM unnest(matched) id
    ON CONFLICT(wallet_address,core_address,outbox_id) DO UPDATE
      SET dismissed_at=EXCLUDED.dismissed_at,updated_at=EXCLUDED.updated_at
      WHERE auction_notification_reads.dismissed_at IS NULL;
  RETURN jsonb_build_object('removed',true,'ids',to_jsonb(matched::TEXT[]));
END;
$$;
REVOKE ALL ON FUNCTION public.remove_auction_notifications(TEXT,TEXT,BIGINT[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.remove_auction_notifications(TEXT,TEXT,BIGINT[]) TO service_role;

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
        'ARTWORK_HIDDEN','ARTWORK_RESTORED','DONATION_MESSAGE_HIDDEN','DONATION_MESSAGE_RESTORED') ORDER BY n.id FOR UPDATE
  ) owned;
  IF coalesce(cardinality(matched),0)<>cardinality(p_ids) THEN RETURN jsonb_build_object('removed',false); END IF;
  UPDATE public.artwork_report_notifications SET dismissed_at=statement_timestamp()
    WHERE id=ANY(matched) AND recipient_wallet=p_wallet AND dismissed_at IS NULL;
  RETURN jsonb_build_object('removed',true,'ids',to_jsonb(matched::TEXT[]));
END;
$$;
REVOKE ALL ON FUNCTION public.remove_personal_moderation_notifications(TEXT,BIGINT[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.remove_personal_moderation_notifications(TEXT,BIGINT[]) TO service_role;
COMMIT;
