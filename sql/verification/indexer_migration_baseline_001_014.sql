-- ArtSoul indexer migrations 001-014: read-only production baseline check.
--
-- Run this file section-by-section in the Supabase SQL editor. Export every
-- result grid with the execution timestamp and environment name. This script
-- does not create the migration ledger and does not modify schema or data.
-- Keep the transaction open through Sections 0-12, then run ROLLBACK.

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '30s';

-- Section 0. Context stamp.
SELECT NOW() AS verified_at,
       current_database() AS database_name,
       current_user AS database_role;

-- Section 1. Migration ledger presence. Do not create it from this script.
SELECT to_regclass('public.artsoul_schema_migrations') AS migration_ledger;

-- If Section 1 is non-null, select and export the ledger in a separate editor
-- tab. Do not uncomment this line when the ledger is absent.
-- SELECT migration_id, source_path, sha256, environment, applied_at, applied_by
-- FROM public.artsoul_schema_migrations ORDER BY migration_id;

-- Section 2. Table presence matrix for migrations 001-014.
WITH expected(migration, object_name) AS (VALUES
    ('001', 'indexer_state'),
    ('001', 'indexed_auctions'),
    ('001', 'indexed_bids'),
    ('001', 'contract_events'),
    ('001', 'block_confirmations'),
    ('002', 'indexed_withdrawals'),
    ('003', 'indexer_errors'),
    ('003', 'reorg_events'),
    ('003', 'retry_queue'),
    ('004', 'distributed_locks'),
    ('005', 'event_processing_registry'),
    ('007', 'outbox_events'),
    ('008', 'block_hashes'),
    ('009', 'event_queue_spillover'),
    ('010', 'v41_artworks'),
    ('010', 'v41_auctions'),
    ('010', 'v41_bids'),
    ('010', 'v41_bid_withdrawals'),
    ('010', 'v41_auction_extensions'),
    ('010', 'v41_auction_endings'),
    ('010', 'v41_settlements'),
    ('010', 'v41_floor_history'),
    ('010', 'v41_resale_listings'),
    ('010', 'v41_resale_history'),
    ('010', 'v41_project_eligibility'),
    ('010', 'v41_genesis_holders'),
    ('010', 'v41_trust_signals'),
    ('011', 'artwork_social_signals'),
    ('012', 'indexer_state'),
    ('012', 'contract_events'),
    ('012', 'indexer_errors')
)
SELECT migration,
       object_name,
       CASE WHEN to_regclass('public.' || object_name) IS NOT NULL
            THEN 'present' ELSE 'MISSING' END AS status
FROM expected
ORDER BY migration, object_name;

-- Section 3. Required extensions.
SELECT extname
FROM pg_extension
WHERE extname IN ('pgcrypto', 'uuid-ossp')
ORDER BY extname;

-- Section 4. Column shapes that distinguish overlapping migrations.
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
      'indexer_state', 'contract_events', 'indexer_errors',
      'event_processing_registry', 'block_hashes',
      'artwork_social_signals', 'outbox_events',
      'event_queue_spillover', 'distributed_locks'
  )
ORDER BY table_name, ordinal_position;

-- Section 5. Migration 013 chain scoping.
WITH scoped(object_name) AS (VALUES
    ('indexer_state'), ('event_processing_registry'), ('block_hashes'),
    ('contract_events'), ('indexer_errors'),
    ('v41_artworks'), ('v41_auctions'), ('v41_bids'),
    ('v41_bid_withdrawals'), ('v41_auction_extensions'),
    ('v41_auction_endings'), ('v41_settlements'), ('v41_floor_history'),
    ('v41_resale_listings'), ('v41_resale_history'),
    ('v41_project_eligibility'), ('v41_genesis_holders'),
    ('v41_trust_signals'), ('artwork_social_signals')
)
SELECT s.object_name,
       CASE
           WHEN to_regclass('public.' || s.object_name) IS NULL
               THEN 'table MISSING'
           WHEN EXISTS (
               SELECT 1
               FROM information_schema.columns c
               WHERE c.table_schema = 'public'
                 AND c.table_name = s.object_name
                 AND c.column_name = 'chain_id'
           ) THEN 'chain_id present'
           ELSE 'chain_id MISSING'
       END AS status
FROM scoped s
ORDER BY s.object_name;

-- Section 6. Primary keys and unique constraints. Compare composite keys with
-- migration 013 before assigning verified-present status.
SELECT c.conrelid::regclass AS table_name,
       c.conname,
       pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
