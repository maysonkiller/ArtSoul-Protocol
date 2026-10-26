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

Local checks completed so far:

- 185 header/prepaint/menu/cache tests passed.
- Notification API/state/schema suite: 269 passed; PostgreSQL removal tests ran
  against a disposable PostgreSQL 17 instance, including recipient isolation,
  mixed-batch rejection, replay, paging/counts and service-only grants.
- 74 latest inbox UI/reminder/header/search checks passed.
- 72 artwork/Donate/public-action regressions passed.
- Browser: eight inbox cases (Classic/Future, 320/390/768/1440px), selection,
  deletion, reopen and top settings; 64 shared-header layout cases; Donate at
  320/1280px with lazy history, no overflow and correct report/focus handoff.
- Initial build passed; final catalog-inclusive suite/build and deployment
  acceptance are pending.

Schema files: `notification_inbox_removal.sql`, `admin_artwork_catalog.sql`.
They require reviewed backups, rollback rehearsals and explicit deployment
verification. At this checkpoint neither migration nor this code is published.
Mock/browser viewport checks do not constitute new native iPhone acceptance.

Local evidence is under `output/audit/b22-*`, `output/playwright/b22-*`, and the
private guarded schema helpers. Recovery diff: `output/audit/b22-inprogress-recovery.patch`.
Unrelated untracked authority-policy files, `.codex/` and `output/` are preserved.
