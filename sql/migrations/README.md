# SQL Migration Status

See `docs/security/MIGRATION_RUNBOOK.md` before running any SQL.

## Active Indexer Sequence

The reproducible indexer sequence is:

1. `001_core_indexer_schema.sql`
2. `002_auction_state_schema.sql`
3. `003_resilience_schema.sql`
4. `../../src/indexer/migrations/004_distributed_locks.sql`
5. `../../src/indexer/migrations/005_event_idempotency.sql`
6. `../../src/indexer/migrations/006_ownership_observability.sql`
7. `../../src/indexer/migrations/007_outbox_pattern.sql`
8. `../../src/indexer/migrations/008_reorg_handling.sql`
9. `../../src/indexer/migrations/009_event_queue_spillover.sql`
10. `../../src/indexer/migrations/010_v4_1_event_lifecycle.sql`
11. `../../src/indexer/migrations/011_discovery_social_signals.sql`
12. `../../src/indexer/migrations/012_indexer_base_runtime_tables.sql`
13. `../../src/indexer/migrations/013_chain_scoped_v41_projections.sql`

Use `node scripts/apply-migrations.js` for a dry run. Existing production databases require manual baseline reconciliation first.

## Superseded Security Files

- `security_hardening.sql`: do not apply.
- `rls_wallet_fix.sql`: do not apply.
- `phase18_7a_supabase_security_hardening.sql`: prior partial classification.
- `phase18_7b_supabase_security_hardening.sql`: current reviewed proposal, manual application only.

All remaining SQL files are feature/manual migrations. Their presence in this directory does not prove they were applied to any environment.
