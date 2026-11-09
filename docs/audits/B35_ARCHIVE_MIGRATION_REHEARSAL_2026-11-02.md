# B35 — Actual-archive migration rehearsal

November 9 update: independent encrypted recovery, owner key custody and fresh
archive restoration passed; the five migrations and Core-only worker are now
active. See [the dated evidence](B35_INDEPENDENT_RECOVERY_AND_CORE_CUTOVER_2026-11-09.md).
The open production gates below describe the November 2 rehearsal. NFT/cache
activation and representative capacity remain separate acceptance work.

Status: local archive restoration, ordered migrations and committed-schema
archive restoration checks pass.
Production migrations, worker activation and independent encrypted recovery
remain open. This record does not authorize a downgrade to the older worker.

## Evidence boundary

The rehearsal ran November 2, 2026, 11:57:40–11:58:51 UTC against the actual
November 1 Protocol database archive. It used the November 1 role/membership
catalog and separately observed November 2 database ownership/ACL. No live
records were changed. These snapshots do not establish current runtime grants.

The container used pinned Supabase PostgreSQL image
`sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00`,
network mode `none`, no published ports, a read-only root filesystem and a
temporary database volume. Limits were one CPU, 768 MB RAM and 128 processes.
The validated container was stopped after the run.

The complete archive restored 111 tables / 286,532 rows. All archived COPY
content digests, sequence states and 1,258 ownership/grant/RLS declarations
matched before migrations; no invalid indexes were found. Storage object bytes
are separate from a PostgreSQL archive and are not revalidated by this test.

An earlier attempt stopped safely at `permission denied for database rehearsal`.
The disposable database initially belonged to the bootstrap administrator.
This archive's non-create restore path did not reproduce database ownership/ACL.
A narrow read-only catalog query confirmed the live database owner and grants.
Those exact grants were reproduced locally before retrying; the migration actor
was not made superuser.
The earlier failure is retained in private evidence.

## Ordered candidate

Source was pinned to `f1484c7b5079e9c9b0fff422a54c3c1edc168f92`.
Local migration text was compared with that Git commit before execution.

1. `20261029212603_notification_reorg_identity.sql`
2. `20261029220854_recovery_cache_obligation.sql`
3. `20261101120000_nft_transfer_coverage.sql`
4. `20261101130000_verified_nft_owners.sql`
5. `20261101140000_verified_nft_history.sql`

The rehearsal removed only the verified outer `BEGIN`/`COMMIT` lines and ran
the ordered bodies in one transaction as the catalogued non-superuser
`postgres` role. Statement and lock timeouts bounded execution. The shipped
per-file transaction boundaries remain unchanged.

## Checks that passed

- Rolling back the complete batch preserved the schema and every archived
  table's original-column row count and sorted content digest.
- Committing the batch preserved the same original data. Additive columns were
  tested separately, rather than omitted from the result without explanation.
- Existing indexer rows acquired pending recovery tokens. No NFT coverage or
  verified owner was invented by schema installation.
- `anon` and `authenticated` lacked NFT-reader EXECUTE and coverage SELECT.
  All three Data API roles, including `service_role`, lacked access to the
  private notification identities and EXECUTE on internal recovery/writer
  functions and both rollback overloads.
- Both new tables retained enabled and forced RLS. Data API roles lacked
  INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER privileges.
- `service_role` could invoke all four bounded NFT readers. Missing source
  coverage returned no verified ownership/boundary. These readers remained
  stable, SECURITY INVOKER and owned by `postgres`.
- Reapplying the migrations preserved pending token identities and original
  data. A separate rolled-back scenario preserved an acknowledged NULL token
  alongside a still-pending token; replay did not rearm acknowledged recovery.

## Integrity references

Private evidence contains database contents and is intentionally excluded from
the public repository. Retained SHA-256 identifiers permit local reconciliation.

| Artifact | SHA-256 |
| --- | --- |
| November 1 full database archive | `5105452a4aa9de17329ecf98e9bd2b97d26f37dfb2185abd786790bc97627cd3` |
| November 1 role catalog | `0301571925cf85974f71ba0feb808f2ea488960fbd7fbf21854ff85f97c90e4a` |
| November 2 database-access catalog | `e9f248458181f01bcfa6c34b79393ee092964782f2e92f5b30e72dedc2cae97d` |
| Completed migration rehearsal evidence | `beab87ba31ddc853ed83f6931d609c00843288f7ac3fc25eb2f6791b30d92719` |
| Candidate staging manifest | `0207e80d60654e12976052709bf667e5f8fb40ebfa50f61224f8840fceb6a209` |

