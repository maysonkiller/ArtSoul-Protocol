-- A8a FOUNDER-OPERATED ONE-TIME BOOTSTRAP ENROLLMENT GRANT.
--
-- Run manually with the service role in the Supabase SQL editor AFTER the
-- a8a_moderation_passkey_foundation.sql migration is applied and verified.
-- This is intentionally NOT reachable from any public browser or API route.
--
-- WHAT IT DOES (one transaction, via the atomic issue RPC):
--   * generates a fresh 256-bit one-time bearer token;
--   * stores ONLY its SHA-256 hash in the grant row;
--   * writes the grant_issued audit event;
--   * DISPLAYS THE RAW TOKEN EXACTLY ONCE in the query result.
-- The raw token is never persisted or logged. Copy it from the result,
-- transfer it out-of-band to the enrolling device, and enroll the first
-- passkey. After enrollment the grant is consumed and can never be reused.
--
-- SAFE RETRY: if a previous bootstrap grant EXPIRED UNUSED, the issue RPC
-- supersedes it (auditable) and issues a fresh one, so an expired row can
-- never permanently lock the founder out. If an ACTIVE unexpired bootstrap
-- grant already exists, the RPC raises A8A_ACTIVE_BOOTSTRAP_EXISTS (revoke
-- it first if you must replace it). Once ANY bootstrap grant has been
-- consumed or a bootstrap credential exists, the RPC raises
-- A8A_BOOTSTRAP_ALREADY_ESTABLISHED and no further bootstrap can be issued.
--
-- Before running, replace the two psql-style placeholders:
--   :founder_wallet   lowercase 0x wallet that will enroll the first passkey
--                     (must already hold an active artsoul_staff_roles row)
--   :ttl_minutes      grant validity window in minutes (tunable operational
--                     value; it only bounds how long the enrollment page can
--                     consume this grant)

BEGIN;

WITH token AS (
    -- 32 CSPRNG bytes rendered as hex = 256 bits of entropy.
    SELECT encode(gen_random_bytes(32), 'hex') AS raw
),
issued AS (
    SELECT
        token.raw AS raw_token,
        public.a8a_issue_enrollment_grant(
            LOWER(:'founder_wallet'),
            'bootstrap',
            'founder-bootstrap-runbook',
            -- Hash format MUST match the application: SHA-256 of the UTF-8
            -- token string, lowercase hex.
            encode(sha256(convert_to(token.raw, 'UTF8')), 'hex'),
            NOW() + MAKE_INTERVAL(mins => :ttl_minutes)
        ) AS grant_id
    FROM token
)
SELECT
    grant_id,
    raw_token AS one_time_enrollment_token,
    'Copy the token now; it is shown only once and is not stored.' AS notice
FROM issued;

COMMIT;
