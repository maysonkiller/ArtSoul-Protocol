# B30 — Database egress incident

Status: confirmed indexer defect fixed on the active Base Sepolia host;
repository CI/release pending. Provider quota restriction remains open.
Work date: October 29, 2026 in Europe/Warsaw; measurements below use UTC.
Scope: canonical B2/B3, indexer/database operations, Bible sections 1 and 15.
No contract, economic, lifecycle, permission or schema change.

## Evidence and cause

The founder supplied a Supabase notice reporting 411.15 GB of 275 GB egress
and restriction until November 24. These are the notice's billing figures,
not an independently retrieved usage dashboard. The available dashboard
session belongs to a different organization; no billing setting was changed.

The active database measured 100,912,275 bytes; Storage metadata recorded
159 objects totaling 115,603,645 bytes. Egress is cumulative network transfer,
not stored size. Supabase separately labels PostgREST and Supavisor traffic;
see [egress documentation](https://supabase.com/docs/guides/platform/manage-your-usage/egress).

`IndexerSyncEngine._computeStateHash` downloaded every historical block hash
through the confirmed cursor, joined the strings in Node, and sent the result
back to PostgreSQL for SHA-256. It runs during synchronization and reorg checks.
The host polls every two seconds. One measured Base history held 140,197 rows,
or 9,253,002 bytes of hash text before row/protocol overhead.

At containment, `pg_stat_statements` query `-8998087275607607246` showed
1,287,486 calls and 16,221,744,465 returned rows. These counters are cumulative
over the statistics collection period, **not** this billing cycle. They prove
the repeated large transfer, but do not attribute every billed byte of the
411.15 GB notice to this query. The provider breakdown remains required.

## Correction and safe rollout

The same ordered, comma-separated SHA-256 is now calculated entirely inside
PostgreSQL using `string_agg`, `digest` and `encode`. Empty history remains the
hash of the empty string. Chain and block cutoff remain bound parameters.
One query returns one 64-character digest instead of the history. No hash
version, reorg check, cursor, polling interval or historical row is changed.
This bounds response size; database computation still grows with history.

The deployed host contains previously reviewed targeted fixes, so the full
checkout was not replaced. Only this method was substituted after checking the
complete pre-patch file hash and preserving a root-only source backup/journal.

- Pre-patch source SHA-256:
  `565bc4dd76381f94d89363b334c550b15904cb19c62b1dd154640bce077de3fc`.
- Post-patch source SHA-256:
  `85ff8cca6410216ee2d84df98fb8a49fe4072cfb9216e94ed3e1af933785fa02`.
- Candidate method SHA-256:
  `08e89dca51bb368d29444f847dfb82309faf4ec7daa91f48121d9a4e644b7a6e`.
- Base worker stopped at 23:16:14 UTC and resumed at 23:21:22 UTC, October 28.
- Preserved confirmed cursor: 51,537,518. The new query exactly matched stored
  hash `0xeb97c0a2a719c7acca6542a3011aeb8467946e30899167358e1fc658ec29f5cb`.
- The legacy Ethereum Sepolia worker remained stopped.

Before deployment, six real PostgreSQL read-only fixtures passed: empty
history, ordered prefix, multiple blocks, cutoff, another chain and absent
chain. Eighteen focused unit/event-failure/rollback checks passed. No new
transaction was signed and no projection or checkpoint was reset.

At 23:22:33 and 23:24:13 UTC the old query's call/row counters were unchanged.
The new query advanced from 19 calls/19 rows to 69 calls/69 rows: 50 digest
calculations, exactly 50 returned rows. Confirmed cursor advanced from
51,539,419 to 51,539,919. Health was healthy/synchronized, 12 blocks behind,
zero unresolved, failed or dead events, and zero recent RPC errors. The new
query's execution time over this interval averaged about 43 ms. This is a
bounded observation, not a future monthly usage guarantee.

## Regression and acceptance

- New transport tests reject a second history round trip and propagate query
  failures without retry/fallback writes.
- Disposable PostgreSQL regression exercises 2,048 reverse-inserted blocks,
  multiple cutoffs, chain isolation, empty input and response below 100 bytes.
  Docker is unavailable locally; this test must execute in Linux CI.
- Local full unit run: 2,535 passed, 33 skipped, no failures. That run includes
  the existing unrelated untracked policy tests, which are not part of this
  change; exact committed-candidate CI results must be recorded separately.
- Private read-only measurements and the bounded rollout journal are retained
  under `docs/private/` and the host recovery directory. They are not public
  source files and contain no emitted credential values.

## Remaining incident gates

Real Data API and Storage read requests returned **HTTP 402** at 23:24 UTC.
The public artwork endpoint still returned HTTP 200 with `success: true` and
11 upstream warnings, so HTTP status alone must not be used as an availability
check. Direct database access and the indexer remained operational. This is
not a claim that the user-facing product is restored.

Fixing the consumer does not erase consumed allowance. Retain Spend Cap and
do not move projects, delete data, reset statistics, bypass service restrictions
or enable chargeable usage automatically. The owner must choose restoration
with the provider or an explicitly approved paid-overage decision; otherwise
the notice's refill date remains the stated recovery date. See
[cost control](https://supabase.com/docs/guides/platform/cost-control).

Before closing the incident: inspect the correct organization's billing-cycle
breakdown, restore provider service under an approved decision, verify real
Data API/Storage and populated public results, and record post-fix egress slope.
The historical A9 cost window does not prove present-day cost readiness.
Phase B remains open. No financial support request was sent on the owner's behalf.

## Interpretation and rollback

No canon amendment is needed: computation location changes, not the checksum
or protocol behavior. Temporary worker containment was a reversible response
to confirmed ongoing waste. If a new digest mismatch appears, stop the worker
and preserve the cursor/logs; compare the stored hash before reverting. Blindly
restoring the old method while running would resume the excessive transfer.