The separate private staging bundle includes 27 reachable runtime modules,
five ordered migrations and the package/lock references. Offline verification
passed 27 syntax checks and 34 exact Git-byte comparisons. Package and lock
files match the October 26 candidate; this is not proof of installed remote
versions and is not a reason to run an in-place dependency installation.

## Committed-schema archive restoration

A follow-up ran November 2, 2026, 13:29:07–13:30:57 UTC at reviewed HEAD
`1a43e1b4d16b3c1d8089c492c638ee71e61030d8`. The five migration blobs remain
identical to the earlier candidate. It repeated the original archive/migration
checks, committed local synthetic fixtures, dumped the complete updated database
and restored that dump into a distinct empty database in the isolated cluster.

The updated archive contains 113 tables / 286,536 rows and 22 sequences. Every
COPY column, sorted row digest and sequence state matched. The four additional
rows exercise nonempty coverage, a quarantined notification identity, its outbox
record and recipient read/dismissal state. Pending and acknowledged recovery
tokens coexist. These local fixtures are not real chain coverage or deliveries.

The complete normalized schema matched, including functions, triggers, RLS,
policies, ownership and grants. Normalization removes random dump restrict keys
and line-ending differences and accepts only the two exact equivalent array-cast
spellings in `contract_events_core_auction_history` and
`contract_events_core_resale_token`. PostgreSQL expands the fixed `varchar[]`
to `text[]` cast into per-literal casts after restoration. No other schema text
is omitted. Raw schema dumps are retained; this is not raw byte equality.
Database ACL/owner and extension owner/version also matched separately.

Effective Data API denials and service-only bounded readers passed after
restoration. A matching boundary became readable only inside a rolled-back
token acknowledgement and was closed again afterward. Replaying all five
migrations preserved all restored data, schema and sequence state.

Two further rolled-back scenarios rearmed every restored deployment, first
with pending coverage and then with acknowledged, demonstrably readable
coverage. Fresh tokens invalidated coverage through the shipped trigger and
closed the readers in both cases. Every notification identity, outbox record
and recipient read/dismissal row remained identical inside each transaction;
rollback also restored the prior state. No real Redis/CDN purge was simulated
as completed.

The successful run used a 1 GiB temporary volume and a 1,536 MiB memory
limit; CPU, process and isolation limits stayed unchanged. The original
512 MiB volume attempt stopped on disk exhaustion. Subsequent strict schema
comparison failures exposed the two cast spellings above before narrowly scoped
normalization was reviewed. All failed evidence is retained. Each container was
stopped; no live migration, worker change or billing change occurred.

| Follow-up artifact | SHA-256 |
| --- | --- |
| Completed post-commit rehearsal evidence | `6e7c122425eca586095e1ffbc0732d2e6bb3eb4847657a34f0cd5903b2ec9081` |
| Full updated database SQL archive | `7852d01571566c32fd0b0102e30562d12a6458d537d31271362fbc50956db44d` |
| Matching normalized source/restored schema | `96c9edd1c4d3cd4990139e052f517d12224925ab3c0e2b8f0c6b7d220afd1fc1` |

## Remaining operational acceptance

The newer worker is still not active. Before live changes, reconcile current
remote files, operation journals, actual grants and source/deployment pins;
verify independent encrypted database/object recovery and key custody; then
follow the [migration runbook](../security/MIGRATION_RUNBOOK.md).
Representative RPC/SQL/Redis/CDN usage and real-provider transport remain open.

Transaction rollback is not a committed-schema downgrade rehearsal. After a
committed recovery-schema change, preserve tokens, quarantined identities and
coverage evidence. Disable ownership readers and drain the writer on failure;
use a compatible reviewed forward repair or a consistent restored database with
cache recovery. Blindly reinstalling B30 files can bypass the new obligations.
The compatible committed-schema logical restore is now locally tested above.
Production cutover, later-write reconciliation, real cache/provider recovery,
independent encrypted durability and key custody remain separate open gates.
