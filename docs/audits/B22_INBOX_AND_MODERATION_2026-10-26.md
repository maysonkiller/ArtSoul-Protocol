# Header, inbox and moderation workflow follow-up

Source: the founder's October 26 screenshots and request. This continues Phase B
from `b9be502` in `C:\Projects\ArtSoul`, branch `codex/takeover-audit`.
Architecture scope: Bible sections 11, 16 and 17. No contract, auction economics,
minting, ownership, Trust or role-grant change.

## Reproduction and changes

- The bell waited for settled wallet restoration and then a dynamic UI import.
  Returning users now get a generic static bell from a matching visual identity
  hint. It contains no private count or messages. Code preloads early; only a
  confirmed wallet mounts the inbox. Early clicks are bound to that wallet and
  discarded on account change or disconnect.
- Admin menu eligibility began when the dropdown opened. The same server check
  now starts when the confirmed wallet and existing sign-in agree. No stored
  role grants access. First-session and network latency still require a response.
- Staff discovery ran after personal history and waited for the entire queue.
  These requests now overlap; the Moderation category can show its loading state
  after the server confirms eligibility, while protected data remains gated.
- Personal history mixed read and unread messages. New is now the default, All
  retains earlier history, and an opened message stays visible while its read
  state saves. The top gear opens settings without losing reminder drafts.
- Selection removes messages only from that recipient's inbox, in batches of
  at most 20. Durable dismissal excludes them from pagination, reminders and
  unread counts. Source events, reports and audit history remain intact. Failed
  writes retain the selection; account/session changes cancel remaining batches.
- Public artwork pages no longer load or render staff moderation controls.
  Donate contains its own History tab, fetched only when opened. Donation-message
  reporting remains available. Closing or switching tabs aborts history loading.
- Header search already searches all indexed public artworks and artist profiles;
  the gallery field filters its loaded cards. Labels now state that distinction.
  Private staff records are not part of public search.

## Interpretations

- Delete means recipient-specific dismissal, not deletion of the underlying
  complaint or blockchain event. A later reminder at another configured offset
  or deadline remains a distinct notification.
- No automatic report-count hiding threshold was supplied or implemented.
  Counts inform staff; they do not decide visibility.
- A generic bell is a visual hint only. Server authorization and factor checks
  remain authoritative even when a menu control is already visible.
- The new Admin catalog includes hidden works and complaint previews. Manual
  restoration must not bypass active actioned complaints, and a stale visibility
  decision must be rejected. Existing complaint review remains independent.

## Verification and release state

