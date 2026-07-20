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

-- 4) The single-bootstrap partial unique index exists (expect 1 row).
SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname = 'idx_artsoul_enrollment_grants_single_bootstrap';

-- 5) Credential IDs are unique (expect a UNIQUE constraint/index on credential_id).
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'artsoul_staff_passkeys'
  AND indexdef ILIKE '%UNIQUE%'
  AND indexdef ILIKE '%credential_id%';

-- 6) No IP or user-agent columns exist in the audit table (expect 0 rows).
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'artsoul_staff_auth_events'
  AND (column_name ILIKE '%ip%' OR column_name ILIKE '%agent%');

-- 7) At most one bootstrap grant exists (expect count 0 before bootstrap, 1 after).
SELECT COUNT(*) AS bootstrap_grants
FROM public.artsoul_staff_enrollment_grants
WHERE purpose = 'bootstrap';
