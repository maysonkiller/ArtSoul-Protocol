# Profile notification read state follow-up

Date: 2026-11-16. Status: implemented, tested and applied to production; database preservation and real signed-session browser read acceptance passed.

## Observed failure

The authorized profile moderation cycle produced reporter and profile-owner notices. Reporter notices could be marked read. Opening either owner notice displayed `Saving…`, then returned to `Unread` with a read-state error. The browser request was `PUT /api/moderation/notifications?v=2`, carried the correct owner wallet and notice ID, and returned HTTP 409.

The existing `mark_personal_moderation_notifications` allowlist omitted `PROFILE_CONTENT_HIDDEN` and `PROFILE_CONTENT_RESTORED`. It returned `updated:false` for those types, which the API correctly mapped to 409. The same two types were missing from the unread summary and recipient removal functions. The profile moderation migration had extended the notification table constraint and generated the notices, but had not extended these three consumers.

Account-switch cancellation and session-wallet validation remain unchanged.

## Bounded correction

Migration: [`20261116115041_profile_notification_read_state.sql`](../../sql/migrations/20261116115041_profile_notification_read_state.sql), created with the installed Supabase CLI migration command.

It adds the two profile types to exactly three existing function bodies:

- `read_notification_summary(text,text,boolean,boolean,boolean)`;
- `mark_personal_moderation_notifications(text,bigint[],boolean)`;
- `remove_personal_moderation_notifications(text,bigint[])`.

The summary uses the latest October 29 definition, retaining reminder reorg identity and dismissal handling. Function prerequisite checks run before replacement. `CREATE OR REPLACE` retains the existing function identities, owners and permissions; the migration contains no grant changes, table changes or data writes. Existing recipient checks, atomic mutation behavior, 20-ID mutation bound, 100-unread count cap, dismissal semantics and auction/reminder logic are preserved.

SQL SHA-256: `d2c7f5d081449ad418df79d267264e26e351e3688a6c7d6b0be1727c19349c48`.

## Verification

[`profile-notification-read-state.test.cjs`](../../test/profile-notification-read-state.test.cjs) uses disposable PostgreSQL 17 with networking disabled and no published ports. The container was removed afterward. It loads the maintained original function definitions, reproduces the original read/remove rejection and missing count, then applies the new migration twice.

`node --test test/profile-notification-read-state.test.cjs`: **5 passing, 0 failing, 0 skipped**. Coverage includes:

- both new types through count, read, unread and removal; repeated reads/removals preserve their original timestamps, and unread changes cannot restore dismissed notices;
- mixed owned/foreign, missing and synthetic unknown-type IDs rejected atomically without row changes;
- all eight existing types, exact string acknowledgments above JavaScript's safe-integer limit, duplicate/invalid IDs, the existing 20-ID limit and the 100-count cap;
- service-role execution, anonymous/authenticated execution denial, and unchanged OIDs, owners, ACLs, security mode, search path and captured row contents after two applications.

The fixture executes the personal-notification summary path. The full function-body comparison additionally verifies that existing auction and reminder branches were not changed.

The three replacement bodies were compared with the fresh, privately captured production function definitions on November 16. After removing only the two added type literals and normalizing whitespace, every body matched. Original definition MD5 values:

| Function | Production definition MD5 before correction |
| --- | --- |
| `mark_personal_moderation_notifications` | `88907554ab0335c2fe40db88db6aa6be` |
| `read_notification_summary` | `9ed6f44b7757759c34f0d4c899a1c77e` |
| `remove_personal_moderation_notifications` | `5d48aefe15a735690c4c586b84cf3869` |

`node --test test/migration-ledger-coverage.test.cjs`: **8 passing** after the runbook disposition row was recorded. `git diff --check` passed.

## Verified production application

The release operator applied the exact migration SHA above to production as `profile_notification_read_state` at approximately 11:54 UTC on November 16. The existing complete November 16 backup and fresh affected-function/notification snapshots supported this bounded function replacement.

Preflight at `2026-11-16T11:54:10.586657Z` and post-application verification at `2026-11-16T11:54:25.251729Z` confirmed:

- 22 notification rows, 9 report rows and 43 audit rows remained present; all three captured data digests were unchanged;
- all three functions retained owner `postgres`, their existing owner/service-role-only execution ACLs, `SECURITY DEFINER` and `search_path=pg_catalog,public`;
- all three function bodies included both profile notification types.

The affected owner remained signed in as lys. Without reloading or changing the
session, the unread badge corrected from two to four. Expanding the two profile
notices then returned HTTP 200 for both real UI requests, displayed `Read`, and
reduced the badge to two. The messages and profile links were correct. A bounded
read-only database check confirmed all four cycle notices read and none dismissed.
No notice was marked read or dismissed by the migration itself. Removal behavior
was exercised only in the isolated regression; the live test history is retained.

## References

- [Current summary definition](../../sql/migrations/20261029212603_notification_reorg_identity.sql).
- [Existing personal read function](../../sql/migrations/notification_summary.sql).
- [Existing personal removal function](../../sql/migrations/notification_inbox_removal.sql).
- [Profile notice generation](../../sql/migrations/profile_content_moderation.sql).
- [Private notification API](../../src/api/routes/moderation/notifications.js).
- [PostgreSQL function replacement semantics](https://www.postgresql.org/docs/17/sql-createfunction.html).
- [Supabase changelog](https://supabase.com/changelog.md), checked for relevant changes; the installed CLI remains on v2 for this migration-file creation.
