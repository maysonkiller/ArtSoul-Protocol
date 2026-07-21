-- Read-only A8c verification. Run only after applying the reviewed migration.

SELECT
    to_regclass('public.artwork_reports') AS reports,
    to_regclass('public.artwork_report_events') AS report_events,
    to_regclass('public.artwork_report_notifications') AS report_notifications,
    to_regprocedure(
        'public.review_artwork_report(uuid,timestamp with time zone,text,text,text)'
    ) AS review_function;

SELECT
    c.relname AS table_name,
    c.relrowsecurity AS rls_enabled,
    c.relforcerowsecurity AS rls_forced
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
      'artwork_reports',
      'artwork_report_events',
      'artwork_report_notifications'
  )
ORDER BY c.relname;

SELECT
    routine_name,
    security_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'review_artwork_report';

SELECT
    table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
      (table_name = 'artwork_reports' AND column_name IN (
          'reviewed_by',
          'reviewed_at',
          'decision_reason'
      ))
      OR (table_name = 'artwork_report_events' AND column_name = 'reason')
  )
ORDER BY table_name, ordinal_position;

-- The replaced status constraint must accept 'resolved' and the notification
-- type list must include 'REPORT_RESOLVED'.
SELECT
    conname,
    pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conname IN (
    'artwork_reports_status_check',
    'artwork_report_notifications_notification_type_check'
)
ORDER BY conname;

SELECT
    table_name,
    grantee,
    privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN (
      'artwork_reports',
      'artwork_report_events',
      'artwork_report_notifications'
  )
  AND grantee IN ('anon', 'authenticated', 'service_role')
ORDER BY table_name, grantee, privilege_type;
