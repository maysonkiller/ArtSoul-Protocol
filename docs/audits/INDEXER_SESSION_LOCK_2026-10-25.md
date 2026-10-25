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

Operational acceptance remains separate: preserve a protected configuration/source
backup, change only the Base Sepolia worker's connection override, permit bounded
graceful shutdown, and verify two restarts with actual advisory/registry release
and advancing healthy indexing. Record that result in the lifecycle audit before
enabling the new notification capability. Other worker environments remain intact.
