-- Read-only preparation checks. No mailbox addresses or challenge values.
BEGIN TRANSACTION READ ONLY;
SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'profile_email_connections';
SELECT role_name, privilege, has_table_privilege(role_name, 'public.profile_email_connections', privilege) AS permitted
FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS roles(role_name)
CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS privileges(privilege);
SELECT role_name, has_function_privilege(role_name, 'public.confirm_profile_email(text,text)', 'EXECUTE') AS permitted
FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS roles(role_name);
SELECT p.prosecdef, p.proconfig FROM pg_proc p
WHERE p.oid = 'public.confirm_profile_email(text,text)'::regprocedure;
SELECT to_regprocedure('public.consume_launch_service_quota(text,integer,integer)') IS NOT NULL AS durable_quota_available;
ROLLBACK;
