# Personal activity and compact profile correction

Date: 2026-10-25. Workspace: `C:\Projects\ArtSoul`, branch
`codex/takeover-audit`; starting HEAD `4482e5d` (PR #348).

## Scope and reproduced defects

The founder's mobile screenshot shows the final Saved tab clipped by a horizontal
tab strip. Chromium reproduces the overflow at 390px. Narrow layouts now wrap the
five tabs within the content panel, while wider layouts keep the normal row.

The founder explicitly retired the separate profile cover image. Remove its
editor, rendering, upload authorization and dead client upload wiring. Existing
stored references and objects are retained; layout changes preserve the old
reference without downloading an invisible image. An older client cannot upload
or replace a cover. Main profile avatars and artwork uploads remain supported.

Profile curation uses a compact pinned-work row, expandable selection sections
and an explicit artwork picker. Preview/save/cancel and revision conflicts remain.
No arbitrary palette is introduced: visitors retain their Classic/Future theme
and the existing contrast tokens. This interprets the founder's optional palette
suggestion; it changes no aura or protocol rule.

## Personal notification sources

The existing private auction-created/outbid category is extended through an
explicit v2 API capability; v1 remains compatible during rollout and rollback.

| Confirmed event | Recipient and notification |
| --- | --- |
| BidPlaced | Creator: new bid; the existing outbid recipient/key remains unchanged |
| AuctionEnded, nonzero winner | Winner: auction won, payment still required |
| AuctionEnded, no winner | Creator: ended without bids, no NFT minted |
| SettlementCompleted | Winner: completed purchase/mint; creator: completed sale |
| SettlementDefaulted | Winner and creator: unpaid settlement finalized |
| ResaleCompleted | Buyer: NFT purchased; seller: NFT sold |

These are historical facts, not unconditional current actions. A win never claims
that an NFT already exists. Artwork links open the current state; hidden/unavailable
artworks have no active link. Network and token IDs are explicit. Resales do not
invent an auction ID. Token IDs and wei remain decimal strings.

New outbox entries share the event transaction and rollback correlation. Their
recipient/type key uses native SHA-256 to fit the existing 100-character limit;
the actual PostgreSQL rehearsal caught the otherwise oversized concatenation.
Reads require the exact Core, completed event registry, confirmed blocks, original
auction creation, and original mint provenance for resale. Unknown sources stay
excluded. Pagination filters first; read updates are atomic and wallet-bound;
preferences use the existing compare-and-swap revision. No email subscription,
economic change, event replay or synthetic production notification is introduced.

## Verification and rollout status

- Backend: 54 actual PostgreSQL/indexer/order/grant tests pass with no skips.
  Includes real Engine transaction failure/retry, original-mint rewind, source and
  recipient exclusion, v1 preservation and repeated migration application.
- API/client/component: 53 focused checks pass; the version capability, both
  private write paths, malformed projections and session retirement are covered.
- Profile API: seven checks pass, including preserved historical cover metadata,
  rejection of replacement and no hidden image fetch during saves.
- Isolated Chromium: 320/390/768/1440px, Classic and Future, tab/editor bounds and
  editing actions exercised. This is not a new physical iPhone acceptance claim.
- Full candidate CI, final build, deployed assets, live migration/worker and v2
  activation remain to be recorded. The v1 inbox is already active.

Rollout: back up and read-validate the database; rehearse the additive migration
inside a rollback; preserve v1 function hashes and existing preferences; release
the tested source with v2 disabled; apply the reviewed migration and source-only
worker update; verify a staged v2 deployment with actual signed test accounts;
only then enable/promote and verify the apex. Preserve every operation journal.

## Remaining Phase B work

Project-wide announcements need an explicit official source, not an assumption
that staff-wallet artwork is official. They are not enabled by this slice.
Deadline reminders require separate extension/current-round-aware producers.
Broader profile-content notice handling, assistant expansion, final B18 redesign,
external beta cohort and the durable Snapshot A gates remain open. Phase B is not
complete merely because these implementation checks pass.
