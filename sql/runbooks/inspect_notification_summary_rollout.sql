-- Read-only preflight or postflight. Return catalog evidence without reading any inbox.
WITH target AS (
  SELECT to_regprocedure('public.read_notification_summary(text,text,boolean,boolean,boolean)') AS oid
)
SELECT CASE
  WHEN p.oid IS NULL THEN 'missing'
  WHEN md5(replace(p.prosrc, E'\r\n', E'\n'))='743898b714ef9e377614b5e3f8d41064' THEN 'november_16'
  WHEN md5(replace(p.prosrc, E'\r\n', E'\n'))='e107eebd0c4eff643dc936d66880f466' THEN 'november_25_batched'
  ELSE 'unrecognized'
END AS body_version,
p.prosecdef AS security_definer, p.proconfig AS function_settings,
has_function_privilege('anon',p.oid,'EXECUTE') AS anon_can_execute,
has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_can_execute,
has_function_privilege('service_role',p.oid,'EXECUTE') AS service_can_execute,
EXISTS (SELECT FROM pg_catalog.pg_index i WHERE i.indisready AND i.indisvalid
  AND i.indexrelid=to_regclass('public.outbox_notification_recipient')
  AND i.indrelid=to_regclass('public.outbox_events')) AS recipient_index_ready,
EXISTS (SELECT FROM pg_catalog.pg_index i WHERE i.indisready AND i.indisvalid AND i.indisprimary
  AND i.indrelid=to_regclass('public.auction_notification_reads')) AS read_state_primary_key_ready
FROM target LEFT JOIN pg_catalog.pg_proc p ON p.oid=target.oid;
