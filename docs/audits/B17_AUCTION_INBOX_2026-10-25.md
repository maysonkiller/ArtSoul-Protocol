# B17 private auction inbox: first slice

Status: first slice released and activated; staged and apex real-account HTTP
acceptance passed. Later lifecycle categories remain unfinished.
Workspace: `C:\Projects\ArtSoul`, `codex/takeover-audit`, starting HEAD `fec283b`.
This resumes the preserved October 24 work after the profile/feed correction in
PR #345. It does not complete all B17 lifecycle categories or Phase B.

## Scope and integration

- Existing confirmed `auction_created` and `outbid` outbox events supply private
  in-app history. No fabricated delivery worker, email opt-in or new chain event.
- `/api/notifications` requires a signed wallet session plus a matching connected
  wallet header. Read state and category preferences persist through protected
  RPCs; revisions prevent one tab from silently overwriting another.
- Public config exposes the existing pattern of an explicit feature flag,
  `ARTSOUL_AUCTION_NOTIFICATIONS_ENABLED`; its default is off. The new category
  remains absent when disabled. Existing moderation notifications still work.
- The combined inbox preserves PR #345's compact bell and placement. Notification
  settings start collapsed so updates appear first. Both themes use shared color
  variables, including checkbox accents. All controls remain keyboard accessible.

## Source and privacy boundaries

Indexer migration 017 adds nullable actual contract provenance to stored events.
New matching logs stamp their real emitting address; foreign sources fail before
commit. Historical unknown addresses remain NULL, never filled from current
configuration. No deployed smart-contract storage is changed.

The read RPC checks the configured Core, indexed/confirmed cursor, completed event
registry, block record, matching outbox/source identity and recipient. Outbid
recipients must match the immediate preceding bid. Unknown/foreign prior logs
cannot be skipped to invent another recipient. Hidden artworks have no action
link. Category filters precede the function's internal 21-row page bound.

Tables enforce RLS and explicit grants. Browser roles cannot read or mutate them;
service writes use the bounded RPCs. Read updates reject mixed-recipient IDs as a
unit. Preferences affect visibility only and preserve history/read state; they
never enroll a user in email.

The existing chain-rewind revision is returned as exact decimal text in the same
stable database snapshot. A changed revision during pagination removes already
rendered events before reloading. Wallet/auth/page boundaries and close/unmount
retire in-flight requests. Late JSON and false write acknowledgements cannot
repaint private state or report success. A timeout exposes retry rather than a
late successful result.

## Local evidence

- 64 API/client/component/profile/moderation tests passed without skips. Includes
  actual catch-all routing, public config, authentication, origin/body validation,
  precision, malformed responses, cross-wallet requests, delayed JSON, read/unread,
  preference conflicts, rollback refresh, timeouts and combined-inbox clearing.
- 10 actual PostgreSQL notification checks passed, including source proof,
  category filtering before pagination, permissions, read-state cascade, numeric
  cursors above JavaScript precision and the missing-revision failure boundary.
- No-default-grant, bootstrap and migration checks passed 38 checks in the same
  serial run. The initial notification fixture omitted required indexer timestamps;
  its setup was corrected without weakening production schema constraints.
- Local build passed 11 routes and 174 required utilities.
- Actual profile JSX and inbox component with synthetic in-memory API responses:
  Classic/Future at 320/390/768/1440 px, no horizontal overflow, read/unread and
  category hide/show preserve state. The first standalone layout fixture lacked
  the profile's avatar-column context; the complete profile fixture was used for
  final layout acceptance. No physical phone or authenticated live API claim.

Ignored evidence: `output/audit/b17-client-api-2026-10-25.log`,
`b17-schema-recheck-2026-10-25.log`, `b17-schema-grants-2026-10-25.log`,
`b17-integration-build-2026-10-25.log`, and `output/playwright/b17-profile-*`.

## Rollout gates and remaining work

1. Pass exact-candidate CI and keep the flag off while deploying reviewed code.
2. Take a protected backup/read-validated before-image; verify the actual Core and
   indexer state. Apply migration 017 before the notification migration. The
   existing media-reorg bookkeeping must already be present. No reset/backfill.
3. Deploy the source-stamping indexer without losing its search/donation overlays;
   verify cursor progress and actual eligible confirmed event proof. Historical
   auctions with unknown creation provenance cannot produce later outbid history
   until separately reviewed receipt-backed recovery establishes that provenance.
4. Verify two real test accounts' HTTP isolation/read/preferences and rollback-safe
   behavior, then activate and check the real inbox. Do not count fixtures as this.
5. Add later bid, settlement/payment-due and deadline categories in separate
   reviewed slices. Deadline reminders must respect extensions and current rounds.

Interpretations to retain: no architecture/economic change; in-app category
preferences are visibility controls; historical source-unknown events stay hidden;
moderation availability is refreshed on feed reload, not pushed in real time;
performance validation here is a small fixture query-plan smoke check, not a
large-history load test.

## October 25 rollout evidence

- PR #346 merged as `8a34716`. Final candidate `4fa43b5` passed CI
  `40185201858`: Linux 2,433 passed / 2 Windows-only skips; Windows 2,122 passed /
  24 Docker/PostgreSQL skips; 46 contract checks per OS. Earlier failures were an
  outdated migration-sequence assertion and a donation fixture without migration
  017. The corrected real PostgreSQL donation suite passes all 12 checks.
