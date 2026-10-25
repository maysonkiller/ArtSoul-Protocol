# B17 notification indicator

Owner request: show a clear red unread indicator and make notification controls
readable, coherent and restrained in both Classic and Future. This is a display
and recipient-owned read-state change under Bible sections 11 and 16, not an
economic, contract, trust or delivery-policy amendment.

## Behavior and interpretation

- The existing profile Notifications control shows an unread count before the
  panel opens, capped visually at 99+. Zero is hidden. A dot means known unread
  history exists while current reminders cannot be verified; unavailable data
  is never presented as zero. Counts are private, short-lived and not persisted
  in browser storage.
- Opening or closing the panel does not silently mark unseen messages as read.
  Explicit read/unread actions update the count across auction and personal
  moderation notices. Staff review-queue contents are not part of this badge.
- The closed control requests only a summary. Full content still loads on open.
  Wallet/session changes, logout, hidden pages, stale responses and expired
  reminder deadlines invalidate the summary. The badge never prompts a wallet
  signature by itself.
- Both themes use their own red variables and surfaces. Stable badge geometry,
  visible expanded/focus states, grouped cards, bounded scrolling and a pinned
  close action avoid layout jumps. No continuous pulse; reduced motion is
  respected. This restrained hierarchy is the design direction for the later
  B18 pass, not a claim that the entire product has been redesigned.
- Approved reminder timing stays unchanged: default one hour, up to three
  personal offsets within 24 hours. No new email, push or project announcement.

## Implementation

`notification_summary.sql` adds one partial index and two service-only RPCs.
Unread history is proven against canonical confirmed sources before the count
cap; read rows cannot hide older unread rows. Current reminders use existing
source/deadline/freshness rules without creating outbox rows. Personal moderation
read state updates only exact recipient-owned IDs, atomically. Existing v1/v2/v3
functions, read history and preference revisions remain unchanged.

`ARTSOUL_NOTIFICATION_SUMMARY_ENABLED` gates the new summary and moderation v2
read API independently of auction enablement. Fresh installations must apply
the migration after its lifecycle/reminder prerequisites, then pass staged
acceptance before enabling this flag. Disabling it restores the prior inbox;
the additive schema and durable read states can remain in place.

## Verified locally

- 105 focused API, state and component tests passed, no skips.
- 26 PostgreSQL summary and Data API privilege tests passed, no skips. Includes
  source forgery, recipients, reorgs/extensions, stale indexer evidence, page
  boundaries, atomic read updates and installation without implicit grants.
- Production build passed, including 11 routes and Tailwind verification.
- Chromium fixture: 16 size/zoom cases and 64 badge states, both themes; widths
  320–1440, enlarged text, keyboard close/focus, read-count changes, logout and
  reduced motion. No horizontal overflow. Badge text contrast: Classic 5.09:1,
  Future 5.98:1. This is browser evidence, not a new physical iPhone test.
- Review regressions cover config arriving after panel open, BFCache return,
  read clicks during pagination and logout when backend cookie clearing fails.

Local evidence is under `output/audit/notification-badge-*` and
`output/audit/notification-polish-evidence-2026-10-25.json`; screenshots are under
`output/playwright/notification-polish-{classic,future}-390.png`.

## Release status

Prepared locally; CI, protected backup, rollback rehearsal, additive migration,
staged real-account acceptance and public activation are still pending at this
checkpoint. Do not describe this document as proof of a live release. No worker
restart, chain transaction or past journal replay is required for this change.

B17 official project-announcement source/publishing policy and B18 final design
remain open. This slice does not close all of Phase B.

Design references: [Apple notifications guidance](https://developer.apple.com/design/human-interface-guidelines/notifications)
for meaningful, current badges and [WAI disclosure pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/)
for the expandable control. No claim is made about an invented industry trend.
