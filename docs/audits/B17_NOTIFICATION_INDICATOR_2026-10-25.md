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

Released through [PR #355](https://github.com/maysonkiller/ArtSoul-Protocol/pull/355),
merge `f7ccbee`. Candidate `c07b61d` / CI `40201679037` passed Linux 2,586 tests
(two documented skips), Windows 2,213 tests (29 documented skips), 46 contract
tests on each platform, builds and static checks.

A fresh protected full/schema backup was archive-read validated. Rollback
rehearsal and additive application preserved all 78 existing public function
bodies/owners/ACLs, relevant table access controls, preference rows, auction read
state and moderation rows. The new summary performed no data writes. Anonymous
and authenticated database roles cannot execute either new RPC.

Staged deployment `dpl_DBn4ocdcU7pMB96q4NtLfavefNtG` passed 83 real SIWE/API/client
interactions before promotion, then the apex passed the same 83 interactions.
Three old test accounts were used; auction read/unread changed summary totals,
and two accounts also exercised real recipient-owned moderation read state.
The third had no eligible unread personal moderation row; none was fabricated.
Guest, mismatched-wallet, foreign-ID and wrong-origin requests were rejected.
Every touched read state was restored and read back; preferences and their
revisions were unchanged, and all three test sessions were logged out after
each run. No chain transaction, due-time reminder or phone acceptance is claimed.

Only `ARTSOUL_NOTIFICATION_SUMMARY_ENABLED=true` was added to production settings;
other settings were preserved. Eight page asset lists, the shared card runtime,
public config and private endpoint denial match the exact released source. No
worker restart or prior operation replay occurred. Private backup, schema,
release, flag and HTTP journals are terminal and must not be replayed.

B17 official project-announcement source/publishing policy and B18 final design
remain open. This slice does not close all of Phase B.

Design references: [Apple notifications guidance](https://developer.apple.com/design/human-interface-guidelines/notifications)
for meaningful, current badges and [WAI disclosure pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/)
for the expandable control. No claim is made about an invented industry trend.

## Personal and staff groups (October 25 follow-up)

The founder requests separate personal and moderation groups in the same inbox.
This presentation change touches Bible section 11 and visual/theme part 16;
existing roles, factor checks, recipient rules and database/API behavior remain.

- Personal opens by default. It contains auction updates, reminders and outcomes
  about the user's own reports, artworks and donation messages, including when
  that user is also staff.
- Moderation appears only after the existing server-confirmed staff eligibility
  check. It contains the bounded queue notice or its existing verification,
  disabled or unavailable state. Complaint decisions remain in Admin.
- The red unread badge remains personal. Pending staff reports have a separate
  neutral count labelled "reports awaiting review"; they are not unread messages.
- Switching groups does not mark messages read, reset pagination or discard an
  unfinished reminder-settings draft. Closing or invalidating the wallet/auth
  context clears private contents and returns the selection to Personal.
- Ordinary users retain their personal report outcomes without a staff control.
  Profile selections and layout editing are deliberately unchanged, as requested.

Interpretation recorded: "moderation messages" means staff review notices, not
the recipient's own report outcomes. This separates responsibilities without
withholding personal notices or creating a new role or unread-status definition.

Local verification: 81 focused tests passed; production build passed. The actual
React component in a Chromium fixture passed 20 size/theme/zoom cases (320–1440
pixels and 400% zoom), keyboard switching/close/focus return, read-count changes,
preserved reminder drafts, eligible/unverified/ordinary states and auth reset.
Screenshots were inspected in Classic and Future. This is not a new physical
iPhone or live staff-factor ceremony. Evidence: `output/audit/notification-groups-*`
and `output/playwright/notification-groups-*`.