Released in [PR #365](https://github.com/maysonkiller/ArtSoul-Protocol/pull/365),
candidate `25ae246`, merge `cc87dcd`, October 26. Working path remains
`C:\Projects\ArtSoul`, branch `codex/takeover-audit`. The merge has the exact
candidate tree. No contract or mainnet deployment occurred.

Verification:

- 185 header/prepaint/menu/cache tests passed.
- Notification API/state/schema suite: 269 passed; PostgreSQL removal tests ran
  against a disposable PostgreSQL 17 instance, including recipient isolation,
  mixed-batch rejection, replay, paging/counts and service-only grants.
- 74 latest inbox UI/reminder/header/search checks passed.
- 72 artwork/Donate/public-action regressions passed.
- Browser: eight inbox cases (Classic/Future, 320/390/768/1440px), selection,
  deletion, reopen and top settings; 64 shared-header layout cases; Donate at
  320/1280px with lazy history, no overflow and correct report/focus handoff.
- Catalog/API/client/session tests: 77 passed, including actual PostgreSQL 17
  concurrency, pagination, metadata identity, role revocation and microsecond
  revision checks. The final refresh-failure regression and updated legacy
  fixtures pass in the 102-test group. The real PostgreSQL moderation journey
  passes 12/12. These overlapping groups are not summed.
- Eight final catalog browser cases pass at the same four widths in both themes:
  contained media, no overflow, one revision-bound restore write and logout
  clearing. A failed refresh after an acknowledged decision clears stale cards
  and offers refresh rather than submitting that decision again.
- Final local production build passes, including 11 HTML entries and 174
  generated Tailwind utilities. No dependency was added.
- Initial CI failed because older fixtures required the removed artwork staff
  panel or omitted the catalog migration/exported metadata helpers. Corrected
  candidate CI [40306352050](https://github.com/maysonkiller/ArtSoul-Protocol/actions/runs/40306352050)
  passes: Linux 2,685 unit tests / two skips; Windows 2,298 / 31 skips; zero
  failures. Both platforms pass 46 contract tests, builds and static checks.
  Skips are not executions. The broad local unit run was stopped during Docker
  resource contention and is not reported as a passing run.

Schema rollout completed in two separate guarded transactions:

- `notification_inbox_removal.sql`, 10:27 UTC, SHA-256
  `3747f70602dbf6d6cbc922ef9c6fe4372eecd86cd2b2f87b51855c4013cd02dd`.
  Separate protected full/schema backup, archive read validation and successful
  rollback rehearsal preceded application. Two columns, two indexes and two
  service-only RPCs were added; five intended read/count functions changed.
  Existing data, table grants and RLS were preserved. Legacy reads, guest/client
  denials and existing-owned-row dismissal/replay were checked and rolled back.
- `admin_artwork_catalog.sql`, 10:30 UTC, SHA-256
  `c5c4e1834482ed767467799f07f78f90214b6b9479fe88f24f44f503f2ca5eef`.
  A second backup captured the preceding migration. Rehearsal and application
  verified two service-only RPCs, one index, unchanged roles/grants/source rows
  and no application DML. The catalog returned 26 bounded real rows; invalid
  writes and client reads were denied. No real complaint/work was hidden or
  restored by this smoke check.

The ordinary PR preview has disabled feature configuration. After the existing
CLI session refreshed, a separate exact-source staged deployment used production
configuration without assigning public domains (`autoAssignCustomDomains:false`;
[Vercel staging behavior](https://vercel.com/changelog/stage-and-manually-promote-deployments-to-production)).
Staged deployment `dpl_GUYfe2AbmiyyJuPZVB548CkJ6oP7` and apex GitHub deployment
`7329636305` each matched eight HTML headers/asset lists and 35 built/runtime
assets. Guest private endpoints return 401 with private/no-store caching.

Real HTTP acceptance passed **56 steps on the staged release and 56 on the apex**:
three previously authorized old test accounts, actual client models, own removal,
idempotent replay, disappearance after reopening, exact unread counts, all-or-none
foreign-batch rejection, origin/wallet/session denials and stale-model isolation.
Original test inbox records and preferences were restored with compare-and-swap;
source events and complaints were unchanged; all three sessions were logged out.
No transaction was signed and no founder credential was used. Public site
activation is verified, rather than inferred from the local build.

Both staged and apex browsers passed 32 page/theme/width cases plus Donate/History;
the apex History tab also loaded the existing donation records successfully. Native
iPhone acceptance, a new staff factor ceremony, live complaint hide/restore and
live due-time reminder delivery are not claimed by these checks. First-time Admin
discovery still waits for the authoritative server response; the generic bell
does not grant access or expose a cached private unread count.

Local evidence is under `output/audit/b22-*`, `output/playwright/b22-*`, and the
private guarded schema helpers. Recovery diff: `output/audit/b22-inprogress-recovery.patch`.
Unrelated untracked authority-policy files, `.codex/` and `output/` are preserved.

Exactly next step: B-21 explicit Saved add/remove commands through the existing
state/API with account isolation. Phase B remains open; automatic official
announcements await the deferred dedicated creator address, while broader
assistant coverage, aggregate favorite counts and final visual work are separate
pending slices. This release does not claim an arbitrary mass-complaint threshold
or a new moderation policy.
