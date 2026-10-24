# B-02: preserve canonical event order

## Scope and reproduction

October 24, 2026. Canon sections 3/4/5 (auction, settlement, provenance), 13
(delivery/integrity) and 17 (beta journeys). This fixes the projection of existing
contract events; no contract, economics, lifecycle or authentication change.

B-14 live acceptance exposed artwork 36 with a NULL current-auction pointer while
both pinned Base Sepolia RPCs returned round 70. The database recorded its later
AuctionCreated event 54 ms before ArtworkRegistered. Both registry rows were
completed, so normal retries could not repair the missed UPDATE.

The historical scheduler ran up to five dependent projection transactions
concurrently. A real PostgreSQL fixture reproduced five failures before the fix:
missing registration/auction mapping, an earlier bid overwriting the later bid,
an ending overwriting settlement, a listing reactivating a completed resale, and
later logs committing after an earlier failure. Setting concurrency to one alone
would not fix the last case: the old scheduler continued after failures.

## Change and validation

The existing sync engine sorts by block and log index, commits one event at a
time, and stops at the first failure across batch boundaries. The completed
prefix remains idempotent; the failed event retries before the untouched suffix.
Leases, rollback, reorg logic and the range cursor remain in place. Production
startup and polling both use this guarded range-processing path.

- New real PostgreSQL ordering and existing failure-integrity suites: 20 pass.
- Heartbeat, health, metrics, public projections, confirmation and reorg: 50 pass.
- Actual PostgreSQL event lease and failure-record integration: 12 pass.
- No skips in those 82 focused checks. `git diff --check` passes.
- Local 250-event fixture: about 2.6 seconds sequential versus 1.1 seconds with
  the old concurrent scheduler. Correct dependent state takes precedence over
  that concurrency. These local measurements are not a production SLA.

Exact-candidate full CI and production deployment are pending. Completed live
projection rows are not automatically replayed by this patch.

## Bounded live reconciliation

A read-only snapshot at confirmed block 49,628,751 compared 37 artworks, 71
auctions and four resale listings against both pinned-code RPCs at the same
block hash. Five NULL artwork pointers differ: 3 -> 3, 4 -> 4, 9 -> 9, 35 -> 67,
36 -> 70. All other compared fields agree. All five rounds remain contract-active
(some are expired but not finalized); there are no ending rows. Registration and
auction registry records are completed and the artwork update block is still its
registration block. Expiry alone must not clear a contract-active pointer.

Reconciliation is pending. Require a protected before-image, fresh two-RPC/code/
block agreement and canonical AuctionCreated receipts, then compare-and-set only
those five pointers and their event update metadata. Do not replay completed
events, alter counters/outbox, reset data, or invent finalization transactions.
Afterwards repeat the full bounded comparison and check worker health/cursors.

## Separate finding and acceptance limits

Fresh indexer migrations create the legacy `indexer_state` in migration 001;
migration 012's `CREATE TABLE IF NOT EXISTS` does not add its runtime `state_hash`
column. The disposable ordering fixture adds that documented column explicitly
to isolate this defect. A separate forward migration and fresh-install regression
are required; deployed databases are not changed by this finding.

This engineering correction does not complete the B-02 independent-user beta
journey gate. No real user's end-to-end transaction journey is claimed here.
