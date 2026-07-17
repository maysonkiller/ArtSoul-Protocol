# Database Migration Runbook

This runbook is the authoritative operational path for the current ArtSoul repository. It is intentionally conservative: production predates the checksum ledger, so no script may guess which migrations were applied.

## Migration Families

| Location | Purpose | Treatment |
| --- | --- | --- |
| `sql/migrations/001_core_indexer_schema.sql` through `003_resilience_schema.sql` | Base indexer schema | First three migrations in the indexer sequence. Managed by `scripts/apply-migrations.js` for fresh or already-ledgered environments. |
| `src/indexer/migrations/004_*.sql` through `014_*.sql` | Active indexer and V4.1 projections | Remaining eleven migrations in the same sequence. Managed by `scripts/apply-migrations.js`. |
| Other files in `sql/migrations/` | Feature, auth, AI, moderation, observability, and security changes | Manually reviewed migrations. Their production status must be recorded explicitly; filename order is not an execution plan. |
| `migrations/001_ai_integration.sql` | Early AI integration migration | Historical/manual. Verify schema before use; do not assume it belongs to the indexer 001-014 sequence. |

The one-off scripts `scripts/apply-outbox-migration.js`, `scripts/apply-reorg-migration.js`, and `scripts/run-migration-009.js` are historical utilities. Do not use them for new environments because they do not provide a complete sequence, advisory lock, or checksum ledger.

## Security Migration Status

- `security_hardening.sql`: **SUPERSEDED, DO NOT APPLY**. It grants direct authenticated writes that conflict with the current server-write boundary.
- `rls_wallet_fix.sql`: **SUPERSEDED, DO NOT APPLY**. It depends on legacy authenticated JWT wallet claims and direct client writes.
- `phase18_7a_supabase_security_hardening.sql`: prior partial classification.
- `phase18_7b_supabase_security_hardening.sql`: current public-schema classification. Applied to production on 2026-07-17 after backup and pre-change verification. Other environments must still follow the procedure below.
- `phase18_7c_supabase_storage_hardening.sql`: current `storage.objects` policy hardening for the `artworks` bucket. Applied to production on 2026-07-17 after backup and pre-change verification. Other environments must still follow the storage procedure below.

## Production Application Record (2026-07-17)

- A custom-format full backup and a separate schema-only backup were created and validated before any write.
- The complete verification report was captured before and after application.
- Phase 18.7b and Phase 18.7c each committed as one transaction.
- Post-change state: all 37 public tables have RLS enabled and forced; client non-SELECT grants are zero; the artworks bucket has zero direct client write policies and exactly one public read policy, `artsoul_artworks_public_read`.
- Production public API and existing artwork-media reads remained available after application.
- This record does not reconcile the historical migration ledger and does not complete bucket guardrails or authenticated upload/SIWE smoke tests.

## Existing Production Database

Do not run `node scripts/apply-migrations.js --apply` against production until the baseline is reconciled.

1. Create a database backup and a schema-only export using the Supabase-supported backup path.
2. Run `sql/verification/phase_a_security_verification.sql`. Export every result grid with timestamp and project/environment name. Do not include keys.
3. Run `sql/verification/indexer_migration_baseline_001_014.sql` section-by-section. Export every result grid with timestamp and project/environment name. The script opens a read-only transaction and ends with `ROLLBACK`; never replace it with `COMMIT`.
4. Compare the live tables, columns, indexes, functions, and views with indexer migrations 001-014. Record each migration as `verified-present`, `verified-absent`, or `requires-review`.
5. Compare SHA-256 checksums from the dry run:

   ```bash
   node scripts/apply-migrations.js
   ```

6. Do **not** insert ledger rows merely because a similarly named table exists. An operator must verify the complete migration effect and checksum first.
7. Review `phase18_7b_supabase_security_hardening.sql` against the pre-change export. Add any newly discovered table to exactly one classification before applying.
8. Apply Phase 18.7b manually in the Supabase SQL editor. It is one transaction.
9. Re-run the verification file. Expected results:
   - no unclassified application-owned table;
   - no public application table with RLS disabled or not forced;
   - no non-SELECT grant for `anon` or `authenticated`;
   - no client grant on an internal table;
   - no unreviewed client-executable `SECURITY DEFINER` function.
10. Smoke test public reads, profile save, discovery signals, signed upload, moderation access, SIWE sign-in, and indexer health.
11. Only after steps 1-10 are evidenced may the live baseline be entered into `artsoul_schema_migrations`. Baseline insertion is a manual database-owner action and is not automated by this repository.

If any verification result is unexpected, stop. Roll back using the database backup or the transaction before continuing; do not edit production until the classification is understood.

## Supabase Storage Hardening (Phase 18.7c)

This targets `storage.objects` policies for the `artworks` bucket only. It does not modify `storage.buckets` or any object data, and it does not touch other buckets.

