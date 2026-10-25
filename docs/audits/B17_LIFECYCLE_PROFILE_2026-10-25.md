# Personal activity and compact profile correction

Date: 2026-10-25. Workspace: `C:\Projects\ArtSoul`, branch
`codex/takeover-audit`; starting HEAD `4482e5d` (PR #348).

## Scope and reproduced defects

The founder's mobile screenshot shows the final Saved tab clipped by a horizontal
tab strip. Chromium reproduces the overflow at 390px. PR #349 initially wrapped
the tabs on narrow screens. The founder rejected the additional row after release;
the follow-up keeps all five tabs in one compact row. This is a layout correction,
not a change to profile sections or permissions.

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
- The subsequent one-row correction (PR #351, `9e3ac5c`) also passes 17 focused
  profile checks and 32 browser cases: 320/360/375/390/414/430/768/1440px, both
  themes, Arial fallback and loaded Inter. All 160 tab selections retain full
  labels/borders in one row, no horizontal overflow, and 44px button height.
  Only mobile navigation CSS changes; the desktop row remains unchanged.
  CI `40192029775` passed: Linux 2,472 unit checks / two documented skips;
  Windows 2,135 / 26 documented skips; 46 contract checks per platform and both
  builds. Merge `297e5bd` is deployed and its eight apex asset lists verified.
- PR #349 candidate `616201f`: CI `40189933729` passed on Linux (2,455 unit
  checks, two documented skips) and Windows (2,133, 25 documented skips), plus
  46 contract tests on each platform. Builds and static checks passed. Local
  full-suite PostgreSQL startup timed out once; the isolated affected file then
  passed all 37 checks. The successful CI is the exact-candidate evidence.
- Merge `618b648` was released with v2 disabled. Eight deployed asset lists and
  the shared card runtime match the reviewed build. Protected full/schema backup
  was read-validated, the additive migration rehearsed with rollback, then
  committed once. Existing v1 functions and preference/read data were preserved.
- Five notifications for the old artwork-34 / auction-66 rehearsal were recovered
  from events 182, 183, 185, 189 and 190, after exact receipts/logs/code/block
  verification through both RPCs. Two missing source fields were restored from
  those receipts. Registry, cursor and projections were not replayed or reset.
  These are historical facts with original dates, not new-event acceptance.
- Staged deployment `dpl_8v8beSVup2gta2xbo7vAcPdpyWKb` passed real SIWE, HTTP and
  64 actual HTTP/client interactions with three old test accounts: recipient isolation,
  read/unread persistence, lifecycle filtering, v1-compatible preference writes,
  stale revisions and retired cover rejection. Test preferences/read state were
  restored and all three browser-session cookies cleared. No chain transaction.
- After both worker restarts, a fresh stage of merge `297e5bd`,
  `dpl_2zshSqJeP5qxevFQbU3Q7ecNvJ3q`, passed all 64 real-account interactions.
  The production capability was then persisted and this exact deployment promoted
  to the apex. The same 64 interactions passed there, with restored preferences,
  read state and cleared test-session cookies. Eight asset lists, shared runtime,
  alias and enabled v2 config match. The final indexer check was healthy/synced at
  confirmed block 50044332 with zero unresolved/failed/dead events.

Rollout: back up and read-validate the database; rehearse the additive migration
inside a rollback; preserve v1 function hashes and existing preferences; release
the tested source with v2 disabled; apply the reviewed migration and source-only
worker update; verify a staged v2 deployment with actual signed test accounts;
only then enable/promote and verify the apex. Preserve every operation journal.

These steps are now complete for this slice. Do not replay the committed schema,
receipt recovery, source/connection update or flag journals. The first staged
deployment predates the compact-tab correction and must not be promoted over the
final build. Disabling `ARTSOUL_AUCTION_LIFECYCLE_ENABLED` and deploying the current
source hides v2 without deleting history; v1 remains supported. Do not destructively
reverse the additive schema or restore stale data as a UI rollback.

Interpretations are explicit: compact one-row mobile tabs supersede the initial
wrap; cover retirement preserves stored references/objects; no optional arbitrary
palette is introduced; personal notices are confirmed historical facts, not new
rights or automatic actions. Official project identity and broadcast eligibility
remain undecided. No economic, contract, aura or mainnet rule was amended.

## Indexer restart finding

The source-only lifecycle worker restart exposed an existing session-lock defect:
acquisition and unlock used shared pool queries, and the runtime connection used
Supavisor transaction mode (6543). The stopped worker's database backend retained
the advisory lock while the replacement stayed a follower. Its idle session
expired naturally about five minutes later; indexing then caught up with zero
unresolved errors. Two guarded cleanup attempts did not establish a successful
manual termination and must not be described as one or replayed against a new PID.

The correction keeps acquisition, ownership checks, heartbeat and release on one
checked-out client, fences on connection loss, and rejects recognized transaction
pooler endpoints. The runtime change is explicit and limited to this worker's
Base Sepolia environment: the same host, credentials and verified TLS on port
5432. A read-only connection test already verified backend affinity across
transactions. Supabase documents this as the persistent-backend session mode:
[Connecting to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres).
PR #350 passed 24 focused checks and full CI. The worker-local override and two
controlled restarts are verified: the second stop released both lock and registry
in 375ms, then the new process advanced with zero unresolved/failed/dead events.
The shared environment, chain data and other services stay intact. Details and
rollback boundaries: `INDEXER_SESSION_LOCK_2026-10-25.md`.

## Remaining Phase B work

Project-wide announcements need an explicit official source, not an assumption
that staff-wallet artwork is official. They are not enabled by this slice.
Deadline reminders require separate extension/current-round-aware producers.
Broader profile-content notice handling, assistant expansion, final B18 redesign,
external beta cohort and the durable Snapshot A gates remain open. Phase B is not
complete merely because these implementation checks pass.
