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

Released in PR #359, merge `7258846`. Candidate `1316178` / CI `40204868576`
passed Linux 2,591 tests (two documented skips), Windows 2,218 (29 documented
skips), 46 contract tests per platform, builds and static checks. Preview
`dpl_C5LdYvhoePkMGa9N8ARXGyuLRBHp` and apex
`dpl_4jkDhRN82VJdKkK59u6ZC699EDEM` match eight page asset lists and all 17 profile
assets byte-for-byte. Active apex config and anonymous denial on summary,
recipient outcomes and staff queue endpoints passed. No live recipient state
was changed or factor ceremony replayed. Browser/server and helper are finished.

## Shared header and opening-to-read (October 25 follow-up)

The founder moves the inbox from Profile into the shared header, beside search
and account controls. Bible section 11 and visual/theme part 16 apply; this is
presentation and existing recipient-owned read state, not a role or API change.

- One icon-only bell appears on all eight product headers after an actual wallet
  connection settles. Cached profile hints cannot show it. The guest path does
  not import the inbox or request private notifications. Profile no longer mounts
  a duplicate inbox in either view or edit mode.
- Clicking a message opens its contents and saves its read state. Opening the
  panel or switching Personal/Moderation does not mark unseen messages read.
  Read messages stay in history; reopening them never makes them unread.
- Rapid opens are serialized across activity, reminders and personal outcomes.
  Closing the panel lets already-opened messages finish saving; then private
  panel contents are cleared. Wallet/auth changes, pagehide and unmount discard
  queued work and invalidate responses. A failed older-page request does not
  prevent marking an already loaded personal outcome read.
- The last verified unread badge stays visible during a save, without extending
  its original validity. A fresh summary follows acknowledged writes. Failed
  writes retain unread state and expose the existing error/retry flow.
- The panel is bounded to the viewport, scrolls internally, closes on outside
  click or Escape, and returns focus on explicit close. Narrow mobile headers
  retain search, bell, avatar and shortened wallet in one row. Colors remain
  theme variables; existing reduced-motion behavior remains.

Interpretations: "read on click" means opening that individual message, not
deleting it or reading the whole inbox. Staff queue notices remain workflow
items, not personal unread messages. Both groups and profile curation stay.

Local verification: 249 focused tests and the production build passed. Chromium
checked 14 Classic/Future header/panel layouts (320–1440 pixels), plus four
expanded-content portrait/landscape cases with reduced motion, individual reads,
unchanged-wallet events, disconnect, outside close and keyboard focus return.
Twelve further checks at 769–961 pixels cover both themes at header breakpoints;
the keyboard shortcut hint yields space to the search label on narrow desktops.
Both theme screenshots were inspected. This does not claim a new physical
iPhone test or a live staff-factor ceremony. Evidence: `output/audit/header-notifications-*`
and `output/playwright/header-notifications-{classic,future}-390.png`.

Released through [PR #361](https://github.com/maysonkiller/ArtSoul-Protocol/pull/361),
merge `2e13b5a`. Final candidate `c6a9b0c` / CI `40207767230` passed Linux 2,617
tests (two documented skips), Windows 2,244 (29 documented skips), 46 contract
tests per platform, builds and static checks. The initial preview also passed
an eight-page guest browser flow: hidden bell, no private notification request,
and public config available after wallet restoration settled.

Final preview `dpl_Cq97JVGspKuP2pXKtZB1WxYfo6Wv` and apex
`dpl_BKC4E4BAjHdtw1e46abzxbMDp72v` match eight page asset lists and 18 direct/dynamic
profile/header assets byte-for-byte. Apex summary/lifecycle/reminder config is
active; anonymous summary, recipient-outcome and staff-queue requests return
401 with private/no-store caching. No live recipient data was mutated.
Browser/server closed and helpers finished. B17 official announcement policy
and B18 final design remain open.
