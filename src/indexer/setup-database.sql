-- Setup PostgreSQL extensions and apply migrations

-- Enable pgcrypto for digest() function
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Apply migrations in order
\i src/indexer/migrations/004_distributed_locks.sql
\i src/indexer/migrations/005_event_idempotency.sql
\i src/indexer/migrations/006_ownership_observability.sql
\i src/indexer/migrations/007_outbox_pattern.sql
\i src/indexer/migrations/008_reorg_handling.sql
\i src/indexer/migrations/009_event_queue_spillover.sql
\i src/indexer/migrations/010_v4_1_event_lifecycle.sql
\i src/indexer/migrations/011_discovery_social_signals.sql
\i src/indexer/migrations/012_indexer_base_runtime_tables.sql
\i src/indexer/migrations/013_chain_scoped_v41_projections.sql

-- Verify setup
SELECT 'Extensions installed:' as status;
SELECT extname FROM pg_extension WHERE extname IN ('pgcrypto');

SELECT 'Tables created:' as status;
SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  AND tablename IN (
    'distributed_locks',
    'event_processing_registry',
    'indexer_state',
    'contract_events',
    'indexer_errors',
    'v41_artworks',
    'v41_auctions',
    'v41_bids',
    'v41_settlements',
    'v41_resale_history',
    'v41_project_eligibility',
    'v41_genesis_holders',
    'artwork_social_signals'
  );

SELECT 'Views created:' as status;
SELECT viewname FROM pg_views WHERE schemaname = 'public'
  AND viewname IN ('v41_project_eligibility_signals');