- Dormant production `dpl_8XG9cUNwiHkP6He4bsTpoj6JZxMS` is READY. Eight apex
  asset lists match the retained build, card runtime remains v23, private guest
  reads return 401, and the auction inbox flag remains off.
- Protected full/schema backup was read-validated. Exact migrations were first
  rehearsed inside a rolled-back transaction against the actual schema, then
  committed at 10:36 UTC with table/RPC grants, RLS, unchanged rollback functions
  and empty new feature tables verified. Existing historical events stayed NULL.
- A source-only worker rollout preserved the search/donation overlays, launch
  configuration and verified TLS. Confirmed cursor advanced 50013823 to 50014113
  with zero unresolved/failed/dead events; only Base Sepolia is active.
- Separately reviewed historical recovery restored only 14 exact source addresses:
  12 AuctionCreated and two BidPlaced. Both RPCs agreed on emitter, successful
  receipt, block, transaction, log and decoded arguments. Raw public logs and
  before-images are retained privately. The chain-revision row was locked through
  the exact NULL-only updates; no cursor, payload or projection was changed.
- Of 85 candidate history rows, 25 lacked indexed block evidence and 46 lacked
  a receipt from at least one provider. All 71 stay unknown/excluded. Fourteen
  source records do not imply fourteen inbox messages: recipient, previous bid,
  outbox and current visibility checks still apply. The old creator and outbid
  collector each have one source-proven item for auction 66 / artwork 34.
- No new on-chain transaction was sent. The changed worker's future-log path is
  covered locally; no newly arriving public log has yet been observed after this
  rollout. Historical receipt recovery is not represented as that observation.

The first ordinary preview lacked production Core/runtime configuration. Its
temporary branch-only flag was removed; no server secret was copied into preview.
A production-environment staged deployment with automatic custom-domain
assignment disabled is being used for the two-account acceptance before promotion.

### Staged routing correction

Real SIWE authentication for the two old disposable accounts passed, but ordinary
`GET /api/notifications` returned `INVALID_NOTIFICATION_CURSOR`. The same signed
session calling `/api/[...route]?route=notifications` returned its one real item;
adding `route=notifications` to the ordinary URL still failed. The explicit
Vercel rewrite used by the profile routes was missing for notifications. Add that
rewrite, retaining the strict private-query validation and session-derived identity.
The regression dispatches the configured rewrite, preserves an exact BIGINT cursor,
and rejects a query-selected wallet. All 16 route tests pass.

No read-state/preferences mutation ran in the failed acceptance attempt. The
private probe initially expected logout to revoke a manually retained stateless
cookie. Its check now honors the response's clearing cookie; no product auth change
is needed. Both diagnostic sessions then receive 401 without their cleared cookie.
The corrected hosted route subsequently passed the acceptance below.

### Corrected release and activation

- PR #347 candidate `289b150` passed CI `40186814967`: Linux 2,434 passed / two
  Windows-only skips; Windows 2,123 passed / 24 Docker/PostgreSQL skips; 46
  contract tests per OS. Build and static checks passed. Merge: `daf8dfc`.
- Local Vercel CLI route generation retains `...route` as a dynamic parameter,
  explaining the extra query field. The exact rewrite fixes routing without
  accepting extra user-selected identity fields.
- The corrected dormant apex passed eight page-asset checks. Staged production
  deployment `dpl_M8YJZVx6JjdLxWGYhSKRCpFsyo7Q` was then built from that exact
  merge with the inbox flag enabled and automatic domain assignment disabled.
  The apex remained disabled throughout staged acceptance.
- Both staged and apex acceptance passed 43 HTTP interactions each using the
  existing disposable creator/collector accounts: real SIWE, distinct source-proven
  auction-66 items, guest/wallet/origin denial, atomic rejection of foreign/mixed
  read IDs, read/unread persistence, category filtering, stale preference conflict,
  pagination and logout. The actual frontend state module performed read/unread
  writes against the live API and cleared its list after cookie removal.
- Test read state and category defaults were restored. Preference revisions
  advanced from zero to two on staged acceptance and to four on apex acceptance;
  revisions were not reset. Both sessions were cleared after each run. No chain
  transaction, email enrollment or user-owned browser session was used.
- The single production flag was persisted, then the already-tested deployment
  was promoted. The authoritative apex alias record resolves to the exact staged
  deployment; the deployment's shorter alias list is not treated as authoritative.
  Eight apex asset lists and the v23 card runtime match the retained build.
- Post-activation indexer health is healthy/synced, confirmed block 50022261,
  zero unresolved, failed or dead events. Existing search/donation behavior and
  chain/economics are unchanged.

Evidence: `output/audit/b17-routing-api-2026-10-25.log`,
`b17-routing-config-2026-10-25.log`, `b17-routing-ci-2026-10-25.log`, and
`b17-active-release-*.json`. Protected operational journals retain backup,
source recovery, staged/apex HTTP results and the one-flag activation receipt.
No secret values appear in this report.

This is real HTTP/client persistence acceptance, not a new physical-device test,
a newly emitted auction event, or acceptance of later lifecycle notifications.
The next B17 slice is to map actual indexed bid/end/settlement events to the
approved recipients and current auction round before adding producers; deadline
reminders require extension and stale-round tests. Phase B remains open.
