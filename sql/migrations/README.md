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
14. `../../src/indexer/migrations/014_schema_aware_reorg_rollback.sql`
15. `../../src/indexer/migrations/015_public_metrics_projection.sql`

Use `node scripts/apply-migrations.js` for a dry run. Existing production databases require manual baseline reconciliation first.

## Superseded Security Files

- `security_hardening.sql`: do not apply.
- `rls_wallet_fix.sql`: do not apply.
- `phase18_7a_supabase_security_hardening.sql`: prior partial classification.
- `phase18_7b_supabase_security_hardening.sql`: current reviewed public-schema proposal, manual application only.
- `phase18_7c_supabase_storage_hardening.sql`: current reviewed `storage.objects` (artworks bucket) proposal, manual application only. Preserves the server-signed upload flow.

All remaining SQL files are feature/manual migrations. Their presence in this directory does not prove they were applied to any environment.

## Exact-media publication foundation

`artwork_media_preparation.sql` is the next private, manual prerequisite. It
records a publication UUID, authenticated wallet, deployment and fixed media /
metadata paths before signing an upload URL. A second service-only RPC pins the
verified bytes and exact metadata JSON once; retries return the same record.
It has explicit grants, revokes and forced RLS and is rehearsed without platform
default grants. It does not release claims or authorize blockchain submission.

The authenticated `POST /api/upload/publication` preparation route is disabled
unless `ARTSOUL_MEDIA_PREPARATION_ENABLED=true` and an explicit
`ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA` exists. Keep it disabled until rollout is
reviewed. `issue` requires a stable `publication_id`, filename, MIME type and
size; only its media upload URL is signed. `prepare` requires that UUID and the
existing artwork metadata shape. It loads wallet-owned issuance, verifies the
original bytes, binds every consumed media/creator alias, pins JSON before a
server-only metadata write and reads the object back before claiming the hash.
No browser-selected path/hash/deployment is authoritative. Both responses say
`can_submit: false`: a matching preparation or existing claim is not permission
to broadcast again. The browser publishing path has not been switched over.

After a successful or uncertain media PUT, non-overwrite upload signing can
return a conflict because the object already exists. Reissuing verifies the
stored raw bytes against the issuance (and any pinned hash) and returns
`upload_complete: true` with `upload: null`; it never authorizes overwrite.
After an uncertain metadata write, only an exact readback match allows progress;
the service does not overwrite or change the fixed path. This follows the
[Supabase standard-upload conflict behavior](https://supabase.com/docs/guides/storage/uploads/standard-uploads)
and [signed-upload upsert rules](https://supabase.com/docs/reference/javascript/file-buckets-uploadtosignedurl).
Actual production storage-policy verification remains a rollout gate.

`artwork_media_identity.sql` is additive preparation for the founder-requested
website check against identical original bytes. It is not in the active indexer
sequence and has not been applied to production. Its private catalog retains
every historical artwork reference, including existing duplicates. The claim
RPC coordinates a single publication identity per deployment/hash; it is not
permission to submit a transaction and introduces no timeout-based release.

Before activation, connect authenticated upload preparation and immutable
metadata verification, persist/recover publication attempts, reconcile verified
registration evidence including reorgs, and record full legacy coverage at a
known deployment/block watermark. Unknown broadcasts must not silently become
new registrations. The unchanged contract accepts direct registrations and
does not enforce this website restriction. New-contract enforcement remains a
separate test-contract/mainnet-preparation decision.
