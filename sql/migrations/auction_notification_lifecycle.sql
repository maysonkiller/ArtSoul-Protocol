-- Private lifecycle history. Install after auction_notifications; v1 remains unchanged.
-- No historical replay, source repair, delivery worker, or implicit grants.
BEGIN;
ALTER TABLE public.auction_notification_preferences ADD COLUMN IF NOT EXISTS lifecycle BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS outbox_lifecycle_notification_recipient ON public.outbox_events(lower(payload->>'recipient'),id DESC)
  WHERE event_type='notification' AND payload->>'type' IN ('bid_received','auction_won','auction_ended',
    'purchase_completed','sale_completed','payment_missed','sale_unpaid','resale_purchased','resale_sold');
CREATE INDEX IF NOT EXISTS contract_events_settlement_token ON public.contract_events(chain_id,(event_data->>'tokenId'),block_number,log_index)
  WHERE event_name='SettlementCompleted';

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

CREATE OR REPLACE FUNCTION public.read_auction_notifications_v2(p_wallet TEXT,p_core TEXT,p_before BIGINT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE prefs public.auction_notification_preferences%ROWTYPE; items JSONB; chain_revision TEXT;
BEGIN
  IF p_wallet IS NULL OR p_wallet !~ '^0x[0-9a-f]{40}$' OR p_wallet='0x0000000000000000000000000000000000000000'
    OR p_core IS NULL OR p_core !~ '^0x[0-9a-f]{40}$' OR p_core='0x0000000000000000000000000000000000000000'
    OR p_before<=0 THEN RAISE EXCEPTION 'Invalid notification request' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.indexer_state s WHERE s.chain_id=84532 AND lower(s.contract_address)=p_core) THEN
    RAISE EXCEPTION 'Notification deployment unavailable' USING ERRCODE='55000'; END IF;
  SELECT revision::TEXT INTO chain_revision FROM public.artwork_media_chain_revisions WHERE chain_id=84532;
  IF chain_revision IS NULL THEN RAISE EXCEPTION 'Notification revision unavailable' USING ERRCODE='55000'; END IF;
  SELECT * INTO prefs FROM public.auction_notification_preferences WHERE wallet_address=p_wallet AND core_address=p_core;
  SELECT coalesce(jsonb_agg(to_jsonb(page)-'sort_id' ORDER BY page.sort_id DESC),'[]'::JSONB) INTO items FROM (
    SELECT n.id AS sort_id,n.id::TEXT AS id,n.notification_type AS type,n.created_at,n.artwork_id,n.auction_id,n.transaction_hash,
      n.artwork_available AS "artworkAvailable",coalesce(r.read,false) AS read,n.token_id,n.amount_wei,n.settlement_deadline
    FROM public.canonical_auction_notifications_v2(p_wallet,p_core,p_before,NULL,coalesce(prefs.auction_created,true),coalesce(prefs.outbid,true),coalesce(prefs.lifecycle,true)) n
    LEFT JOIN public.auction_notification_reads r ON r.wallet_address=p_wallet AND r.core_address=p_core AND r.outbox_id=n.id
    ORDER BY n.id DESC LIMIT 21
  ) page;
  RETURN jsonb_build_object('items',items,'chainRevision',chain_revision,'preferences',jsonb_build_object('auction_created',coalesce(prefs.auction_created,true),
    'outbid',coalesce(prefs.outbid,true),'lifecycle',coalesce(prefs.lifecycle,true)),'preferencesRevision',coalesce(prefs.revision,0));
