-- Phase A read-only Supabase security verification.
-- Run in the Supabase SQL editor before and after Phase 18.7b.
-- Export every result grid with the execution timestamp. This file does not
-- modify schema, data, grants, policies, functions, or storage configuration.

SELECT NOW() AS verified_at, current_database() AS database_name, current_user AS database_role;

-- 1. Every application table must have an explicit security classification.
WITH classified(object_name) AS (
    VALUES
        ('admin_users'), ('ai_suggestions'), ('ai_worker_logs'),
        ('artsoul_schema_migrations'), ('artsoul_staff_roles'),
        ('artwork_moderation_log'), ('artwork_moderation_visibility'),
        ('artwork_social_signals'), ('audit_log'), ('audit_log_entries'),
        ('audit_log_hash_chain'), ('block_confirmations'), ('block_hashes'),
        ('contract_events'), ('distributed_locks'), ('event_processing_registry'),
        ('event_queue_spillover'), ('failed_ai_jobs'), ('failed_events'),
        ('indexed_auctions'), ('indexed_bids'), ('indexed_withdrawals'),
        ('indexer_checkpoints'), ('indexer_errors'), ('indexer_lag'),
        ('indexer_state'), ('moderation_actions'), ('oauth_tokens'),
        ('outbox_events'), ('processed_events'), ('queue_metrics'),
        ('queue_metrics_snapshot'), ('reorg_events'), ('retry_queue'),
        ('rpc_providers'), ('siwe_nonces'), ('system_flags'), ('system_locks'),
        ('system_logs'), ('tx_states'),
        ('ai_valuations'), ('artworks'), ('auctions'), ('bids'),
        ('bids_history'), ('nft_ownership'), ('profiles'), ('secondary_sales'),
        ('token_balances'), ('token_stakes'), ('token_transactions'), ('users'),
        ('votes'), ('v41_artworks'), ('v41_auction_endings'),
        ('v41_auction_extensions'), ('v41_auctions'), ('v41_bid_withdrawals'),
        ('v41_bids'), ('v41_floor_history'), ('v41_genesis_holders'),
        ('v41_project_eligibility'), ('v41_resale_history'),
        ('v41_resale_listings'), ('v41_settlements'), ('v41_trust_signals')
)
SELECT table_name AS unclassified_public_table
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
  AND table_name NOT IN (SELECT object_name FROM classified)
ORDER BY table_name;

-- Expected after hardening: zero rows for application-owned tables.

-- 2. RLS must be enabled and forced on every public application table.
SELECT
    c.relname AS table_name,
    c.relrowsecurity AS rls_enabled,
    c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
  AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)
ORDER BY c.relname;

-- Expected after hardening: zero rows.

-- 3. Client roles must have no write privileges in the public schema.
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated')
  AND privilege_type <> 'SELECT'
ORDER BY table_name, grantee, privilege_type;

-- Expected after hardening: zero rows.

-- 4. Internal tables must not be directly readable by client roles.
WITH internal(table_name) AS (
    VALUES
        ('admin_users'), ('ai_suggestions'), ('ai_worker_logs'),
        ('artsoul_schema_migrations'), ('artsoul_staff_roles'),
        ('artwork_moderation_log'), ('artwork_moderation_visibility'),
        ('artwork_social_signals'), ('audit_log'), ('audit_log_entries'),
        ('audit_log_hash_chain'), ('block_confirmations'), ('block_hashes'),
        ('contract_events'), ('distributed_locks'), ('event_processing_registry'),
        ('event_queue_spillover'), ('failed_ai_jobs'), ('failed_events'),
        ('indexed_auctions'), ('indexed_bids'), ('indexed_withdrawals'),
        ('indexer_checkpoints'), ('indexer_errors'), ('indexer_lag'),
        ('indexer_state'), ('moderation_actions'), ('oauth_tokens'),
        ('outbox_events'), ('processed_events'), ('queue_metrics'),
        ('queue_metrics_snapshot'), ('reorg_events'), ('retry_queue'),
        ('rpc_providers'), ('siwe_nonces'), ('system_flags'), ('system_locks'),
        ('system_logs'), ('tx_states')
)
SELECT grants.grantee, grants.table_name, grants.privilege_type
FROM information_schema.role_table_grants grants
JOIN internal ON internal.table_name = grants.table_name
WHERE grants.table_schema = 'public'
  AND grants.grantee IN ('anon', 'authenticated')
ORDER BY grants.table_name, grants.grantee, grants.privilege_type;

-- Expected after hardening: zero rows.

-- 5. Review all remaining RLS policies. Public tables should expose SELECT only.
SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 6. SECURITY DEFINER functions must never be callable by public client roles.
SELECT
    n.nspname AS function_schema,
    p.proname AS function_name,
    pg_get_function_identity_arguments(p.oid) AS arguments,
    has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
    p.proconfig AS function_settings
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosecdef
ORDER BY p.proname;

-- Expected: client execution is false unless separately reviewed and approved;
-- every SECURITY DEFINER function has a fixed search_path.

-- 7. Migration ledger availability. Export the ledger separately if present.
SELECT
    to_regclass('public.artsoul_schema_migrations') AS migration_ledger,
    to_regclass('public.siwe_nonces') AS siwe_nonces,
    to_regclass('public.artsoul_staff_roles') AS staff_roles,
    to_regclass('public.artwork_moderation_visibility') AS moderation_visibility,
    to_regclass('public.v41_artworks') AS v41_artworks,
    to_regclass('public.v41_auctions') AS v41_auctions,
    to_regclass('public.v41_settlements') AS v41_settlements;

-- 8. Storage is public-read but upload authorization must remain signed/server-side.
SELECT id, name, public, file_size_limit, allowed_mime_types
FROM storage.buckets
ORDER BY id;

-- 8a. Full storage policy inventory (review every row). Export before AND after
--     Phase 18.7c.
SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage'
ORDER BY tablename, policyname;

-- 8b. Direct client WRITE policies on the artworks bucket. These let a client
--     write/overwrite/delete objects without the server's validation.
--     Expected BEFORE Phase 18.7c: the observed INSERT/UPDATE/DELETE rows.
--     Expected AFTER Phase 18.7c: zero rows.
SELECT policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  AND (
        COALESCE(qual, '') ILIKE '%artworks%'
     OR COALESCE(with_check, '') ILIKE '%artworks%'
  )
ORDER BY policyname;

-- 8c. Public SELECT policies referencing the artworks bucket.
--     Expected BEFORE Phase 18.7c: multiple duplicate rows.
--     Expected AFTER Phase 18.7c: exactly one row, artsoul_artworks_public_read.
SELECT policyname, roles, cmd, qual
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND cmd = 'SELECT'
  AND (
        COALESCE(qual, '') ILIKE '%artworks%'
     OR COALESCE(with_check, '') ILIKE '%artworks%'
  )
ORDER BY policyname;

-- 8d. Aggregate check. After Phase 18.7c this must return
--     write_policies = 0 and select_policies = 1.
SELECT
    count(*) FILTER (WHERE cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')) AS write_policies,
    count(*) FILTER (WHERE cmd = 'SELECT') AS select_policies
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND (
        COALESCE(qual, '') ILIKE '%artworks%'
     OR COALESCE(with_check, '') ILIKE '%artworks%'
  );
