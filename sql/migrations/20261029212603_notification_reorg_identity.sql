-- Apply after artwork_media_reorg.sql and notification_inbox_removal.sql,
-- before activating the corresponding indexer writer. No worker is started here.
-- Stable inbox rows preserve recipient read/dismissal state across proven replay.
BEGIN;

CREATE SCHEMA IF NOT EXISTS artsoul_private;
REVOKE ALL ON SCHEMA artsoul_private FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE IF NOT EXISTS artsoul_private.notification_reorg_identities (
    identity_key TEXT PRIMARY KEY,
    source_identity JSONB NOT NULL,
    outbox_id BIGINT NOT NULL UNIQUE REFERENCES public.outbox_events(id) ON DELETE RESTRICT,
    orphaned BOOLEAN NOT NULL DEFAULT false,
    retained_status TEXT NOT NULL CHECK (retained_status IN ('pending','processing','completed','failed','dead'))
);
ALTER TABLE artsoul_private.notification_reorg_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE artsoul_private.notification_reorg_identities FORCE ROW LEVEL SECURITY;
REVOKE ALL ON artsoul_private.notification_reorg_identities FROM PUBLIC,anon,authenticated,service_role;

-- A block-global log index and a block height can both change on reinclusion.
-- Within a transaction, retain the occurrence among this contract/event's logs;
-- exact source bytes and payload (including recipient) must still match. JSONB
-- provides canonical key ordering. No deployment is inferred for legacy rows.
CREATE OR REPLACE FUNCTION artsoul_private.notification_source_identity(
    p_aggregate_type TEXT,p_aggregate_id TEXT,p_payload JSONB,p_correlation TEXT,p_completed BOOLEAN
) RETURNS JSONB LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
    SELECT jsonb_build_object('version',1,'chain',e.chain_id::TEXT,'contract',e.contract_address,
        'transaction',e.transaction_hash,'event',e.event_name,'occurrence',(
            SELECT count(*) FROM public.contract_events prior
            WHERE prior.chain_id=e.chain_id AND prior.transaction_hash=e.transaction_hash
              AND prior.contract_address=e.contract_address AND prior.event_name=e.event_name
              AND prior.log_index<=e.log_index),
        'data',e.event_data,'aggregateType',p_aggregate_type,'aggregateId',p_aggregate_id,'payload',p_payload)
    FROM public.contract_events e
    JOIN public.indexer_state s ON s.chain_id=e.chain_id AND lower(s.contract_address)=e.contract_address
    WHERE p_correlation ~ '^[1-9][0-9]{0,77}-0x[0-9a-f]{64}-[0-9]{1,10}$'
      AND e.chain_id=CASE WHEN p_correlation ~ '^[1-9][0-9]{0,77}-0x[0-9a-f]{64}-[0-9]{1,10}$'
          THEN split_part(p_correlation,'-',1)::NUMERIC END
      AND e.transaction_hash=split_part(p_correlation,'-',2)
      AND e.log_index=CASE WHEN p_correlation ~ '^[1-9][0-9]{0,77}-0x[0-9a-f]{64}-[0-9]{1,10}$'
          THEN split_part(p_correlation,'-',3)::BIGINT END
      AND e.contract_address ~ '^0x[0-9a-f]{40}$'
      AND e.contract_address<>'0x0000000000000000000000000000000000000000'
      AND EXISTS (SELECT 1 FROM public.event_processing_registry r
          WHERE r.chain_id=e.chain_id AND r.transaction_hash=e.transaction_hash AND r.log_index=e.log_index
            AND r.event_name=e.event_name AND r.block_number=e.block_number
            AND (r.processing_status='completed' OR (NOT p_completed AND r.processing_status='processing')))
      AND (NOT p_completed OR EXISTS (SELECT 1 FROM public.block_hashes b
          WHERE b.chain_id=e.chain_id AND b.block_number=e.block_number));
$$;
REVOKE ALL ON FUNCTION artsoul_private.notification_source_identity(TEXT,TEXT,JSONB,TEXT,BOOLEAN)
    FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.write_recoverable_notification(
    p_aggregate_type TEXT,p_aggregate_id TEXT,p_payload JSONB,p_correlation TEXT,p_key TEXT,p_status TEXT
) RETURNS BIGINT LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE
    source JSONB; identity_hash TEXT; existing_source JSONB;
    retained artsoul_private.notification_reorg_identities%ROWTYPE;
    existing public.outbox_events%ROWTYPE; result_id BIGINT;
