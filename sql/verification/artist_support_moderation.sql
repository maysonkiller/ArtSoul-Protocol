-- Read-only typed moderation preflight after artist_support_moderation.sql.
-- No complaint text, wallet identities, notification rows or message bodies.
-- Expected: browser EXECUTE/table privileges false; service EXECUTE true;
-- all functions SECURITY DEFINER with pinned search_path=public.
BEGIN TRANSACTION READ ONLY;
SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public'
AND table_name='artwork_reports' AND column_name IN ('target_type','donation_contract_address',
  'donation_transaction_hash','donation_log_index','target_author_wallet') ORDER BY column_name;
SELECT role_name,signature,has_function_privilege(role_name,'public.'||signature,'EXECUTE') AS permitted
FROM (VALUES ('anon'),('authenticated'),('service_role')) AS roles(role_name)
CROSS JOIN (VALUES
  ('submit_artwork_report(numeric,numeric,text,text,text,text,boolean,integer)'),
  ('review_artwork_report(uuid,timestamptz,text,text,text)'),
  ('submit_moderation_report(numeric,numeric,text,text,text,text,boolean,integer,text,text,text,integer)'),
  ('review_moderation_report(uuid,timestamptz,text,text,text,text)'),
  ('read_donation_report_messages(uuid[])')) AS functions(signature);
SELECT p.oid::regprocedure AS signature,p.prosecdef,p.proconfig FROM pg_proc p
WHERE p.oid IN (
  'public.submit_artwork_report(numeric,numeric,text,text,text,text,boolean,integer)'::regprocedure,
  'public.review_artwork_report(uuid,timestamptz,text,text,text)'::regprocedure,
  'public.submit_moderation_report(numeric,numeric,text,text,text,text,boolean,integer,text,text,text,integer)'::regprocedure,
  'public.review_moderation_report(uuid,timestamptz,text,text,text,text)'::regprocedure,
  'public.read_donation_report_messages(uuid[])'::regprocedure);
SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c
WHERE c.oid IN ('public.artwork_reports'::regclass,'public.artwork_report_events'::regclass,
  'public.artwork_report_notifications'::regclass,'public.donation_message_visibility'::regclass);
SELECT role_name,table_name,has_table_privilege(role_name,'public.'||table_name,'SELECT,INSERT,UPDATE,DELETE') AS permitted
FROM (VALUES ('anon'),('authenticated')) AS roles(role_name)
CROSS JOIN (VALUES ('artwork_reports'),('artwork_report_events'),('artwork_report_notifications'),('donation_message_visibility')) AS tables(table_name);
SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public'
AND indexname IN ('idx_artwork_reports_one_pending_category','idx_donation_reports_one_pending_category');
SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
WHERE conrelid='public.artwork_reports'::regclass AND conname='artwork_reports_target_check';
ROLLBACK;
