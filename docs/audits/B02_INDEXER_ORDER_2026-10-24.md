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

PR #340 candidate `ad96093` passed full CI `40097788978`: Linux 2,305 pass /
2 platform skips, Windows 2,013 pass / 21 Docker skips, 46 contracts per OS,
build/static/preview green. Merged as `c629356`. The existing Base worker received
only the reviewed sync-engine file, preserving the B-14 search worker and all
configuration. Deployed SHA-256:
`d8a432b6d1b318734bca10d5577beca64e5519a3e4f01fd3fed79cfe3a8b1db5`.
Completed live projection rows were not replayed by the patch.

## Bounded live reconciliation

A read-only snapshot at confirmed block 49,628,751 compared 37 artworks, 71
auctions and four resale listings against both pinned-code RPCs at the same
block hash. Five NULL artwork pointers differ: 3 -> 3, 4 -> 4, 9 -> 9, 35 -> 67,
36 -> 70. All other compared fields agree. All five rounds remain contract-active
(some are expired but not finalized); there are no ending rows. Registration and
auction registry records are completed and the artwork update block is still its
registration block. Expiry alone must not clear a contract-active pointer.

Reconciliation completed at 13:27 UTC after a protected, read-validated full
database backup and a saved before-image. The Base worker was briefly stopped.
Fresh two-RPC current-state/code/block agreement confirmed all five mappings;
canonical AuctionCreated receipts were decoded from the archive-capable RPC.
The second RPC could not serve the old receipts for #3/#4/#9 (its old-block API
also reported unavailable), so two-source historical receipt coverage is not
claimed. Both sources independently confirmed the current pinned contract state.

A serializable compare-and-set transaction updated only the five missing
pointers and the update block/time that their creation event should have written.
No event replay, counters/outbox mutation, reset, transaction signing or expiry
finalization occurred. After restart the worker caught up: confirmed block
49,633,263, 12 blocks behind, healthy/synced, zero unresolved/failed/dead events;
the indexed event total remains 204. Legacy Ethereum indexing remains stopped.

Repeated bounded comparison of all 37 works, 71 auctions and four resale listings
through both RPCs at block 49,632,252 returned **zero differences** in the compared
fields. Actual public search still returns the two current live works #36/#37.
Protected operation journals and before-images are under `docs/private/`; the
public read-only verification report is under `output/audit/b02-projection-drift-*`.
These journals must be reconciled rather than replayed on continuation.

## Separate finding and acceptance limits

Fresh indexer migrations create the legacy `indexer_state` in migration 001;
migration 012's `CREATE TABLE IF NOT EXISTS` does not add its runtime `state_hash`
column. The initial ordering fixture added that column explicitly to isolate this
defect. A separate forward migration 016 and fresh-install regression now remove
the workaround; historical migrations remain immutable. Live read-only inspection
confirmed the existing column already matches `VARCHAR(66) NOT NULL DEFAULT '0x0'`,
so no live DDL or hash reset is required. See the migration runbook for its release.

This engineering correction does not complete the B-02 independent-user beta
journey gate. No real user's end-to-end transaction journey is claimed here.
