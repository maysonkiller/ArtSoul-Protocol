# Database Migration Runbook

This runbook is the authoritative operational path for the current ArtSoul repository. It is intentionally conservative: production predates the checksum ledger, so no script may guess which migrations were applied.

## Migration Families

| Location | Purpose | Treatment |
| --- | --- | --- |
| `sql/migrations/001_core_indexer_schema.sql` through `003_resilience_schema.sql` | Base indexer schema | First three migrations in the indexer sequence. Managed by `scripts/apply-migrations.js` for fresh or already-ledgered environments. |
| `src/indexer/migrations/004_*.sql` through `013_*.sql` | Active indexer and V4.1 projections | Remaining ten migrations in the same sequence. Managed by `scripts/apply-migrations.js`. |
| Other files in `sql/migrations/` | Feature, auth, AI, moderation, observability, and security changes | Manually reviewed migrations. Their production status must be recorded explicitly; filename order is not an execution plan. |
| `migrations/001_ai_integration.sql` | Early AI integration migration | Historical/manual. Verify schema before use; do not assume it belongs to the indexer 001-013 sequence. |

The one-off scripts `scripts/apply-outbox-migration.js`, `scripts/apply-reorg-migration.js`, and `scripts/run-migration-009.js` are historical utilities. Do not use them for new environments because they do not provide a complete sequence, advisory lock, or checksum ledger.

## Security Migration Status

- `security_hardening.sql`: **SUPERSEDED, DO NOT APPLY**. It grants direct authenticated writes that conflict with the current server-write boundary.
- `rls_wallet_fix.sql`: **SUPERSEDED, DO NOT APPLY**. It depends on legacy authenticated JWT wallet claims and direct client writes.
- `phase18_7a_supabase_security_hardening.sql`: prior partial classification.
- `phase18_7b_supabase_security_hardening.sql`: current proposed classification. It is not automatically applied and must pass the procedure below.

## Existing Production Database

Do not run `node scripts/apply-migrations.js --apply` against production until the baseline is reconciled.

1. Create a database backup and a schema-only export using the Supabase-supported backup path.
2. Run `sql/verification/phase_a_security_verification.sql`. Export every result grid with timestamp and project/environment name. Do not include keys.
3. Compare the live tables, columns, indexes, functions, and views with indexer migrations 001-013. Record each migration as `verified-present`, `verified-absent`, or `requires-review`.
4. Compare SHA-256 checksums from the dry run:

   ```bash
   node scripts/apply-migrations.js
   ```

5. Do **not** insert ledger rows merely because a similarly named table exists. An operator must verify the complete migration effect and checksum first.
6. Review `phase18_7b_supabase_security_hardening.sql` against the pre-change export. Add any newly discovered table to exactly one classification before applying.
7. Apply Phase 18.7b manually in the Supabase SQL editor. It is one transaction.
8. Re-run the verification file. Expected results:
   - no unclassified application-owned table;
   - no public application table with RLS disabled or not forced;
   - no non-SELECT grant for `anon` or `authenticated`;
   - no client grant on an internal table;
   - no unreviewed client-executable `SECURITY DEFINER` function.
9. Smoke test public reads, profile save, discovery signals, signed upload, moderation access, SIWE sign-in, and indexer health.
10. Only after steps 1-9 are evidenced may the live baseline be entered into `artsoul_schema_migrations`. Baseline insertion is a manual database-owner action and is not automated by this repository.

If any verification result is unexpected, stop. Roll back using the database backup or the transaction before continuing; do not edit production until the classification is understood.

## Fresh Or Already-Ledgered Environment

1. Set a database URL in the process environment. Never put it in the command line or repository.
2. Set a non-secret environment label:

   ```bash
   export ARTSOUL_MIGRATION_ENVIRONMENT=preview
   ```

3. List the exact 001-013 sequence and checksums without modifying the database:

   ```bash
   node scripts/apply-migrations.js
   ```

4. Review the list, then apply intentionally:

   ```bash
   node scripts/apply-migrations.js --apply
   ```

The runner:

- rejects a missing or duplicated sequence number;
- obtains a PostgreSQL advisory lock;
- applies one migration per transaction;
- records source path, SHA-256, environment, timestamp, and database role;
- skips an exact already-applied checksum;
- stops on a changed checksum for an applied migration.

Feature/manual migrations still require an explicit reviewed procedure. The indexer runner does not silently execute every SQL file in the repository.

## Rollback Policy

Most migrations are forward-only. Do not improvise destructive down migrations on production. For a failed uncommitted migration, the runner rolls back that migration transaction. For a committed migration defect, stop writes, preserve evidence, restore from the approved backup if required, and prepare a new reviewed forward migration.
