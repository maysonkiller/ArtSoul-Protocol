-- A8a passkey foundation: READ-ONLY verification. Safe to run at any time.
-- Every statement is a SELECT; nothing is created, modified, or deleted.

-- 1) All four tables exist.
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'artsoul_staff_passkeys',
    'artsoul_webauthn_challenges',
    'artsoul_staff_enrollment_grants',
    'artsoul_staff_auth_events'
  )
ORDER BY table_name;

-- 2) RLS is enabled AND forced on all four tables (expect 4 rows, both true).
SELECT relname, relrowsecurity AS rls_enabled, relforcerowsecurity AS rls_forced
FROM pg_class
WHERE relnamespace = 'public'::regnamespace
  AND relname IN (
    'artsoul_staff_passkeys',
    'artsoul_webauthn_challenges',
    'artsoul_staff_enrollment_grants',
    'artsoul_staff_auth_events'
  )
ORDER BY relname;

-- 3) anon/authenticated hold NO privileges on these tables (expect 0 rows).
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN (
    'artsoul_staff_passkeys',
    'artsoul_webauthn_challenges',
    'artsoul_staff_enrollment_grants',
    'artsoul_staff_auth_events'
  )
  AND grantee IN ('anon', 'authenticated')
ORDER BY table_name, grantee;

-- 4) The active-bootstrap partial unique index exists (expect 1 row). It is
--    scoped to unconsumed AND unrevoked rows, so an expired unused bootstrap
--    grant can still be superseded/replaced.
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname = 'idx_artsoul_enrollment_grants_active_bootstrap';

-- 5) Credential IDs are unique (expect a UNIQUE index on credential_id).
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'artsoul_staff_passkeys'
  AND indexdef ILIKE '%UNIQUE%'
  AND indexdef ILIKE '%credential_id%';

-- 6) Grants store only a token hash: no raw-token column exists (expect 0).
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'artsoul_staff_enrollment_grants'
  AND column_name ILIKE '%token%'
  AND column_name NOT ILIKE '%hash%';

-- 7) No IP or user-agent columns exist in the audit table (expect 0 rows).
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'artsoul_staff_auth_events'
  AND (column_name ILIKE '%ip%' OR column_name ILIKE '%agent%');

-- 8) The four atomic RPCs exist, are SECURITY DEFINER, and pin search_path
--    (expect 4 rows with prosecdef = true and a search_path config).
SELECT p.proname, p.prosecdef, p.proconfig
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'a8a_issue_enrollment_grant',
    'a8a_complete_registration',
    'a8a_revoke_credential',
    'a8a_complete_authentication'
  )
ORDER BY p.proname;

-- 9) Only service_role may execute the RPCs; anon/authenticated cannot
--    (expect zero anon/authenticated EXECUTE rows).
SELECT r.routine_name, p.grantee, p.privilege_type
FROM information_schema.routine_privileges p
JOIN information_schema.routines r ON r.specific_name = p.specific_name
WHERE r.routine_schema = 'public'
  AND r.routine_name IN (
    'a8a_issue_enrollment_grant',
    'a8a_complete_registration',
    'a8a_revoke_credential',
    'a8a_complete_authentication'
  )
  AND p.grantee IN ('anon', 'authenticated')
ORDER BY r.routine_name, p.grantee;

-- 10) At most one active bootstrap grant, and bootstrap-consumed count
--     (expect active_bootstrap <= 1).
SELECT
  COUNT(*) FILTER (WHERE purpose = 'bootstrap' AND consumed_at IS NULL AND revoked_at IS NULL) AS active_bootstrap,
  COUNT(*) FILTER (WHERE purpose = 'bootstrap' AND consumed_at IS NOT NULL) AS consumed_bootstrap
FROM public.artsoul_staff_enrollment_grants;