BEGIN
    IF p_aggregate_type IS NULL OR p_aggregate_id IS NULL OR p_payload IS NULL OR p_key IS NULL
        OR p_status IS NULL OR p_status NOT IN ('pending','processing','completed','failed','dead') THEN
        RAISE EXCEPTION 'INVALID_NOTIFICATION_WRITE';
    END IF;
    -- Also fence privileged direct helper calls. The indexer takes its state
    -- lock first; API reminder callers already hold this SHARE lock.
    PERFORM 1 FROM public.artwork_media_chain_revisions
        WHERE chain_id=CASE WHEN p_correlation ~ '^[1-9][0-9]{0,77}-0x[0-9a-f]{64}-[0-9]{1,10}$'
            THEN split_part(p_correlation,'-',1)::NUMERIC END FOR SHARE;
    IF NOT FOUND AND split_part(p_correlation,'-',1)='84532' THEN
        RAISE EXCEPTION 'NOTIFICATION_REVISION_UNAVAILABLE';
    END IF;
    source:=artsoul_private.notification_source_identity(p_aggregate_type,p_aggregate_id,p_payload,p_correlation,false);
    IF source IS NULL THEN
        -- Compatibility for historical logs without actual source provenance.
        -- Canonical inbox readers still deny them; rewind quarantines them and
        -- never carries their user state to a newly proven event.
        IF NOT EXISTS (SELECT 1 FROM public.contract_events e
            JOIN public.event_processing_registry r ON r.chain_id=e.chain_id AND r.transaction_hash=e.transaction_hash
              AND r.log_index=e.log_index AND r.block_number=e.block_number AND r.event_name=e.event_name
              AND r.processing_status IN ('processing','completed')
            WHERE e.contract_address IS NULL
              AND p_correlation=e.chain_id::TEXT||'-'||e.transaction_hash||'-'||e.log_index) THEN
            -- In particular, a writer released after rewind must not recreate
            -- an old key while its original row is detached and retained.
            RAISE EXCEPTION 'NOTIFICATION_SOURCE_UNAVAILABLE';
        END IF;
        INSERT INTO public.outbox_events(aggregate_type,aggregate_id,event_type,payload,correlation_id,idempotency_key,processing_status)
            VALUES(p_aggregate_type,p_aggregate_id,'notification',p_payload,p_correlation,p_key,p_status)
            ON CONFLICT(idempotency_key) DO NOTHING RETURNING id INTO result_id;
        RETURN result_id;
    END IF;
    identity_hash:=encode(sha256(convert_to(source::TEXT,'UTF8')),'hex');
    -- Serializes first insertion as well as replay; a lock-hash collision only
    -- causes waiting. Full JSONB equality, not the hash alone, proves identity.
    PERFORM pg_advisory_xact_lock(hashtextextended('notification-replay:'||identity_hash,0));
    SELECT * INTO retained FROM artsoul_private.notification_reorg_identities
        WHERE identity_key=identity_hash FOR UPDATE;
    IF FOUND THEN
        IF retained.source_identity<>source THEN RAISE EXCEPTION 'NOTIFICATION_IDENTITY_COLLISION'; END IF;
        SELECT * INTO existing FROM public.outbox_events WHERE id=retained.outbox_id FOR UPDATE;
        IF NOT retained.orphaned AND (existing.correlation_id IS DISTINCT FROM p_correlation
            OR existing.idempotency_key IS DISTINCT FROM p_key) THEN
            RAISE EXCEPTION 'NOTIFICATION_REBIND_REQUIRES_REWIND';
        END IF;
        IF retained.orphaned THEN
            UPDATE public.outbox_events SET correlation_id=p_correlation,idempotency_key=p_key,
                processing_status=retained.retained_status WHERE id=retained.outbox_id;
            UPDATE artsoul_private.notification_reorg_identities SET orphaned=false WHERE identity_key=identity_hash;
        END IF;
        RETURN retained.outbox_id;
    END IF;
    SELECT * INTO existing FROM public.outbox_events WHERE idempotency_key=p_key FOR UPDATE;
    IF FOUND THEN
        existing_source:=artsoul_private.notification_source_identity(existing.aggregate_type,existing.aggregate_id,
            existing.payload,existing.correlation_id,false);
        IF existing.event_type<>'notification' OR existing_source IS DISTINCT FROM source THEN
            RAISE EXCEPTION 'NOTIFICATION_SOURCE_CONFLICT';
        END IF;
        result_id:=existing.id;
    ELSE
        INSERT INTO public.outbox_events(aggregate_type,aggregate_id,event_type,payload,correlation_id,idempotency_key,processing_status)
            VALUES(p_aggregate_type,p_aggregate_id,'notification',p_payload,p_correlation,p_key,p_status)
            RETURNING id INTO result_id;
    END IF;
    INSERT INTO artsoul_private.notification_reorg_identities(identity_key,source_identity,outbox_id,retained_status)
        VALUES(identity_hash,source,result_id,coalesce(existing.processing_status,p_status));
    RETURN result_id;
