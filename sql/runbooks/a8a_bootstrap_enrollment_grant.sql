-- A8a FOUNDER-OPERATED ONE-TIME BOOTSTRAP ENROLLMENT GRANT.
--
-- Run manually with the service role in the Supabase SQL editor AFTER the
-- a8a_moderation_passkey_foundation.sql migration is applied and verified.
-- This is intentionally NOT reachable from any public browser or API route.
--
-- Before running, replace the two psql-style placeholders below:
--   :founder_wallet   lowercase 0x wallet that will enroll the first passkey
--                     (must already hold an active artsoul_staff_roles row)
--   :ttl_minutes      grant validity window in minutes (tunable operational
--                     value; it only bounds how long the enrollment page can
--                     consume this grant)
--
-- The whole procedure is ONE transaction: the grant and its audit record
-- are created together or not at all. Re-running the script fails on the
-- single-bootstrap partial unique index
-- (idx_artsoul_enrollment_grants_single_bootstrap), so at most one
-- bootstrap grant can ever exist, consumed or not.

BEGIN;

WITH inserted_grant AS (
    INSERT INTO public.artsoul_staff_enrollment_grants (
        target_wallet,
        purpose,
        issued_by,
        expires_at
    ) VALUES (
        LOWER(:'founder_wallet'),
        'bootstrap',
        'founder-bootstrap-runbook',
        NOW() + MAKE_INTERVAL(mins => :ttl_minutes)
    )
    RETURNING id, target_wallet, expires_at
)
INSERT INTO public.artsoul_staff_auth_events (
    wallet_address,
    event_type,
    details
)
SELECT
    target_wallet,
    'grant_issued',
    JSONB_BUILD_OBJECT(
        'purpose', 'bootstrap',
        'grant_id', id,
        'issued_by', 'founder-bootstrap-runbook',
        'expires_at', expires_at
    )
FROM inserted_grant;

COMMIT;

-- Post-run check (read-only): expect exactly one row.
SELECT id, target_wallet, purpose, issued_at, expires_at, consumed_at
FROM public.artsoul_staff_enrollment_grants
WHERE purpose = 'bootstrap';
