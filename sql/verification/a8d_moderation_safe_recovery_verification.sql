-- A8d Safe-only moderation recovery: READ-ONLY verification.
-- Every statement is a SELECT; nothing is created, modified, or deleted.

-- 1) The recovery-request table exists (expect 1 row).
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'artsoul_staff_recovery_requests';

-- 2) RLS is enabled AND forced (expect one row, both true).
SELECT relname, relrowsecurity AS rls_enabled, relforcerowsecurity AS rls_forced
FROM pg_class
WHERE relnamespace = 'public'::regnamespace
  AND relname = 'artsoul_staff_recovery_requests';

-- 3) anon/authenticated hold no table privileges (expect zero rows).
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'artsoul_staff_recovery_requests'
  AND grantee IN ('anon', 'authenticated');

-- 4) No raw signature, enrollment token, private key, IP, or user-agent
--    column exists (expect zero rows).
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'artsoul_staff_recovery_requests'
  AND (
    column_name ~* '(^|_)signature($|_)'
    OR (column_name ILIKE '%token%' AND column_name NOT ILIKE '%hash%')
    OR column_name ILIKE '%private%'
    OR column_name ILIKE '%seed%'
    OR column_name ILIKE '%ip%'
    OR column_name ILIKE '%agent%'
  );

-- 5) The atomic completion RPC exists, is SECURITY DEFINER, and pins its
--    search_path (expect one row, prosecdef true, search_path present).
SELECT p.proname, p.prosecdef, p.proconfig
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'a8d_complete_safe_recovery';

-- 6) anon/authenticated cannot execute the RPC (expect zero rows).
SELECT r.routine_name, p.grantee, p.privilege_type
FROM information_schema.routine_privileges p
JOIN information_schema.routines r ON r.specific_name = p.specific_name
WHERE r.routine_schema = 'public'
  AND r.routine_name = 'a8d_complete_safe_recovery'
  AND p.grantee IN ('anon', 'authenticated');

-- 7) The audit constraint includes authorization and denial outcomes
--    (expect one row containing both event names).
SELECT c.conname, pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
WHERE c.conrelid = 'public.artsoul_staff_auth_events'::regclass
  AND c.conname = 'artsoul_staff_auth_events_event_type_check';

-- 8) Operational evidence only: count outstanding, expired, and consumed
--    requests. No raw authorization material is returned.
SELECT
  COUNT(*) FILTER (WHERE consumed_at IS NULL AND expires_at > NOW()) AS active_requests,
  COUNT(*) FILTER (WHERE consumed_at IS NULL AND expires_at <= NOW()) AS expired_requests,
  COUNT(*) FILTER (WHERE consumed_at IS NOT NULL) AS consumed_requests
FROM public.artsoul_staff_recovery_requests;
