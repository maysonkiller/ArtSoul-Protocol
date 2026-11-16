# Eligibility view caller permissions — November 16, 2026

Status: implemented and verified in isolated PostgreSQL and a complete restored
archive, then applied and verified in production at `2026-11-16T11:33:33Z`.
Repository release evidence remains separate from the database application.

## Scope and current evidence

Before this migration, `public.v41_project_eligibility_signals` used its owner's
table permissions. The November 16 schema backup confirms public SELECT grants
on both the view and its five source tables, with public-read RLS policies.
The view aggregates historical chain records; this review establishes no new
private-data exposure or current Genesis entitlement.

The additive migration
`sql/migrations/20261116112454_eligibility_view_security_invoker.sql` sets only
`security_invoker=true` on that existing view. Its definition, identity, owner,
columns, grants and source data are preserved. Future source-table restrictions
will therefore also constrain view callers. The operation requires PostgreSQL
15 or later and the existing chain-scoped view from indexer migration 013;
an absent prerequisite fails instead of silently skipping the change.

This follows the [Supabase view guidance](https://supabase.com/docs/guides/database/postgres/row-level-security#views).
No function body, function search path, grant, economic parameter, network or
Genesis allocation behavior is changed. The separate 17 mutable-function-path
advisories remain outside this slice.

## Isolated behavioral verification

`node --test test/eligibility-view-security.test.cjs` passed five tests with no
failures or skips on local PostgreSQL 17. The disposable container had no
network and no published ports and was removed afterward. The fixture reuses
the actual migration-013 view definition and covers:

- Two migration applications preserve the view OID, owner, definition, columns,
  ACLs, source data and results for `anon`, `authenticated` and `service_role`.
- Existing public reads remain available; public source-table writes remain
  denied.
- Restrictive source RLS policies constrain browser-role results while the
  service role retains its existing access.
- An underlying SELECT revocation cannot be bypassed through the view grant.

`node --test test/migration-ledger-coverage.test.cjs` passed all eight checks.
The new test passes `node --check`; whitespace checks pass. No full-suite or CI
result is claimed by this local verification.

## Complete archive rehearsal

At `2026-11-16T11:30:30Z`–`11:31:30Z`, a separate offline container restored the
November 16 full archive, retaining the recorded ownership, ACLs, extension
owners and role attributes. The existing B20 profile migration was applied
twice first; the eligibility migration was then applied twice as the
non-superuser `postgres` owner role.

- All 115 archived tables and 783,661 rows passed the original full restore.
- The original 1,314 security declarations and 22 sequence states were verified.
- Before and after each eligibility application, all three roles returned 12
  rows with the same result SHA-256:
  `23ae63c33b3cef0efd7d388bac4045ab8e18427533433380d6e50baeb0878a4c`.
- Full schema comparison found only the intended view option change.
- Full table-content digests and sequence states matched the immediate
  pre-eligibility-migration baseline.
- The container used the pinned Supabase Postgres image, disabled networking,
  no published ports, a read-only image and temporary database storage. It was
  stopped after verification.

Migration SHA-256:
`1769ad7b44ed3caf603212a020f5cbe56a52b2b4104b56635c618adadc20a925`.
The private evidence record is
`protocol-2026-11-16/eligibility-restore-1794828630796-db107d93/evidence.json`
under the existing `.artsoul-recovery` directory. Raw archive data is not
published.

An earlier rehearsal stopped at its final data comparison because that check
compared the pre-B20 archive row shape with B20's added report columns. The
eight report rows remained present. The corrected rehearsal takes its baseline
after B20 and immediately before this migration; the successful run above
supersedes that harness failure without discarding its private evidence.

The archive represents its recorded snapshot, not later production writes;
Storage object bytes are outside its PostgreSQL archive. The production
application is verified separately below.

## Verified production application

The migration was applied at `2026-11-16T11:33:33Z` under the migration name
`eligibility_view_security_invoker`.

- Pre- and post-application reads returned 12 rows with unchanged result MD5
  `e8d0ee7c576054432b1cf88370875413`.
- The view definition MD5 remained
  `6753998ec8a85f2e01d9e580f3d72ecf`; its owner and ACL were unchanged.
- The resulting view options contain `security_invoker=true`.
- Anonymous REST access returned HTTP 200 with 12 rows.
- The `security_definer_view` ERROR no longer appears in the security advisor.
  Other warnings remain, including the separately scoped mutable-function-path
  advisories; this is not an all-clear for the database.

These live MD5 comparisons are distinct from the isolated rehearsal's SHA-256
result fingerprint above. No function or grant changes were included in the
production migration.
