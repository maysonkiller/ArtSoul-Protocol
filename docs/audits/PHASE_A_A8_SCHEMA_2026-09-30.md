# Phase A dormant A8 schema verification — 2026-09-30

Canonical checkout: `C:\Projects\ArtSoul`, branch `codex/takeover-audit`.
Application source: `9dcf82bda0619e1009dcdadc0268f63b78f7a6f8`, released through
[PR #282](https://github.com/maysonkiller/ArtSoul-Protocol/pull/282).
Dates use Warsaw local time; private evidence retains UTC timestamps.

## Reproduction and cause

The released recipient notification endpoint accepted a real Base Sepolia SIWE
session but returned `503 NOTIFICATIONS_UNAVAILABLE`. The same session correctly
rejected a mismatching wallet with 401 and an invalid cursor with 400. Read-only
catalog inspection confirmed that all eight A8 tables and all seven A8 RPCs were
absent. The notification query therefore had no backing table. This was an
unapplied schema dependency, not an authentication failure.

## Authorized preparation

The founder separately authorized the necessary live-service work. This operation
prepared the reviewed dormant schema only. Bible section 11 and the Phase A
activation criteria still apply; real founder passkeys and recovery remain
deferred under the September 29 amendment. No passkey, role, bootstrap grant,
report, moderation decision, recovery request or notification was inserted.

Preflight verified the exact project, PostgreSQL 17.6, prerequisites, existing
moderation RPC, client denial and schema defaults. Connections used verified TLS
with the official Supabase CA. No TLS checks or global trust settings were
disabled. The historical database has no checksum ledger; this agrees with the
July 18 disposition in `docs/security/A1_SECURITY_AND_MIGRATION_AUDIT.md`.
No historical migration rows were inferred or invented.

Before any DDL, PostgreSQL 18.4 `pg_dump` created a full custom archive and a
separate schema export. The private directory permits only the local operator
and SYSTEM. `pg_restore --list` and a complete archive read succeeded. These
checks establish archive readability; a restore rehearsal was not performed.

| Backup | Bytes | SHA-256 |
| --- | ---: | --- |
| Full archive | 994866 | `da95915a4b60767334374be693c731ed86592eee9ce0b5be9dd3badbf4d1933f` |
| Schema export | 436395 | `e55ec7a02c429a9c9c825240c1b4e48682c749486446709ce43e49932dbac577` |

The unchanged, reviewed migration files ran in this order under the existing
migration advisory lock. Each had its own transaction, five-second lock timeout,
45-second statement timeout and asserted verification before COMMIT. Source and
backup hashes were pinned; an exclusive, flushed private journal records every
stage. No indexer baseline runner was used.

| Migration | SHA-256 of applied file bytes | Result |
| --- | --- | --- |
| `a8a_moderation_passkey_foundation.sql` | `a4a644fde96f8b19fa6148506006474f2da362e03a1d34969a4fbc30c399d6fc` | Committed and verified |
| `a8b_artwork_report_intake.sql` | `45e860468144837a15d410485784bdf56962985de5ac8ac032446d4310bf4571` | Committed and verified |
| `a8c_protocol_admin_review.sql` | `06a02db331ad23f01f64b61dc3e69cedf11515f5b77a05161f98aa86379a52ef` | Committed and verified |
| `a8d_moderation_safe_recovery.sql` | `db60f4d85cf1f826349f437d1ce1c05ee615d25d7cc2aeb5871bba3a5906139e` | Committed and verified |

## Verification and repeat check

- Eight new tables have RLS enabled and forced, with no effective anon or
  authenticated privileges. Service SELECT/INSERT/UPDATE/DELETE were checked
  individually. All eight tables remained empty.
- Seven new RPCs have the exact expected argument signatures, SECURITY DEFINER,
  fixed `search_path=public`, service execution and no client execution.
- Five identity sequences deny effective client access and retain service
  USAGE/SELECT. Unique and partial indexes, restrictive report foreign keys,
  status/event vocabularies, review columns and absence of raw secret columns
  passed stage-specific checks before COMMIT.
- The general security verification has zero unclassified tables, RLS failures,
  client write grants or private-table read grants. All existing public policies
  and Storage results match the before snapshot. There are eight protected
  SECURITY DEFINER functions including the pre-existing moderation function.
- The read-only verifier now classifies the eight A8 tables and three existing
  A11 metric tables. Migration 015 already classified the latter as service-only;
  this corrects the verifier without changing historical migration SQL or rights.
- The helper's assertion review accepted four valid stage fixtures and rejected
  seven deliberately invalid fixtures. The focused documentation/security suite
  passed 32 checks with zero failures/skips.
- On the apex, a fresh real SIWE session now receives **200** with an empty,
  correctly scoped notification list and `private, no-store`. Mismatching wallet
  still returns **401**, invalid cursor **400**, and logout **200**. No blockchain
  transaction was signed by this repeat check.
- Public reporting remains false; moderation access remains disabled; the
  passkey route remains **404 PASSKEY_DISABLED**. These were checked before,
  between and after the migrations. No activation variable was changed.

Private evidence: `phase-a-a8-preflight-2026-09-30.json`,
`phase-a-a8-sequence-defaults-2026-09-30.json`,
`phase-a-db-backup-2026-09-30/manifest.json`,
`phase-a-a8-apply-2026-09-30.json`,
`phase-a-generic-security-{before,after}-2026-09-30.json`,
`phase-a-notification-live-2026-09-29.json`, and
`phase-a-notification-after-schema-2026-09-30.json`, all under ignored
`docs/private/`. Test log: `output/audit/a8-dormant-preparation-final-2026-09-30.log`.
Credentials, sessions, complaint contents and database backups are not public.

## Remaining boundary

The schema is installed and notification reads work. Empty history does not
prove delivery following a real staff decision. Local PostgreSQL complaint,
review and recipient journeys remain engineering evidence; live operator
acceptance, public intake activation, deferred passkey/Safe ceremonies and A10
beta review remain open. No mainnet, DNS, deployed contract, economics, Genesis
eligibility or existing artwork visibility changed. This preparation does not
close A8 or Phase A.