END;
$$;
REVOKE ALL ON FUNCTION public.write_recoverable_notification(TEXT,TEXT,JSONB,TEXT,TEXT,TEXT)
    FROM PUBLIC,anon,authenticated,service_role;

-- Called under the existing recovery/media fence, before source deletion. API
-- reminder writes hold the corresponding media SHARE lock. Keep ledger -> outbox
-- lock order, and retain unknown historical rows without assigning an identity.
CREATE OR REPLACE FUNCTION artsoul_private.detach_reorg_notifications(p_block BIGINT,p_chain NUMERIC)
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE item RECORD; source JSONB;
BEGIN
    FOR item IN
        SELECT o.* FROM public.outbox_events o WHERE o.event_type='notification' AND EXISTS (
            SELECT 1 FROM public.contract_events e WHERE e.chain_id=p_chain AND e.block_number>=p_block
              AND (o.correlation_id=p_chain::TEXT||'-'||e.transaction_hash||'-'||e.log_index
                OR (p_chain=84532 AND o.correlation_id=e.transaction_hash||'-'||e.log_index)
                OR o.idempotency_key=p_chain::TEXT||'-'||e.transaction_hash||'-'||e.log_index||'-notification'))
        ORDER BY o.id
    LOOP
        source:=artsoul_private.notification_source_identity(item.aggregate_type,item.aggregate_id,item.payload,item.correlation_id,true);
        IF source IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM artsoul_private.notification_reorg_identities WHERE outbox_id=item.id) THEN
            PERFORM public.write_recoverable_notification(item.aggregate_type,item.aggregate_id,item.payload,
                item.correlation_id,item.idempotency_key,item.processing_status);
        END IF;
        UPDATE artsoul_private.notification_reorg_identities SET orphaned=true,retained_status=item.processing_status
            WHERE outbox_id=item.id AND NOT orphaned;
        UPDATE public.outbox_events SET correlation_id=NULL,idempotency_key='notification-orphan-'||id,processing_status='dead'
            WHERE id=item.id;
    END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION artsoul_private.detach_reorg_notifications(BIGINT,NUMERIC)
    FROM PUBLIC,anon,authenticated,service_role;

-- Media-aware rollback, preserved with one pre-deletion retention step.
CREATE OR REPLACE FUNCTION public.rollback_events_from_block(
    reorg_block BIGINT,
    target_chain_id NUMERIC
)
RETURNS TABLE(
    events_deleted BIGINT,
    auctions_deleted BIGINT,
    bids_deleted BIGINT,
    outbox_deleted BIGINT
) AS $$
DECLARE
    v_events_deleted BIGINT := 0;
    v_auctions_deleted BIGINT := 0;
    v_bids_deleted BIGINT := 0;
    v_outbox_deleted BIGINT := 0;
    v_rows BIGINT := 0;
    v_revision NUMERIC(78, 0);
