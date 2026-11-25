-- PostgreSQL fixture only. The surrounding test owns a disposable, network-isolated database.
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.fixture_proof_calls') IS NULL THEN
    RAISE EXCEPTION 'Expected an isolated notification proof fixture';
  END IF;
END $$;
CREATE TEMP TABLE fixture_valid_receipts(id bigint PRIMARY KEY);
CREATE TEMP TABLE fixture_batches(ids bigint[] NOT NULL);
CREATE OR REPLACE FUNCTION public.canonical_auction_notifications_v2(text,text,bigint,bigint[],boolean,boolean,boolean)
RETURNS TABLE(id bigint) LANGUAGE plpgsql AS $body$
BEGIN
  INSERT INTO pg_temp.fixture_batches VALUES($4);
  RETURN QUERY SELECT receipts.id FROM pg_temp.fixture_valid_receipts receipts WHERE receipts.id=ANY($4)
    ORDER BY receipts.id DESC LIMIT 21;
END $body$;
DO $check$
DECLARE
  owner_wallet text:='0x'||repeat('1',40); foreign_wallet text:='0x'||repeat('2',40); core text:='0x'||repeat('4',40);
  available integer; observed integer; calls integer; largest_page integer; candidates integer; distinct_candidates integer;
BEGIN
  FOREACH available IN ARRAY ARRAY[0,1,19,20,21,39,40,41,99,100,101,121] LOOP
    TRUNCATE public.outbox_events,public.auction_notification_reads,pg_temp.fixture_valid_receipts,pg_temp.fixture_batches;
    INSERT INTO public.outbox_events SELECT i,'notification',jsonb_build_object('type','auction_created','recipient',owner_wallet)
      FROM generate_series(1,available) i;
    INSERT INTO pg_temp.fixture_valid_receipts SELECT id FROM public.outbox_events;
    SELECT (public.read_notification_summary(owner_wallet,core,true,true,false)->>'auctionCount')::integer INTO observed;
    SELECT count(*),coalesce(max(cardinality(ids)),0) INTO calls,largest_page FROM pg_temp.fixture_batches;
    SELECT count(*),count(DISTINCT candidate) INTO candidates,distinct_candidates
      FROM pg_temp.fixture_batches CROSS JOIN LATERAL unnest(ids) candidate;
    IF observed<>least(100,available) OR calls<>(least(100,available)+19)/20 OR largest_page>20
      OR candidates<>least(100,available) OR distinct_candidates<>candidates THEN
      RAISE EXCEPTION 'Incorrect proof boundary at % candidates: count %, calls %, page %, visited %, distinct %',
        available,observed,calls,largest_page,candidates,distinct_candidates;
    END IF;
  END LOOP;

  TRUNCATE public.outbox_events,public.auction_notification_reads,pg_temp.fixture_valid_receipts,pg_temp.fixture_batches;
  INSERT INTO public.outbox_events SELECT i,'notification',jsonb_build_object('type',CASE WHEN i%2=0 THEN 'outbid' ELSE 'bid_received' END,'recipient',owner_wallet)
    FROM generate_series(1,201) i;
  INSERT INTO pg_temp.fixture_valid_receipts VALUES(1),(16),(80),(160),(199);
  SELECT (public.read_notification_summary(owner_wallet,core,true,true,false)->>'auctionCount')::integer INTO observed;
  IF observed<>5 OR (SELECT count(*) FROM pg_temp.fixture_batches)<>11 THEN
    RAISE EXCEPTION 'Unproven pages must not hide older receipts';
  END IF;
  UPDATE public.outbox_events SET payload=jsonb_set(payload,'{recipient}',to_jsonb(foreign_wallet)) WHERE id=199;
  UPDATE public.outbox_events SET payload=jsonb_set(payload,'{type}','"unknown"') WHERE id=80;
  INSERT INTO public.auction_notification_reads VALUES
    (owner_wallet,core,160,true,NULL),(owner_wallet,core,16,false,now()),(foreign_wallet,core,1,true,NULL);
  SELECT (public.read_notification_summary(owner_wallet,core,true,true,false)->>'auctionCount')::integer INTO observed;
  IF observed<>1 THEN RAISE EXCEPTION 'Recipient, type, read and dismissed filters must be independent'; END IF;
  SELECT (public.read_notification_summary(owner_wallet,core,true,false,false)->>'auctionCount')::integer INTO observed;
  IF observed<>0 THEN RAISE EXCEPTION 'A disabled lifecycle category yielded a proof'; END IF;

  -- The 100th receipt lands in the middle of a page containing invalid candidates.
  TRUNCATE public.auction_notification_reads,pg_temp.fixture_valid_receipts,pg_temp.fixture_batches;
  UPDATE public.outbox_events SET payload=jsonb_build_object('recipient',owner_wallet,'type','outbid');
  INSERT INTO pg_temp.fixture_valid_receipts SELECT id FROM public.outbox_events WHERE id%4<>0;
  SELECT (public.read_notification_summary(owner_wallet,core,true,true,false)->>'auctionCount')::integer INTO observed;
  IF observed<>100 OR (SELECT count(*) FROM pg_temp.fixture_batches)<>7 THEN
    RAISE EXCEPTION 'The count must stop at the first page containing the hundredth proven receipt';
  END IF;

  TRUNCATE public.outbox_events,pg_temp.fixture_valid_receipts,pg_temp.fixture_batches;
  INSERT INTO public.outbox_events SELECT 9223372036854775807::bigint-i,'notification',
    jsonb_build_object('type','outbid','recipient',owner_wallet) FROM generate_series(0,22) i;
  INSERT INTO pg_temp.fixture_valid_receipts VALUES(9223372036854775807),(9223372036854775785);
  SELECT (public.read_notification_summary(owner_wallet,core,true,true,false)->>'auctionCount')::integer INTO observed;
  IF observed<>2 THEN RAISE EXCEPTION 'Bigint cursor omitted an endpoint'; END IF;
END $check$;
ROLLBACK;
