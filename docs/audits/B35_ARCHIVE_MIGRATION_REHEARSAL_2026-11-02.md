# B35 — Actual-archive migration rehearsal

Status: local archive restoration and ordered migration checks pass.
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
The disposable database initially belonged to the bootstrap administrator:
`pg_dump` does not include database ownership/ACL. A narrow read-only catalog
query confirmed the live database owner and grants. Those exact grants were
reproduced locally before retrying; the migration actor was not made superuser.
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
This successful local test does not close that separate recovery gate.