JOIN pg_namespace n ON n.oid = c.connamespace
WHERE n.nspname = 'public'
  AND c.contype IN ('p', 'u')
  AND c.conrelid::regclass::text IN (
      'indexer_state', 'contract_events', 'event_processing_registry',
      'block_hashes', 'v41_artworks', 'v41_auctions', 'v41_bids',
      'v41_bid_withdrawals', 'v41_auction_extensions',
      'v41_auction_endings', 'v41_settlements', 'v41_floor_history',
      'v41_resale_listings', 'v41_resale_history',
      'v41_project_eligibility', 'v41_genesis_holders',
      'v41_trust_signals', 'artwork_social_signals',
      'indexed_auctions', 'indexed_bids', 'indexed_withdrawals',
      'outbox_events', 'event_queue_spillover', 'distributed_locks',
      'retry_queue', 'reorg_events', 'indexer_errors',
      'block_confirmations'
  )
ORDER BY 1, 2;

-- Section 7. Function signatures and live bodies. The migration 014 target is
-- the two-argument rollback function with both schema guards and chain scope.
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS args,
       p.prosrc ILIKE '%to_regclass(''public.indexed_auctions'')%'
           AS has_014_auctions_guard,
       p.prosrc ILIKE '%to_regclass(''public.indexed_bids'')%'
           AS has_014_bids_guard,
       p.prosrc ILIKE '%target_chain_id%' AS chain_scoped_013_or_014,
       p.prosrc ILIKE '%indexed_auctions%' AS touches_legacy_tables,
       length(p.prosrc) AS body_length
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
      'update_updated_at_column', 'mark_events_confirmed',
      'rollback_events_from_block', 'cleanup_expired_locks',
      'compute_event_hash'
  )
ORDER BY p.proname, args;

-- Section 7b. Exact signature presence matrix.
SELECT
    to_regprocedure('public.update_updated_at_column()')
        AS m002_update_updated_at,
    to_regprocedure('public.mark_events_confirmed(bigint,integer)')
        AS m003_mark_events_confirmed,
    to_regprocedure('public.cleanup_expired_locks()')
        AS m004_cleanup_expired_locks,
    to_regprocedure(
        'public.compute_event_hash(character varying,integer,character varying,jsonb)'
    ) AS m005_or_013_hash_4arg,
    to_regprocedure(
        'public.compute_event_hash(numeric,character varying,integer,character varying,jsonb)'
    ) AS m013_hash_5arg,
    to_regprocedure('public.rollback_events_from_block(bigint)')
        AS rollback_1arg_wrapper,
    to_regprocedure('public.rollback_events_from_block(bigint,numeric)')
        AS m013_014_rollback_2arg;

-- Section 8. Index inventory for every indexer table.
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN (
      'indexer_state', 'indexed_auctions', 'indexed_bids',
      'contract_events', 'block_confirmations', 'indexed_withdrawals',
      'indexer_errors', 'reorg_events', 'retry_queue', 'distributed_locks',
      'event_processing_registry', 'outbox_events', 'block_hashes',
      'event_queue_spillover', 'v41_artworks', 'v41_auctions',
      'v41_bids', 'v41_bid_withdrawals', 'v41_auction_extensions',
      'v41_auction_endings', 'v41_settlements', 'v41_floor_history',
      'v41_resale_listings', 'v41_resale_history',
      'v41_project_eligibility', 'v41_genesis_holders',
      'v41_trust_signals', 'artwork_social_signals'
  )
ORDER BY tablename, indexname;

-- Section 9. Triggers from migration 002.
SELECT tgname, tgrelid::regclass AS table_name
FROM pg_trigger
WHERE NOT tgisinternal
  AND tgname IN (
      'update_auctions_updated_at', 'update_withdrawals_updated_at'
  );

-- Section 10. The chain-scoped migration 013 view includes chain_id.
SELECT viewname,
       definition ILIKE '%chain_id%' AS chain_scoped_013_version
FROM pg_views
WHERE schemaname = 'public'
  AND viewname = 'v41_project_eligibility_signals';

-- Section 11. Runtime evidence snapshot. The V4.1 tables below were already
-- confirmed present in the Phase A production audit.
SELECT * FROM public.indexer_state ORDER BY chain_id;

SELECT (SELECT count(*) FROM public.contract_events) AS contract_events_rows,
       (SELECT count(*) FROM public.v41_artworks) AS v41_artworks_rows,
       (SELECT count(*) FROM public.v41_auctions) AS v41_auctions_rows,
       (SELECT count(*) FROM public.v41_bids) AS v41_bids_rows;

-- Section 12. Migration 014 comment stamp.
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS args,
       obj_description(p.oid, 'pg_proc') AS comment
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'rollback_events_from_block'
ORDER BY args;

ROLLBACK;
