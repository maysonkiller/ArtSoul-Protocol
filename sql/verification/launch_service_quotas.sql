-- Catalog-only quota preparation checks; no quota keys or challenge data.
BEGIN TRANSACTION READ ONLY;
SELECT relrowsecurity, relforcerowsecurity FROM pg_class
WHERE oid = 'public.launch_service_quotas'::regclass;
SELECT role_name, privilege, has_table_privilege(role_name, 'public.launch_service_quotas', privilege) AS permitted
FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS roles(role_name)
CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS privileges(privilege);
SELECT role_name, has_function_privilege(role_name, 'public.consume_launch_service_quota(text,integer,integer)', 'EXECUTE') AS permitted
FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS roles(role_name);
SELECT prosecdef, proconfig FROM pg_proc
WHERE oid = 'public.consume_launch_service_quota(text,integer,integer)'::regprocedure;
ROLLBACK;