BEGIN
    IF reorg_block IS NULL OR reorg_block < 0 OR target_chain_id IS NULL OR target_chain_id <= 0
       OR target_chain_id <> trunc(target_chain_id) THEN RAISE EXCEPTION 'INVALID_REORG_SCOPE'; END IF;
    -- Direct owner calls must use the same state -> media ordering as the
    -- engine's recovery transaction. Even a primitive rewind must invalidate
    -- buffered writer contexts (xmin); the full engine still owns cursor,
    -- digest, header and predecessor reconstruction in the same transaction.
    UPDATE public.indexer_state SET last_indexed_block=last_indexed_block WHERE chain_id=target_chain_id;
    IF target_chain_id = 84532 THEN
        IF current_setting('transaction_isolation') <> 'read committed' THEN
            RAISE EXCEPTION 'MEDIA_IDENTITY_REQUIRES_READ_COMMITTED';
        END IF;
        SELECT revision INTO v_revision FROM public.artwork_media_chain_revisions
            WHERE chain_id = target_chain_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'MEDIA_REGISTRATION_REVISION_UNAVAILABLE'; END IF;
        UPDATE public.artwork_media_chain_revisions SET revision = revision + 1
            WHERE chain_id = target_chain_id RETURNING revision INTO v_revision;
        INSERT INTO public.artwork_media_rewinds(chain_id, revision, from_block)
            VALUES (target_chain_id, v_revision, reorg_block);
        -- A projection rewind is not proof of a chain reorg. Conservatively
        -- quarantine only evidence whose event OR first anchor crosses it.
        UPDATE public.artwork_media_publications p SET claim_status = 'conflict', updated_at = clock_timestamp()
            WHERE p.chain_id = target_chain_id AND p.claim_status <> 'conflict' AND EXISTS (
                SELECT 1 FROM public.artwork_media_catalog c
                LEFT JOIN public.artwork_media_registration_evidence e
                    USING (chain_id, core_address, artwork_id)
                WHERE c.chain_id = p.chain_id AND c.core_address = p.core_address AND c.media_sha256 = p.media_sha256
                  AND (c.block_number >= reorg_block OR e.finalized_block_number >= reorg_block)
            );
    END IF;

    PERFORM artsoul_private.detach_reorg_notifications(reorg_block,target_chain_id);

    DELETE FROM public.event_processing_registry
    WHERE chain_id = target_chain_id AND block_number >= reorg_block;
    GET DIAGNOSTICS v_events_deleted = ROW_COUNT;

    DELETE FROM public.v41_genesis_holders WHERE chain_id = target_chain_id AND block_number >= reorg_block;
    DELETE FROM public.v41_project_eligibility WHERE chain_id = target_chain_id AND block_number >= reorg_block;
    DELETE FROM public.v41_resale_history WHERE chain_id = target_chain_id AND block_number >= reorg_block;
    DELETE FROM public.v41_resale_listings WHERE chain_id = target_chain_id AND block_number >= reorg_block;
    DELETE FROM public.v41_floor_history WHERE chain_id = target_chain_id AND block_number >= reorg_block;
    DELETE FROM public.v41_settlements WHERE chain_id = target_chain_id AND block_number >= reorg_block;
    DELETE FROM public.v41_auction_endings WHERE chain_id = target_chain_id AND block_number >= reorg_block;
    DELETE FROM public.v41_auction_extensions WHERE chain_id = target_chain_id AND block_number >= reorg_block;
    DELETE FROM public.v41_bid_withdrawals WHERE chain_id = target_chain_id AND block_number >= reorg_block;

    DELETE FROM public.v41_bids
    WHERE chain_id = target_chain_id AND block_number >= reorg_block;
    GET DIAGNOSTICS v_bids_deleted = ROW_COUNT;

    DELETE FROM public.v41_auctions
    WHERE chain_id = target_chain_id AND block_number >= reorg_block;
    GET DIAGNOSTICS v_auctions_deleted = ROW_COUNT;

    DELETE FROM public.v41_artworks
    WHERE chain_id = target_chain_id AND block_number >= reorg_block;

    IF to_regclass('public.indexed_auctions') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.indexed_auctions WHERE block_number >= $1'
        USING reorg_block;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_auctions_deleted := v_auctions_deleted + v_rows;
    END IF;

    IF to_regclass('public.indexed_bids') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.indexed_bids WHERE block_number >= $1'
        USING reorg_block;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_bids_deleted := v_bids_deleted + v_rows;
    END IF;

    DELETE FROM public.outbox_events
    WHERE correlation_id IN (
        SELECT target_chain_id::TEXT || '-' || transaction_hash || '-' || log_index
        FROM public.contract_events
        WHERE chain_id = target_chain_id AND block_number >= reorg_block
    )
    OR (
        target_chain_id = 84532
        AND correlation_id IN (
            SELECT transaction_hash || '-' || log_index
            FROM public.contract_events
            WHERE chain_id = target_chain_id AND block_number >= reorg_block
        )
    );
    GET DIAGNOSTICS v_outbox_deleted = ROW_COUNT;

    DELETE FROM public.outbox_events
    WHERE idempotency_key IN (
        SELECT target_chain_id::TEXT || '-' || transaction_hash || '-' || log_index || '-webhook'
        FROM public.contract_events
        WHERE chain_id = target_chain_id AND block_number >= reorg_block
        UNION
        SELECT target_chain_id::TEXT || '-' || transaction_hash || '-' || log_index || '-notification'
        FROM public.contract_events
        WHERE chain_id = target_chain_id AND block_number >= reorg_block
    );
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_outbox_deleted := v_outbox_deleted + v_rows;

    DELETE FROM public.contract_events
    WHERE chain_id = target_chain_id AND block_number >= reorg_block;

    RETURN QUERY SELECT
        v_events_deleted,
        v_auctions_deleted,
        v_bids_deleted,
        v_outbox_deleted;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public;