END;
$$;
REVOKE ALL ON FUNCTION public.read_auction_notifications_v2(TEXT,TEXT,BIGINT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_auction_notifications_v2(TEXT,TEXT,BIGINT) TO service_role;

CREATE OR REPLACE FUNCTION public.mark_auction_notifications_v2(p_wallet TEXT,p_core TEXT,p_ids BIGINT[],p_read BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE matched BIGINT[];
BEGIN
  IF p_wallet IS NULL OR p_wallet !~ '^0x[0-9a-f]{40}$' OR p_wallet='0x0000000000000000000000000000000000000000'
    OR p_core IS NULL OR p_core !~ '^0x[0-9a-f]{40}$' OR p_core='0x0000000000000000000000000000000000000000'
    OR p_ids IS NULL OR cardinality(p_ids) NOT BETWEEN 1 AND 20 OR p_read IS NULL
    OR EXISTS (SELECT 1 FROM unnest(p_ids) x WHERE x IS NULL OR x<=0)
    OR (SELECT count(DISTINCT x) FROM unnest(p_ids) x)<>cardinality(p_ids)
  THEN RAISE EXCEPTION 'Invalid notification update' USING ERRCODE='22023'; END IF;
  SELECT array_agg(n.id ORDER BY n.id) INTO matched FROM public.canonical_auction_notifications_v2(p_wallet,p_core,NULL,p_ids) n;
  IF coalesce(cardinality(matched),0)<>cardinality(p_ids) THEN RETURN jsonb_build_object('updated',false); END IF;
  INSERT INTO public.auction_notification_reads(wallet_address,core_address,outbox_id,read)
    SELECT p_wallet,p_core,x,p_read FROM unnest(matched) x
    ON CONFLICT(wallet_address,core_address,outbox_id) DO UPDATE SET read=EXCLUDED.read,updated_at=now();
  RETURN jsonb_build_object('updated',true,'ids',to_jsonb(matched::TEXT[]),'read',p_read);
END;
$$;
REVOKE ALL ON FUNCTION public.mark_auction_notifications_v2(TEXT,TEXT,BIGINT[],BOOLEAN) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.mark_auction_notifications_v2(TEXT,TEXT,BIGINT[],BOOLEAN) TO service_role;

CREATE OR REPLACE FUNCTION public.save_auction_notification_preferences_v2(p_wallet TEXT,p_core TEXT,p_revision INTEGER,p_created BOOLEAN,p_outbid BOOLEAN,p_lifecycle BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE saved public.auction_notification_preferences%ROWTYPE;
BEGIN
  IF p_wallet IS NULL OR p_wallet !~ '^0x[0-9a-f]{40}$' OR p_wallet='0x0000000000000000000000000000000000000000'
    OR p_core IS NULL OR p_core !~ '^0x[0-9a-f]{40}$' OR p_core='0x0000000000000000000000000000000000000000'
    OR p_revision IS NULL OR p_revision<0 OR p_revision>=2147483647 OR p_created IS NULL OR p_outbid IS NULL OR p_lifecycle IS NULL
  THEN RAISE EXCEPTION 'Invalid notification preferences' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.indexer_state s WHERE s.chain_id=84532 AND lower(s.contract_address)=p_core) THEN
    RAISE EXCEPTION 'Notification deployment unavailable' USING ERRCODE='55000'; END IF;
  IF p_revision=0 THEN
    INSERT INTO public.auction_notification_preferences(wallet_address,core_address,auction_created,outbid,lifecycle,revision)
      VALUES(p_wallet,p_core,p_created,p_outbid,p_lifecycle,1) ON CONFLICT(wallet_address,core_address) DO NOTHING RETURNING * INTO saved;
  ELSE
    UPDATE public.auction_notification_preferences SET auction_created=p_created,outbid=p_outbid,lifecycle=p_lifecycle,revision=revision+1,updated_at=now()
      WHERE wallet_address=p_wallet AND core_address=p_core AND revision=p_revision RETURNING * INTO saved;
  END IF;
  IF saved.wallet_address IS NULL THEN RETURN jsonb_build_object('saved',false); END IF;
  RETURN jsonb_build_object('saved',true,'preferences',jsonb_build_object('auction_created',saved.auction_created,'outbid',saved.outbid,'lifecycle',saved.lifecycle),'preferencesRevision',saved.revision);
END;
$$;
REVOKE ALL ON FUNCTION public.save_auction_notification_preferences_v2(TEXT,TEXT,INTEGER,BOOLEAN,BOOLEAN,BOOLEAN) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_auction_notification_preferences_v2(TEXT,TEXT,INTEGER,BOOLEAN,BOOLEAN,BOOLEAN) TO service_role;
COMMIT;
