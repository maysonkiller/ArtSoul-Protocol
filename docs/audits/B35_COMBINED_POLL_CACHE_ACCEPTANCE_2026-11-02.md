# B35 — Combined polling and cache acceptance, November 2, 2026

Status: one bounded offline acceptance slice passes. No production-source,
schema, deployment, feature-flag or worker configuration change accompanies it.
The test extends `test/indexer-reorg-atomicity.test.cjs` and reuses its disposable
loopback-only PostgreSQL cluster, migrations, synthetic chain source and cache
transport. It never accepts a remote database URL. PostgreSQL version: 18.4.

## Behavior verified

The shipped polling, catch-up, confirmation and coordinated-publication methods
run together. Two Core events and one NFT transfer commit at block 117. An
injected cache deletion failure leaves the committed rows intact and the public
verified boundary unavailable. The next poll retries only cache work. A later
poll acknowledges the same durable obligation; it does not replay events or
duplicate projections, event-processing records or lifecycle outbox rows.

A cache miss captured before publication resumes after recovery. Its old result
cannot refill the cache: it reads the new boundary once, and a subsequent normal
read stores the current result and serves a cache hit. Polls inside the existing
ten-second publication interval observe the newer head without repeating NFT
proof or publication. At the interval boundary, an empty confirmed range advances
both cursors to 120 without purging the cache again.

## Measured fixture work

Counts include only each named phase, excluding setup and assertion probes.
Clock offsets are injected runner time, not measured outage duration.

| Phase | Offset | SQL calls | SQL row JSON bytes | NFT transport responses | Core listener reads | Head reads | Cache attempts |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Publish; deletion fails | 0 s | 47 | 6,396 | 10 | 4 | 1 | SET, SCAN, DEL |
| Deletion retry fails | 2 s | 1 | 500 | 0 | 0 | 0 | SET, SCAN, DEL |
| Purge recovers | 4 s | 9 | 1,103 | 0 | 0 | 0 | SET, SCAN, DEL |
| Delayed refill, fresh store and hit | 4 s | 2 | 320 | 0 | 0 | 0 | 2 EVAL, 5 GET, 1 SET |
| Publication interval holds | 6 s | 2 | 932 | 0 | 0 | 1 | None |
| Publication interval holds | 8 s | 2 | 932 | 0 | 0 | 1 | None |
| Next empty publication | 10 s | 38 | 7,109 | 9 | 3 | 1 | None |

Only the two publication phases calculate the state digest. NFT transport
responses are synthetic low-level JSON-RPC responses; Core listener reads are
synthetic `getBlock` and `queryAllHistoricalEvents` calls, not a measured count
of their underlying production RPC requests. SQL bytes are serialized returned
rows, not PostgreSQL protocol bytes or billed egress. Timestamps and other
generated values can change byte counts between runs.

Auxiliary resale/search refreshes are stubbed; the periodic reorg check is not
due in this ten-second sequence. Redis commands use the existing in-memory
adapter; this does not establish actual Lua/Redis atomicity, provider latency,
production query plans or total worker cost. Existing dedicated suites retain
those separate responsibilities. No HTTP request is allowed by the scenario.

## Validation and evidence

The selected PostgreSQL scenario passes: two Node tests including its parent.
The related runner/checkpoint/cache suites pass 72 tests. The final disposable
cluster stopped successfully. CI run `41372931396` on candidate
`f4b34277f5ace632b567201d64e883dc1d053ed6` also passed: Linux 4,075 unit tests
with two environment skips, Windows 3,377 with 35 environment skips, 49 contract
tests on each platform, both builds and static checks. The isolated PostgreSQL
scenario runs on Linux CI; Windows' environment skips are not recorded as
PostgreSQL acceptance. The branch was subsequently reconciled with merged
PR444 and its production-release documentation; final-head CI remains required.

```powershell
$env:ARTSOUL_TEST_POSTGRES_BIN = (& 'C:/Users/mayso/scoop/apps/postgresql/current/bin/pg_config.exe' --bindir).Trim()
node --test --test-name-pattern='^rewind events, cursor, hashes and media revision atomically \(isolated PostgreSQL\)$' --test-skip-pattern='^rewind events, cursor, hashes and media revision atomically \(isolated PostgreSQL\) (?!coordinated poll/cache acceptance)' test/indexer-reorg-atomicity.test.cjs
node --test test/coordinated-runner.test.mjs test/nft-transfer-runner.test.mjs test/nft-transfer-checkpoint.test.mjs test/cache-recovery-generation.test.mjs
```

The binary setting is confined to the test process; no system or deployment
environment was changed. Private evidence:

- `docs/private/b35-combined-poll-cache-final.log`
- `docs/private/b35-combined-poll-cache-related.log`
- `docs/private/reorg-atomicity-1793582862622-62892-64e599c0/evidence.json`

An initial name filter also admitted unrelated children because Node includes
all children of a matched parent. That run was stopped after 24 completed
scenarios; its cluster was explicitly stopped and `pg_ctl status` confirmed no
server running. Its incomplete log remains in
`docs/private/b35-combined-poll-cache-first.log`. The corrected child exclusion
above ran only the intended scenario. An intermediate successful selected run
is retained in `b35-combined-poll-cache-selected.log`; the final run also counts
the direct SQL reads made by cache refills.

## Interpretation and remaining gates

This verifies poll/publication/cache sequencing without changing canon sections
1, 4, 5 or 9. The ten-second cadence already exists in source; it is operational
policy, not new auction economics. No architectural ambiguity was resolved or
canon amendment introduced.

The complete combined workload and representative live usage/egress remain
open: this small fixture excludes resale/search enrichment, periodic reorg work
and real provider/cache behavior. Independent durable encrypted recovery and
restore evidence, and reviewed activation of the newer worker and ownership API
on the existing server, remain separate gates. The Saved/search whole-response
gate was already closed by PR442 and was not repeated here.