COMMENT ON FUNCTION rollback_events_from_block(BIGINT, NUMERIC)
IS 'Chain-scoped reorg rollback for V4.1 projections with optional cleanup of legacy auction and bid tables';

-- Neither Data API clients nor service-role HTTP calls operate the indexer.
-- This invoker function requires the indexer database owner, as in deployment.
CREATE OR REPLACE FUNCTION public.rollback_events_from_block(reorg_block BIGINT)
RETURNS TABLE(events_deleted BIGINT, auctions_deleted BIGINT, bids_deleted BIGINT, outbox_deleted BIGINT)
LANGUAGE sql SECURITY INVOKER SET search_path = pg_catalog, public
AS $$ SELECT * FROM public.rollback_events_from_block(reorg_block, 84532) $$;
REVOKE ALL ON FUNCTION public.rollback_events_from_block(BIGINT, NUMERIC) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.rollback_events_from_block(BIGINT) FROM PUBLIC, anon, authenticated, service_role;

-- Both writers share identity; canonical readers and mutation proofs are unchanged.
CREATE OR REPLACE FUNCTION public.read_auction_notifications_v3(p_wallet TEXT,p_core TEXT,p_before BIGINT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE prefs public.auction_notification_preferences%ROWTYPE; history JSONB; reminders JSONB; chain_revision TEXT;
  task_now TIMESTAMPTZ:=statement_timestamp(); available BOOLEAN; capped BOOLEAN; minutes INTEGER[]; candidate RECORD;
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
    FOR candidate IN
      SELECT c.* FROM public.auction_reminder_candidates(p_wallet,p_core,minutes,task_now) c
      ORDER BY c.deadline::NUMERIC,c.auction_id::NUMERIC,c.notification_type LIMIT 21
    LOOP
      -- The shared writer retains the original ID and dismissal on replay.
      -- Auction IDs can be reused by a different creation transaction after
      -- rewind; those reminders must never inherit the former recipient state.
      PERFORM public.write_recoverable_notification('auction',candidate.auction_id,
        jsonb_build_object('type',candidate.notification_type,'recipient',p_wallet,'coreAddress',p_core,
          'artworkId',candidate.artwork_id,'auctionId',candidate.auction_id,'offsetMinutes',candidate.offset_minutes),
        candidate.correlation_id,candidate.idempotency_key,'completed');
    END LOOP;
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


-- Summary must honor retained recipient state before opening the inbox rebinds
-- a reminder. This lookup remains read-only and does not create notifications.
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
        'ARTWORK_HIDDEN','ARTWORK_RESTORED','DONATION_MESSAGE_HIDDEN','DONATION_MESSAGE_RESTORED') LIMIT 100
  ) unread;
  RETURN jsonb_build_object('auctionCount',auction_count,'moderationCount',moderation_count,'reminderCount',reminder_count,
    'remindersAvailable',reminders_available,'serverTime',task_now,'nextReminderDeadline',next_deadline,
    'chainRevision',chain_revision,'preferencesRevision',coalesce(prefs.revision,0));
END;
$$;
REVOKE ALL ON FUNCTION public.read_notification_summary(TEXT,TEXT,BOOLEAN,BOOLEAN,BOOLEAN) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_notification_summary(TEXT,TEXT,BOOLEAN,BOOLEAN,BOOLEAN) TO service_role;


COMMIT;
