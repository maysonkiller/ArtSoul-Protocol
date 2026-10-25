-- Private in-app history from confirmed, source-proven indexer events only.
-- No new event producer, delivery worker or email subscription.
-- Requires indexer migration 017 and the existing artwork_media_reorg migration.
BEGIN;
CREATE TABLE IF NOT EXISTS public.auction_notification_reads (
    wallet_address TEXT NOT NULL CHECK (wallet_address ~ '^0x[0-9a-f]{40}$' AND wallet_address <> '0x0000000000000000000000000000000000000000'),
    core_address TEXT NOT NULL CHECK (core_address ~ '^0x[0-9a-f]{40}$' AND core_address <> '0x0000000000000000000000000000000000000000'),
    chain_id INTEGER NOT NULL DEFAULT 84532 CHECK (chain_id=84532),
    outbox_id BIGINT NOT NULL REFERENCES public.outbox_events(id) ON DELETE CASCADE,
    read BOOLEAN NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(wallet_address,core_address,outbox_id)
);
CREATE TABLE IF NOT EXISTS public.auction_notification_preferences (
    wallet_address TEXT NOT NULL CHECK (wallet_address ~ '^0x[0-9a-f]{40}$' AND wallet_address <> '0x0000000000000000000000000000000000000000'),
    core_address TEXT NOT NULL CHECK (core_address ~ '^0x[0-9a-f]{40}$' AND core_address <> '0x0000000000000000000000000000000000000000'),
    chain_id INTEGER NOT NULL DEFAULT 84532 CHECK (chain_id=84532),
    auction_created BOOLEAN NOT NULL DEFAULT true,
    outbid BOOLEAN NOT NULL DEFAULT true,
    revision INTEGER NOT NULL CHECK (revision>0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(wallet_address,core_address)
);
ALTER TABLE public.auction_notification_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auction_notification_reads FORCE ROW LEVEL SECURITY;
ALTER TABLE public.auction_notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auction_notification_preferences FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.auction_notification_reads,public.auction_notification_preferences FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.auction_notification_reads,public.auction_notification_preferences TO service_role;
CREATE INDEX IF NOT EXISTS outbox_notification_recipient ON public.outbox_events(lower(payload->>'recipient'),id DESC)
    WHERE event_type='notification' AND payload->>'type' IN ('auction_created','outbid');

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
      AND (p_before IS NULL OR o.id<p_before) AND (p_ids IS NULL OR o.id=ANY(p_ids))
      AND ((o.payload->>'type'='auction_created' AND o.aggregate_type='auction' AND e.event_name='AuctionCreated'
          AND lower(e.event_data->>'creator')=p_wallet)
        OR (o.payload->>'type'='outbid' AND o.aggregate_type='bid' AND e.event_name='BidPlaced'
          AND previous.contract_address=p_core AND lower(previous.bidder)=p_wallet AND lower(e.event_data->>'bidder')<>p_wallet
          AND lower(o.payload->>'newBidder')=lower(e.event_data->>'bidder')))
    ORDER BY o.id DESC LIMIT 21;
$$;
REVOKE ALL ON FUNCTION public.canonical_auction_notifications(TEXT,TEXT,BIGINT,BIGINT[],BOOLEAN,BOOLEAN) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.read_auction_notifications(p_wallet TEXT,p_core TEXT,p_before BIGINT DEFAULT NULL)
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
      n.artwork_available AS "artworkAvailable",coalesce(r.read,false) AS read
    FROM public.canonical_auction_notifications(p_wallet,p_core,p_before,NULL,coalesce(prefs.auction_created,true),coalesce(prefs.outbid,true)) n
    LEFT JOIN public.auction_notification_reads r ON r.wallet_address=p_wallet AND r.core_address=p_core AND r.outbox_id=n.id
    WHERE (n.notification_type='auction_created' AND coalesce(prefs.auction_created,true)) OR
      (n.notification_type='outbid' AND coalesce(prefs.outbid,true))
    ORDER BY n.id DESC LIMIT 21
  ) page;
  RETURN jsonb_build_object('items',items,'chainRevision',chain_revision,'preferences',jsonb_build_object('auction_created',coalesce(prefs.auction_created,true),
    'outbid',coalesce(prefs.outbid,true)),'preferencesRevision',coalesce(prefs.revision,0));
