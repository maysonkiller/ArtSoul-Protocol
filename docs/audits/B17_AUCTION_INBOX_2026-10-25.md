# B17 private auction inbox: first slice

Status: implemented and locally tested; deployment and activation pending.
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
large-history load test. No live schema, worker or activation action has occurred.
