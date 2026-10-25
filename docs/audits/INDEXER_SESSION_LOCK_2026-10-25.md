# Indexer session ownership correction

The October 25 lifecycle rollout exposed an existing leadership defect. Advisory
lock acquisition and release used separate pool queries, so release could run on
a different PostgreSQL session. The runtime also used Supavisor transaction mode
(6543), which cannot preserve a session lock between transactions. The replaced
worker stayed a follower until the old idle backend expired about five minutes
later. The cursor and event projections were not reset; normal indexing resumed.

The correction pins a checked-out client for acquisition, registration, heartbeat,
status checks and release. Registry ownership alone is insufficient: renewals
also verify the backend PID and actual advisory lock. Socket loss, lost ownership,
timeouts and uncertain acquisition acknowledgements fence the worker and destroy
unsafe clients. Concurrent acquisitions are serialized and do not stack locks.
Shutdown excludes only this permanently checked-out client from the pool drain.

The known Supavisor transaction endpoint fails closed. Deployment must explicitly
use session mode on 5432, preserving the host, credentials and verified TLS; code
never silently rewrites a database URL. This matches the documented persistent
backend configuration: [Supabase Postgres connections](https://supabase.com/docs/guides/database/connecting-to-postgres).

## Evidence before rollout

- 17 lock/drain tests pass against disposable PostgreSQL, including reproduction
  of the former wrong-session unlock, two-worker handoff, connection loss,
  uncertain acquisition, blocked heartbeat timeout, fencing and shutdown.
- Seven existing event-heartbeat tests also pass: 24 checks, no skips.
- A read-only connection from the actual worker host confirms backend affinity
  across transactions using 5432 and the existing `verify-full` TLS mode.
- No storage-layout, auction economy, event handler or cursor change is involved.

## Operational acceptance

PR #350, candidate `efb30c0`, passed CI `40191749569` on Linux and Windows,
including builds and contract suites, before merge `7836805`. The source-only
worker update preserved a protected copy of both changed files and the previous
Base Sepolia environment. Only that worker gained a DATABASE_URL override on
5432; shared configuration, search/donation settings and source stayed pinned.
PM2 now permits a 45-second graceful shutdown, longer than the runner's bounded
30-second drain. It does not deliberately delay shutdown.

Both controlled restarts passed. The second stop took 375ms; a live database check
between stop and start found no advisory lock and no leader registry row. The new
process became leader and advanced to confirmed block 50042192 with zero unresolved,
failed or dead events. PM2 configuration was saved after verification. No database
backend was forcibly terminated, and no event/cursor was replayed or reset.

The private journal `lifecycle-lock-worker-rollout-2026-10-25.json` has terminal
status `TWICE_RESTARTED_HEALTHY_LOCK_RELEASE_VERIFIED`; do not replay its mutation
steps. Private backup/configuration values stay outside Git. A rollback of this
lock fix must retain session mode: reverting to transaction mode would reintroduce
the known failure.
