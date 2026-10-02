-- Catalog-only preflight after artist_support.sql. No donation/message/wallet rows.
-- Expected: both RLS flags true, browser privileges false, service privileges true.
BEGIN TRANSACTION READ ONLY;
SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c
WHERE c.oid IN ('public.artwork_donations'::regclass,'public.donation_message_visibility'::regclass);
SELECT role_name,table_name,privilege,has_table_privilege(role_name,'public.'||table_name,privilege) AS permitted
FROM (VALUES ('anon'),('authenticated'),('service_role')) AS roles(role_name)
CROSS JOIN (VALUES ('artwork_donations'),('donation_message_visibility')) AS tables(table_name)
CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) AS privileges(privilege);
SELECT conname,contype,pg_get_constraintdef(oid) AS definition FROM pg_constraint
WHERE conrelid='public.artwork_donations'::regclass AND contype IN ('f','p');
SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public'
AND tablename IN ('artwork_donations','donation_message_visibility') ORDER BY indexname;
ROLLBACK;