END;
$$;
REVOKE ALL ON FUNCTION public.read_auction_notifications(TEXT,TEXT,BIGINT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_auction_notifications(TEXT,TEXT,BIGINT) TO service_role;

CREATE OR REPLACE FUNCTION public.mark_auction_notifications(p_wallet TEXT,p_core TEXT,p_ids BIGINT[],p_read BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE matched BIGINT[];
BEGIN
  IF p_wallet IS NULL OR p_wallet !~ '^0x[0-9a-f]{40}$' OR p_wallet='0x0000000000000000000000000000000000000000'
    OR p_core IS NULL OR p_core !~ '^0x[0-9a-f]{40}$' OR p_core='0x0000000000000000000000000000000000000000'
    OR p_ids IS NULL OR cardinality(p_ids) NOT BETWEEN 1 AND 20 OR p_read IS NULL
    OR EXISTS (SELECT 1 FROM unnest(p_ids) x WHERE x IS NULL OR x<=0)
    OR (SELECT count(DISTINCT x) FROM unnest(p_ids) x)<>cardinality(p_ids)
  THEN RAISE EXCEPTION 'Invalid notification update' USING ERRCODE='22023'; END IF;
  SELECT array_agg(n.id ORDER BY n.id) INTO matched FROM public.canonical_auction_notifications(p_wallet,p_core,NULL,p_ids) n;
  IF coalesce(cardinality(matched),0)<>cardinality(p_ids) THEN RETURN jsonb_build_object('updated',false); END IF;
  INSERT INTO public.auction_notification_reads(wallet_address,core_address,outbox_id,read)
    SELECT p_wallet,p_core,x,p_read FROM unnest(matched) x
    ON CONFLICT(wallet_address,core_address,outbox_id) DO UPDATE SET read=EXCLUDED.read,updated_at=now();
  RETURN jsonb_build_object('updated',true,'ids',to_jsonb(matched::TEXT[]),'read',p_read);
END;
$$;
REVOKE ALL ON FUNCTION public.mark_auction_notifications(TEXT,TEXT,BIGINT[],BOOLEAN) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.mark_auction_notifications(TEXT,TEXT,BIGINT[],BOOLEAN) TO service_role;

CREATE OR REPLACE FUNCTION public.save_auction_notification_preferences(p_wallet TEXT,p_core TEXT,p_revision INTEGER,p_created BOOLEAN,p_outbid BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE saved public.auction_notification_preferences%ROWTYPE;
BEGIN
  IF p_wallet IS NULL OR p_wallet !~ '^0x[0-9a-f]{40}$' OR p_wallet='0x0000000000000000000000000000000000000000'
    OR p_core IS NULL OR p_core !~ '^0x[0-9a-f]{40}$' OR p_core='0x0000000000000000000000000000000000000000'
    OR p_revision IS NULL OR p_revision<0 OR p_revision>=2147483647 OR p_created IS NULL OR p_outbid IS NULL
  THEN RAISE EXCEPTION 'Invalid notification preferences' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.indexer_state s WHERE s.chain_id=84532 AND lower(s.contract_address)=p_core) THEN
    RAISE EXCEPTION 'Notification deployment unavailable' USING ERRCODE='55000'; END IF;
  IF p_revision=0 THEN
    INSERT INTO public.auction_notification_preferences(wallet_address,core_address,auction_created,outbid,revision)
      VALUES(p_wallet,p_core,p_created,p_outbid,1) ON CONFLICT(wallet_address,core_address) DO NOTHING RETURNING * INTO saved;
  ELSE
    UPDATE public.auction_notification_preferences SET auction_created=p_created,outbid=p_outbid,revision=revision+1,updated_at=now()
      WHERE wallet_address=p_wallet AND core_address=p_core AND revision=p_revision RETURNING * INTO saved;
  END IF;
  IF saved.wallet_address IS NULL THEN RETURN jsonb_build_object('saved',false); END IF;
  RETURN jsonb_build_object('saved',true,'preferences',jsonb_build_object('auction_created',saved.auction_created,'outbid',saved.outbid),'preferencesRevision',saved.revision);
END;
$$;
REVOKE ALL ON FUNCTION public.save_auction_notification_preferences(TEXT,TEXT,INTEGER,BOOLEAN,BOOLEAN) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_auction_notification_preferences(TEXT,TEXT,INTEGER,BOOLEAN,BOOLEAN) TO service_role;
COMMIT;