Background: signed uploads do not need client write policies. The server creates a short-lived signed upload URL with the service_role key (`src/api/routes/upload/file.js` → `supabaseStorageRest('object/upload/sign/...')` in `src/api/backend.js`). The service_role bypasses RLS, and the signed upload token authorizes the single object write on the storage server. Neither path consults an anon/authenticated INSERT/UPDATE/DELETE policy, so removing those policies does not break uploads. Public reads keep working because the bucket is public and one canonical SELECT policy is retained.

Pre-application (do not skip):

1. Confirm a current database backup exists (the same backup taken for 18.7b is sufficient if nothing changed since).
2. Run section 8 of `sql/verification/phase_a_security_verification.sql`. Export the 8a full inventory, 8b write-policy, 8c select-policy, and 8d aggregate grids with timestamp and environment. Expected before: multiple duplicate SELECT rows and the observed INSERT/UPDATE/DELETE rows; 8d shows `write_policies > 0` and `select_policies > 1`.
3. Review `phase18_7c_supabase_storage_hardening.sql`. If 8a shows a write or artworks SELECT policy whose name is not in the migration's explicit `DROP` list, confirm the defensive sweep would match it (it references the `artworks` bucket in `qual`/`with_check`); if a bucket-agnostic write policy such as `Authenticated users can upload` also serves another bucket, decide and record whether that bucket should keep direct writes before applying.

Application:

4. Apply `phase18_7c_supabase_storage_hardening.sql` manually in the Supabase SQL editor. It is one transaction.

Post-application:

5. Re-run section 8. Expected after: 8b returns zero rows; 8c returns exactly one row, `artsoul_artworks_public_read`; 8d returns `write_policies = 0` and `select_policies = 1`; `storage.buckets` unchanged (artworks still `public = true`).
6. Smoke test, in the deployed app, a wallet-authenticated artwork upload (must still succeed through the server signed-URL path) and an unauthenticated public read of an existing artwork object (must still load).
7. Confirm, using an anon/authenticated client key, that a direct client INSERT/UPDATE/DELETE to `storage.objects` for the artworks bucket is now rejected.

Bucket guardrails (required defense in depth):

8. In the Supabase Storage dashboard, edit the `artworks` bucket. Do not update Supabase-managed `storage.buckets` rows with handwritten SQL.
9. Set the file-size limit to **100 MB** (`104857600` bytes).
10. Set the allowed MIME types to the same boundary enforced by `src/api/routes/upload/file.js`:

    ```text
    image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime,audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/ogg,audio/aac,audio/mp4,application/json
    ```

    `application/json` is required for the metadata upload path. The bucket limit is shared, so the stricter 256 KB metadata limit remains enforced by the server route.
11. Re-run verification section 8 and retain the bucket row showing the expected limit and MIME allowlist. Smoke-test one supported media upload and one metadata upload. Also verify that an unsupported MIME type and an upload larger than 100 MB are rejected.

If any post-application result is unexpected, roll back with the transaction or restore from backup; a public bucket with no SELECT policy still serves public downloads, but re-run until 8c shows exactly the canonical policy.

## Fresh Or Already-Ledgered Environment

1. Set a database URL in the process environment. Never put it in the command line or repository.
2. Set a non-secret environment label:

   ```bash
   export ARTSOUL_MIGRATION_ENVIRONMENT=preview
   ```

3. List the exact 001-014 sequence and checksums without modifying the database:

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

## Production Forward Fix 014

Migration `014_schema_aware_reorg_rollback.sql` replaces only the chain-scoped rollback function. It does not change tables, indexed events, cursors, confirmation depth, or contract data. It prevents rollback from failing when a deployment does not contain the superseded `indexed_auctions` and `indexed_bids` tables.

Production currently predates the checksum ledger. Therefore, do not use `scripts/apply-migrations.js --apply` for this forward fix until the baseline procedure above is complete.

After this migration is merged and the operator has explicit approval to modify production:

1. Create and verify a current database backup.
2. Record the current `indexer_state` row for chain `84532` and the current row counts for `contract_events`, `v41_artworks`, `v41_auctions`, and `v41_bids`.
3. Review and apply only `src/indexer/migrations/014_schema_aware_reorg_rollback.sql` in the Supabase SQL editor. The statement is idempotent because it uses `CREATE OR REPLACE FUNCTION`.
4. Confirm `to_regprocedure('public.rollback_events_from_block(bigint,numeric)')` is present. Do not invoke the rollback function as a smoke test against live indexed blocks.
5. Restart the Base Sepolia indexer and verify `/health` remains healthy, `confirmationDepthSyncError` is null, and indexed cursors continue advancing.
6. Monitor the indexer logs through the next real reorg check. The prior `relation "indexed_auctions" does not exist` and `relation "indexed_bids" does not exist` errors must not recur.

Rollback, if required, is a database restore or a new reviewed forward migration. Do not restore the pre-014 function because it is incompatible with the observed production schema.

## Rollback Policy

Most migrations are forward-only. Do not improvise destructive down migrations on production. For a failed uncommitted migration, the runner rolls back that migration transaction. For a committed migration defect, stop writes, preserve evidence, restore from the approved backup if required, and prepare a new reviewed forward migration.
