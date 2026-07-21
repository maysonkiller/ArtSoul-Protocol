-- A8b artwork report intake: READ-ONLY production verification.
-- Every statement is a SELECT; nothing is created, modified, or deleted.

-- 1) Both report tables exist (expect 2 rows).
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('artwork_reports', 'artwork_report_events')
ORDER BY table_name;

-- 2) RLS is enabled AND forced on both tables (expect 2 rows, both true).
SELECT relname, relrowsecurity AS rls_enabled, relforcerowsecurity AS rls_forced
FROM pg_class
WHERE relnamespace = 'public'::regnamespace
  AND relname IN ('artwork_reports', 'artwork_report_events')
ORDER BY relname;

-- 3) Browser roles hold no table privileges (expect 0 rows).
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('artwork_reports', 'artwork_report_events')
  AND grantee IN ('anon', 'authenticated')
ORDER BY table_name, grantee, privilege_type;

-- 4) The service-role RPC is SECURITY DEFINER with pinned search_path
--    (expect 1 row with security_definer=true and a search_path config).
SELECT p.proname, p.prosecdef AS security_definer, p.proconfig
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'submit_artwork_report';

-- 5) Browser roles cannot execute the RPC (expect 0 rows).
SELECT routine_name, grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name = 'submit_artwork_report'
  AND grantee IN ('anon', 'authenticated')
ORDER BY grantee;

-- 6) The active-report deduplication index exists (expect 1 row).
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname = 'idx_artwork_reports_one_pending_category';

-- 7) Submission events cannot be orphaned or cascade-deleted (expect one
--    foreign key whose definition contains ON DELETE RESTRICT).
SELECT constraint_name, pg_get_constraintdef(pc.oid) AS definition
FROM information_schema.table_constraints tc
JOIN pg_constraint pc ON pc.conname = tc.constraint_name
WHERE tc.table_schema = 'public'
  AND tc.table_name = 'artwork_report_events'
  AND tc.constraint_type = 'FOREIGN KEY';

-- 8) Operational counts. Before activation both should normally be zero.
SELECT
  (SELECT COUNT(*) FROM public.artwork_reports) AS report_count,
  (SELECT COUNT(*) FROM public.artwork_report_events) AS event_count,
  (SELECT COUNT(*) FROM public.artwork_reports WHERE status = 'pending_review') AS pending_count;
