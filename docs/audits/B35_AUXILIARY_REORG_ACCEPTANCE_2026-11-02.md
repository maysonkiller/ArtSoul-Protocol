# B35 — Combined auxiliary refresh and periodic recovery

Status: bounded offline acceptance passes; production activation remains open.
This extends [the polling/cache scenario](B35_COMBINED_POLL_CACHE_ACCEPTANCE_2026-11-02.md)
with the actual resale/search refresh methods and a due periodic reorg check.
Only tests and evidence change. No production source, schema, feature flag,
cursor, billing setting or contract changes accompany this slice.

## Scenario and assertions

The disposable loopback-only PostgreSQL 18.4 harness installs the shipped search
migrations alongside its existing event, recovery, notification and NFT migrations.
The small `profiles` fixture supplies the columns those search migrations need.
The real runner methods, SQL revision fences, rewind and cache implementation run
together. Only the clock and RPC, metadata and Redis transports are synthetic;
external HTTP is explicitly rejected.

1. Publish two Core events and an NFT transfer through block 117. Reconcile eight
   resale rows against the canonical confirmed block hash, leaving the ninth for
   the next bounded batch. Hold the search metadata response for the new work.
2. At the existing 60-second reorg interval, introduce a consistent replacement
   fork from block 116. The actual detection path proves ancestor 115, rewinds
   events/projections, restores eight resale rows and invalidates NFT coverage.
   An injected cache deletion failure leaves a durable recovery obligation;
   public verified ownership remains unavailable.
3. A failed cache retry and then a successful retry perform no chain catch-up,
   NFT proof or publication. They neither replay events nor duplicate outbox
   effects. Successful recovery resets the bounded resale sweep.
4. Two real bounded NFT bootstrap polls prove retained history through 109 and
   then 115. The public verified boundary stays closed until coverage reaches
   the retained Core checkpoint; replacement events then publish through 117.
5. The same artwork ID and metadata URI now belong to a different source
   transaction/revision. Releasing the old metadata response updates zero rows;
   the next eligible scheduled refresh updates the canonical row once.

Assertions also preserve the other chain's data, registry/provenance counts,
the final canonical coverage hash and the cleared durable cache obligation.
Orphan notification records are quarantined, not silently erased: their durable
identity is retained, they do not appear in the public inbox, and the replacement
source appears once. The test distinguishes those intentionally retained dead
records from duplicate active delivery.

## Measured work

The final focused run recorded these phase-local counts. Setup and assertion
queries are excluded. Offsets are injected clock time, not measured latency.

| Phase | Offset | SQL calls | Returned row JSON bytes | Digest calls | Publications |
| --- | ---: | ---: | ---: | ---: | ---: |
| Publish and start auxiliary work | 0 s | 75 | 10,336 | 1 | 1 |
| Due reorg; cache deletion fails | 60 s | 34 | 4,640 | 2 | 0 |
| Cache retry fails | 62 s | 1 | 500 | 0 | 0 |
| Cache retry succeeds | 64 s | 9 | 1,103 | 0 | 0 |
| Prove retained NFT history to 109 | 66 s | 29 | 3,972 | 0 | 0 |
| Prove retained NFT history to 115 | 76 s | 31 | 5,834 | 0 | 0 |
| Publish canonical replacement | 86 s | 67 | 10,187 | 1 | 1 |
| Reject delayed orphan metadata | 86 s | 1 | 2 | 0 | 0 |
| Refresh canonical metadata | 96 s | 17 | 3,854 | 0 | 0 |

There are 25 hash-pinned resale reads and two metadata reads across the sequence.
Private evidence also counts RPC methods, header/head reads and cache deletion
attempts. Serialized SQL rows exclude protocol overhead and are not billed
egress; timestamps/generated values can change byte counts between runs.
This fixture establishes sequencing, not representative production capacity,
provider latency, query plans or real Redis/Lua atomicity.

## Validation

The final focused run passes both combined scenarios: three Node tests including
the parent. Related runner, search, recovery and resale suites pass 96 tests,
with one explicit unavailable-Docker PostgreSQL skip. A separate root run of
the four runner/checkpoint/cache suites passes 72 tests; it overlaps those 96
and must not be added to them as unique coverage.

Private evidence:

- `docs/private/b35-auxiliary-reorg-final.log`
- `docs/private/reorg-atomicity-1793617811961-41864-af3d370b/evidence.json`
- `docs/private/b35-auxiliary-reorg-related.log`
- `docs/private/b35-full-poll-related-2026-11-02.log`

The final focused cluster stopped. Earlier failed attempts remain in private
logs alongside the successful intermediate fifth run. Fixture corrections
addressed numeric token ordering, full coverage invalidation/rebootstrap and
retained orphan-notification quarantine; production code was not changed to
satisfy the scenario.

The full isolated PostgreSQL file passes **274/274**, with no skips, and its
cluster stopped. The first full run passed 272 checks but failed the uint256
fixture and its parent: that fixture rewrites an artwork ID in place, now
correctly blocked by the installed search foreign key. It removes only the
derived fixture row and uses the shipped trigger to rebuild it under the new
ID; every original precision/order assertion remains. Both run logs are kept.
Final evidence: `docs/private/b35-auxiliary-reorg-full-final.log` and
`docs/private/reorg-atomicity-1793618284097-39664-f6d829fb/evidence.json`.
Exact-head CI remains required before merge.

## Existing worker and remaining gates

A bounded read-only SSH preflight at 11:03:10 UTC found the existing Base Sepolia
worker healthy and synced, 13 blocks behind, with zero failed/dead/unresolved
events. Polling remained 2 seconds, reorg checks 60 seconds and ranges 10 blocks.
The NFT writer flag was unset. Compared runner/sync/resale files differ from
current repository source; coordinated/NFT checkpoint files are absent. This is
the already documented B30 worker, not a deployed B35 release. No new server is
needed. The preflight did not restart or alter the worker or query its database.
Private record: `docs/private/b35-worker-preflight-2026-11-02.json`.

This closes the specific offline gap for auxiliary work plus a due periodic
reorg in the combined polling path. Representative real usage/egress, independent
encrypted recovery, ordered migration/privilege review and activation of the
new worker and ownership API remain separate gates. No economic or architecture
rule was interpreted anew; canon §§5 and 17 remain unchanged.
